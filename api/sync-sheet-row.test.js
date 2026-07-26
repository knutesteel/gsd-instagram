import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_SYNC_ERROR_CUTOFF,
  currentSheetRowNumber,
  isNumericIdentifier,
  shouldReportSyncIssue,
  sheetImageSummary,
  uniqueNumericSheetRows,
} from "./sync-sheet-generation.js";

test("derives the current sheet row after sorting instead of trusting a cached pointer", () => {
  const rows = [
    ["Created", "Status", "Title", "Identifier"],
    ["2026-07-25", "Generated", "Item 29", 29],
    ["2026-07-24", "Generated", "Item 27", 27],
  ];
  assert.equal(currentSheetRowNumber(rows, rows[1]), 2);
  assert.equal(currentSheetRowNumber(rows, rows[2]), 3);
});

test("uses only the new numeric identifier for synchronization", () => {
  assert.equal(isNumericIdentifier("29"), true);
  assert.equal(isNumericIdentifier(29), true);
  assert.equal(isNumericIdentifier("WFCSHQ"), false);
  assert.equal(isNumericIdentifier(""), false);
});

test("blocks duplicate numeric identifiers instead of synchronizing either row", () => {
  const header = ["Created", "Status", "Title", "Identifier"];
  const first = ["2026-07-25", "Generated", "First", 1];
  const duplicate = ["2026-07-25", "Posted", "Second", "1"];
  const valid = ["2026-07-25", "Generated", "Third", 29];
  const result = uniqueNumericSheetRows([header, first, duplicate, valid]);
  assert.deepEqual(result.rows, [valid]);
  assert.deepEqual(result.duplicateIdentifiers, ["1"]);
});

test("suppresses historical sync issues without hiding today or unknown records", () => {
  assert.equal(LEGACY_SYNC_ERROR_CUTOFF, "2026-07-25T04:00:00.000Z");
  assert.equal(shouldReportSyncIssue("2026-07-24T23:59:59.999Z"), false);
  assert.equal(shouldReportSyncIssue("2026-07-25T03:59:59.999Z"), false);
  assert.equal(shouldReportSyncIssue("2026-07-25T04:00:00.000Z"), true);
  assert.equal(shouldReportSyncIssue("2026-07-25T12:00:00.000Z"), true);
  assert.equal(shouldReportSyncIssue(null), true);
  assert.equal(shouldReportSyncIssue("not-a-date"), true);
});

test("persists displayable sheet image links without discarding other image metadata", () => {
  assert.deepEqual(
    sheetImageSummary(
      { origin: "text_overview", content: "Panel copy", imported_image_count: 5 },
      ["https://drive.google.com/file/d/one/view", "https://drive.google.com/file/d/two/view"],
      0,
    ),
    {
      origin: "text_overview",
      content: "Panel copy",
      sheet_images: [
        "https://drive.google.com/file/d/one/view",
        "https://drive.google.com/file/d/two/view",
      ],
      imported_image_count: 0,
    },
  );
});
