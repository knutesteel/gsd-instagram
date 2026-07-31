const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const fetchRows = async (url, headers) => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Health query failed with HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
};

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).setHeader("Allow", "GET").json({ error: "Method not allowed" });
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ healthy: false, error: "Server configuration is incomplete." });

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...jsonHeaders };
  try {
    const [runs, articles, concepts, syncItems] = await Promise.all([
      fetchRows(`${supabaseUrl}/rest/v1/sheet_sync_runs?select=id,status,rows_processed,rows_failed,error_message,started_at,finished_at,details&order=started_at.desc&limit=1`, headers),
      fetchRows(`${supabaseUrl}/rest/v1/articles?select=id,user_id,generation_identifier,status&generation_identifier=not.is.null`, headers),
      fetchRows(`${supabaseUrl}/rest/v1/post_concepts?select=article_id,image_summary`, headers),
      fetchRows(`${supabaseUrl}/rest/v1/sheet_sync_items?select=user_id,article_id,identifier,status,expected_images,imported_images,error_message`, headers),
    ]);

    const latestRun = runs[0] || null;
    const articleById = new Map(articles.map((article) => [article.id, article]));
    const conceptCounts = new Map();
    for (const concept of concepts) conceptCounts.set(concept.article_id, (conceptCounts.get(concept.article_id) || 0) + 1);

    const identifierCounts = new Map();
    for (const article of articles) {
      const key = `${article.user_id}:${String(article.generation_identifier).trim()}`;
      identifierCounts.set(key, (identifierCounts.get(key) || 0) + 1);
    }

    const duplicateIdentifiers = [...identifierCounts.values()].filter((count) => count > 1).length;
    const missingConcepts = articles.filter((article) => !conceptCounts.has(article.id)).length;
    const duplicateConcepts = [...conceptCounts.values()].filter((count) => count > 1).length;
    const invalidSyncItems = syncItems.filter((item) => {
      const article = articleById.get(item.article_id);
      return !article || article.user_id !== item.user_id || String(article.generation_identifier) !== String(item.identifier);
    }).length;
    const failedSyncItems = syncItems.filter((item) => item.status === "failed").length;
    const incompleteAssets = syncItems.filter((item) => Number(item.expected_images || 0) > Number(item.imported_images || 0) && item.status === "complete").length;

    const latestStarted = latestRun?.started_at ? Date.parse(latestRun.started_at) : NaN;
    const latestAgeMinutes = Number.isFinite(latestStarted) ? Math.round((Date.now() - latestStarted) / 60000) : null;
    const counts = {
      duplicateIdentifiers,
      missingConcepts,
      duplicateConcepts,
      invalidSyncItems,
      failedSyncItems,
      incompleteAssets,
    };
    const invariantFailures = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const runHealthy = Boolean(latestRun)
      && latestRun.status === "completed"
      && Number(latestRun.rows_failed || 0) === 0
      && latestAgeMinutes !== null
      && latestAgeMinutes <= 25;
    const healthy = runHealthy && invariantFailures === 0;

    return res.status(healthy ? 200 : 503).json({
      healthy,
      checkedAt: new Date().toISOString(),
      latestRun: latestRun ? {
        id: latestRun.id,
        status: latestRun.status,
        rowsProcessed: Number(latestRun.rows_processed || 0),
        rowsFailed: Number(latestRun.rows_failed || 0),
        ageMinutes: latestAgeMinutes,
        resultCounts: latestRun.details?.resultCounts || null,
        error: latestRun.error_message || null,
      } : null,
      counts,
    });
  } catch (error) {
    return res.status(503).json({ healthy: false, error: error instanceof Error ? error.message : "Synchronization health check failed." });
  }
}
