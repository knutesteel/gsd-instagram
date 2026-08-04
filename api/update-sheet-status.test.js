import test from "node:test";
import assert from "node:assert/strict";
import { statusRequiresSheetLookup } from "./update-sheet-status.js";

test("archiving a new app-only item never requires a Google Sheet lookup", () => {
  assert.equal(statusRequiresSheetLookup("Archived", "new", false), false);
});

test("archiving an auto-added item with an identifier remains app-only", () => {
  assert.equal(statusRequiresSheetLookup("Archived", "auto_added", false), false);
});

test("archiving a sheet-backed item checks for and preserves its sheet row", () => {
  assert.equal(statusRequiresSheetLookup("Archived", "sent_to_sheets", true), true);
  assert.equal(statusRequiresSheetLookup("Archived", "generated", false), true);
});

test("restoring an app-only archived item does not require a sheet lookup", () => {
  assert.equal(statusRequiresSheetLookup("New", "discarded", false), false);
  assert.equal(statusRequiresSheetLookup("New", "discarded", true), true);
});

test("auto-added intake status never creates or changes a Google Sheet row", () => {
  assert.equal(statusRequiresSheetLookup("Auto-Added"), false);
  assert.equal(statusRequiresSheetLookup("Auto-Added", "generated", true), false);
});

test("sheet-backed workflow statuses still reconcile with Google Sheets", () => {
  for (const status of ["New", "Sent to Sheets", "Generated", "Approved", "Posted"]) {
    assert.equal(statusRequiresSheetLookup(status), true);
  }
});
