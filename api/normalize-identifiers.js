import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");
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
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();
  try {
    const articlesResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&select=id,title,generation_identifier,generation_sheet_row,created_at&order=created_at.asc`, { headers });
    if (!articlesResponse.ok) throw new Error("Couldn’t load article identifiers.");
    const articles = await articlesResponse.json();
    const assignments = new Map(articles.map((article, index) => [String(article.generation_identifier || "").trim(), String(index + 1)]));
    const appNeedsUpdate = articles.some((article, index) => String(article.generation_identifier || "") !== String(index + 1));
    const accessToken = await googleToken();
    const sheet = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sheet.ok) throw new Error("Couldn’t read the generation sheet.");
    const rows = (await sheet.json()).values ?? [];
    const updates = rows.slice(1).map((row, index) => {
      const current = String(row[3] || "").trim();
      const next = assignments.get(current) || current;
      return { current, range: `Sheet1!D${index + 2}`, values: [[next]] };
    }).filter((update) => update.values[0][0] && update.values[0][0] !== update.current)
      .map(({ range, values }) => ({ range, values }));
    const sheetNeedsUpdate = updates.length > 0;
    if (!appNeedsUpdate && !sheetNeedsUpdate) return res.status(200).json({ normalized: articles.length, changed: false });
    for (let index = 0; index < articles.length; index += 1) {
      const article = articles[index];
      if (String(article.generation_identifier || "") === String(index + 1)) continue;
      await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_identifier: String(index + 1) }) });
    }
    if (updates.length) await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }) });
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)" } },
      { sortRange: { range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 17 }, sortSpecs: [{ dimensionIndex: 3, sortOrder: "DESCENDING" }] } },
    ] }) });
    // Sorting changes physical row positions. Refresh the stored sheet-row
    // reference so dashboard links and later status updates target the right row.
    const sorted = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sorted.ok) throw new Error("Couldn’t verify the sorted generation sheet.");
    const identifiers = (await sorted.json()).values ?? [];
    for (let index = 0; index < articles.length; index += 1) {
      const identifier = String(index + 1);
      const sheetRow = identifiers.findIndex((row) => String(row[0] || "").trim() === identifier) + 1;
      await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${articles[index].id}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_identifier: identifier, generation_sheet_row: sheetRow || null }) });
    }
    return res.status(200).json({ normalized: articles.length, changed: true });
  } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t normalize identifiers." }); }
}
