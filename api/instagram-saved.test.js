import test from "node:test";
import assert from "node:assert/strict";
import { savedItemsFromInstagramExport } from "./_instagram-saved.js";

test("saved item importer extracts posts and reels from Instagram HTML", () => {
  const html = `
    <div><a href="https://www.instagram.com/p/ABC123/?utm_source=export">A useful ADHD post</a>
      <div>July 24, 2026 1:15 PM</div></div>
    <div><a href="https://instagram.com/reel/REEL456/">Funny squirrel reel</a></div>
  `;
  const result = savedItemsFromInstagramExport(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].instagram_url, "https://www.instagram.com/p/ABC123/");
  assert.equal(result[0].title, "A useful ADHD post");
  assert.equal(result[0].saved_at, "2026-07-24T13:15:00.000Z");
  assert.equal(result[1].instagram_url, "https://www.instagram.com/reel/REEL456/");
});

test("saved item importer ignores profiles, external links, and duplicates", () => {
  const html = `
    <a href="https://instagram.com/hankandthesquirrel/">Profile</a>
    <a href="https://example.com/p/NOPE/">External</a>
    <a href="https://instagram.com/p/SAME/">First</a>
    <a href="https://instagram.com/p/SAME/?x=1">Duplicate</a>
  `;
  const result = savedItemsFromInstagramExport(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].instagram_url, "https://www.instagram.com/p/SAME/");
});
