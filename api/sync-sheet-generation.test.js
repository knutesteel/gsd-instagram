import test from "node:test";
import assert from "node:assert/strict";
import {
  countImportedImages,
  finalizeRowResults,
  firstMissingImageSequence,
  isNumericIdentifier,
  oneRelatedRecord,
  uniqueNumericSheetRows,
  uniqueSheetOwner,
  validateGenerationSheet,
} from "./sync-sheet-generation.js";

const header = ["Created", "Status", "Article Title", "Identifier"];
const row = (identifier, status = "Generated") => ["2026-07-30", status, `Title ${identifier}`, String(identifier)];

test("generation sheet validation rejects a truncated response", () => {
  assert.throws(() => validateGenerationSheet([header, row(1)]), /returned only 1 identified rows/);
});

test("generation sheet validation accepts a complete numeric data set", () => {
  const rows = [header, ...Array.from({ length: 10 }, (_, index) => row(index + 1))];
  assert.deepEqual(validateGenerationSheet(rows), {
    totalDataRows: 10,
    numericRows: 10,
    firstIdentifier: "1",
  });
});

test("duplicate spreadsheet identifiers are removed from the sync set", () => {
  const rows = [header, row(35), row(35), row(36)];
  const result = uniqueNumericSheetRows(rows);
  assert.deepEqual(result.duplicateIdentifiers, ["35"]);
  assert.deepEqual(result.rows.map((item) => item[3]), ["36"]);
});

test("numeric and variant identifiers are treated as canonical IDs", () => {
  assert.equal(isNumericIdentifier("35"), true);
  assert.equal(isNumericIdentifier("35-1"), true);
  assert.equal(isNumericIdentifier("35-12"), true);
  assert.equal(isNumericIdentifier("35-a"), false);
  assert.equal(isNumericIdentifier(""), false);
  assert.equal(isNumericIdentifier(null), false);
});

test("every populated row receives an explicit result", () => {
  const populatedRows = [
    { rowNumber: 2, identifier: "35" },
    { rowNumber: 3, identifier: "36" },
  ];
  const results = finalizeRowResults(populatedRows, [{
    rowNumber: 2,
    identifier: "35",
    outcome: "already_synchronized",
    reason: "Matched",
  }]);
  assert.equal(results.length, 2);
  assert.equal(results[0].outcome, "already_synchronized");
  assert.equal(results[1].outcome, "failed");
  assert.match(results[1].reason, /not processed/);
});

test("image resume logic imports only missing sequences", () => {
  const sourceImages = ["one", "two", "three", "four"];
  const assets = [{ sequence: 1 }, { sequence: 3 }];
  assert.equal(firstMissingImageSequence(sourceImages, assets), 2);
  assert.equal(countImportedImages(sourceImages, assets), 2);
});

test("fully imported image sets report no missing sequence", () => {
  const sourceImages = ["one", "two", "three", "four"];
  const assets = [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }, { sequence: 4 }];
  assert.equal(firstMissingImageSequence(sourceImages, assets), 0);
  assert.equal(countImportedImages(sourceImages, assets), 4);
});

test("embedded one-to-one and one-to-many records normalize consistently", () => {
  const record = { id: "concept" };
  assert.equal(oneRelatedRecord(record), record);
  assert.equal(oneRelatedRecord([record]), record);
  assert.equal(oneRelatedRecord([]), undefined);
});

test("scheduled synchronization requires one unambiguous owner", () => {
  assert.equal(uniqueSheetOwner([{ user_id: "owner" }, { user_id: "owner" }]), "owner");
  assert.throws(() => uniqueSheetOwner([]), /could not find a sheet owner/);
  assert.throws(() => uniqueSheetOwner([{ user_id: "a" }, { user_id: "b" }]), /one unambiguous sheet owner/);
});
