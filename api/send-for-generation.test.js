import assert from "node:assert/strict";
import test from "node:test";
import { locateGenerationRow, verifyGenerationValues } from "./send-for-generation.js";

test("locates an existing generation row by identifier only", () => {
  const rows = [["Date", "Status", "Title", "Identifier"], ["2026-07-22", "Pending", "Old title", "13"]];
  assert.deepEqual(locateGenerationRow(rows, "13"), { row: 2, exists: true });
});

test("uses the first fully empty row when the identifier is absent", () => {
  const rows = [["Date", "Status", "Title", "Identifier"], ["2026-07-22", "Pending", "Other", "12"], [], ["2026-07-22", "Pending", "Later", "14"]];
  assert.deepEqual(locateGenerationRow(rows, "13"), { row: 3, exists: false });
});

test("verifies A-L exactly and requires M-Q to be blank", () => {
  const expected = Array.from({ length: 17 }, (_, index) => index < 12 ? `value-${index}` : "");
  assert.deepEqual(verifyGenerationValues(expected, expected), { ok: true, mismatches: [] });
  const staleOutput = [...expected];
  staleOutput[12] = "old image";
  assert.deepEqual(verifyGenerationValues(staleOutput, expected), { ok: false, mismatches: [13] });
});
