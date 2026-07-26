import assert from "node:assert/strict";
import test from "node:test";
import { COLLABORATION_STATUSES, normalizeProspectIds } from "./instagram-collaboration-status.js";

test("collaboration pipeline exposes the five requested statuses", () => {
  assert.deepEqual([...COLLABORATION_STATUSES], [
    "explore",
    "reached_out",
    "in_discussions",
    "in_place",
    "archived",
  ]);
});

test("prospect ids are validated and deduplicated", () => {
  const id = "87a40e1f-f9c6-4e58-b75e-e199966b43bd";
  assert.deepEqual(normalizeProspectIds([id, id, "bad", null]), [id]);
});

