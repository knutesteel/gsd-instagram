import { authenticatedUser, createOAuthState, instagramConfig, safeError } from "./_instagram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const config = instagramConfig();
    const user = await authenticatedUser(req, config);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const state = createOAuthState(user.id, config.stateSecret);
    const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", config.callbackUrl);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement");
    return res.status(200).json({ authorizationUrl: url.toString() });
  } catch (error) {
    return safeError(res, error);
  }
}
