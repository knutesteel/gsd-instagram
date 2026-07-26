import {
  authenticatedUser, instagramConfig, safeError, serviceHeaders,
} from "./_instagram.js";

export const SAVED_ITEM_STATUSES = new Set(["not_reviewed", "keep", "delete"]);

export function normalizeSavedItemId(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

export default async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const id = normalizeSavedItemId(req.body?.id);
    const status = String(req.body?.status || "");
    if (!id) return res.status(400).json({ error: "Choose a valid saved item." });
    if (!SAVED_ITEM_STATUSES.has(status)) return res.status(400).json({ error: "Choose a valid saved-item status." });
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/instagram_saved_items?user_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: serviceHeaders(config, "return=representation"),
        body: JSON.stringify({ review_status: status, updated_at: new Date().toISOString() }),
      },
    );
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error("Couldn’t update the saved item.");
    if (!rows.length) return res.status(404).json({ error: "Saved item not found." });
    return res.status(200).json({ id, status });
  } catch (error) {
    return safeError(res, error);
  }
}
