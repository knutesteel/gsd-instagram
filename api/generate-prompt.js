const json = { "Content-Type": "application/json" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !publicKey) return res.status(500).json({ error: "Server configuration is incomplete." });
  const auth = { apikey: publicKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: auth });
  if (!userResponse.ok) return res.status(401).json({ error: "Sign in required." });
  const { articleId, title, url, score, postType, panelCount, consistency, setting, content, caption } = req.body ?? {};
  if (!articleId) return res.status(400).json({ error: "Article is required." });
  const documentsResponse = await fetch(`${supabaseUrl}/rest/v1/prompt_documents?select=kind,text_content&is_active=eq.true`, { headers: auth });
  const documents = documentsResponse.ok ? await documentsResponse.json() : [];
  const guide = (kind) => documents.find((document) => document.kind === kind)?.text_content ?? "";
  const prompt = `Use the GSD Voice, ICP, and Visual Guide to create a ${panelCount || 5}-panel Instagram ${postType || "carousel"}.\n\nArticle title: ${title}\nArticle URL: ${url}\nGSD engagement score: ${score}\n\nConsistency: ${consistency}\n\nSetting: ${setting}\n\nContent:\n${content}\n\nCaption:\n${caption || ""}\n\nGSD Voice:\n${guide("voice_guide")}\n\nICP:\n${guide("icp")}\n\nVisual Guide:\n${guide("visual_guide")}\n\nFollow the guides faithfully. Keep dialogue exactly as specified unless the content calls for a revision. Keep characters, clothing, scale, and setting continuous across all panels.`;
  const update = await fetch(`${supabaseUrl}/rest/v1/post_concepts?article_id=eq.${articleId}`, { method: "PATCH", headers: { ...auth, ...json, Prefer: "return=representation" }, body: JSON.stringify({ detailed_prompt: prompt, post_type: postType, panel_count: panelCount, image_summary: { consistency, setting, content }, caption }) });
  if (!update.ok) return res.status(502).json({ error: `Couldn’t save generated prompt: ${await update.text()}` });
  return res.status(200).json({ prompt });
}
