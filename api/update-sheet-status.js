import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");
const statusMap = {
  New: { app: "new", sheet: "New" },
  "Sent to Sheets": { app: "sent_to_sheets", sheet: "Pending" },
  Generated: { app: "generated", sheet: "Generated" },
  Approved: { app: "approved_to_post", sheet: "Approved" },
  Archived: { app: "discarded", sheet: "Archived" },
};

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
  const articleId = req.body?.articleId;
  const status = req.body?.status;
  const target = statusMap[status];
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  if (!articleId || !target) return res.status(400).json({ error: "A valid article and status are required." });

  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();

  try {
    const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,generation_identifier,generation_sheet_row`, { headers });
    if (!articleResponse.ok) throw new Error("Couldn’t find the article.");
    const article = (await articleResponse.json())[0];
    if (!article) return res.status(404).json({ error: "Article not found." });

    let sheetRow = article.generation_sheet_row;
    let accessToken = null;
    // Rows can move or be recreated after a sheet cleanup. Resolve by identifier
    // before falling back to the saved row number so the wrong story is never updated.
    if (article.generation_identifier) {
      accessToken = await googleAccessToken();
      const lookup = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!B:D")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!lookup.ok) throw new Error("Couldn’t find the article in the Google Sheet.");
      const rows = (await lookup.json()).values ?? [];
      const foundIndex = rows.findIndex((row) => String(row[2] || "").trim() === String(article.generation_identifier).trim());
      if (foundIndex < 0) throw new Error(`Couldn’t find identifier #${article.generation_identifier} in the Google Sheet.`);
      sheetRow = foundIndex + 1;
    }

    if (sheetRow) {
      accessToken ||= await googleAccessToken();
      const update = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Sheet1!B${sheetRow}`)}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [[target.sheet]] }),
      });
      if (!update.ok) throw new Error("Couldn’t update the status in the Google Sheet.");
      if (sheetRow !== article.generation_sheet_row) {
        await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
          method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ generation_sheet_row: sheetRow }),
        });
      }
    }

    const statusUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: target.app }),
    });
    if (!statusUpdate.ok) throw new Error("Couldn’t save the status in the app.");
    return res.status(200).json({ status });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t update the status." });
  }
}
