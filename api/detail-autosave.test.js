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
