import { createPrivateKey, sign } from "node:crypto";
import { extendSheetFilter } from "./sheet-filter.js";
import { sharedFieldsFromSheetRow } from "./sheet-sync-fields.js";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
// Grandfather records created before July 25, 2026 in the user's Eastern
// timezone. Keep synchronizing them, but do not surface their historical
// mismatches as current workflow errors.
export const LEGACY_SYNC_ERROR_CUTOFF = "2026-07-25T04:00:00.000Z";
export function shouldReportSyncIssue(createdAt, cutoff = LEGACY_SYNC_ERROR_CUTOFF) {
  if (!createdAt) return true;
  const createdTime = Date.parse(createdAt);
  const cutoffTime = Date.parse(cutoff);
  return !Number.isFinite(createdTime) || !Number.isFinite(cutoffTime) || createdTime >= cutoffTime;
}
const base64Url = (value) => Buffer.from(value).toString("base64url");
const driveFileId = (url) => String(url || "").match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1] || String(url || "").match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] || String(url || "").match(/\/d\/([A-Za-z0-9_-]+)(?:[=/?]|$)/)?.[1];
const driveImageUrl = (url) => {
  const id = driveFileId(url);
  // Keep a stable file reference in the database. The app serves it through a
  // same-origin image endpoint instead of depending on Google's thumbnail UI.
  return id ? `https://drive.google.com/file/d/${id}/view` : url;
};
const extensionFor = (contentType) => contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_ASSET_IMPORTS_PER_RUN = 3;
export const firstMissingImageSequence = (sourceImages, activeAssets) => {
  const imported = new Set((activeAssets || []).map((asset) => Number(asset.sequence)).filter(Number.isInteger));
  return sourceImages.findIndex((_url, index) => !imported.has(index + 1)) + 1;
};
export const countImportedImages = (sourceImages, activeAssets) => {
  const expected = new Set(sourceImages.map((_url, index) => index + 1));
  return new Set((activeAssets || []).map((asset) => Number(asset.sequence)).filter((sequence) => expected.has(sequence))).size;
};
const typeLabel = (postType) => ({ carousel: "Carousel", single_image: "Single Image", multi_pane_cartoon: "Multi-pane Cartoon", reel: "Reel" }[postType] || postType || "Carousel");
const normalizeSheetStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (normalized === "pending" || normalized === "sent to sheets") return { database: "sent_to_sheets", label: "Sent to Sheets" };
  if (normalized === "generated") return { database: "generated", label: "Generated" };
  if (normalized === "approved" || normalized === "approved to post") return { database: "approved_to_post", label: "Approved" };
  if (normalized === "posted") return { database: "posted", label: "Posted" };
  if (normalized === "archived") return { database: "discarded", label: "Archived" };
  return null;
};
const appStatusLabel = (value) => ({ sent_to_sheets: "Sent to Sheets", generated: "Generated", approved_to_post: "Approved", posted: "Posted", new: "New", discarded: "Archived" }[value] || String(value || "Unknown"));
export const currentSheetRowNumber = (rows, row) => rows.indexOf(row) + 1;
export const isNumericIdentifier = (value) => /^\d+$/.test(String(value ?? "").trim());
export const uniqueNumericSheetRows = (rows) => {
  const byIdentifier = new Map();
  const duplicates = new Set();
  for (const row of rows.slice(1)) {
    if (!normalizeSheetStatus(row[1]) || !isNumericIdentifier(row[3])) continue;
    const identifier = String(row[3]).trim();
    if (byIdentifier.has(identifier)) {
      duplicates.add(identifier);
      continue;
    }
    byIdentifier.set(identifier, row);
  }
  for (const identifier of duplicates) byIdentifier.delete(identifier);
  return { rows: [...byIdentifier.values()], duplicateIdentifiers: [...duplicates] };
};
export const isScheduledSyncRequest = (req, cronSecret = process.env.CRON_SECRET) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return Boolean(cronSecret && token === cronSecret);
};
export const uniqueSheetOwner = (articles) => {
  const userIds = [...new Set((articles || []).map((article) => article.user_id).filter(Boolean))];
  if (userIds.length !== 1) {
    throw new Error(userIds.length
      ? "Scheduled sheet synchronization requires one unambiguous sheet owner."
      : "Scheduled sheet synchronization could not find a sheet owner.");
  }
  return userIds[0];
};
export const sheetImageSummary = (currentSummary, images, importedImageCount = 0) => ({
  ...(currentSummary || {}),
  sheet_images: images,
  imported_image_count: importedImageCount,
});
async function createSyncRun({ supabaseUrl, headers, userId, trigger }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/sheet_sync_runs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify([{ user_id: userId, trigger }]),
  });
  if (!response.ok) throw new Error("Couldn’t create the synchronization audit record.");
  return (await response.json())[0];
}
async function finishSyncRun({ supabaseUrl, headers, runId, status, rowsProcessed = 0, rowsFailed = 0, imagesImported = 0, errorMessage = null, details = {} }) {
  if (!runId) return;
  await fetch(`${supabaseUrl}/rest/v1/sheet_sync_runs?id=eq.${runId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      rows_processed: rowsProcessed,
      rows_failed: rowsFailed,
      images_imported: imagesImported,
      error_message: errorMessage,
      details,
      finished_at: new Date().toISOString(),
    }),
  });
}
async function saveItemState({ supabaseUrl, headers, userId, articleId, identifier, stage, status, errorMessage = null, expectedImages = 0, importedImages = 0 }) {
  const failed = status === "failed";
  const now = new Date().toISOString();
  const response = await fetch(`${supabaseUrl}/rest/v1/sheet_sync_items?on_conflict=user_id,article_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      user_id: userId,
      article_id: articleId,
      identifier: Number(identifier),
      stage,
      status,
      error_message: errorMessage,
      expected_images: expectedImages,
      imported_images: importedImages,
      last_attempt_at: now,
      last_success_at: status === "complete" ? now : null,
      next_retry_at: failed ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null,
      retry_count: failed ? 1 : 0,
      updated_at: now,
    }]),
  });
  if (!response.ok) throw new Error(`Couldn’t save synchronization state for #${identifier}.`);
}
async function googleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets connection is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey)).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error("Couldn’t authenticate the Google Sheets connection.");
  return (await response.json()).access_token;
}
async function importImage({ url, accessToken, supabaseUrl, headers, userId, conceptId, sequence }) {
  const id = driveFileId(url);
  const candidates = id ? [
    { url: `https://www.googleapis.com/drive/v3/files/${id}?alt=media`, headers: { Authorization: `Bearer ${accessToken}` } },
    { url: `https://lh3.googleusercontent.com/d/${id}=w2400` },
    { url: `https://drive.usercontent.google.com/download?id=${id}&export=view&confirm=t` },
    { url: `https://drive.google.com/uc?export=view&id=${id}` },
  ] : [{ url }];
  let imageResponse;
  const failures = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, { redirect: "follow", headers: candidate.headers });
      const contentType = String(response.headers.get("content-type") || "").split(";")[0];
      if (response.ok && contentType.startsWith("image/")) { imageResponse = response; break; }
      failures.push(`${new URL(candidate.url).hostname}: HTTP ${response.status}, ${contentType || "unknown type"}`);
    } catch {
      failures.push(`${new URL(candidate.url).hostname}: request failed`);
    }
  }
  if (!imageResponse) throw new Error(`Drive download failed (${failures.join("; ")}).`);
  const contentType = String(imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0];
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length) throw new Error("Drive returned an empty image.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Drive image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit.`);
  const storagePath = `${userId}/generated/${conceptId}/panel-${sequence}.${extensionFor(contentType)}`;
  const upload = await fetch(`${supabaseUrl}/storage/v1/object/post-assets/${storagePath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
    body: bytes,
  });
  if (!upload.ok) {
    const details = await upload.text().catch(() => "");
    throw new Error(`Storage upload failed with HTTP ${upload.status}${details ? `: ${details.slice(0, 180)}` : ""}.`);
  }
  return { sequence, storage_path: storagePath, mime_type: contentType };
}
async function restoreMissingSheetRows({ rows, accessToken, supabaseUrl, headers, userId }) {
  const sheetIdentifiers = new Set(rows.slice(1).map((row) => String(row[3] || "").trim()).filter(Boolean));
  const rowKey = (value) => String(value || "").trim().toLocaleLowerCase().replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(userId)}&status=in.(sent_to_sheets,discarded)&select=id,title,status,source,generation_identifier,source_url,canonical_url,post_concepts(summary,post_type,panel_count,image_summary,caption,hashtags)`, { headers });
  if (!response.ok) throw new Error("Couldn’t check sheet-backed and archived items.");
  const missing = (await response.json()).filter((article) => article.generation_identifier && !sheetIdentifiers.has(String(article.generation_identifier).trim()));
  for (const article of missing) {
    const concept = article.post_concepts?.[0];
    if (!concept) continue;
    const articleUrl = rowKey(article.source_url || article.canonical_url);
    const articleTitle = rowKey(article.title);
    const matchingIndex = rows.slice(1).findIndex((row) =>
      (articleUrl && rowKey(row[4]) === articleUrl) || (articleTitle && rowKey(row[2]) === articleTitle),
    );
    if (matchingIndex >= 0) {
      const rowNumber = matchingIndex + 2;
      const correction = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!D${rowNumber}`)}?valueInputOption=USER_ENTERED`, {
        method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [[article.generation_identifier]] }),
      });
      if (!correction.ok) throw new Error(`Couldn’t correct identifier #${article.generation_identifier} in the Google Sheet.`);
      rows[rowNumber - 1][3] = article.generation_identifier;
      sheetIdentifiers.add(String(article.generation_identifier).trim());
      const rowUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_sheet_row: rowNumber }) });
      if (!rowUpdate.ok) throw new Error(`Couldn’t save the corrected row for #${article.generation_identifier}.`);
      continue;
    }
    const values = [[
      new Date().toISOString().slice(0, 10), article.status === "discarded" ? "Archived" : "Pending", article.title || "", article.generation_identifier,
      article.source_url || article.canonical_url || "", concept.summary || "", concept.panel_count || 1,
      typeLabel(concept.post_type), concept.image_summary?.content || "", "", concept.caption || "",
      Array.isArray(concept.hashtags) ? concept.hashtags.slice(0, 4).join(" ") : "",
      "", "", "", "", "", article.source || "",
    ]];
    const append = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:R")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ values }),
    });
    if (!append.ok) throw new Error(`Couldn’t restore ${article.generation_identifier} to the Google Sheet.`);
    const result = await append.json();
    const rowNumber = Number(String(result.updates?.updatedRange || "").match(/!A(\d+):/i)?.[1]);
    if (rowNumber > 2) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ copyPaste: { source: { sheetId: 0, startRowIndex: rowNumber - 2, endRowIndex: rowNumber - 1, startColumnIndex: 9, endColumnIndex: 10 }, destination: { sheetId: 0, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 9, endColumnIndex: 10 }, pasteType: "PASTE_NORMAL", pasteOrientation: "NORMAL" } }] }),
      });
    }
    await extendSheetFilter({ accessToken, spreadsheetId, lastRow: rowNumber });
    const rowUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_sheet_row: rowNumber }) });
    if (!rowUpdate.ok) throw new Error(`Couldn’t save the restored row for #${article.generation_identifier}.`);
    rows.push(values[0]);
    sheetIdentifiers.add(String(article.generation_identifier).trim());
  }
  return missing.map((article) => article.generation_identifier);
}
export default async function handler(req, res) {
  const scheduled = req.method === "GET" && isScheduledSyncRequest(req);
  if (req.method !== "POST" && !scheduled) return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = scheduled ? serviceKey : publicKey;
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let user;
  let run = null;
  const syncMode = req.syncMode || (scheduled ? "records" : "all");
  if (scheduled) {
    const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const ownersResponse = await fetch(`${supabaseUrl}/rest/v1/articles?generation_identifier=not.is.null&select=user_id`, { headers: serviceHeaders });
    if (!ownersResponse.ok) return res.status(502).json({ error: "Couldn’t resolve the generation sheet owner." });
    try {
      user = { id: uniqueSheetOwner(await ownersResponse.json()) };
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Couldn’t resolve the generation sheet owner." });
    }
    Object.assign(headers, serviceHeaders);
  } else {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
    if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
    user = await userResponse.json();
  }
  try {
    run = await createSyncRun({
      supabaseUrl,
      headers,
      userId: user.id,
      trigger: scheduled ? (syncMode === "assets" ? "scheduled_assets" : "scheduled_records") : "manual",
    });
    const accessToken = await googleToken();
    const sheet = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:R")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sheet.ok) throw new Error("Couldn’t read the generation sheet.");
    const rows = (await sheet.json()).values ?? [];
    // Sheet status reconciliation is the primary responsibility of this route.
    // Row restoration is maintenance work and must never prevent an existing
    // identifier from moving to Generated/Approved/Posted.
    let restoredIdentifiers = [];
    let restorationWarning = null;
    // Numeric app identifiers are the sole synchronization key. Legacy letter
    // values are repaired below; they are never queried as current identities.
    const canonicalRows = uniqueNumericSheetRows(rows);
    const syncedRows = canonicalRows.rows;
    if (!syncedRows.length) {
      await finishSyncRun({ supabaseUrl, headers, runId: run.id, status: "completed" });
      return res.status(200).json({ updatedArticleIds: [], statuses: {}, statusMismatches: [], restoredIdentifiers });
    }
    const updatedArticleIds = [];
    const statuses = {};
    const statusMismatches = [];
    const imagesByArticleId = {};
    const enrichmentQueue = [];
    const articleDatesResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&select=generation_identifier,created_at`, { headers });
    if (!articleDatesResponse.ok) throw new Error("Couldn’t load article dates for synchronization.");
    const articleCreatedAtByIdentifier = new Map(
      (await articleDatesResponse.json())
        .filter((article) => isNumericIdentifier(article.generation_identifier))
        .map((article) => [String(article.generation_identifier).trim(), article.created_at]),
    );
    const syncErrors = canonicalRows.duplicateIdentifiers
      .filter((identifier) => shouldReportSyncIssue(articleCreatedAtByIdentifier.get(identifier)))
      .map((identifier) => ({
        identifier,
        error: `Duplicate spreadsheet rows use identifier #${identifier}. Neither row was synchronized.`,
      }));

    // Pass 1: reconcile every identifier's status before doing any image
    // downloads. Image work can be slow or fail, but it must never prevent a
    // later row from receiving its authoritative sheet status.
    for (const row of syncedRows) {
      const identifier = String(row[3]).trim();
      const rowNumber = currentSheetRowNumber(rows, row);
      try {
      const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&generation_identifier=eq.${encodeURIComponent(identifier)}&select=id,status,title,created_at,source_url,canonical_url,source,generation_identifier,generation_sheet_row,post_concepts(id,summary,post_type,panel_count,image_summary,caption,hashtags)`, { headers });
      if (!articleResponse.ok) throw new Error("Couldn’t load the matching app record.");
      const article = (await articleResponse.json())[0];
      const concept = article?.post_concepts?.[0];
      if (!concept) throw new Error("The matching app record or content is missing.");

      const normalizedStatus = normalizeSheetStatus(row[1]);
      if (!normalizedStatus) continue;
      const sheetStatus = normalizedStatus.database;
      if (article.status !== sheetStatus && shouldReportSyncIssue(article.created_at)) {
        statusMismatches.push({ identifier, appStatus: appStatusLabel(article.status), sheetStatus: normalizedStatus.label });
      }
      if (article.status !== sheetStatus) {
        const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ status: sheetStatus }),
        });
        if (!articleUpdate.ok) throw new Error(`Couldn’t reconcile identifier #${identifier} with the Google Sheet.`);
        updatedArticleIds.push(article.id);
        statuses[article.id] = normalizedStatus.label;
      }
      if (Number(article.generation_sheet_row || 0) !== rowNumber) {
        const rowPointerUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ generation_sheet_row: rowNumber }),
        });
        if (!rowPointerUpdate.ok) throw new Error(`Couldn’t refresh the sheet row for identifier #${identifier}.`);
      }

      // Reconcile every field shared by the spreadsheet and app before image
      // downloads. The sheet is authoritative during a scheduled/manual pull;
      // app saves use update-sheet-detail and write both stores immediately.
      const shared = sharedFieldsFromSheetRow(row);
      const articleFieldsChanged = String(article.title || "") !== shared.article.title
        || String(article.source_url || article.canonical_url || "") !== shared.article.source_url
        || String(article.source || "") !== shared.article.source;
      if (articleFieldsChanged) {
        const metadataUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(shared.article),
        });
        if (!metadataUpdate.ok) throw new Error(`Couldn’t synchronize article fields for #${identifier}.`);
        if (!updatedArticleIds.includes(article.id)) updatedArticleIds.push(article.id);
      }

      const currentContent = String(concept.image_summary?.content || "");
      const conceptFieldsChanged = String(concept.summary || "") !== shared.concept.summary
        || Number(concept.panel_count || 1) !== shared.concept.panel_count
        || String(concept.post_type || "") !== shared.concept.post_type
        || currentContent !== shared.concept.content
        || String(concept.caption || "") !== shared.concept.caption
        || JSON.stringify(concept.hashtags || []) !== JSON.stringify(shared.concept.hashtags);
      if (conceptFieldsChanged) {
        const sharedConceptUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({
            summary: shared.concept.summary,
            panel_count: shared.concept.panel_count,
            post_type: shared.concept.post_type,
            image_summary: { ...(concept.image_summary || {}), content: shared.concept.content },
            caption: shared.concept.caption,
            hashtags: shared.concept.hashtags,
          }),
        });
        if (!sharedConceptUpdate.ok) throw new Error(`Couldn’t synchronize content fields for #${identifier}.`);
        if (!updatedArticleIds.includes(article.id)) updatedArticleIds.push(article.id);
      }

      const sourceImages = row.slice(12, 17).filter(Boolean);
      const images = sourceImages.map(driveImageUrl);
      imagesByArticleId[article.id] = images;
      enrichmentQueue.push({
        identifier,
        article,
        concept: {
          ...concept,
          summary: shared.concept.summary,
          panel_count: shared.concept.panel_count,
          post_type: shared.concept.post_type,
          image_summary: { ...(concept.image_summary || {}), content: shared.concept.content },
          caption: shared.concept.caption,
          hashtags: shared.concept.hashtags,
        },
        row,
        sourceImages,
        images,
      });
      await saveItemState({
        supabaseUrl, headers, userId: user.id, articleId: article.id, identifier,
        stage: sourceImages.length ? "assets_pending" : "record_sync",
        status: sourceImages.length ? "pending" : "complete",
        expectedImages: sourceImages.length,
      });
      } catch (error) {
        if (shouldReportSyncIssue(articleCreatedAtByIdentifier.get(identifier))) {
          syncErrors.push({
            identifier,
            error: error instanceof Error ? error.message : "This row could not be synchronized.",
          });
        }
      }
    }

    // Pass 2: synchronize captions and image references for every status,
    // including Posted. Posted previously returned early, which permanently
    // hid images when the initial import had not completed.
    let imagesImportedThisRun = 0;
    for (const { identifier, article, concept, row, sourceImages, images } of enrichmentQueue) {
      try {
        const caption = String(row[10] || "");
        const hashtags = Array.from(new Set(String(row[11] || "").split(/[\s,]+/).filter(Boolean))).slice(0, 4);
        const currentImages = Array.isArray(concept.image_summary?.sheet_images) ? concept.image_summary.sheet_images : [];
        const importedImageCount = Number(concept.image_summary?.imported_image_count || 0);
        const imageLinksChanged = JSON.stringify(currentImages) !== JSON.stringify(images);
        const linksAndTextSynced = !imageLinksChanged
          && String(concept.caption || "") === caption
          && JSON.stringify(concept.hashtags || []) === JSON.stringify(hashtags);

        // Persist the sheet links first. Generation Details can render these
        // through the same-origin image proxy even if Drive import is slow or
        // temporarily unavailable.
        if (!linksAndTextSynced) {
          const conceptUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify({
              image_summary: sheetImageSummary(
                concept.image_summary,
                images,
                imageLinksChanged ? 0 : importedImageCount,
              ),
              caption,
              hashtags,
            }),
          });
          if (!conceptUpdate.ok) throw new Error(`Couldn’t save generated image links for #${identifier}.`);
          const saved = (await conceptUpdate.json())[0];
          const savedImages = Array.isArray(saved?.image_summary?.sheet_images) ? saved.image_summary.sheet_images : [];
          if (JSON.stringify(savedImages) !== JSON.stringify(images)) {
            throw new Error(`Generated image links for #${identifier} did not verify after saving.`);
          }
        }

        if (!sourceImages.length || syncMode === "records") continue;
        if (imagesImportedThisRun >= MAX_ASSET_IMPORTS_PER_RUN) continue;
        const assetsResponse = await fetch(
          `${supabaseUrl}/rest/v1/assets?concept_id=eq.${concept.id}&source=eq.generated&is_active=eq.true&select=id,sequence,storage_path`,
          { headers },
        );
        if (!assetsResponse.ok) throw new Error(`Couldn’t inspect imported assets for #${identifier}.`);
        const activeAssets = await assetsResponse.json();
        const nextSequence = firstMissingImageSequence(sourceImages, activeAssets);
        const currentImportedCount = countImportedImages(sourceImages, activeAssets);
        if (!nextSequence) {
          if (importedImageCount !== currentImportedCount) {
            const countUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, {
              method: "PATCH",
              headers: { ...headers, Prefer: "return=minimal" },
              body: JSON.stringify({ image_summary: sheetImageSummary(concept.image_summary, images, currentImportedCount) }),
            });
            if (!countUpdate.ok) throw new Error(`Couldn’t verify imported assets for #${identifier}.`);
          }
          await saveItemState({
            supabaseUrl, headers, userId: user.id, articleId: article.id, identifier,
            stage: "assets", status: "complete", expectedImages: sourceImages.length,
            importedImages: currentImportedCount,
          });
          continue;
        }

        // Import one missing panel per item per run. Each panel is committed
        // immediately, so a serverless timeout cannot erase progress or force
        // the next scheduled run to restart the entire carousel.
        const imported = await importImage({
          url: sourceImages[nextSequence - 1],
          accessToken,
          supabaseUrl,
          headers,
          userId: user.id,
          conceptId: concept.id,
          sequence: nextSequence,
        });
        const removeSameSequence = await fetch(
          `${supabaseUrl}/rest/v1/assets?concept_id=eq.${concept.id}&source=eq.generated&sequence=eq.${nextSequence}`,
          { method: "DELETE", headers },
        );
        if (!removeSameSequence.ok) throw new Error(`Couldn’t replace generated panel ${nextSequence} for #${identifier}.`);
        const assetInsert = await fetch(`${supabaseUrl}/rest/v1/assets`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify([{
            concept_id: concept.id,
            user_id: user.id,
            sequence: imported.sequence,
            media_type: "image",
            source: "generated",
            storage_path: imported.storage_path,
            mime_type: imported.mime_type,
            is_active: true,
          }]),
        });
        if (!assetInsert.ok) throw new Error(`Couldn’t save imported panel ${nextSequence} for #${identifier}.`);
        const savedAssets = await assetInsert.json();
        if (!savedAssets.some((asset) => Number(asset.sequence) === nextSequence && asset.storage_path === imported.storage_path)) {
          throw new Error(`Imported panel ${nextSequence} for #${identifier} did not verify after saving.`);
        }
        const newImportedCount = currentImportedCount + 1;
        const countUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ image_summary: sheetImageSummary(concept.image_summary, images, newImportedCount) }),
        });
        if (!countUpdate.ok) throw new Error(`Couldn’t finalize imported assets for #${identifier}.`);
        imagesImportedThisRun += 1;
        await saveItemState({
          supabaseUrl, headers, userId: user.id, articleId: article.id, identifier,
          stage: "assets",
          status: newImportedCount >= sourceImages.length ? "complete" : "pending",
          expectedImages: sourceImages.length,
          importedImages: newImportedCount,
        });
      } catch (error) {
        try {
          await saveItemState({
            supabaseUrl, headers, userId: user.id, articleId: article.id, identifier,
            stage: "assets", status: "failed",
            errorMessage: error instanceof Error ? error.message : "Generated images could not be synchronized.",
            expectedImages: sourceImages.length,
          });
        } catch {}
        if (shouldReportSyncIssue(article.created_at)) {
          syncErrors.push({
            identifier,
            error: error instanceof Error ? error.message : "Generated images could not be synchronized.",
          });
        }
      }
    }
    try {
      restoredIdentifiers = await restoreMissingSheetRows({ rows, accessToken, supabaseUrl, headers, userId: user.id });
    } catch (error) {
      restorationWarning = error instanceof Error ? error.message : "Sheet row restoration did not complete.";
    }
    await finishSyncRun({
      supabaseUrl, headers, runId: run.id,
      status: syncErrors.length || restorationWarning ? "partial" : "completed",
      rowsProcessed: syncedRows.length,
      rowsFailed: syncErrors.length,
      imagesImported: imagesImportedThisRun,
      details: { syncMode, updatedArticleIds, restoredIdentifiers, restorationWarning },
    });
    return res.status(200).json({ scheduled, syncMode, updatedArticleIds, statuses, statusMismatches, imagesByArticleId, restoredIdentifiers, restorationWarning, syncErrors });
  } catch (error) {
    await finishSyncRun({
      supabaseUrl, headers, runId: run?.id, status: "failed",
      errorMessage: error instanceof Error ? error.message : "Couldn’t sync generated content.",
      details: { syncMode },
    });
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t sync generated content." });
  }
}
