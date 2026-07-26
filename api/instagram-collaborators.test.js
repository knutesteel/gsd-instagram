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

test("extracts and deduplicates usernames from Instagram HTML exports", () => {
  const result = usernamesFromInstagramExport(`
    <html><body>
      <a href="https://www.instagram.com/bookhumor/">bookhumor</a>
      <a href="https://www.instagram.com/_u/ADHD.author?utm_source=test">@ADHD.author</a>
      <a href="https://www.instagram.com/bookhumor/">BookHumor</a>
    </body></html>
  `);
  assert.deepEqual(result.map((row) => row.username), ["bookhumor", "ADHD.author"]);
  assert.equal(result[1].profile_url, "https://www.instagram.com/ADHD.author/");
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
