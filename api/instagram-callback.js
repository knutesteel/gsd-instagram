import { discoverInstagramAccount, encryptToken, graph, instagramConfig, serviceHeaders, verifyOAuthState } from "./_instagram.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  let config;
  try {
    config = instagramConfig();
    if (req.query.error) throw new Error(String(req.query.error_description || "Instagram authorization was cancelled."));
    const { userId } = verifyOAuthState(req.query.state, config.stateSecret);
    const tokenUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", config.appId);
    tokenUrl.searchParams.set("client_secret", config.appSecret);
    tokenUrl.searchParams.set("redirect_uri", config.callbackUrl);
    tokenUrl.searchParams.set("code", String(req.query.code || ""));
    const shortResponse = await fetch(tokenUrl);
    const short = await shortResponse.json();
    if (!shortResponse.ok || !short.access_token) throw new Error(short.error?.message || "Meta did not return an access token.");
    const long = await graph("oauth/access_token", short.access_token, config, {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: short.access_token,
    });
    const userToken = long.access_token || short.access_token;
    const discovery = await discoverInstagramAccount(userToken, config);
    const { page, account } = discovery;
    if (!page || !account) {
      const pageSummary = discovery.inspectedPages?.length
        ? ` Meta returned ${discovery.inspectedPages.length} Page(s): ${discovery.inspectedPages.map((item) => item.name || item.id).join(", ")}.`
        : " Meta returned no Facebook Pages.";
      throw new Error(`No connected Instagram professional account was found.${pageSummary}`);
    }
    const expiresAt = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null;
    const response = await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?on_conflict=user_id`, {
      method: "POST",
      headers: serviceHeaders(config, "resolution=merge-duplicates,return=representation"),
      body: JSON.stringify({
        user_id: userId,
        instagram_account_id: account.id,
        instagram_username: account.username || account.name || null,
        facebook_page_id: page.id,
        facebook_page_name: page.name || null,
        access_token_encrypted: encryptToken(page.access_token || userToken, config.encryptionKey),
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error("Couldn’t save the Instagram connection.");
    return res.redirect(302, `${config.appUrl}/?instagram=connected`);
  } catch (error) {
    console.error(error);
    const destination = `${config?.appUrl || "https://gsd-instagram2.vercel.app"}/?instagram=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Instagram authorization failed.")}`;
    return res.redirect(302, destination);
  }
}
