import test from "node:test";
import assert from "node:assert/strict";
import { collaborationFit, followingRefreshDue, usernamesFromInstagramExport } from "./_instagram-collaborators.js";

test("extracts and deduplicates usernames from an Instagram following export", () => {
  const result = usernamesFromInstagramExport({
    relationships_following: [
      { string_list_data: [{ value: "BookHumor", href: "https://instagram.com/bookhumor", timestamp: 1700000000 }] },
      { string_list_data: [{ value: "bookhumor" }] },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].username, "bookhumor");
  assert.match(result[0].followed_at, /^2023-/);
});

test("scores a relevant collaboration profile above a generic profile", () => {
  const relevant = collaborationFit({ biography: "ADHD author sharing productivity humor", followers_count: 12000 });
  const generic = collaborationFit({ biography: "Landscape photographs", followers_count: 900000 });
  assert.ok(relevant.fit_score > generic.fit_score);
  assert.equal(relevant.fit_label, "Excellent");
});

test("following refresh reminder becomes due every three days", () => {
  const now = Date.parse("2026-07-25T18:00:00Z");
  assert.equal(followingRefreshDue(null, now), true);
  assert.equal(followingRefreshDue("2026-07-23T18:00:01Z", now), false);
  assert.equal(followingRefreshDue("2026-07-22T18:00:00Z", now), true);
});
