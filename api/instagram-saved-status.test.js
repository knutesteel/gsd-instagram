import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSavedItemId, SAVED_ITEM_STATUSES } from "./instagram-saved-status.js";

test("saved-item statuses match the supported review workflow", () => {
  assert.deepEqual([...SAVED_ITEM_STATUSES], ["not_reviewed", "keep", "delete"]);
});

test("saved-item id normalization accepts UUIDs only", () => {
  assert.equal(normalizeSavedItemId(" 123e4567-e89b-42d3-a456-426614174000 "), "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(normalizeSavedItemId("not-an-id"), "");
});
