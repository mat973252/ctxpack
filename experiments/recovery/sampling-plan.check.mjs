import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { makeSlots, reserveSlot, assertInputEvidence, assertIndependentCwd } from "./sampling-plan.mjs";

test("the fixed matrix covers every task/condition/repetition and rotates every condition through every position", () => {
  const slots = makeSlots();
  assert.equal(slots.length, 45);
  assert.equal(new Set(slots.map((s) => s.id)).size, 45);
  for (const task of new Set(slots.map((s) => s.task))) {
    for (const condition of ["manual", "native", "ctxpack"]) {
      const matches = slots.filter((s) => s.task === task && s.condition === condition);
      assert.deepEqual(matches.map((s) => s.repeat), [1, 2, 3]);
      assert.deepEqual(matches.map((s) => s.position).sort(), [0, 1, 2]);
    }
  }
});
test("an occupied or unfinished slot cannot be rerun or skipped, including a failed slot", () => {
  const directory = mkdtempSync(join(tmpdir(), "ctxpack-slot-check-"));
  const slots = makeSlots();
  const reserve = (slot) => reserveSlot(directory, slots, slot.id, "frozen-plan");
  assert.throws(() => reserve(slots[1]));
  const first = reserve(slots[0]);
  assert.throws(() => reserve(slots[0]));
  assert.throws(() => reserve(slots[1]));
  writeFileSync(join(first, "completion.json"), JSON.stringify({ terminal: true, result: "failed", slotId: slots[0].id, planSha256: "other-plan" }));
  assert.throws(() => reserve(slots[1]));
  writeFileSync(join(first, "completion.json"), JSON.stringify({ terminal: true, result: "failed", slotId: slots[1].id, planSha256: "frozen-plan" }));
  assert.throws(() => reserve(slots[1]));
  writeFileSync(join(first, "completion.json"), JSON.stringify({ terminal: true, result: "failed", slotId: slots[0].id, planSha256: "frozen-plan" }));
  reserve(slots[1]);
  assert.throws(() => reserve(slots[0]));
  assert.equal(JSON.parse(readFileSync(join(first, "completion.json"), "utf8")).result, "failed");
});
test("changed input or build hashes cannot enter the frozen batch", () => {
  const expected = { inputsSha256: { manual: "a", nativePreparation: "b", ctxpack: "c" }, builtFilesSha256: { "cli.js": "d" }, dependencyInputsSha256: { "pnpm-lock.yaml": "e" } };
  assertInputEvidence(expected, expected);
  for (const field of Object.keys(expected)) assert.throws(() => assertInputEvidence(expected, { ...expected, [field]: {} }));
});
test("an empty model directory cannot inherit a repository or ancestor instructions", () => {
  const clean = mkdtempSync(join(tmpdir(), "ctxpack-cwd-check-"));
  assertIndependentCwd(clean);
  const child = join(clean, "empty-host"); mkdirSync(child);
  writeFileSync(join(clean, "AGENTS.md"), "Injected unrelated task");
  assert.throws(() => assertIndependentCwd(child), /inherits project instructions/);
  const repo = mkdtempSync(join(tmpdir(), "ctxpack-cwd-repo-"));
  execFileSync("git", ["init", "--quiet", repo]);
  const empty = join(repo, "empty-host"); mkdirSync(empty);
  assert.throws(() => assertIndependentCwd(empty), /outside Git repositories/);
});
