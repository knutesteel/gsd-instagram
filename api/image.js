const validFileId = /^[A-Za-z0-9_-]{10,200}$/;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const fileId = String(req.query?.fileId ?? "").trim();
  if (!validFileId.test(fileId)) return res.status(400).json({ error: "A valid image file is required." });

  const candidates = [
    `https://lh3.googleusercontent.com/d/${fileId}=w2400`,
    `https://drive.usercontent.google.com/download?id=${fileId}&export=view&confirm=t`,
    `https://drive.google.com/uc?export=view&id=${fileId}`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      const contentType = String(response.headers.get("content-type") ?? "").split(";")[0];
      if (!response.ok || !contentType.startsWith("image/")) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 50 * 1024 * 1024) return res.status(413).json({ error: "Image is too large." });
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).send(bytes);
    } catch {
      // Try the next public Google Drive image surface.
    }
  }

  return res.status(404).json({ error: "Image could not be loaded from Google Drive." });
}
