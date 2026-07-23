import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets connection is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
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

export function promptForIdentifier(rows, identifier) {
  const normalizedIdentifier = String(identifier ?? "").trim();
  const match = rows.find((row) => String(row[0] ?? "").trim() === normalizedIdentifier);
  return {
    found: Boolean(match),
    prompt: String(match?.[6] ?? ""),
  };
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

  const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=generation_identifier`, { headers: auth });
  if (!articleResponse.ok) return res.status(502).json({ error: "Couldn’t load the article." });
  const article = (await articleResponse.json())[0];
  if (!article) return res.status(404).json({ error: "Article not found." });
  if (!article.generation_identifier) return res.status(422).json({ error: "This article does not have an identifier." });

  try {
    const accessToken = await googleAccessToken();
    const sheetResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:J")}?valueRenderOption=FORMATTED_VALUE&_=${Date.now()}`,
      {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Cache-Control": "no-cache",
        },
      },
    );
    if (!sheetResponse.ok) throw new Error("Couldn’t read the generation prompt from Google Sheets.");
    const { found, prompt } = promptForIdentifier((await sheetResponse.json()).values ?? [], article.generation_identifier);
    if (!found) return res.status(404).json({ error: `No sheet row was found for identifier ${article.generation_identifier}.` });
    if (!prompt.trim()) return res.status(404).json({ error: `Column J is empty for identifier ${article.generation_identifier}.` });
    return res.status(200).json({ prompt });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t retrieve the generation prompt." });
  }
}
