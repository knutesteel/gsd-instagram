import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERATION_SPREADSHEET_ID,
  isScheduledSyncRequest,
  uniqueSheetOwner,
  validateGenerationSheet,
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

test("locks synchronization to the approved production sheet", () => {
  assert.equal(GENERATION_SPREADSHEET_ID, "1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ");
});

test("validates sheet identity and rejects suspiciously incomplete reads", () => {
  const rows = [
    ["Created", "Status", "Article Title", "Identifier"],
    ...Array.from({ length: 10 }, (_, index) => ["07/27/2026", "Generated", `Item ${index + 1}`, String(index + 1)]),
  ];
  assert.deepEqual(validateGenerationSheet(rows), {
    totalDataRows: 10,
    numericRows: 10,
    firstIdentifier: "1",
  });
  assert.throws(() => validateGenerationSheet([["Date", "Status", "Title", "ID"]]), /unexpected columns/i);
  assert.throws(() => validateGenerationSheet([
    ["Created", "Status", "Article Title", "Identifier"],
    ["07/27/2026", "Generated", "Only one", "1"],
  ]), /only 1 identified row/i);
});
