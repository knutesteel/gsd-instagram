import { createHash } from "node:crypto";

const jsonHeaders = { "Content-Type": "application/json" };
const extractJson = (text) => {
  const clean = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
  return JSON.parse(clean);
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
  const { mode = "system", manualUrl, searchText, topics = [], timeframe = 48 } = req.body ?? {};
  if (mode === "manual" && !/^https:\/\//i.test(manualUrl ?? "")) return res.status(400).json({ error: "A complete HTTPS article URL is required." });

  const docsResponse = await fetch(`${supabaseUrl}/rest/v1/prompt_documents?select=kind,text_content&is_active=eq.true`, { headers: auth });
  const docs = docsResponse.ok ? await docsResponse.json() : [];
  const voice = docs.find((doc) => doc.kind === "voice_guide")?.text_content ?? "Use a warm, direct, non-judgmental GSD voice. Hank and the squirrel reveal an honest execution insight.";
  const icp = docs.find((doc) => doc.kind === "icp")?.text_content ?? "Knowledge workers who want practical, compassionate help protecting attention and following through.";
  const query = mode === "manual" ? `Analyze this direct article URL: ${manualUrl}` : `Find fresh, accessible stories from the past ${timeframe} hours. Search focus: ${searchText || topics.join(", ")}.`;
  const instructions = `You are the GSD Instagram research editor. ${query}
Follow this policy: original accessible sources only; no politics, celebrity gossip, routine sports, paywalls, aggregators, or sensational misinformation. Prioritize neuroscience/behavior, surprising animals, science/space, archaeology, offbeat human stories, attention technology, and immediately useful productivity. Use web search. Return ${mode === "manual" ? "one" : "three"} high-fit stories. Score rank 61-100 based on engagement for the GSD ICP. GSD ICP: ${icp}\nGSD VOICE: ${voice}\nReturn ONLY a JSON array. Each object must have title,url,publisher,category,rank,summary (25 words max),post_type, panel_count, image_summary (object with exactly consistency,setting,content). For carousel content, write every panel in well-formatted prose: composition, character expression, action, and exact Hank/Squirrel dialog. detailed_prompt must be the full production prompt based on those fields and include continuity. caption,hashtags (array).`;
  const aiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { ...jsonHeaders, Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model: "gpt-5-mini", tools: [{ type: "web_search" }], input: instructions }) });
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
    if (!article) {
      const existing = await fetch(`${supabaseUrl}/rest/v1/articles?select=id&url_fingerprint=eq.${fingerprint}`, { headers: auth });
      const existingRows = existing.ok ? await existing.json() : [];
      article = existingRows[0];
    }
    if (article) {
      await fetch(`${supabaseUrl}/rest/v1/post_concepts?on_conflict=article_id`, { method: "POST", headers: { ...auth, ...jsonHeaders, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ article_id: article.id, user_id: user.id, summary: item.summary.slice(0, 200), post_type: item.post_type, panel_count: item.panel_count ?? (item.post_type === "carousel" ? 5 : 1), image_summary: item.image_summary ?? {}, detailed_prompt: item.detailed_prompt, caption: item.caption, hashtags: item.hashtags ?? [] }) });
      records.push(article.id);
    }
  }
  return res.status(200).json({ count: records.length, articleIds: records });
}
