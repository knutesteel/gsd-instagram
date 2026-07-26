import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const jsonHeaders = { "Content-Type": "application/json" };

export function instagramConfig() {
  const required = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "META_APP_ID",
    "META_APP_SECRET",
    "META_OAUTH_STATE_SECRET",
    "META_TOKEN_ENCRYPTION_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing server configuration: ${missing.join(", ")}`);
  const appUrl = String(process.env.APP_URL || "https://gsd-instagram2.vercel.app").replace(/\/+$/, "");
  return {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    publicKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    stateSecret: process.env.META_OAUTH_STATE_SECRET,
    encryptionKey: process.env.META_TOKEN_ENCRYPTION_KEY,
    graphVersion: process.env.META_GRAPH_API_VERSION || "v24.0",
    appUrl,
    callbackUrl: `${appUrl}/api/instagram-callback`,
  };
}

export async function authenticatedUser(req, config) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.publicKey, Authorization: `Bearer ${token}` },
  });
  return response.ok ? response.json() : null;
}

const base64url = (value) => Buffer.from(value).toString("base64url");

export function createOAuthState(userId, secret, now = Date.now()) {
  const payload = base64url(JSON.stringify({
    userId,
    nonce: randomBytes(18).toString("hex"),
    expiresAt: now + 10 * 60 * 1000,
  }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state, secret, now = Date.now()) {
  const [payload, suppliedSignature] = String(state || "").split(".");
  if (!payload || !suppliedSignature) throw new Error("Invalid authorization state.");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid authorization state.");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!parsed.userId || !parsed.expiresAt || parsed.expiresAt < now) throw new Error("Authorization state expired.");
  return parsed;
}

function keyFromSecret(secret) {
  return createHash("sha256").update(secret).digest();
}

export function encryptToken(token, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(value, secret) {
  const [iv, tag, encrypted] = String(value || "").split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("Stored Instagram authorization is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function serviceHeaders(config, prefer) {
  return {
    ...jsonHeaders,
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export async function graph(path, token, config, params = {}) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path.replace(/^\/+/, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  url.searchParams.set("access_token", token);
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(body.error?.message || "Meta API request failed.");
  return body;
}

export async function discoverInstagramAccount(userToken, config) {
  const pages = [];
  let path = "me/accounts";
  let params = { fields: "id,name,access_token", limit: 100 };

  while (path) {
    const batch = await graph(path, userToken, config, params);
    pages.push(...(batch.data || []));
    const next = batch.paging?.next;
    if (!next) break;
    const nextUrl = new URL(next);
    path = nextUrl.pathname.replace(/^\/[^/]+\//, "");
    params = Object.fromEntries(nextUrl.searchParams.entries());
  }

  for (const page of pages) {
    const pageToken = page.access_token || userToken;
    const details = await graph(page.id, pageToken, config, {
      fields: "id,name,instagram_business_account{id,username,name,profile_picture_url},connected_instagram_account{id,username,name,profile_picture_url}",
    });
    const account = details.instagram_business_account || details.connected_instagram_account;
    if (account?.id) {
      return {
        page: { ...page, name: details.name || page.name },
        account,
      };
    }
  }

  return { page: null, account: null, inspectedPages: pages.map(({ id, name }) => ({ id, name })) };
}

export function engagementRate(metrics) {
  const reach = Number(metrics.reach || 0);
  const interactions = Number(metrics.total_interactions || (
    Number(metrics.like_count || 0) + Number(metrics.comments_count || 0)
    + Number(metrics.saved || 0) + Number(metrics.shares || 0)
  ));
  return reach > 0 ? Number(((interactions / reach) * 100).toFixed(2)) : 0;
}

export function identifierFromCaption(caption) {
  const match = String(caption || "").match(/(?:^|[\s[(])#?(\d{1,6})(?=$|[\s)\].,:;-])/);
  return match?.[1] || null;
}

export function safeError(res, error, status = 500) {
  console.error(error);
  return res.status(status).json({ error: error instanceof Error ? error.message : "Instagram request failed." });
}
