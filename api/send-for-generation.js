import { createPrivateKey, sign } from "node:crypto";

const json = { "Content-Type": "application/json" };
const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
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
const createIdentifier = () => Array.from({ length: 6 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)]).join("");
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

async function formatAddedRow(accessToken, rowNumber) {
  if (!rowNumber) return;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: [{ repeatCell: {
      range: { sheetId: 0, startRowIndex: rowNumber - 1, endRowIndex: rowNumber },
      cell: { userEnteredFormat: { verticalAlignment: "TOP", wrapStrategy: "WRAP" } },
      fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
    } }] }),
  });
  if (!response.ok) throw new Error("Couldn’t format the new Google Sheets row.");
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
    const identifier = article.generation_identifier || createIdentifier();
    const url = article.source_url || article.canonical_url || "";
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
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:L")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      headers: { ...json, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ values }),
    });
    if (!response.ok) throw new Error("Couldn’t add the row to Google Sheets.");
    const result = await response.json();
    const destinationRow = Number(String(result.updates?.updatedRange ?? "").match(/!A(\d+):/i)?.[1]);
    await copyPromptFromPreviousRow(accessToken, destinationRow);
    await formatAddedRow(accessToken, destinationRow);
    const rowUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...auth, ...json, Prefer: "return=minimal" },
      body: JSON.stringify({ generation_identifier: identifier, generation_sheet_row: destinationRow }),
    });
    if (!rowUpdate.ok) throw new Error("Couldn’t save the Google Sheets row reference.");
    return res.status(200).json({ updatedRange: result.updates?.updatedRange, sheetRow: destinationRow });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t add the row to Google Sheets." });
  }
}