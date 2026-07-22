import assert from "node:assert/strict";
import test from "node:test";
import { promptForIdentifier } from "./generation-prompt.js";

test("returns column J for the row matching the article identifier", () => {
  const rows = [
    ["Identifier", "URL", "Summary", "Panels", "Type", "Overview", "Prompt"],
    ["12", "url-12", "summary", "3", "Carousel", "overview", "prompt twelve"],
    ["13", "url-13", "summary", "3", "Carousel", "overview", "prompt thirteen"],
  ];
  assert.equal(promptForIdentifier(rows, "13"), "prompt thirteen");
});

test("does not return another row when the identifier is absent", () => {
  assert.equal(promptForIdentifier([["Identifier"], ["12", "url", "summary", "3", "Carousel", "overview", "wrong prompt"]], "13"), "");
});
