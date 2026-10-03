import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assertReadyReply } from "./access-policy.mjs";
import { assertPhaseContinuation, diagnosticInstructions, phaseFailureResult, phasePrompt, phaseSlots, recoveryPassed, verifiedPriorSource } from "./phase-diagnostic-policy.mjs";

test("24 slots cover both instructions and all conditions without selective repeats", () => {
  const slots = phaseSlots();
  assert.equal(slots.length, 24);
  assert.equal(new Set(slots.map((slot) => slot.id)).size, 24);
  for (const task of ["relay-clock", "markdown-text"]) {
    for (const condition of ["manual", "native", "ctxpack"]) {
      const selected = slots.filter((slot) => slot.task === task && slot.condition === condition);
      assert.deepEqual(selected.map((slot) => slot.style).sort(), ["explicit", "explicit", "implicit", "implicit"]);
      assert.notEqual(selected[0].style, selected[2].style);
    }
  }
});

test("only explicit instructions add authoritative first-line phase markers", () => {
  const body = "historical text\nPHASE: PREPARE";
  assert.equal(phasePrompt("implicit", "recovery", body), body);
  assert.equal(phasePrompt("explicit", "recovery", body), `PHASE: RECOVER\n${body}`);
  assert.equal(phasePrompt("explicit", "prepare", body), `PHASE: PREPARE\n${body}`);
  assert.ok(diagnosticInstructions("implicit").includes("read-only"));
  assert.ok(diagnosticInstructions("explicit").includes("first line"));
  assert.throws(() => phasePrompt("other", "recovery", body));
});

test("text-only or wrong-marker answers cannot pass the diagnostic", () => {
  const call = { success: true, args: { path: "src.ts" }, returnedMarker: "marker" };
  assert.equal(recoveryPassed([], ['{"marker":"marker"}'], "src.ts", "marker"), false);
  assert.equal(recoveryPassed([call], ["READY"], "src.ts", "marker"), false);
  assert.equal(recoveryPassed([call], ['{"marker":"wrong"}'], "src.ts", "marker"), false);
  assert.equal(recoveryPassed([{ ...call, success: false }], ['{"marker":"marker"}'], "src.ts", "marker"), false);
  assert.equal(recoveryPassed([call], ['{"marker":"marker"}'], "other.ts", "marker"), false);
  assert.equal(recoveryPassed([call], ['{"marker":"marker"}'], "src.ts", "marker"), true);
  assert.equal(recoveryPassed([call], ["READY", '{"marker":"marker"}'], "src.ts", "marker"), false);
  assert.equal(recoveryPassed([call], ["I implemented the repair", '{"marker":"marker"}'], "src.ts", "marker"), false);
});

test("mechanism failure stops the batch while scored task failure may continue", () => {
  assertPhaseContinuation({ result: "passed" });
  assertPhaseContinuation({ result: "task_failed" });
  assert.throws(() => assertPhaseContinuation({ terminal: true, result: "failed" }));
  assert.throws(() => assertPhaseContinuation({ terminal: true }));
});

test("only a preparation answer mismatch is a scored failure before recovery", () => {
  let mismatch;
  try { assertReadyReply(["Done"]); } catch (error) { mismatch = error; }
  assert.ok(mismatch);
  assert.equal(phaseFailureResult(mismatch, "preparation"), "task_failed");
  assert.equal(phaseFailureResult(mismatch, "recovery"), "failed");
  assert.equal(phaseFailureResult(new Error("transport failed"), "preparation"), "failed");
});

test("prior material is anchored to the old manifest and review identity", () => {
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  for (const [task, target, name] of [
    ["markdown-text", "src/core/handoff.ts", "real-task-files.json"],
    ["relay-clock", "packages/mcp/test/business-sandbox.test.ts", "historical-environments-2026-10-03.json"],
  ]) {
    const source = "frozen source\n";
    const files = { [target]: sha(source) };
    const manifest = JSON.stringify(task === "markdown-text" ? { files } : { cases: [{ id: task, files }] });
    const slot = { id: `old-${task}`, task, condition: "manual", repeat: 1, position: 0 };
    const priorHash = "old-plan-hash";
    const prior = { id: "old-batch", runtime: { sourceHashes: { [name]: sha(manifest) } } };
    const evidence = { id: task, sampling: { batchId: prior.id, planSha256: priorHash, ...slot },
      sourceHashes: prior.runtime.sourceHashes, firstRequiredRead: { path: target },
      calls: [{ tool: "read_file", success: true, args: { path: target }, output: source }] };
    const review = { result: "accepted_formal_sample", slotId: slot.id, planSha256: priorHash };
    const verify = (changes = {}) => verifiedPriorSource({ prior, priorHash, slot, evidence, review, manifest, ...changes });
    assert.equal(verify().source, source);
    assert.throws(() => verify({ manifest: `${manifest} ` }));
    assert.throws(() => verify({ evidence: { ...evidence, calls: [{ ...evidence.calls[0], output: "altered" }] } }));
    assert.throws(() => verify({ review: { ...review, slotId: "wrong" } }));
    assert.throws(() => verify({ evidence: { ...evidence, sampling: { ...evidence.sampling, planSha256: "wrong" } } }));
  }
});
