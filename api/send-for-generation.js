import { createPrivateKey, sign } from "node:crypto";
import { extendSheetFilter } from "./sheet-filter.js";

const json = { "Content-Type": "application/json" };
// This workflow has one canonical destination. Do not allow a stale deployment
// variable to silently redirect generation rows to a different spreadsheet.
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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function googleFetch(url, options, operation) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, options);
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) return response;
    if (attempt < 2) await wait(250 * (2 ** attempt));
  }
  if (!response) throw new Error(`${operation} failed before Google Sheets responded.`);
  return response;
}
async function nextSequentialIdentifier(accessToken, databaseIdentifiers = []) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Couldn’t determine the next sheet identifier.");
  const sheetIdentifiers = ((await response.json()).values ?? []).slice(1).map((row) => Number(numericIdentifier(row[0]))).filter((value) => Number.isInteger(value) && value > 0);
  const appIdentifiers = databaseIdentifiers.map((value) => Number(numericIdentifier(value))).filter((value) => Number.isInteger(value) && value > 0);
  const current = [...sheetIdentifiers, ...appIdentifiers];
  return String((current.length ? Math.max(...current) : 0) + 1);
}
const cellValue = (value) => String(value ?? "").trim();
export function locateGenerationRow(rows, identifier) {
  const existingIndex = rows.findIndex((row, rowIndex) => rowIndex > 0 && cellValue(row[3]) === cellValue(identifier));
  if (existingIndex >= 0) return { row: existingIndex + 1, exists: true };
  const emptyIndex = rows.findIndex((row, rowIndex) => rowIndex > 0 && !row.some((value) => cellValue(value)));
  return { row: emptyIndex >= 0 ? emptyIndex + 1 : Math.max(rows.length + 1, 2), exists: false };
}
async function generationSheetRows(accessToken) {
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:Q")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Generation sheet lookup",
  );
  if (!response.ok) throw new Error(await googleError(response, "Couldn’t read the generation sheet"));
  return (await response.json()).values || [];
}
async function sheetRowForIdentifier(accessToken, identifier) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Couldn’t locate the sorted Google Sheets row.");
  const rows = (await response.json()).values ?? [];
  const index = rows.findIndex((row) => String(row[0] || "").trim() === String(identifier).trim());
  return index >= 0 ? index + 1 : null;
}
async function readExactSheetRow(accessToken, row) {
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!A${row}:Q${row}`)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Generation row verification",
  );
  if (!response.ok) throw new Error(await googleError(response, "Couldn’t verify the Google Sheets row"));
  return ((await response.json()).values || [])[0] || [];
}
export function verifyGenerationValues(actual, expected) {
  const padded = Array.from({ length: 17 }, (_, index) => cellValue(actual[index]));
  const wanted = Array.from({ length: 17 }, (_, index) => cellValue(expected[index]));
  const mismatches = [];
  for (let index = 0; index < 12; index += 1) {
    // Column J contains a formula, so the values API returns its calculated
    // result. The exact formula is verified separately through grid data.
    if (index !== 9 && padded[index] !== wanted[index]) mismatches.push(index + 1);
  }
  for (let index = 12; index < 17; index += 1) if (padded[index] !== "") mismatches.push(index + 1);
  return { ok: mismatches.length === 0 && padded[3] === wanted[3], mismatches };
}
export function rowNumberFromUpdatedRange(updatedRange) {
  const match = String(updatedRange || "").match(/![A-Z]+(\d+)(?::[A-Z]+\d+)?$/i);
  const row = match ? Number(match[1]) : NaN;
  return Number.isInteger(row) && row > 0 ? row : null;
}
export const generationPromptFormula = (row) => `="Create a "&G${row}&" "&H${row}&" Instagrage Post based on "&E${row}&" "&" with the following content: "&I${row}&" Create every output image at exactly 1080 pixels wide by 1440 pixels high (3:4 portrait), the default Instagram size. Use he GSD Voice, Image Guide, and ICP. Store the resulting images, description, and hastags (maximum of 4) in the google sheet : 
https://docs.google.com/spreadsheets/d/1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ/edit?gid=0#gid=0, populating the relevant fields for the row with Identifyerer value of "&D${row}`;

async function readGenerationPromptFormula(accessToken, row) {
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent(`Sheet1!J${row}`)}&fields=sheets(data(rowData(values(userEnteredValue))))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Generation prompt formula verification",
  );
  if (!response.ok) throw new Error(await googleError(response, "Couldn’t verify the generation prompt formula"));
  return (await response.json())?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredValue?.formulaValue || "";
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

  let stage = "authenticate";
  let intendedRow = null;
  let identifier = "";
  try {
    const accessToken = await googleAccessToken();
    stage = "prepare";
    const content = concept.image_summary.content;
    const identifiersResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&select=generation_identifier`, { headers: auth });
    if (!identifiersResponse.ok) throw new Error("Couldn’t determine the next app identifier.");
    const databaseIdentifiers = (await identifiersResponse.json()).map((row) => row.generation_identifier);
    // The app/database identifier is authoritative. A legacy Sheet identifier
    // is used only when the app record does not yet have a numeric identifier.
    identifier = numericIdentifier(article.generation_identifier)
      || await nextSequentialIdentifier(accessToken, databaseIdentifiers);
    stage = "locate-row";
    const sheetRows = await generationSheetRows(accessToken);
    const destination = locateGenerationRow(sheetRows, identifier);
    intendedRow = destination.row;
    const isTextOverview = concept.image_summary?.origin === "text_overview";
    const url = isTextOverview ? "" : article.source_url || article.canonical_url || "";
    const type = typeLabel(concept.post_type);
    const promptFormula = generationPromptFormula(intendedRow);
    const rowValues = [
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
      "", "", "", "", "",
    ];
    stage = "write-row";
    const write = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!A${intendedRow}:Q${intendedRow}`)}?valueInputOption=RAW`, {
      method: "PUT",
      headers: { ...json, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ range: `Sheet1!A${intendedRow}:Q${intendedRow}`, majorDimension: "ROWS", values: [rowValues] }),
    }, "Generation row write");
    if (!write.ok) throw new Error(await googleError(write, "Couldn’t write the Google Sheets row"));

    stage = "write-prompt-formula";
    const promptWrite = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!J${intendedRow}`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      headers: { ...json, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ range: `Sheet1!J${intendedRow}`, majorDimension: "ROWS", values: [[promptFormula]] }),
    }, "Generation prompt formula write");
    if (!promptWrite.ok) throw new Error(await googleError(promptWrite, "Couldn’t write the generation prompt formula"));

    stage = "verify-row";
    const actualValues = await readExactSheetRow(accessToken, intendedRow);
    const verification = verifyGenerationValues(actualValues, rowValues);
    if (!verification.ok) throw new Error(`Google Sheets verification failed for columns ${verification.mismatches.join(", ") || "unknown"}.`);
    const actualPromptFormula = await readGenerationPromptFormula(accessToken, intendedRow);
    if (actualPromptFormula !== promptFormula) throw new Error("Google Sheets verification failed for the Column J formula.");

    const warnings = [];
    stage = "format-sort";
    try { await formatAndSortSheet(accessToken); } catch (error) { warnings.push(error instanceof Error ? error.message : "The row was saved, but sheet formatting failed."); }
    stage = "relocate-row";
    const sortedRow = await sheetRowForIdentifier(accessToken, identifier);
    if (!sortedRow) throw new Error("The verified row could not be located by identifier after sorting.");
    stage = "expand-filter";
    try { await extendSheetFilter({ accessToken, spreadsheetId, lastRow: sortedRow }); } catch (error) { warnings.push(error instanceof Error ? error.message : "The row was saved, but the sheet filter was not expanded."); }

    stage = "save-row-reference";
    const rowUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...auth, ...json, Prefer: "return=minimal" },
      body: JSON.stringify({ generation_identifier: identifier, generation_sheet_row: sortedRow }),
    });
    if (!rowUpdate.ok) throw new Error("The sheet row was saved, but the app could not save its row reference.");
    return res.status(200).json({ reusedExistingRow: destination.exists, sheetRow: sortedRow, identifier, verified: true, warnings });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Couldn’t add the row to Google Sheets.",
      diagnostics: { stage, identifier: identifier || null, intendedRow, verified: stage !== "authenticate" && stage !== "prepare" && stage !== "locate-row" && stage !== "write-row" ? false : null },
    });
  }
}
