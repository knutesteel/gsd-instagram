import { createPrivateKey, sign } from "node:crypto";

const spreadsheetId = process.env.GOOGLE_GENERATION_SHEET_ID || "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ";
const base64Url = (value) => Buffer.from(value).toString("base64url");
const driveFileId = (url) => String(url || "").match(/\/d\/([^/]+)/)?.[1] || String(url || "").match(/[?&]id=([^&]+)/)?.[1];
const driveImageUrl = (url) => {
  const id = driveFileId(url);
  // Google Drive's file-view URL is an HTML page, not a dependable image source.
  // The thumbnail endpoint renders directly in the app while the originals remain in Drive.
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : url;
};
const extensionFor = (contentType) => contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
async function googleToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google Sheets connection is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey)).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error("Couldn’t authenticate the Google Sheets connection.");
  return (await response.json()).access_token;
}
async function importImage({ url, accessToken, supabaseUrl, headers, userId, conceptId, sequence }) {
  const id = driveFileId(url);
  const candidates = id ? [
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ] : [url];
  let imageResponse;
  for (const candidate of candidates) {
    const response = await fetch(candidate, candidate.includes("googleapis.com") ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
    if (response.ok && String(response.headers.get("content-type") || "").startsWith("image/")) { imageResponse = response; break; }
  }
  if (!imageResponse) return null;
  const contentType = String(imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0];
  const storagePath = `${userId}/generated/${conceptId}/panel-${sequence}.${extensionFor(contentType)}`;
  const upload = await fetch(`${supabaseUrl}/storage/v1/object/post-assets/${storagePath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
    body: Buffer.from(await imageResponse.arrayBuffer()),
  });
  if (!upload.ok) return null;
  return { sequence, storage_path: storagePath, mime_type: contentType };
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
    const syncedRows = rows.slice(1).filter((row) => ["generated", "approved"].includes(String(row[1]).trim().toLowerCase()) && row[3]);
    if (!syncedRows.length) return res.status(200).json({ updatedArticleIds: [], statuses: {} });
    const updatedArticleIds = [];
    const statuses = {};
    for (const row of syncedRows) {
      const identifier = String(row[3]).trim();
      const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&generation_identifier=eq.${encodeURIComponent(identifier)}&select=id,generation_identifier,post_concepts(id,image_summary)`, { headers });
      if (!articleResponse.ok) continue;
      const article = (await articleResponse.json())[0];
      const concept = article?.post_concepts?.[0];
      if (!concept) continue;

      const sheetStatus = String(row[1]).trim().toLowerCase();
      if (sheetStatus === "approved") {
        const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved_to_post" }) });
        if (!articleUpdate.ok) throw new Error("Couldn’t mark the article as approved.");
        updatedArticleIds.push(article.id);
        statuses[article.id] = "Approved";
        continue;
      }

      const sourceImages = row.slice(12, 17).filter(Boolean);
      const images = sourceImages.map(driveImageUrl);
      // Save the Generated status and all visible content first. Image import is best-effort
      // so a Drive permission delay never prevents the dashboard from updating.
      const conceptUpdate = await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          image_summary: { ...(concept.image_summary || {}), sheet_images: images, imported_image_count: 0 },
          caption: String(row[10] || ""),
          hashtags: String(row[11] || "").split(/[\\s,]+/).filter(Boolean),
        }),
      });
      if (!conceptUpdate.ok) throw new Error("Couldn’t save the generated post content.");

      if (sourceImages.length) {
        const imported = (await Promise.all(sourceImages.map(async (url, index) => {
          try { return await importImage({ url, accessToken, supabaseUrl, headers, userId: user.id, conceptId: concept.id, sequence: index + 1 }); }
          catch { return null; }
        }))).filter(Boolean);
        if (imported.length) {
          await fetch(`${supabaseUrl}/rest/v1/assets?concept_id=eq.${concept.id}&source=eq.generated`, { method: "DELETE", headers });
          await fetch(`${supabaseUrl}/rest/v1/assets`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(imported.map((asset) => ({ concept_id: concept.id, user_id: user.id, sequence: asset.sequence, media_type: "image", source: "generated", storage_path: asset.storage_path, mime_type: asset.mime_type }))) });
          await fetch(`${supabaseUrl}/rest/v1/post_concepts?id=eq.${concept.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ image_summary: { ...(concept.image_summary || {}), sheet_images: images, imported_image_count: imported.length } }) });
        }
      }

      const articleUpdate = await fetch(`${supabaseUrl}/rest/v1/articles?id=eq.${article.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "generated" }) });
      if (!articleUpdate.ok) throw new Error("Couldn’t mark the article as generated.");
      updatedArticleIds.push(article.id);
      statuses[article.id] = "Generated";
    }
    return res.status(200).json({ updatedArticleIds, statuses });
  } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : "Couldn’t sync generated content." }); }
}
