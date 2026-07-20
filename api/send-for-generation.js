import { createPrivateKey, sign } from "node:crypto";

const json = { "Content-Type": "application/json" };
const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1gRQGMBFRRMxW2WZL-ZVGxJNQrCbG2PFpRXukD-1_Xyo";
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

const formatLabel = (postType, panelCount) => {
  const names = { carousel: "Instagram carousel", single_image: "single image", multi_pane_cartoon: "multi-pane cartoon", reel: "reel" };
  return `${panelCount || 1}-panel ${names[postType] || postType || "Instagram carousel"}`;
};

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

  const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=title,source_url,canonical_url,post_concepts(summary,post_type,panel_count,image_summary,detailed_prompt)`, { headers: auth });
  if (!articleResponse.ok) return res.status(502).json({ error: "Couldn’t load the article for generation." });
  const article = (await articleResponse.json())[0];
  if (!article) return res.status(404).json({ error: "Article not found." });
  const concept = Array.isArray(article.post_concepts) ? article.post_concepts[0] : article.post_concepts;
  if (!concept?.summary || !concept?.image_summary?.content) return res.status(422).json({ error: "Add an article summary and suggested content before sending this item." });

  try {
    const accessToken = await googleAccessToken();
    const content = concept.detailed_prompt?.trim() || concept.image_summary.content;
    const values = [[
      new Date().toISOString().slice(0, 10),
      "New",
      article.title,
      article.source_url || article.canonical_url || "",
      concept.summary,
      formatLabel(concept.post_type, concept.panel_count),
      content,
    ]];
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!A:G")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      headers: { ...json, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ values }),
    });
    if (!response.ok) throw new Error("Couldn’t add the row to Google Sheets.");
    const result = await response.json();
    return res.status(200).json({ updatedRange: result.updates?.updatedRange });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t add the row to Google Sheets." });
  }
}
