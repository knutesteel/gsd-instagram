import { randomUUID } from "node:crypto";

const json = { "Content-Type": "application/json" };
const panelBrief = (content, sequence) => {
  const match = String(content ?? "").match(new RegExp(`(?:^|\\n\\s*)Panel\\s+${sequence}\\s*[—:-]([\\s\\S]*?)(?=\\n\\s*Panel\\s+\\d+\\s*[—:-]|$)`, "i"));
  return match?.[0] ?? `Panel ${sequence}: Hank and the squirrel discuss the article together.`;
};
const createImage = async (openaiKey, prompt, reference) => {
  if (reference) {
    const form = new FormData();
    form.append("model", "gpt-image-1-mini");
    form.append("prompt", prompt);
    form.append("image", new Blob([reference], { type: "image/png" }), "previous-panel.png");
    form.append("size", "1024x1536");
    form.append("quality", "medium");
    form.append("output_format", "png");
    return fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${openaiKey}` }, body: form });
  }
  return fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { ...json, Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model: "gpt-image-1-mini", prompt, size: "1024x1536", quality: "medium", output_format: "png" }) });
};

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
  let reference = null;
  if (requestedSequence && requestedSequence > 1) {
    const previousResponse = await fetch(`${supabaseUrl}/rest/v1/assets?select=storage_path&concept_id=eq.${concept.id}&sequence=lt.${requestedSequence}&is_active=eq.true&order=sequence.desc&limit=1`, { headers: auth });
    const previous = previousResponse.ok ? (await previousResponse.json())[0] : null;
    if (previous?.storage_path) {
      const stored = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/post-assets/${previous.storage_path}`, { headers: auth });
      if (stored.ok) reference = Buffer.from(await stored.arrayBuffer());
    }
  }
  for (const sequence of sequences) {
    const content = concept.image_summary?.content ?? "";
    const prompt = `Create only Instagram carousel panel ${sequence} of ${count}, vertical 4:5. This is a Hank-and-the-squirrel conversation about the article, never a standalone infographic or generic scene.\n\nCURRENT PANEL BRIEF (follow exactly):\n${panelBrief(content, sequence)}\n\nNON-NEGOTIABLE CHARACTER CONTINUITY: Hank and the squirrel must both appear in this panel. Preserve the same Hank, squirrel, outfits, body proportions, illustration style, desk/room, lighting, and color palette throughout the carousel. Do not redesign either character. Use the exact spoken dialog from the panel brief in legible speech bubbles.\n\nConsistency brief: ${concept.image_summary?.consistency ?? ""}\nSetting: ${concept.image_summary?.setting ?? ""}\nGSD Voice: ${guide("voice_guide")}\nVisual Guide: ${guide("visual_guide")}\n${reference ? "The attached previous panel is the visual source of truth. Keep both characters and the setting visually identical; change only the action required by the current panel." : "This is the master character-and-setting reference panel for the carousel."}\n${requestedChange ? `Requested change: ${requestedChange}` : ""}`;
    const imageResponse = await createImage(openaiKey, prompt, reference);
    if (!imageResponse.ok) return res.status(502).json({ error: `Image provider error: ${await imageResponse.text()}` });
    const image = await imageResponse.json();
    const base64 = image.data?.[0]?.b64_json;
    if (!base64) return res.status(502).json({ error: "Image provider returned no image data." });
    const path = `${user.id}/${concept.id}/${sequence}-${randomUUID()}.png`;
    reference = Buffer.from(base64, "base64");
    const upload = await fetch(`${supabaseUrl}/storage/v1/object/post-assets/${path}`, { method: "POST", headers: { ...auth, "Content-Type": "image/png", "x-upsert": "true" }, body: Buffer.from(base64, "base64") });
    if (!upload.ok) return res.status(502).json({ error: `Couldn’t save generated image: ${await upload.text()}` });
    const assetResponse = await fetch(`${supabaseUrl}/rest/v1/assets`, { method: "POST", headers: { ...auth, ...json, Prefer: "return=representation" }, body: JSON.stringify({ concept_id: concept.id, user_id: user.id, sequence, media_type: "image", source: "generated", storage_path: path, mime_type: "image/png", generation_prompt: prompt, requested_change: requestedChange || null, is_active: true }) });
    const rows = assetResponse.ok ? await assetResponse.json() : [];
    if (rows[0]) created.push(rows[0]);
  }
  return res.status(200).json({ assets: created });
}
