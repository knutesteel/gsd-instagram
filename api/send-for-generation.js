import { createPrivateKey, sign } from "node:crypto";

const json = { "Content-Type": "application/json" };
const spreadsheetId = "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets connection is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey)).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!response.ok) throw new Error("Couldn’t authenticate the Google Sheets connection.");
  return (await response.json()).access_token;
}

const typeLabel = (postType) => {
  const names = { carousel: "Carousel", single_image: "Single Image", multi_pane_cartoon: "Multi-pane Cartoon", reel: "Reel" };
  return names[postType] || postType || "Carousel";
};
const numericIdentifier = (value) => /^\d+$/.test(String(value || "").trim()) ? String(value).trim() : "";
async function nextSequentialIdentifier(accessToken, databaseIdentifiers = []) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Couldn’t determine the next sheet identifier.");
  const sheetIdentifiers = ((await response.json()).values ?? []).slice(1).map((row) => Number(numericIdentifier(row[0]))).filter((value) => Number.isInteger(value) && value > 0);
  const appIdentifiers = databaseIdentifiers.map((value) => Number(numericIdentifier(value))).filter((value) => Number.isInteger(value) && value > 0);
  const current = [...sheetIdentifiers, ...appIdentifiers];
  return String((current.length ? Math.max(...current) : 0) + 1);
}
const valueKey = (value) => String(value || "").trim().toLocaleLowerCase();
async function existingSheetRow(accessToken, article) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:L")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Couldn’t check the existing generation row.");
  const rows = ((await response.json()).values || []).slice(1);
  const url = valueKey(article.source_url || article.canonical_url);
  const title = valueKey(article.title);
  const index = rows.findIndex((row) => (url && valueKey(row[4]) === url) || (title && valueKey(row[2]) === title));
  return index < 0 ? null : { row: index + 2, identifier: String(rows[index][3] || "").trim() };
}
async function sheetRowForIdentifier(accessToken, identifier) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Couldn’t locate the sorted Google Sheets row.");
  const rows = (await response.json()).values ?? [];
  const index = rows.findIndex((row) => String(row[0] || "").trim() === String(identifier).trim());
  return index >= 0 ? index + 1 : null;
}
const generationPrompt = ({ title, url, panelCount, type, content }) => `Create a ${panelCount || 1}-panel ${type} Instagram post based on ${url} with the following content:\n\n${content}\n\nPanel 1 must directly introduce the article and show Hank reading a physical newspaper whose visible front-page headline is exactly: “${title}”. The squirrel responds to the headline. For Panels 2 onward, let Hank and the squirrel have a natural, funny conversation inspired by the article’s theme or humane takeaway. Do not mechanically restate the article or force its setting and props into every later panel; a natural setting change and conversational tangent are welcome. Keep both characters present and speaking in every panel, with the last panel landing a warm, practical thought. Use the GSD Voice, Image Guide, and ICP. Store the resulting images, description, and hashtags (maximum of 4) in the Google Sheet row for this article.`;

async function copyPromptFromPreviousRow(accessToken, destinationRow) {
  if (!destinationRow || destinationRow <= 2) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [{ copyPaste: {
      source: { sheetId: 0, startRowIndex: destinationRow - 2, endRowIndex: destinationRow - 1, startColumnIndex: 9, endColumnIndex: 10 },
      destination: { sheetId: 0, startRowIndex: destinationRow - 1, endRowIndex: destinationRow, startColumnIndex: 9, endColumnIndex: 10 },
      pasteType: "PASTE_NORMAL",
      pasteOrientation: "NORMAL",
    } }] }),
  });
  if (!response.ok) throw new Error("Couldn’t copy the Prompt from the previous Google Sheets row.");
}

async function formatAndSortSheet(accessToken) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)" } },
      { sortRange: { range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 17 }, sortSpecs: [{ dimensionIndex: 3, sortOrder: "DESCENDING" }] } },
    ] }),
  });
  if (!response.ok) throw new Error("Couldn’t format and sort the Google Sheet.");
}

