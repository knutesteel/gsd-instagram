import assert from "node:assert/strict";
import test from "node:test";
import { generationPromptFormula, locateGenerationRow, verifyGenerationValues } from "./send-for-generation.js";

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
  const calculatedFormulaResult = [...expected];
  calculatedFormulaResult[9] = "calculated prompt";
  assert.deepEqual(verifyGenerationValues(calculatedFormulaResult, expected), { ok: true, mismatches: [] });
  const staleOutput = [...expected];
  staleOutput[12] = "old image";
  assert.deepEqual(verifyGenerationValues(staleOutput, expected), { ok: false, mismatches: [13] });
});

test("builds the exact generation formula using the destination row", () => {
  assert.equal(
    generationPromptFormula(24),
    `="Create a "&G24&" "&H24&" Instagrage Post based on "&E24&" "&" with the following content: "&I24&" Create every output image at exactly 1080 pixels wide by 1440 pixels high (3:4 portrait), the default Instagram size. Use he GSD Voice, Image Guide, and ICP. Store the resulting images, description, and hastags (maximum of 4) in the google sheet : 
https://docs.google.com/spreadsheets/d/1Rl-vNbEXGpXoV5Pf9aNXsw4N4VSbjJqDcmtUrt_e7kQ/edit?gid=0#gid=0, populating the relevant fields for the row with Identifyerer value of "&D24`,
  );
});
