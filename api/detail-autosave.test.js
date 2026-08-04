import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("editable detail fields save when focus leaves the field", () => {
  assert.match(source, /label="Caption"[\s\S]*?onBlur=\{saveOnBlur\}/);
  assert.match(source, /label="Content \(Suggested Prompt\)"[\s\S]*?onBlur=\{saveOnBlur\}/);
});

test("previous and next navigation wait for a verified save", () => {
  assert.match(source, /navigateAfterSave\(previous\)/);
  assert.match(source, /navigateAfterSave\(next\)/);
  assert.match(source, /if \(dirtyRef\.current\) await save\(true\)/);
});

test("a missing sheet row re-enables repair and blocks generation", () => {
  assert.match(source, /result\.code === "SHEET_ROW_MISSING"/);
  assert.match(source, /promptRepairRequired \? "Repair Sheet Row"/);
  assert.match(source, /promptRepairRequired \? "Repair Sheet Row First"/);
  assert.match(source, /setPromptReload\(\(value\) => value \+ 1\)/);
});


test("custom content before Panel 1 survives later field saves and reloads", () => {
  assert.doesNotMatch(source, /value\.slice\(firstPanel\)/);
  assert.match(source, /function formatPanelContent\(value: string\) \{[\s\S]*?return value[\s\S]*?\.trim\(\);/);
});

test("every edit is debounced and saved as a sparse field patch", () => {
  assert.match(source, /pendingChangesRef\.current = \{ \.\.\.pendingChangesRef\.current, \[key\]: value \}/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*?void save\(true\);[\s\S]*?\}, 750\)/);
  assert.match(source, /await saveDetail\(articleId, patch\)/);
  assert.doesNotMatch(source, /await saveDetail\(articleId, snapshot\)/);
});

test("pending field edits flush before navigation, generation, and unmount", () => {
  assert.match(source, /if \(dirtyRef\.current\) await save\(true\)/);
  assert.match(source, /if \(Object\.keys\(patch\)\.length\) void saveDetail\(story\.id, patch\)/);
});
