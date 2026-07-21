import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");
const json = { "Content-Type": "application/json" };

async function googleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets connection is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey)).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error("Couldn’t authenticate the Google Sheets connection.");
  return (await response.json()).access_token;
}

const conceptOf = (article) => Array.isArray(article.post_concepts) ? article.post_concepts[0] : article.post_concepts;
const titleKey = (value) => String(value || "").trim().toLocaleLowerCase();
const urlKey = (value) => String(value || "").trim().toLocaleLowerCase().replace(/\/$/, "");
const sheetValues = (article, identifier) => {
  const concept = conceptOf(article) || {};
  return [[new Date().toISOString().slice(0, 10), "Pending", article.title || "", identifier,
    article.source_url || article.canonical_url || "", concept.summary || "", concept.panel_count || 1,
    ({ carousel: "Carousel", single_image: "Single Image", multi_pane_cartoon: "Multi-pane Cartoon", reel: "Reel" }[concept.post_type] || concept.post_type || "Carousel"),
    concept.image_summary?.content || "", "", concept.caption || "", Array.isArray(concept.hashtags) ? concept.hashtags.join(" ") : ""]];
};

async function copyPromptFromPreviousRow(accessToken, row) {
  if (row <= 2) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST", headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [{ copyPaste: { source: { sheetId: 0, startRowIndex: row - 2, endRowIndex: row - 1, startColumnIndex: 9, endColumnIndex: 10 }, destination: { sheetId: 0, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 9, endColumnIndex: 10 }, pasteType: "PASTE_NORMAL", pasteOrientation: "NORMAL" } }] }),
  });
  if (!response.ok) throw new Error("Couldn’t copy the Prompt from the previous sheet row.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  const headers = { apikey: key, Authorization: `Bearer ${token}`, ...json };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();
  try {
    const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&select=id,title,status,source_url,canonical_url,generation_identifier,generation_sheet_row,created_at,post_concepts(summary,post_type,panel_count,image_summary,caption,hashtags)&order=created_at.asc`, { headers });
    if (!articleResponse.ok) throw new Error("Couldn’t load article identifiers.");
    const articles = await articleResponse.json();
    const accessToken = await googleToken();
    const sheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:L")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sheetResponse.ok) throw new Error("Couldn’t read the generation sheet.");
    const rows = (await sheetResponse.json()).values ?? [];
    const dataRows = rows.slice(1);
    // Identifiers are assigned once, when a record is first sent.  Never derive
    // them from article order: sorting, archiving, and delayed sheet writes would
    // otherwise renumber records independently in the app and Sheet.
    const numericIds = dataRows.map((row) => Number(String(row[3] || "").trim())).filter((value) => Number.isInteger(value) && value > 0);
    const databaseNumericIds = articles.map((article) => Number(String(article.generation_identifier || "").trim())).filter((value) => Number.isInteger(value) && value > 0);
    const allNumericIds = [...numericIds, ...databaseNumericIds];
    let nextId = allNumericIds.length ? Math.max(...allNumericIds) + 1 : 1;
    const uniqueByUrl = new Map();
    const urlCounts = new Map();
    const uniqueByTitle = new Map();
    const titleCounts = new Map();
    for (const article of articles) {
      const url = urlKey(article.source_url || article.canonical_url);
      if (url) urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
      const title = titleKey(article.title);
      if (title) titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    for (const article of articles) {
      const url = urlKey(article.source_url || article.canonical_url);
      if (url && urlCounts.get(url) === 1) uniqueByUrl.set(url, article);
      const title = titleKey(article.title);
      if (title && titleCounts.get(title) === 1) uniqueByTitle.set(title, article);
    }
    const desiredId = new Map();
    const matchedArticleIds = new Set();
    dataRows.forEach((row, index) => {
      // Match content first. The app database is authoritative for an existing
      // article; sorting a sheet must never silently reassign its identifier.
      const article = uniqueByUrl.get(urlKey(row[4])) || uniqueByTitle.get(titleKey(row[2]));
      if (!article) return;
      matchedArticleIds.add(article.id);
      const stored = String(article.generation_identifier || "").trim();
      const sheetValue = String(row[3] || "").trim();
      if (/^\d+$/.test(stored)) desiredId.set(article.id, stored);
      else if (/^\d+$/.test(sheetValue)) desiredId.set(article.id, sheetValue);
      else desiredId.set(article.id, String(nextId++));
    });
    // A previous send can have marked an item Sent to Sheets after a transient append failure.
    // Repair those rows here, matching by title as well as identifier so each article is restored once.
    const missingSent = articles.filter((article) => article.status === "sent_to_sheets" && !matchedArticleIds.has(article.id));
    for (const article of missingSent) {
      const identifier = /^\d+$/.test(String(article.generation_identifier || "")) && !numericIds.includes(Number(article.generation_identifier))
        ? String(article.generation_identifier) : String(nextId++);
      desiredId.set(article.id, identifier);
      const append = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:L")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", headers: { ...json, Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ values: sheetValues(article, identifier) }) });
      if (!append.ok) throw new Error(`Couldn’t restore #${identifier} to the Google Sheet.`);
      const row = Number(String((await append.json()).updates?.updatedRange || "").match(/!A(\d+):/i)?.[1]);
      await copyPromptFromPreviousRow(accessToken, row);
    }
    // Bring the existing sheet cells into line with their app records before
    // sorting. This is deliberately identifier-only: it preserves all content
    // authored in the sheet while fixing an ID drift.
    const sheetIdUpdates = [];
    dataRows.forEach((row, index) => {
      const article = uniqueByUrl.get(urlKey(row[4])) || uniqueByTitle.get(titleKey(row[2]));
      const identifier = article && desiredId.get(article.id);
      if (identifier && String(row[3] || "").trim() !== identifier) {
        sheetIdUpdates.push({ range: `Sheet1!D${index + 2}`, values: [[identifier]] });
      }
    });
    if (sheetIdUpdates.length) {
      const updateIds = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
        method: "POST", headers: { ...json, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: sheetIdUpdates }),
      });
      if (!updateIds.ok) throw new Error("Couldn’t synchronize identifiers in the Google Sheet.");
    }
    const appChanges = articles.filter((article) => desiredId.has(article.id) && String(article.generation_identifier || "") !== desiredId.get(article.id));
    const appUpdateResponses = await Promise.all(appChanges.map((article) => fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_identifier: desiredId.get(article.id) }) })));
    if (appUpdateResponses.some((response) => !response.ok)) throw new Error("Couldn’t save synchronized identifiers in the app database.");
    const formatting = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, { method: "POST", headers: { ...json, Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)" } },
      { sortRange: { range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 17 }, sortSpecs: [{ dimensionIndex: 3, sortOrder: "DESCENDING" }] } },
    ] }) });
    if (!formatting.ok) throw new Error("Couldn’t format and sort the Google Sheet.");
    const sortedResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sortedResponse.ok) throw new Error("Couldn’t verify the sorted generation sheet.");
    const identifiers = (await sortedResponse.json()).values ?? [];
    const rowUpdateResponses = await Promise.all(articles.map((article) => {
      const identifier = desiredId.get(article.id);
      if (!identifier) return Promise.resolve(null);
      const sheetRow = identifiers.findIndex((row) => String(row[0] || "").trim() === identifier) + 1;
      return fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_identifier: identifier, generation_sheet_row: sheetRow || null }) });
    }));
    if (rowUpdateResponses.some((response) => response && !response.ok)) throw new Error("Couldn’t save sorted Google Sheets row references in the app database.");
    return res.status(200).json({ normalized: articles.length, restoredIdentifiers: missingSent.map((article) => desiredId.get(article.id)), changed: Boolean(missingSent.length || appChanges.length || sheetIdUpdates.length) });
  } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t normalize identifiers." }); }
}
