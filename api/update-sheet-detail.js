import { createPrivateKey, sign } from "node:crypto";
import { sharedSheetValuesFromApp } from "./sheet-sync-fields.js";

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

async function findSheetRow(accessToken, identifier) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Sheet1!D:D")}`,
    { headers: { Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-cache" } },
  );
  if (!response.ok) throw new Error("Couldn’t read the generation Google Sheet.");
  const rows = (await response.json()).values ?? [];
  const index = rows.findIndex((row) => String(row[0] || "").trim() === String(identifier).trim());
  return index >= 0 ? index + 1 : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const articleId = req.body?.articleId;
  const values = req.body?.values;
  if (!token || !supabaseUrl || !key) return res.status(500).json({ error: "Server configuration is incomplete." });
  if (!articleId || !values) return res.status(400).json({ error: "Article details are required." });

  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();

  try {
    const articleResponse = await fetch(
      `${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,status,generation_identifier,post_concepts(id,image_summary)`,
      { headers },
    );
    if (!articleResponse.ok) throw new Error("Couldn’t load the article.");
    const article = (await articleResponse.json())[0];
    const concept = Array.isArray(article?.post_concepts) ? article.post_concepts[0] : article?.post_concepts;
    if (!article || !concept) return res.status(404).json({ error: "Article not found." });

    const hashtags = Array.isArray(values.hashtags) ? values.hashtags : [];
    const proposed = {
      article: { title: values.title, source_url: values.url, canonical_url: values.url, rank: values.score },
      concept: {
        summary: values.summary,
        panel_count: values.panelCount,
        post_type: values.postType,
        image_summary: { ...(concept.image_summary || {}), setting: values.setting, content: values.content },
        detailed_prompt: values.prompt,
        caption: values.caption,
        hashtags,
      },
    };

    let sheetRow = null;
    if (article.generation_identifier) {
      const accessToken = await googleAccessToken();
      sheetRow = await findSheetRow(accessToken, article.generation_identifier);
      if (!sheetRow && article.status !== "new" && article.status !== "discarded") {
        throw new Error(`Couldn’t find identifier #${article.generation_identifier} in the Google Sheet.`);
      }
      if (sheetRow) {
        const shared = sharedSheetValuesFromApp(proposed);
        const update = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            valueInputOption: "RAW",
            data: [
              { range: `Sheet1!C${sheetRow}:I${sheetRow}`, majorDimension: "ROWS", values: [[shared.firstRange[0], article.generation_identifier, ...shared.firstRange.slice(1)]] },
              { range: `Sheet1!K${sheetRow}:L${sheetRow}`, majorDimension: "ROWS", values: [shared.secondRange] },
            ],
          }),
        });
        if (!update.ok) throw new Error("Couldn’t save article changes to the Google Sheet.");
      }
    }

    const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(articleId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(proposed.article),
    });
    if (!articleUpdate.ok) throw new Error("Couldn’t save article changes in the app.");
    const conceptUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${encodeURIComponent(concept.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(proposed.concept),
    });
    if (!conceptUpdate.ok) throw new Error("Couldn’t save content changes in the app.");
    return res.status(200).json({ synchronized: Boolean(sheetRow), sheetRow });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t synchronize article changes." });
  }
}
