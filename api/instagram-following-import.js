import { authenticatedUser, instagramConfig, safeError, serviceHeaders } from "./_instagram.js";
import { collaborationFit, usernamesFromInstagramExport } from "./_instagram-collaborators.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const accounts = usernamesFromInstagramExport(req.body);
    if (!accounts.length) return res.status(400).json({ error: "No followed accounts were found in this Instagram JSON export." });
    if (accounts.length > 7500) return res.status(400).json({ error: "This export contains more accounts than the importer supports." });
    const rows = accounts.map((account) => ({
      user_id: user.id,
      username: account.username,
      profile_url: account.profile_url,
      followed_at: account.followed_at,
      ...collaborationFit(account),
      updated_at: new Date().toISOString(),
    }));
    const response = await fetch(`${config.supabaseUrl}/rest/v1/instagram_following?on_conflict=user_id,username`, {
      method: "POST",
      headers: serviceHeaders(config, "resolution=merge-duplicates"),
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error("Couldn’t save the Instagram following list.");
    return res.status(200).json({ imported: rows.length });
  } catch (error) {
    return safeError(res, error);
  }
}
