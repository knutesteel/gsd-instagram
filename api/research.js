import { createHash } from "node:crypto";

const jsonHeaders = { "Content-Type": "application/json" };
const extractJson = (text) => {
  const clean = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const firstArray = clean.indexOf("[");
  const firstObject = clean.indexOf("{");
  const start = firstArray === -1 ? firstObject : firstObject === -1 ? firstArray : Math.min(firstArray, firstObject);
  const end = clean[start] === "[" ? clean.lastIndexOf("]") : clean.lastIndexOf("}");
  const parsed = JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean);
  return Array.isArray(parsed) ? parsed : parsed.stories ?? [];
};
const normalizeHashtags = (items) => Array.from(new Set(["#gsd-book", ...(Array.isArray(items) ? items : []).map((tag) => `#${String(tag).replace(/^#/, "").toLowerCase()}`).filter((tag) => tag !== "#gsd-book"), "#focus", "#productivity"])).slice(0, 5);

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
  const { mode = "system", manualUrl, searchText, topics = [], timeframe = 48 } = req.body ?? {};
  if (mode === "manual" && !/^https:\/\//i.test(manualUrl ?? "")) return res.status(400).json({ error: "A complete HTTPS article URL is required." });
  const docsResponse = await fetch(`${supabaseUrl}/rest/v1/prompt_documents?select=kind,text_content,file_name&is_active=eq.true&order=created_at.desc`, { headers: auth });
  const docs = docsResponse.ok ? await docsResponse.json() : [];
  const voice = docs.find((doc) => doc.kind === "voice_guide")?.text_content ?? "Use a warm, direct, non-judgmental GSD voice. Hank and the squirrel reveal an honest execution insight.";
  const icp = docs.find((doc) => doc.kind === "icp")?.text_content ?? "Knowledge workers who want practical, compassionate help protecting attention and following through.";
  const query = mode === "manual" ? `Analyze this exact direct article URL: ${manualUrl}. The returned url must exactly match it.` : `Find fresh, accessible stories from the past ${timeframe} hours. Search focus: ${searchText || topics.join(", ")}.`;
  const instructions = `You are the GSD Instagram research editor. ${query}
Follow this policy: original accessible sources only; no politics, celebrity gossip, routine sports, paywalls, aggregators, or sensational misinformation. Prioritize neuroscience/behavior, surprising animals, science/space, archaeology, offbeat human stories, attention technology, and immediately useful productivity. Use web search. Return ${mode === "manual" ? "one" : "three"} high-fit stories. Score rank 61-100 based on engagement for the GSD ICP.

GSD ICP PROMPT:\n${icp}\n\nGSD VOICE PROMPT:\n${voice}\n\nThe image_summary.content field is an ARTICLE-SPECIFIC panel brief only. It must contain 1–5 clearly separated panels with the article-specific scene/action, Hank’s exact dialogue, and the squirrel’s exact dialogue. Every panel must show both characters discussing or reacting to the article. Do not include any voice-guide, style-guide, visual-guide, clothing, scale, color, palette, composition, continuity, or image-generation instructions in content. Those rules come from saved prompts later. Do not return detailed_prompt.`;
  const schema = { type: "object", additionalProperties: false, required: ["stories"], properties: { stories: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url", "publisher", "category", "rank", "summary", "post_type", "panel_count", "image_summary", "caption", "hashtags"], properties: { title: { type: "string" }, url: { type: "string" }, publisher: { type: "string" }, category: { type: "string" }, rank: { type: "number" }, summary: { type: "string" }, post_type: { type: "string" }, panel_count: { type: "number" }, image_summary: { type: "object", additionalProperties: false, required: ["setting", "content"], properties: { setting: { type: "string" }, content: { type: "string" } } }, caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } } } } } };
  const aiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { ...jsonHeaders, Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model: "gpt-5-mini", tools: [{ type: "web_search" }], input: instructions, text: { format: { type: "json_schema", name: "gsd_article_analysis", strict: true, schema } } }) });
  if (!aiResponse.ok) return res.status(502).json({ error: `Research provider error: ${await aiResponse.text()}` });
  const ai = await aiResponse.json();
  const output = ai.output_text ?? ai.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text;
  let candidates;
  try { candidates = extractJson(output); } catch { return res.status(502).json({ error: "Research response could not be read. Please try again." }); }
  const accepted = candidates.filter((item) => item.title && /^https:\/\//i.test(item.url) && (mode === "manual" || item.rank >= 61)).slice(0, mode === "manual" ? 1 : 3);
  if (accepted.length === 0) return res.status(422).json({ error: mode === "manual" ? "The article could not be analyzed into a usable GSD post concept." : "No qualifying stories were found. Try different topics." });
  const records = [];
  for (const item of accepted) {
    const fingerprint = createHash("sha256").update(item.url.split("#")[0].replace(/\/$/, "")).digest("hex");
    const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles?on_conflict=user_id,url_fingerprint`, { method: "POST", headers: { ...auth, ...jsonHeaders, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ user_id: user.id, canonical_url: item.url, source_url: item.url, url_fingerprint: fingerprint, title: item.title, publisher: item.publisher, category: item.category, rank: item.rank, status: "new" }) });
    const articleRows = articleResponse.ok ? await articleResponse.json() : [];
    let article = articleRows[0];
    if (!article) { const existing = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&url_fingerprint=eq.${fingerprint}`, { headers: auth }); const rows = existing.ok ? await existing.json() : []; article = rows[0]; }
    if (article) {
      await fetch(`${supabaseUrl}/rest/v1/post_concepts?on_conflict=article_id`, { method: "POST", headers: { ...auth, ...jsonHeaders, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ article_id: article.id, user_id: user.id, summary: item.summary.slice(0, 200), post_type: item.post_type, panel_count: item.panel_count ?? (item.post_type === "carousel" ? 5 : 1), image_summary: item.image_summary ?? {}, detailed_prompt: null, caption: item.caption, hashtags: normalizeHashtags(item.hashtags) }) });
      records.push(article.id);
    }
  }
  return res.status(200).json({ count: records.length, articleIds: records });
}
