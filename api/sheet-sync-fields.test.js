import assert from "node:assert/strict";
import test from "node:test";
import {
  appPostType,
  sharedFieldsFromSheetRow,
  sharedSheetValuesFromApp,
} from "./sheet-sync-fields.js";

test("maps every shared sheet field into the app model", () => {
  const row = ["date", "Generated", "Changed title", "27", "https://example.com", "Changed summary", "4", "Multi-pane Cartoon", "Changed content", "formula", "Changed caption", "#one #two", "", "", "", "", "", "Podcast"];
  assert.deepEqual(sharedFieldsFromSheetRow(row), {
    article: {
      title: "Changed title",
      source_url: "https://example.com",
      canonical_url: "https://example.com",
      source: "Podcast",
    },
    concept: {
      summary: "Changed summary",
      panel_count: 4,
      post_type: "multi_pane_cartoon",
      content: "Changed content",
      caption: "Changed caption",
      hashtags: ["#one", "#two"],
    },
  });
});

test("maps app edits to C:I and K:L without overwriting identifier, prompt, or images", () => {
  assert.deepEqual(sharedSheetValuesFromApp({
    article: { title: "App title", source_url: "https://example.com", source: "Newsletter", rank: 91 },
    concept: {
      summary: "App summary",
      panel_count: 3,
      post_type: "carousel",
      image_summary: { content: "App content" },
      caption: "App caption",
      hashtags: ["#one", "#two"],
    },
  }), {
    firstRange: ["App title", "https://example.com", "App summary", 3, "Carousel", "App content"],
    secondRange: ["App caption", "#one #two"],
    source: "Newsletter",
  });
});

test("normalizes every supported sheet post type", () => {
  assert.equal(appPostType("Single Image"), "single_image");
  assert.equal(appPostType("Multi-pane Cartoon"), "multi_pane_cartoon");
  assert.equal(appPostType("Reel"), "reel");
});
