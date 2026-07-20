import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");

async function googleAccessToken() {
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
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();
  const articleId = req.body?.articleId;
  if (!articleId) return res.status(400).json({ error: "Article is required." });
  try {
    const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,generation_sheet_row`, { headers });
    const article = (await articleResponse.json())[0];
    if (!article?.generation_sheet_row) return res.status(422).json({ error: "This article has not been sent to the generation sheet yet." });
    const accessToken = await googleAccessToken();
    const update = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!B${article.generation_sheet_row}`)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [["Approved"]] }) });
    if (!update.ok) throw new Error("Couldn’t set the Google Sheet status to Approved.");
    const statusUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved_to_post" }) });
    if (!statusUpdate.ok) throw new Error("Couldn’t save the Approved status in the app.");
    return res.status(200).json({ status: "Approved" });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t approve this post." });
  }
}
