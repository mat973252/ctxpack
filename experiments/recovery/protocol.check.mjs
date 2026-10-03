import assert from "node:assert/strict";
import { test } from "node:test";
import { recordRead } from "./protocol.mjs";

test("preparation rejection does not consume the eight recovery reads or its clock", () => {
  const sample = { phase: "prepare", prepareAt: 100, resumeAt: 0, files: { "current.js": "evidence" }, reads: [] };
  assert.equal(recordRead(sample, "current.js", "read_fixture", 150), false);
  assert.equal(sample.reads[0].ms, 50);
  sample.phase = "resume";
  sample.resumeAt = 1000;
  for (let i = 0; i < 8; i++) assert.equal(recordRead(sample, "current.js", "read_fixture", 1010 + i), true);
  assert.equal(recordRead(sample, "current.js", "read_fixture", 1020), false);
  assert.equal(sample.reads[1].ms, 10);
});
test("unknown paths and tools are rejected and consume the recovery request budget", () => {
  const sample = { phase: "resume", prepareAt: 0, resumeAt: 100, files: { "a": "b" }, reads: [] };
  assert.equal(recordRead(sample, "../secret", "read_fixture", 101), false);
  assert.equal(recordRead(sample, "a", "write", 102), false);
  for (let i = 0; i < 6; i++) assert.equal(recordRead(sample, "a", "read_fixture", 103 + i), true);
  assert.equal(recordRead(sample, "a", "read_fixture", 110), false);
});
