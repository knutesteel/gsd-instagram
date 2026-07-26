import {
  authenticatedUser, decryptToken, engagementRate, graph, identifierFromCaption,
  instagramConfig, safeError, serviceHeaders,
} from "./_instagram.js";

const metricNames = ["reach", "saved", "shares", "total_interactions", "views", "plays", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];

async function mediaInsights(mediaId, token, config) {
  const metrics = {};
  await Promise.all(metricNames.map(async (metric) => {
    try {
      const result = await graph(`${mediaId}/insights`, token, config, { metric });
      const item = result.data?.[0];
      metrics[metric] = Number(item?.values?.[0]?.value ?? item?.value ?? 0);
    } catch {
      // Meta exposes different metrics for images, carousels, and reels.
    }
  }));
  return metrics;
}

async function syncForUser(userId, config) {
  const connectionResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?user_id=eq.${encodeURIComponent(userId)}&select=*`, {
    headers: serviceHeaders(config),
  });
  const connection = (await connectionResponse.json())[0];
  if (!connection) throw new Error("Connect Instagram before refreshing insights.");
  const token = decryptToken(connection.access_token_encrypted, config.encryptionKey);
  const profile = await graph(connection.instagram_account_id, token, config, {
    fields: "username,followers_count,media_count",
  });
  const media = [];
  let next = `${connection.instagram_account_id}/media`;
  let params = {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    limit: 100,
  };
  while (next && media.length < 500) {
    const page = next.startsWith("http")
      ? await (async () => {
          const response = await fetch(next);
          const body = await response.json();
          if (!response.ok || body.error) throw new Error(body.error?.message || "Couldn’t load Instagram posts.");
          return body;
        })()
      : await graph(next, token, config, params);
    media.push(...(page.data || []));
    next = page.paging?.next || "";
    params = {};
  }
  const articleResponse = await fetch(`${config.supabaseUrl}/rest/v1/articles?user_id=eq.${encodeURIComponent(userId)}&select=id,generation_identifier,status`, {
    headers: serviceHeaders(config),
  });
  const articles = await articleResponse.json();
  const articleByIdentifier = new Map(articles.map((article) => [String(article.generation_identifier || ""), article]));
  let matched = 0;
  for (const item of media.slice(0, 500)) {
    const insights = await mediaInsights(item.id, token, config);
    const identifier = identifierFromCaption(item.caption);
    const article = identifier ? articleByIdentifier.get(identifier) : null;
    if (article) matched += 1;
    const metrics = {
      reach: insights.reach || 0,
      views: insights.views || insights.plays || 0,
      saved: insights.saved || 0,
      shares: insights.shares || 0,
      total_interactions: insights.total_interactions || 0,
    };
    const postResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_media?on_conflict=user_id,instagram_media_id`, {
      method: "POST",
      headers: serviceHeaders(config, "resolution=merge-duplicates,return=representation"),
      body: JSON.stringify({
        user_id: userId,
        connection_id: connection.id,
        article_id: article?.id || null,
        instagram_media_id: item.id,
        caption: item.caption || "",
        media_type: item.media_type || null,
        media_product_type: item.media_product_type || null,
        media_url: item.media_url || null,
        thumbnail_url: item.thumbnail_url || null,
        permalink: item.permalink || null,
        published_at: item.timestamp || null,
        like_count: Number(item.like_count || 0),
        comments_count: Number(item.comments_count || 0),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!postResponse.ok) throw new Error("Couldn’t save Instagram post metrics.");
    const savedPost = (await postResponse.json())[0];
    const rate = engagementRate({ ...metrics, like_count: item.like_count, comments_count: item.comments_count });
    const snapshotResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_media_insights?on_conflict=media_id,captured_on`, {
      method: "POST",
      headers: serviceHeaders(config, "resolution=merge-duplicates"),
      body: JSON.stringify({
        media_id: savedPost.id,
        user_id: userId,
        captured_on: new Date().toISOString().slice(0, 10),
        ...metrics,
        average_watch_time_ms: insights.ig_reels_avg_watch_time || 0,
        watch_time_ms: insights.ig_reels_video_view_total_time || 0,
        raw_metrics: { ...insights, like_count: Number(item.like_count || 0), comments_count: Number(item.comments_count || 0), engagement_rate: rate },
      }),
    });
    if (!snapshotResponse.ok) throw new Error("Couldn’t save the Instagram metrics history.");
    if (article && article.status !== "posted") {
      await fetch(`${config.supabaseUrl}/rest/v1/articles?id=eq.${encodeURIComponent(article.id)}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: serviceHeaders(config),
        body: JSON.stringify({ status: "posted" }),
      });
    }
  }
  await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?id=eq.${encodeURIComponent(connection.id)}`, {
    method: "PATCH",
    headers: serviceHeaders(config),
    body: JSON.stringify({
      instagram_username: profile.username || connection.instagram_username,
      followers_count: Number(profile.followers_count || 0),
      media_count: Number(profile.media_count || 0),
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    }),
  });
  return { imported: media.length, matched };
}

export { syncForUser };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    return res.status(200).json(await syncForUser(user.id, config));
  } catch (error) {
    return safeError(res, error);
  }
}
