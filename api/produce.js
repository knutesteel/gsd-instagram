import { randomUUID } from "node:crypto";

const json = { "Content-Type": "application/json" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!token || !supabaseUrl || !publicKey || !openaiKey) return res.status(500).json({ error: "Server configuration is incomplete." });
  const auth = { apikey: publicKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: auth });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const user = await userResponse.json();
  const { articleId, requestedChange = "", sequence: requestedSequence } = req.body ?? {};
  if (!articleId) return res.status(400).json({ error: "Article is required." });
  const conceptResponse = await fetch(`${supabaseUrl}/rest/v1/post_concepts?select=*&article_id=eq.${articleId}`, { headers: auth });
  const concepts = conceptResponse.ok ? await conceptResponse.json() : [];
  const concept = concepts[0];
  if (!concept) return res.status(404).json({ error: "Create an article concept before producing assets." });
  const guideResponse = await fetch(`${supabaseUrl}/rest/v1/prompt_documents?select=kind,text_content&is_active=eq.true`, { headers: auth });
  const guides = guideResponse.ok ? await guideResponse.json() : [];
  const guide = (kind) => guides.find((item) => item.kind === kind)?.text_content ?? "";
  const count = Math.min(Math.max(concept.panel_count || 1, 1), 5);
  const sequences = requestedSequence
    ? [Math.min(Math.max(Number(requestedSequence) || 1, 1), count)]
    : Array.from({ length: count }, (_, index) => index + 1);
  const created = [];
  for (const sequence of sequences) {
    const prompt = `Create Instagram carousel panel ${sequence} of ${count}, vertical 4:5. ${concept.detailed_prompt || "Create a Hank and the squirrel scene."}\nGSD Voice: ${guide("voice_guide")}\nVisual Guide: ${guide("visual_guide")}\nKeep Hank and the squirrel’s clothing, scale, and setting continuous across every panel. Include readable speech bubbles only when called for. ${requestedChange ? `Requested change: ${requestedChange}` : ""}`;
    const imageResponse = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { ...json, Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model: "gpt-image-1-mini", prompt, size: "1024x1536", quality: "medium", output_format: "png" }) });
    if (!imageResponse.ok) return res.status(502).json({ error: `Image provider error: ${await imageResponse.text()}` });
    const image = await imageResponse.json();
    const base64 = image.data?.[0]?.b64_json;
    if (!base64) return res.status(502).json({ error: "Image provider returned no image data." });
    const path = `${user.id}/${concept.id}/${sequence}-${randomUUID()}.png`;
    const upload = await fetch(`${supabaseUrl}/storage/v1/object/post-assets/${path}`, { method: "POST", headers: { ...auth, "Content-Type": "image/png", "x-upsert": "true" }, body: Buffer.from(base64, "base64") });
    if (!upload.ok) return res.status(502).json({ error: `Couldn’t save generated image: ${await upload.text()}` });
    const assetResponse = await fetch(`${supabaseUrl}/rest/v1/assets`, { method: "POST", headers: { ...auth, ...json, Prefer: "return=representation" }, body: JSON.stringify({ concept_id: concept.id, user_id: user.id, sequence, media_type: "image", source: "generated", storage_path: path, mime_type: "image/png", generation_prompt: prompt, requested_change: requestedChange || null, is_active: true }) });
    const rows = assetResponse.ok ? await assetResponse.json() : [];
    if (rows[0]) created.push(rows[0]);
  }
  return res.status(200).json({ assets: created });
}