async function googleError(response, fallback) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.error?.status || "";
  } catch {
    // The response body is not always JSON. The HTTP status still identifies
    // the failed Google Sheets operation without exposing credentials.
  }
  return detail ? `${fallback} (${response.status}: ${detail})` : `${fallback} (${response.status}).`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !publicKey) return res.status(500).json({ error: "Server configuration is incomplete." });
  const auth = { apikey: publicKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: auth });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();
  const articleId = req.body?.articleId;
  if (!articleId) return res.status(400).json({ error: "Article is required." });

  const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=title,generation_identifier,source_url,canonical_url,post_concepts(summary,post_type,panel_count,image_summary,detailed_prompt,caption,hashtags)`, { headers: auth });
  if (!articleResponse.ok) return res.status(502).json({ error: "Couldn’t load the article for generation." });
  const article = (await articleResponse.json())[0];
  if (!article) return res.status(404).json({ error: "Article not found." });
  const concept = Array.isArray(article.post_concepts) ? article.post_concepts[0] : article.post_concepts;
  if (!concept?.summary || !concept?.image_summary?.content) return res.status(422).json({ error: "Add an article summary and suggested content before sending this item." });

  try {
    const accessToken = await googleAccessToken();
    const content = concept.image_summary.content;
    const existing = await existingSheetRow(accessToken, article);
    const identifiersResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&select=generation_identifier`, { headers: auth });
    if (!identifiersResponse.ok) throw new Error("Couldn’t determine the next app identifier.");
    const databaseIdentifiers = (await identifiersResponse.json()).map((row) => row.generation_identifier);
    // The app/database identifier is authoritative. A legacy Sheet identifier
    // is used only when the app record does not yet have a numeric identifier.
    const identifier = numericIdentifier(article.generation_identifier)
      || numericIdentifier(existing?.identifier)
      || await nextSequentialIdentifier(accessToken, databaseIdentifiers);
    const isTextOverview = concept.image_summary?.origin === "text_overview";
    const url = isTextOverview ? "" : article.source_url || article.canonical_url || "";
    const type = typeLabel(concept.post_type);
    const values = [[
      new Date().toISOString().slice(0, 10),
      "Pending",
      article.title,
      identifier,
      url,
      concept.summary,
      concept.panel_count || 1,
      type,
      content,
      "",
      concept.caption || "",
      Array.isArray(concept.hashtags) ? concept.hashtags.join(" ") : "",
    ]];
    if (existing) {
      // Preserve column J (Prompt), which is owned by the Sheet workflow.
      const update = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
        method: "POST",
        headers: { ...json, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: [
          { range: `Sheet1!A${existing.row}:I${existing.row}`, values: [values[0].slice(0, 9)] },
          { range: `Sheet1!K${existing.row}:L${existing.row}`, values: [[values[0][10], values[0][11]]] },
        ] }),
      });
      if (!update.ok) throw new Error(await googleError(update, "Couldn’t update the existing Google Sheets row"));
      await formatAndSortSheet(accessToken);
      const sortedRow = await sheetRowForIdentifier(accessToken, identifier);
      if (!sortedRow) throw new Error("The updated article could not be found after sorting the Google Sheet.");
      const rowUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH", headers: { ...auth, ...json, Prefer: "return=minimal" },
        body: JSON.stringify({ generation_identifier: identifier, generation_sheet_row: sortedRow }),
      });
      if (!rowUpdate.ok) throw new Error("Couldn’t synchronize the existing Google Sheets row reference.");
      return res.status(200).json({ reusedExistingRow: true, sheetRow: sortedRow, identifier });
    }
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:L")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      headers: { ...json, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ values }),
    });
    if (!response.ok) throw new Error(await googleError(response, "Couldn’t add the row to Google Sheets"));
    const result = await response.json();
    const destinationRow = Number(String(result.updates?.updatedRange ?? "").match(/!A(\d+):/i)?.[1]);
    await copyPromptFromPreviousRow(accessToken, destinationRow);
    await formatAndSortSheet(accessToken);
    const sortedRow = await sheetRowForIdentifier(accessToken, identifier);
    if (!sortedRow) throw new Error("The new article could not be found after sorting the Google Sheet.");
    const rowUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...auth, ...json, Prefer: "return=minimal" },
      body: JSON.stringify({ generation_identifier: identifier, generation_sheet_row: sortedRow }),
    });
    if (!rowUpdate.ok) throw new Error("Couldn’t save the Google Sheets row reference.");
    return res.status(200).json({ updatedRange: result.updates?.updatedRange, sheetRow: sortedRow, identifier });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t add the row to Google Sheets." });
  }
}
