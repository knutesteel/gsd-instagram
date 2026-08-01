import { createHash } from "node:crypto";

const jsonHeaders = { "Content-Type": "application/json" };
const STATUS_LABELS = {
  auto_added: "Auto-Added",
  new: "New",
  sent_to_sheets: "Sent to Sheets",
  generated: "Generated",
  approved_to_post: "Approved",
  posted: "Posted",
  discarded: "Archived",
};

async function authenticatedContext(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !publicKey) throw new Error("Server configuration is incomplete.");
  const headers = { apikey: publicKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return null;
  return { token, supabaseUrl, headers, user: await userResponse.json() };
}

export default async function handler(req, res) {
  const context = await authenticatedContext(req).catch(() => null);
  if (!context) return res.status(401).json({ error: "Sign in required." });
  const { supabaseUrl, headers, user } = context;

  if (req.method === "GET") {
    const response = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&canonical_url=like.${encodeURIComponent("https://gsd.local/content-plan/%")}&select=id,canonical_url,status,generation_identifier,title`, { headers });
    if (!response.ok) return res.status(502).json({ error: "Couldn’t load Content Plan queue links." });
    const items = (await response.json()).map((row) => ({
      articleId: row.id,
      planId: decodeURIComponent(String(row.canonical_url).split("/").pop() || ""),
      status: STATUS_LABELS[row.status] || "New",
      identifier: row.generation_identifier,
      title: row.title,
    }));
    return res.status(200).json({ items });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { planId, title, concept, category = "Recognition", format = "Carousel", cta = "Comment or share" } = req.body ?? {};
  if (!String(planId || "").trim() || !String(title || "").trim()) return res.status(400).json({ error: "A plan item and title are required." });

  const canonicalUrl = `https://gsd.local/content-plan/${encodeURIComponent(String(planId))}`;
  const fingerprint = createHash("sha256").update(canonicalUrl).digest("hex");
  const existingResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&url_fingerprint=eq.${fingerprint}&select=id,status,generation_identifier,title`, { headers });
  if (!existingResponse.ok) return res.status(502).json({ error: "Couldn’t check the Story Queue." });
  const existing = (await existingResponse.json())[0];
  if (existing) return res.status(200).json({ articleId: existing.id, status: STATUS_LABELS[existing.status] || "New", identifier: existing.generation_identifier, alreadyExists: true });

  const identifiersResponse = await fetch(`${supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(user.id)}&select=generation_identifier`, { headers });
  if (!identifiersResponse.ok) return res.status(502).json({ error: "Couldn’t determine the next identifier." });
  const identifiers = (await identifiersResponse.json()).map((row) => Number(row.generation_identifier)).filter((value) => Number.isInteger(value) && value > 0);
  const generationIdentifier = String(identifiers.length ? Math.max(...identifiers) + 1 : 1);

  const articleResponse = await fetch(`${supabaseUrl}/rest/v1/articles`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: user.id,
      canonical_url: canonicalUrl,
      source_url: canonicalUrl,
      source: "Content Plan",
      url_fingerprint: fingerprint,
      title: String(title).trim(),
      category: String(category).trim(),
      rank: 80,
      status: "new",
      generation_identifier: generationIdentifier,
    }),
  });
  if (!articleResponse.ok) return res.status(502).json({ error: `Couldn’t add the item to the Story Queue: ${await articleResponse.text()}` });
  const article = (await articleResponse.json())[0];

  const normalizedFormat = /reel/i.test(format) ? "reel" : /single/i.test(format) ? "single_image" : /multi/i.test(format) ? "multi_pane_cartoon" : "carousel";
  const conceptResponse = await fetch(`${supabaseUrl}/rest/v1/post_concepts`, {
    method: "POST",
    headers: { ...headers, ...jsonHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      article_id: article.id,
      user_id: user.id,
      summary: String(concept || title).slice(0, 200),
      post_type: normalizedFormat,
      panel_count: normalizedFormat === "single_image" ? 1 : 4,
      image_summary: { origin: "content_plan", content: String(concept || ""), plan_id: String(planId), primary_cta: String(cta || "") },
      caption: String(cta || ""),
      hashtags: ["#gsd-book", "#focus", "#productivity"],
    }),
  });
  if (!conceptResponse.ok) return res.status(502).json({ error: `The queue item was created, but its concept could not be saved: ${await conceptResponse.text()}` });

  return res.status(201).json({ articleId: article.id, status: "New", identifier: generationIdentifier, alreadyExists: false });
}
