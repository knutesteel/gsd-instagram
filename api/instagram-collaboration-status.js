import {
  authenticatedUser, instagramConfig, safeError, serviceHeaders,
} from "./_instagram.js";

export const COLLABORATION_STATUSES = new Set([
  "explore",
  "reached_out",
  "in_discussions",
  "in_place",
  "disqualified",
]);

export function normalizeProspectIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || "").trim()).filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))];
}

export default async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const ids = normalizeProspectIds(req.body?.ids);
    const status = String(req.body?.status || "");
    if (!ids.length) return res.status(400).json({ error: "Select at least one account." });
    if (ids.length > 1000) return res.status(400).json({ error: "Update no more than 1,000 accounts at once." });
    if (!COLLABORATION_STATUSES.has(status)) return res.status(400).json({ error: "Choose a valid collaboration status." });
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/instagram_following?user_id=eq.${encodeURIComponent(user.id)}&id=in.(${ids.map(encodeURIComponent).join(",")})`,
      {
        method: "PATCH",
        headers: serviceHeaders(config, "return=representation"),
        body: JSON.stringify({
          collaboration_status: status,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error("Couldn’t update the selected accounts.");
    return res.status(200).json({ updated: rows.length, ids: rows.map((row) => row.id), status });
  } catch (error) {
    return safeError(res, error);
  }
}
