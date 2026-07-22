import test from "node:test";
import assert from "node:assert/strict";
import { nextGenerationIdentifier } from "./research.js";

test("assigns one when no articles have identifiers", () => {
  assert.equal(nextGenerationIdentifier([{ generation_identifier: null }, { generation_identifier: "" }]), 1);
});

test("assigns the next number after the highest valid app identifier", () => {
  assert.equal(nextGenerationIdentifier([
    { generation_identifier: "7" },
    { generation_identifier: "13" },
    { generation_identifier: "not-a-number" },
  ]), 14);
});
