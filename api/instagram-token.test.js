import test from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "./_instagram.js";
import { persistentInstagramToken } from "./_instagram-token.js";

const config = {
  graphVersion: "v24.0",
  appId: "app-id",
  appSecret: "app-secret",
  encryptionKey: "encryption-secret",
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "service-key",
};

test("keeps the current Page token when renewal is not due", async () => {
  const token = await persistentInstagramToken({
    access_token_encrypted: encryptToken("page-token", config.encryptionKey),
    token_expires_at: "2026-09-30T00:00:00.000Z",
  }, config, Date.parse("2026-07-26T00:00:00.000Z"));
  assert.equal(token, "page-token");
});

test("renews and persists the user and Page tokens before expiry", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let saved;
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "example.supabase.co") {
      saved = JSON.parse(options.body);
      return new Response(null, { status: 204 });
    }
    if (parsed.pathname.endsWith("/oauth/access_token")) {
      return Response.json({ access_token: "renewed-user-token", expires_in: 5_184_000 });
    }
    if (parsed.pathname.endsWith("/me/accounts")) {
      return Response.json({ data: [{ id: "page-1", name: "Hank and the Squirrel", access_token: "renewed-page-token" }] });
    }
    if (parsed.pathname.endsWith("/page-1")) {
      return Response.json({
        id: "page-1",
        name: "Hank and the Squirrel",
        instagram_business_account: { id: "ig-1", username: "hankandthesquirrel" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const token = await persistentInstagramToken({
    id: "connection-1",
    facebook_page_name: "Hank and the Squirrel",
    instagram_username: "hankandthesquirrel",
    access_token_encrypted: encryptToken("old-page-token", config.encryptionKey),
    user_access_token_encrypted: encryptToken("old-user-token", config.encryptionKey),
    token_expires_at: "2026-08-01T00:00:00.000Z",
  }, config, Date.parse("2026-07-26T00:00:00.000Z"));

  assert.equal(token, "renewed-page-token");
  assert.equal(decryptToken(saved.user_access_token_encrypted, config.encryptionKey), "renewed-user-token");
  assert.equal(decryptToken(saved.access_token_encrypted, config.encryptionKey), "renewed-page-token");
  assert.equal(saved.token_expires_at, "2026-09-24T00:00:00.000Z");
});
