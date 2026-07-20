import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1gRQGMBFRRMxW2WZL-ZVGxJNQrCbG2PFpRXukD-1_Xyo";
const base64Url = (value) => Buffer.from(value).toString("base64url");
const driveImageUrl = (url) => {
  const id = String(url || "").match(/\/d\/([^/]+)/)?.[1];
  return id ? `https://drive.google.com/uc?export=view&id=${id}` : url;
};
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
    const generated = rows.slice(1).filter((row) => String(row[1]).toLowerCase() === "generated" && row[3]);
    const articles = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&generation_identifier=in.(${generated.map((row) => row[3]).join(",")})&select=id,generation_identifier,post_concepts(id,image_summary)`, { headers });
    const items = await articles.json(); const updatedArticleIds = [];
    for (const row of generated) { const article = items.find((item) => item.generation_identifier === row[3]); const concept = article?.post_concepts?.[0]; if (!concept) continue; const images = row.slice(12, 17).filter(Boolean).map(driveImageUrl); if (!images.length) continue;
      await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ image_summary: { ...(concept.image_summary || {}), sheet_images: images }, hashtags: String(row[11] || "").split(/[\s,]+/).filter(Boolean) }) });
      await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "generated" }) }); updatedArticleIds.push(article.id); }
    return res.status(200).json({ updatedArticleIds });
  } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t sync generated content." }); }
}
