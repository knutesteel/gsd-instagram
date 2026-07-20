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
  const { mode = "system", manualUrl, searchText, topics = [], timeframe = "48" } = req.body ?? {};
  if (mode === "manual" && !/^https:\/\//i.test(manualUrl ?? "")) return res.status(400).json({ error: "A complete HTTPS article URL is required." });
  const recency = String(timeframe) === "anytime" ? "with no publication-date limit" : `from the past ${Number(timeframe) || 48} hours`;
  const query = `${mode === "manual" ? `Analyze this exact direct article URL: ${manualUrl}. The returned url must exactly match it.` : `Find accessible stories ${recency}. Search focus: ${searchText || topics.join(", ")}.`} Caption requirement: format the caption exactly as three sections separated by one blank line: (1) the main article-specific caption, (2) the exact source URL, and (3) a concise, article-specific call to action that explicitly invites a comment. Do not include the source URL in the content panel brief. Use a CTA relevant to the article, never a generic one; for example, for a squirrel lounging on an air conditioner: “Comment your tip for staying cool.”`;
  const instructions = `You are the GSD Instagram research editor. ${query}
Follow this policy: original accessible sources only; no politics, celebrity gossip, routine sports, paywalls, aggregators, or sensational misinformation. Prioritize neuroscience/behavior, surprising animals, science/space, archaeology, offbeat human stories, attention technology, and immediately useful productivity. Use web search. Return ${mode === "manual" ? "one" : "three"} high-fit stories. Score rank 61-100 based on engagement for the GSD ICP.

Create a clear, factual GSD article analysis. The image_summary.content field is an ARTICLE-SPECIFIC panel brief only. It must begin with the precise article-specific setting on its own first line, formatted exactly as “Setting: [setting]”. Leave one blank line before “Panel 1”. Separate every panel with one blank line and use this exact readable structure:\n\nSetting: [article-specific setting]\n\nPanel [number] — [short story beat]\nAction: [what Hank and the squirrel are each doing; mention only article-specific props or developments]\nHank: “exact line”\nthe squirrel: “exact line”\n\nPanel 1 is mandatory: Hank is reading a physical newspaper article, and the newspaper’s clearly visible front-page headline must display the exact article title. The squirrel is present and responds to what Hank is reading. Treat the printed newspaper headline as an in-scene prop, not a separate text overlay. Every panel must include both Hank and the squirrel, and both must speak at least once. Do not use narration, text overlays, captions, or a panel with only one character in place of their conversation. Create a single causal mini-story across the panels: panel 1 introduces the article, middle panels explain/test its finding, and the final panel lands one humane takeaway. Keep the article-specific setting stable and carry forward relevant story props or actions between panels unless the panel explicitly changes them. Do not include generic style, character, clothing, scale, palette, composition, image-generation instructions, or a source URL in content. Do not return detailed_prompt.`;
  const schema = { type: "object", additionalProperties: false, required: ["stories"], properties: { stories: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url", "publisher", "category", "rank", "summary", "post_type", "panel_count", "image_summary", "caption", "hashtags"], properties: { title: { type: "string" }, url: { type: "string" }, publisher: { type: "string" }, category: { type: "string" }, rank: { type: "number" }, summary: { type: "string" }, post_type: { type: "string", enum: ["single_image", "carousel", "multi_pane_cartoon", "reel"] }, panel_count: { type: "number" }, image_summary: { type: "object", additionalProperties: false, required: ["setting", "content"], properties: { setting: { type: "string" }, content: { type: "string" } } }, caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } } } } } };
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
    if (!articleResponse.ok) return res.status(502).json({ error: `Couldn’t save a discovered article: ${await articleResponse.text()}` });
    const articleRows = articleResponse.ok ? await articleResponse.json() : [];
    let article = articleRows[0];
    if (!article) { const existing = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&url_fingerprint=eq.${fingerprint}`, { headers: auth }); const rows = existing.ok ? await existing.json() : []; article = rows[0]; }
    if (article) {
      const conceptResponse = await fetch(`${supabaseUrl}/rest/v1/post_concepts?on_conflict=article_id`, { method: "POST", headers: { ...auth, ...jsonHeaders, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ article_id: article.id, user_id: user.id, summary: item.summary.slice(0, 200), post_type: item.post_type, panel_count: item.panel_count ?? (item.post_type === "carousel" ? 5 : 1), image_summary: item.image_summary ?? {}, detailed_prompt: null, caption: item.caption, hashtags: normalizeHashtags(item.hashtags) }) });
      if (!conceptResponse.ok) return res.status(502).json({ error: `Couldn’t save the article analysis: ${await conceptResponse.text()}` });
      records.push(article.id);
    }
  }
  if (!records.length) return res.status(502).json({ error: "Search completed but no articles could be saved. Please try again." });
  return res.status(200).json({ count: records.length, articleIds: records });
}
