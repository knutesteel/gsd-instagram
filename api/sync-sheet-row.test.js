import assert from "node:assert/strict";
import test from "node:test";
import { currentSheetRowNumber } from "./sync-sheet-generation.js";

test("derives the current sheet row after sorting instead of trusting a cached pointer", () => {
  const rows = [
    ["Created", "Status", "Title", "Identifier"],
    ["2026-07-25", "Generated", "Item 29", 29],
    ["2026-07-24", "Generated", "Item 27", 27],
  ];
  assert.equal(currentSheetRowNumber(rows, rows[1]), 2);
  assert.equal(currentSheetRowNumber(rows, rows[2]), 3);
});
