import { authenticatedUser, instagramConfig, safeError, serviceHeaders } from "./_instagram.js";
import { collaborationFit, usernamesFromInstagramExport } from "./_instagram-collaborators.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const relationshipType = req.body?.relationship_type === "followers" ? "followers" : "following";
    const exportData = req.body?.html ?? req.body?.data ?? req.body;
    const accounts = usernamesFromInstagramExport(exportData);
    if (!accounts.length) return res.status(400).json({ error: `No ${relationshipType === "followers" ? "followers" : "followed accounts"} were found in this Instagram export.` });
    if (accounts.length > 7500) return res.status(400).json({ error: "This export contains more accounts than the importer supports." });
    const rows = accounts.map((account) => ({
      user_id: user.id,
      username: account.username,
      profile_url: account.profile_url,
      followed_at: account.followed_at,
      relationship_type: relationshipType,
      ...collaborationFit(account),
      updated_at: new Date().toISOString(),
    }));
    const response = await fetch(`${config.supabaseUrl}/rest/v1/instagram_following?on_conflict=user_id,username,relationship_type`, {
      method: "POST",
      headers: serviceHeaders(config, "resolution=merge-duplicates"),
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error("Couldn’t save the Instagram following list.");
    const importedAt = new Date().toISOString();
    const importField = relationshipType === "followers" ? "last_followers_import_at" : "last_following_import_at";
    const connectionResponse = await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: serviceHeaders(config),
      body: JSON.stringify({ [importField]: importedAt }),
    });
    if (!connectionResponse.ok) throw new Error("The accounts were imported, but the update reminder couldn’t be reset.");
    return res.status(200).json({ imported: rows.length, importedAt, relationshipType });
  } catch (error) {
    return safeError(res, error);
  }
}
