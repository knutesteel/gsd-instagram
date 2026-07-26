import { authenticatedUser, decryptToken, graph, instagramConfig, safeError, serviceHeaders } from "./_instagram.js";
import { collaborationFit } from "./_instagram-collaborators.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const connectionResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?user_id=eq.${encodeURIComponent(user.id)}&select=*`, {
      headers: serviceHeaders(config),
    });
    const connection = (await connectionResponse.json())[0];
    if (!connection) return res.status(400).json({ error: "Connect Instagram before refreshing collaboration profiles." });
    const candidatesResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_following?user_id=eq.${encodeURIComponent(user.id)}&enriched_at=is.null&select=id,username&limit=25`, {
      headers: serviceHeaders(config),
    });
    const candidates = await candidatesResponse.json();
    const token = decryptToken(connection.access_token_encrypted, config.encryptionKey);
    let enriched = 0;
    await Promise.all(candidates.map(async (candidate) => {
      let profile = { username: candidate.username };
      let available = false;
      try {
        const result = await graph(connection.instagram_account_id, token, config, {
          fields: `business_discovery.username(${candidate.username}){username,name,biography,website,profile_picture_url,followers_count,media_count}`,
        });
        if (result.business_discovery) {
          profile = result.business_discovery;
          available = true;
          enriched += 1;
        }
      } catch {
        // Meta Business Discovery does not expose personal or private accounts.
      }
      const fit = collaborationFit(profile);
      await fetch(`${config.supabaseUrl}/rest/v1/instagram_following?id=eq.${encodeURIComponent(candidate.id)}&user_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: serviceHeaders(config),
        body: JSON.stringify({
          display_name: profile.name || null,
          biography: profile.biography || null,
          website: profile.website || null,
          profile_picture_url: profile.profile_picture_url || null,
          followers_count: available ? Number(profile.followers_count || 0) : null,
          media_count: available ? Number(profile.media_count || 0) : null,
          profile_data_available: available,
          ...fit,
          enriched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }));
    const remainingResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_following?user_id=eq.${encodeURIComponent(user.id)}&enriched_at=is.null&select=id`, {
      method: "HEAD",
      headers: { ...serviceHeaders(config), Prefer: "count=exact" },
    });
    return res.status(200).json({
      processed: candidates.length,
      enriched,
      remaining: Number(remainingResponse.headers.get("content-range")?.split("/")[1] || 0),
    });
  } catch (error) {
    return safeError(res, error);
  }
}
