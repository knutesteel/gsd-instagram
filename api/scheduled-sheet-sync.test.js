import test from "node:test";
import assert from "node:assert/strict";
import {
  isScheduledSyncRequest,
  uniqueSheetOwner,
} from "./sync-sheet-generation.js";

test("accepts only the configured cron bearer token as a scheduled sync", () => {
  assert.equal(isScheduledSyncRequest({ headers: { authorization: "Bearer expected" } }, "expected"), true);
  assert.equal(isScheduledSyncRequest({ headers: { authorization: "Bearer wrong" } }, "expected"), false);
  assert.equal(isScheduledSyncRequest({ headers: {} }, "expected"), false);
});

test("resolves one owner across all sheet-backed records", () => {
  assert.equal(uniqueSheetOwner([
    { user_id: "knute" },
    { user_id: "knute" },
  ]), "knute");
});

test("rejects missing or ambiguous sheet ownership", () => {
  assert.throws(() => uniqueSheetOwner([]), /could not find a sheet owner/i);
  assert.throws(() => uniqueSheetOwner([
    { user_id: "knute" },
    { user_id: "someone-else" },
  ]), /one unambiguous sheet owner/i);
});
