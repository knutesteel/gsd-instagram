import { authenticatedUser, instagramConfig, safeError, serviceHeaders } from "./_instagram.js";
import { savedItemsFromInstagramExport } from "./_instagram-saved.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const items = savedItemsFromInstagramExport(req.body?.html ?? req.body);
    if (!items.length) return res.status(400).json({ error: "No saved Instagram posts or Reels were found in this HTML export." });
    if (items.length > 10000) return res.status(400).json({ error: "This export contains more saved items than the importer supports." });
    const importedAt = new Date().toISOString();
    const rows = items.map((item) => ({
      user_id: user.id,
      ...item,
      imported_at: importedAt,
      updated_at: importedAt,
    }));
    const response = await fetch(`${config.supabaseUrl}/rest/v1/instagram_saved_items?on_conflict=user_id,instagram_url`, {
      method: "POST",
      headers: serviceHeaders(config, "resolution=merge-duplicates"),
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error("Couldn’t save the imported Instagram items.");
    return res.status(200).json({ imported: rows.length, importedAt });
  } catch (error) {
    return safeError(res, error);
  }
}
