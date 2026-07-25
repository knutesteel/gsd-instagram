import test from "node:test";
import assert from "node:assert/strict";
import {
  createOAuthState, decryptToken, encryptToken, engagementRate,
  identifierFromCaption, verifyOAuthState,
} from "./_instagram.js";

test("OAuth state verifies and rejects tampering", () => {
  const state = createOAuthState("user-123", "state-secret", 1_000);
  assert.equal(verifyOAuthState(state, "state-secret", 2_000).userId, "user-123");
  assert.throws(() => verifyOAuthState(`${state}x`, "state-secret", 2_000));
  assert.throws(() => verifyOAuthState(state, "state-secret", 1_000 + 11 * 60 * 1000));
});

test("tokens are encrypted and decryptable", () => {
  const encrypted = encryptToken("EAAB-secret-token", "encryption-secret");
  assert.doesNotMatch(encrypted, /EAAB-secret-token/);
  assert.equal(decryptToken(encrypted, "encryption-secret"), "EAAB-secret-token");
  assert.throws(() => decryptToken(encrypted, "wrong-secret"));
});

test("identifier matching requires a bounded number", () => {
  assert.equal(identifierFromCaption("New post #30 — Hank has a plan"), "30");
  assert.equal(identifierFromCaption("Item (29) is live"), "29");
  assert.equal(identifierFromCaption("2026planning"), null);
});

test("engagement rate uses reach as denominator", () => {
  assert.equal(engagementRate({ reach: 1000, total_interactions: 75 }), 7.5);
  assert.equal(engagementRate({ reach: 100, like_count: 4, comments_count: 2, saved: 3, shares: 1 }), 10);
  assert.equal(engagementRate({ reach: 0, total_interactions: 5 }), 0);
});
