import {
  decryptToken, discoverInstagramAccount, encryptToken, exchangeLongLivedToken,
  serviceHeaders, tokenRefreshDue,
} from "./_instagram.js";

const expirationFrom = (expiresIn, now = Date.now()) => expiresIn
  ? new Date(now + Number(expiresIn) * 1000).toISOString()
  : null;

export async function persistentInstagramToken(connection, config, now = Date.now()) {
  const pageToken = decryptToken(connection.access_token_encrypted, config.encryptionKey);
  if (!tokenRefreshDue(connection.token_expires_at, now)) return pageToken;

  // Connections created before persistent renewal was introduced keep working
  // with their existing Page token. One reconnect stores the renewable user
  // token; after that, the daily job renews it before expiry.
  if (!connection.user_access_token_encrypted) return pageToken;

  const currentUserToken = decryptToken(connection.user_access_token_encrypted, config.encryptionKey);
  let renewed;
  try {
    renewed = await exchangeLongLivedToken(currentUserToken, config);
  } catch (error) {
    // Do not interrupt a refresh while the current Page token is still valid.
    // The daily job will retry; an actually expired token still produces the
    // normal Meta authorization error when the caller uses it.
    if (new Date(connection.token_expires_at).getTime() > now) return pageToken;
    throw error;
  }

  const renewedUserToken = renewed.access_token || currentUserToken;
  const discovery = await discoverInstagramAccount(renewedUserToken, config);
  if (!discovery.page || !discovery.account) return pageToken;

  const renewedPageToken = discovery.page.access_token || pageToken;
  const patch = {
    facebook_page_id: discovery.page.id,
    facebook_page_name: discovery.page.name || connection.facebook_page_name,
    instagram_account_id: discovery.account.id,
    instagram_username: discovery.account.username || discovery.account.name || connection.instagram_username,
    access_token_encrypted: encryptToken(renewedPageToken, config.encryptionKey),
    user_access_token_encrypted: encryptToken(renewedUserToken, config.encryptionKey),
    token_expires_at: expirationFrom(renewed.expires_in, now) || connection.token_expires_at,
    token_last_refreshed_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const response = await fetch(`${config.supabaseUrl}/rest/v1/instagram_connections?id=eq.${encodeURIComponent(connection.id)}`, {
    method: "PATCH",
    headers: serviceHeaders(config),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error("Couldn’t save the renewed Instagram authorization.");
  return renewedPageToken;
}

