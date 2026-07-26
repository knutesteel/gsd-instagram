import {
  authenticatedUser, instagramConfig, safeError, serviceHeaders,
} from "./_instagram.js";

async function fetchRows(url, config) {
  const response = await fetch(url, { headers: serviceHeaders(config) });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body?.message || "Couldn’t load saved Instagram data.");
  return body;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const userId = encodeURIComponent(user.id);
    const [connections, posts, prospects] = await Promise.all([
      fetchRows(
        `${config.supabaseUrl}/rest/v1/instagram_connections?user_id=eq.${userId}&select=instagram_username,facebook_page_name,followers_count,last_synced_at,last_following_import_at,last_followers_import_at,token_expires_at&limit=1`,
        config,
      ),
      fetchRows(
        `${config.supabaseUrl}/rest/v1/instagram_media?user_id=eq.${userId}&select=id,article_id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,published_at,like_count,comments_count,instagram_media_insights(captured_on,views,reach,saved,shares,total_interactions,raw_metrics)&order=published_at.desc&limit=500`,
        config,
      ),
      fetchRows(
        `${config.supabaseUrl}/rest/v1/instagram_following?user_id=eq.${userId}&select=id,username,display_name,biography,profile_url,profile_picture_url,followers_count,profile_data_available,fit_score,fit_label,fit_analysis,enriched_at,relationship_type,collaboration_status,content_analysis,brand_fit_analysis,existing_collaborations,recommended_outreach,researched_at&order=fit_score.desc&limit=15000`,
        config,
      ),
    ]);
    return res.status(200).json({
      connection: connections[0] || null,
      posts,
      following: prospects.filter((row) => row.relationship_type !== "followers"),
      followers: prospects.filter((row) => row.relationship_type === "followers"),
      prospects: prospects.filter((row) => row.relationship_type !== "followers"),
    });
  } catch (error) {
    return safeError(res, error);
  }
}
