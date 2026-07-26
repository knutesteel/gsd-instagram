import test from "node:test";
import assert from "node:assert/strict";

function env() {
  return {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    META_APP_ID: "app-id",
    META_APP_SECRET: "app-secret",
    META_OAUTH_STATE_SECRET: "state-secret",
    META_TOKEN_ENCRYPTION_KEY: "encryption-secret",
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("status returns the authenticated user's saved connection and posts", async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  Object.assign(process.env, env());
  t.after(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith("/auth/v1/user")) {
      assert.equal(options.headers.Authorization, "Bearer user-token");
      return Response.json({ id: "user-123" });
    }
    assert.match(value, /user_id=eq\.user-123/);
    assert.equal(options.headers.Authorization, "Bearer service-key");
    if (value.includes("instagram_connections")) {
      return Response.json([{ instagram_username: "hankandthesquirrel" }]);
    }
    if (value.includes("instagram_media?")) {
      return Response.json([{ id: "post-1", caption: "Hello" }]);
    }
    return Response.json([]);
  };

  const { default: handler } = await import("./instagram-status.js");
  const res = responseRecorder();
  await handler({ method: "GET", headers: { authorization: "Bearer user-token" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.connection.instagram_username, "hankandthesquirrel");
  assert.equal(res.body.posts.length, 1);
});

test("status rejects requests without a valid session", async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  Object.assign(process.env, env());
  t.after(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });
  global.fetch = async () => new Response(null, { status: 401 });
  const { default: handler } = await import("./instagram-status.js");
  const res = responseRecorder();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Sign in required.");
});
