import { randomUUID } from "node:crypto";

const json = { "Content-Type": "application/json" };
const panelBrief = (content, sequence) => {
  const match = String(content ?? "").match(new RegExp(`(?:^|\\n\\s*)Panel\\s+${sequence}\\s*[—:-]([\\s\\S]*?)(?=\\n\\s*Panel\\s+\\d+\\s*[—:-]|$)`, "i"));
  return match?.[0] ?? `Panel ${sequence}: Hank and the squirrel discuss the article together.`;
};
const createImage = async (openaiKey, prompt, reference, count = 1) => {
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
  return fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { ...json, Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model: "gpt-image-1-mini", prompt, n: count, size: "1024x1536", quality: "medium", output_format: "png" }) });
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
  const guideResponse = await fetch(`${supabaseUrl}/rest/v1/prompt_documents?select=kind,text_content,storage_path,file_name,created_at&is_active=eq.true&order=created_at.desc`, { headers: auth });
  const storedGuides = guideResponse.ok ? await guideResponse.json() : [];
  const guides = await Promise.all(storedGuides.map(async (item) => {
    if (item.text_content?.trim() || !item.storage_path) return item;
    const file = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/prompt-documents/${item.storage_path}`, { headers: auth });
    return file.ok ? { ...item, text_content: await file.text() } : item;
  }));
  const guide = (kind) => {
    const promptAsset = guides.find((item) => item.kind === kind && /prompt\.md$/i.test(item.file_name ?? "") && item.text_content?.trim());
    const direct = promptAsset ?? guides.find((item) => item.kind === kind && item.text_content?.trim());
    if (direct) return direct.text_content;
    const clue = kind === "voice_guide" ? /voice/i : /visual|image/i;
    return guides.find((item) => clue.test(item.file_name ?? "") && item.text_content?.trim())?.text_content ?? "";
  };
  const voiceGuide = guide("voice_guide");
  const visualGuide = guide("visual_guide");
  if (!voiceGuide.trim() || !visualGuide.trim()) return res.status(422).json({ error: `Missing readable ${!voiceGuide.trim() ? "GSD Voice" : "Visual Guide"}. Upload the matching .md file in Prompt Guidance (or paste it into that guide’s editable field and click Save).` });
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
  const content = concept.image_summary?.content ?? "";
  const sharedPrompt = `Create an Instagram carousel sequence, vertical 4:5. This is a Hank-and-the-squirrel conversation about the article, never a standalone infographic or generic scene.

NON-NEGOTIABLE CHARACTER CONTINUITY: Hank and the squirrel must both appear in every panel as the same approved characters from the saved Image Prompt. Hank is a raccoon, never a human. Preserve the same characters, outfits, body proportions, illustration style, desk/room, lighting, palette, and scene geography throughout the carousel. Carry recurring props forward logically: do not make an object vanish, switch hands, or change state without an on-panel reason. Do not redesign either character. Use the exact Hank and the squirrel dialogue from each panel brief in two separate, legible speech bubbles connected to the correct speaker. Never replace their conversation with narration, text overlays, or a one-character panel.

ARTICLE-SPECIFIC SETTING: ${concept.image_summary?.setting ?? ""}

===== FULL GSD VOICE GUIDE — HIGHEST PRIORITY =====
${voiceGuide}
===== END GSD VOICE GUIDE =====

===== FULL VISUAL / IMAGE GUIDE — HIGHEST PRIORITY =====
${visualGuide}
===== END VISUAL / IMAGE GUIDE =====

${reference ? "The attached previous panel is the visual source of truth. Preserve it exactly for characters, wardrobe, setting, proportions, art style, and palette; change only the requested panel action and dialogue." : "Treat the first panel as the master reference for the whole sequence; keep every later panel visually continuous with it."}`;
  const panelPrompt = (sequence) => `PANEL ${sequence} OF ${count} — follow exactly:

CURRENT PANEL BRIEF — follow exactly:
${panelBrief(content, sequence)}`;
  const prompt = requestedSequence
    ? `${sharedPrompt}\n\n${panelPrompt(sequences[0])}\n\n${requestedChange ? `Requested change: ${requestedChange}` : ""}`
    : `${sharedPrompt}\n\nCreate one ordered set of ${count} separate Instagram carousel images in this single generation request. Return image 1 for panel 1, image 2 for panel 2, and so on. These are sequential panels in the same scene, not variations of one image.\n\n${sequences.map((sequence) => `===== IMAGE ${sequence} / PANEL ${sequence} =====\n${panelPrompt(sequence)}`).join("\n\n")}`;
  if (prompt.length > 32000) return res.status(422).json({ error: `The combined generation prompt is ${prompt.length.toLocaleString()} characters. Keep the saved Voice and Image Prompts under 30,000 characters combined, then try again.` });
  const imageResponse = await createImage(openaiKey, prompt, reference, requestedSequence ? 1 : count);
  if (!imageResponse.ok) return res.status(502).json({ error: `Image provider error: ${await imageResponse.text()}` });
  const image = await imageResponse.json();
  const generated = image.data ?? [];
  if (generated.length < sequences.length) return res.status(502).json({ error: "Image provider returned fewer carousel panels than requested." });
  for (const [index, sequence] of sequences.entries()) {
    const base64 = generated[index]?.b64_json;
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
