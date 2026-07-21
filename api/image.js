import { createPrivateKey, sign } from "node:crypto";

const validFileId = /^[A-Za-z0-9_-]{10,200}$/;
const base64Url = (value) => Buffer.from(value).toString("base64url");

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) return null;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
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
  if (!response.ok) return null;
  return (await response.json()).access_token ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const fileId = String(req.query?.fileId ?? "").trim();
  if (!validFileId.test(fileId)) return res.status(400).json({ error: "A valid image file is required." });

  const accessToken = await googleAccessToken().catch(() => null);
  const candidates = [
    ...(accessToken ? [{ url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, headers: { Authorization: `Bearer ${accessToken}` } }] : []),
    { url: `https://lh3.googleusercontent.com/d/${fileId}=w2400` },
    { url: `https://drive.usercontent.google.com/download?id=${fileId}&export=view&confirm=t` },
    { url: `https://drive.google.com/uc?export=view&id=${fileId}` },
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, { redirect: "follow", headers: candidate.headers });
      const contentType = String(response.headers.get("content-type") ?? "").split(";")[0];
      if (!response.ok || !contentType.startsWith("image/")) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 50 * 1024 * 1024) return res.status(413).json({ error: "Image is too large." });
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).send(bytes);
    } catch {
      // Try the next public Google Drive image surface.
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ error: "Image could not be loaded from Google Drive." });
}
