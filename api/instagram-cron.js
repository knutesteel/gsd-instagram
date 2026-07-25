import { instagramConfig, safeError, serviceHeaders } from "./_instagram.js";
import { syncForUser } from "./instagram-sync.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const secret = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const config = instagramConfig();
    const response = await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?select=user_id`, {
      headers: serviceHeaders(config),
    });
    if (!response.ok) throw new Error("Couldn’t load Instagram connections.");
    const connections = await response.json();
    const results = [];
    for (const connection of connections) {
      try {
        results.push({ userId: connection.user_id, ...(await syncForUser(connection.user_id, config)) });
      } catch (error) {
        results.push({ userId: connection.user_id, error: error instanceof Error ? error.message : "Sync failed." });
      }
    }
    return res.status(200).json({ connections: results.length, results });
  } catch (error) {
    return safeError(res, error);
  }
}
