import { createPrivateKey, sign } from "node:crypto";
import { extendSheetFilter } from "./sheet-filter.js";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");
const driveFileId = (url) => String(url || "").match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1] || String(url || "").match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] || String(url || "").match(/\/d\/([A-Za-z0-9_-]+)(?:[=/?]|$)/)?.[1];
const driveImageUrl = (url) => {
  const id = driveFileId(url);
  // Keep a stable file reference in the database. The app serves it through a
  // same-origin image endpoint instead of depending on Google's thumbnail UI.
  return id ? `https://drive.google.com/file/d/${id}/view` : url;
};
const extensionFor = (contentType) => contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
const typeLabel = (postType) => ({ carousel: "Carousel", single_image: "Single Image", multi_pane_cartoon: "Multi-pane Cartoon", reel: "Reel" }[postType] || postType || "Carousel");
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
    `https://lh3.googleusercontent.com/d/${id}=w2400`,
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ] : [url];
  let imageResponse;
  for (const candidate of candidates) {
    const response = await fetch(candidate, candidate.includes("googleapis.com") ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
    if (response.ok && String(response.headers.get("content-type") || "").startsWith("image/")) { imageResponse = response; break; }
  }
  if (!imageResponse) return null;
  const contentType = String(imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0];
  const storagePath = `${userId}/generated/${conceptId}/panel-${sequence}.${extensionFor(contentType)}`;
  const upload = await fetch(`${supabaseUrl}/storage/v1/object/post-assets/${storagePath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
    body: Buffer.from(await imageResponse.arrayBuffer()),
  });
  if (!upload.ok) return null;
  return { sequence, storage_path: storagePath, mime_type: contentType };
}
async function restoreMissingSentRows({ rows, accessToken, supabaseUrl, headers, userId }) {
  const sheetIdentifiers = new Set(rows.slice(1).map((row) => String(row[3] || "").trim()).filter(Boolean));
  const rowKey = (value) => String(value || "").trim().toLocaleLowerCase().replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(userId)}&status=eq.sent_to_sheets&select=id,title,generation_identifier,source_url,canonical_url,post_concepts(summary,post_type,panel_count,image_summary,caption,hashtags)`, { headers });
  if (!response.ok) throw new Error("Couldn’t check Sent to Sheets items.");
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
      new Date().toISOString().slice(0, 10), "Pending", article.title || "", article.generation_identifier,
      article.source_url || article.canonical_url || "", concept.summary || "", concept.panel_count || 1,
      typeLabel(concept.post_type), concept.image_summary?.content || "", "", concept.caption || "",
      Array.isArray(concept.hashtags) ? concept.hashtags.join(" ") : "",
    ]];
    const append = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:L")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL; const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers }); if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();
  try {
    const accessToken = await googleToken();
    const sheet = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:Q")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sheet.ok) throw new Error("Couldn’t read the generation sheet.");
    const rows = (await sheet.json()).values ?? [];
    const restoredIdentifiers = await restoreMissingSentRows({ rows, accessToken, supabaseUrl, headers, userId: user.id });
    const syncedRows = rows.slice(1).filter((row) => ["generated", "approved", "posted"].includes(String(row[1]).trim().toLowerCase()) && row[3]);
    if (!syncedRows.length) return res.status(200).json({ updatedArticleIds: [], statuses: {}, restoredIdentifiers });
    const updatedArticleIds = [];
    const statuses = {};
    const imagesByArticleId = {};
    for (const row of syncedRows) {
      const identifier = String(row[3]).trim();
      const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&generation_identifier=eq.${encodeURIComponent(identifier)}&select=id,status,generation_identifier,post_concepts(id,image_summary,caption,hashtags)`, { headers });
      if (!articleResponse.ok) continue;
      const article = (await articleResponse.json())[0];
      const concept = article?.post_concepts?.[0];
      if (!concept) continue;

      const sheetStatus = String(row[1]).trim().toLowerCase();
      if (sheetStatus === "posted") {
        if (article.status === "posted") continue;
        const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "posted" }) });
        if (!articleUpdate.ok) throw new Error("Couldn’t mark the article as posted.");
        updatedArticleIds.push(article.id);
        statuses[article.id] = "Posted";
        continue;
      }
      if (sheetStatus === "approved") {
        if (article.status === "approved_to_post") continue;
        const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved_to_post" }) });
        if (!articleUpdate.ok) throw new Error("Couldn’t mark the article as approved.");
        updatedArticleIds.push(article.id);
        statuses[article.id] = "Approved";
        continue;
      }

      const sourceImages = row.slice(12, 17).filter(Boolean);
      const images = sourceImages.map(driveImageUrl);
      // Always return the live sheet images, including for rows whose database
      // content is already synchronized. This lets the client repair stale or
      // incomplete local state without relying on another database write.
      imagesByArticleId[article.id] = images;
      const caption = String(row[10] || "");
      const hashtags = String(row[11] || "").split(/[\s,]+/).filter(Boolean);
      const currentImages = Array.isArray(concept.image_summary?.sheet_images) ? concept.image_summary.sheet_images : [];
      const importedImageCount = Number(concept.image_summary?.imported_image_count || 0);
      const alreadySynced = article.status === "generated"
        && JSON.stringify(currentImages) === JSON.stringify(images)
        && String(concept.caption || "") === caption
        && JSON.stringify(concept.hashtags || []) === JSON.stringify(hashtags)
        // A prior Drive permission or availability failure must not permanently
        // suppress image imports. Refresh keeps retrying until every sheet image
        // has a durable copy in app storage.
        && (!sourceImages.length || importedImageCount >= sourceImages.length);
      if (alreadySynced) continue;
      // Save the Generated status and all visible content first. Image import is best-effort
      // so a Drive permission delay never prevents the dashboard from updating.
      const conceptUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          image_summary: { ...(concept.image_summary || {}), sheet_images: images, imported_image_count: 0 },
          caption,
          hashtags,
        }),
      });
      if (!conceptUpdate.ok) throw new Error("Couldn’t save the generated post content.");

      // The sheet status is authoritative. Persist it before attempting any
      // best-effort Drive downloads so a slow, unavailable, or private image
      // cannot leave the dashboard stuck at Sent to Sheets.
      const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "generated" }),
      });
      if (!articleUpdate.ok) throw new Error("Couldn’t mark the article as generated.");
      updatedArticleIds.push(article.id);
      statuses[article.id] = "Generated";

      if (sourceImages.length) {
        const imported = (await Promise.all(sourceImages.map(async (url, index) => {
          try { return await importImage({ url, accessToken, supabaseUrl, headers, userId: user.id, conceptId: concept.id, sequence: index + 1 }); }
          catch { return null; }
        }))).filter(Boolean);
        if (imported.length) {
          await fetch(`${supabaseUrl}/rest/v1/assets?concept_id=eq.${concept.id}&source=eq.generated`, { method: "DELETE", headers });
          const assetInsert = await fetch(`${supabaseUrl}/rest/v1/assets`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(imported.map((asset) => ({ concept_id: concept.id, user_id: user.id, sequence: asset.sequence, media_type: "image", source: "generated", storage_path: asset.storage_path, mime_type: asset.mime_type }))) });
          if (assetInsert.ok) await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ image_summary: { ...(concept.image_summary || {}), sheet_images: images, imported_image_count: imported.length } }) });
        }
      }

    }
    return res.status(200).json({ updatedArticleIds, statuses, imagesByArticleId, restoredIdentifiers });
  } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t sync generated content." }); }
}
