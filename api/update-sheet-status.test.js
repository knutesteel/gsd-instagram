import test from "node:test";
import assert from "node:assert/strict";
import { statusRequiresSheetLookup } from "./update-sheet-status.js";

test("archiving never requires a Google Sheet lookup", () => {
  assert.equal(statusRequiresSheetLookup("Archived"), false);
});

test("archiving an identifier checks for and preserves its sheet row", () => {
  assert.equal(statusRequiresSheetLookup("Archived", true), true);
});

test("sheet-backed workflow statuses still reconcile with Google Sheets", () => {
  for (const status of ["New", "Sent to Sheets", "Generated", "Approved", "Posted"]) {
    assert.equal(statusRequiresSheetLookup(status), true);
  }
});
