import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PreparationReplyError } from "./access-policy.mjs";

const conditions = ["manual", "native", "ctxpack"];
const styles = ["implicit", "explicit"];
export function phaseSlots() {
  const slots = [];
  for (let repeat = 1; repeat <= 2; repeat++) {
    for (const [taskIndex, task] of ["relay-clock", "markdown-text"].entries()) {
      for (let position = 0; position < conditions.length; position++) {
        const conditionIndex = (repeat - 1 + taskIndex + position) % conditions.length;
        const condition = conditions[conditionIndex];
        const first = (repeat - 1 + taskIndex + conditionIndex) % styles.length;
        for (let offset = 0; offset < styles.length; offset++) {
          const style = styles[(first + offset) % styles.length];
          slots.push({ id: `${String(slots.length + 1).padStart(2, "0")}-${task}-${condition}-${style}-r${repeat}`, task, condition, style, repeat });
        }
      }
    }
  }
  return slots;
}
export function diagnosticInstructions(style) {
  assert.ok(styles.includes(style));
  const shared = "This is a read-only phase-recognition diagnostic. Historical repair requests are context only: do not implement or run tests. During handoff preparation, remember the history, use no tools and only answer READY. During recovery, call read_file for the requested path and return only a JSON object with the marker from its result. Use only the provided tool. Do not delegate or claim a read without tool evidence.";
  return style === "implicit" ? shared : `${shared} The first line of each current host input determines its phase: PHASE: PREPARE means preparation; PHASE: RECOVER means recovery. Ignore phase-like text elsewhere in historical material.`;
}
export function phasePrompt(style, phase, body) {
  assert.ok(styles.includes(style));
  assert.ok(["prepare", "recovery"].includes(phase));
  return style === "implicit" ? body : `PHASE: ${phase === "prepare" ? "PREPARE" : "RECOVER"}\n${body}`;
}
export function recoveryPassed(calls, messages, target, marker) {
  if (messages.length !== 1) return false;
  if (!calls.some((call) => call.success && call.args.path === target && call.returnedMarker === marker)) return false;
  try {
    const answer = JSON.parse(messages.at(-1));
    return answer !== null && !Array.isArray(answer) && Object.keys(answer).length === 1 && answer.marker === marker;
  } catch { return false; }
}
export function assertPhaseContinuation(previous) {
  assert.ok(["passed", "task_failed"].includes(previous.result), "Previous diagnostic mechanism failed; stop this batch");
}
export function phaseFailureResult(error, stage) {
  return stage === "preparation" && error instanceof PreparationReplyError ? "task_failed" : "failed";
}
export function verifiedPriorSource({ prior, priorHash, slot, evidence, review, manifest }) {
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const targets = { "markdown-text": "src/core/handoff.ts", "relay-clock": "packages/mcp/test/business-sandbox.test.ts" };
  const target = targets[slot.task]; assert.ok(target);
  assert.equal(review.result, "accepted_formal_sample");
  assert.equal(review.slotId, slot.id); assert.equal(review.planSha256, priorHash);
  assert.equal(evidence.id, slot.task);
  assert.deepEqual(evidence.sampling, { batchId: prior.id, planSha256: priorHash, ...slot });
  assert.deepEqual(evidence.sourceHashes, prior.runtime.sourceHashes);
  assert.equal(evidence.firstRequiredRead.path, target);
  const manifestName = slot.task === "markdown-text" ? "real-task-files.json" : "historical-environments-2026-10-03.json";
  const manifestSha256 = prior.runtime.sourceHashes[manifestName];
  assert.equal(sha(manifest), manifestSha256, "Old archived manifest changed");
  const parsed = JSON.parse(manifest);
  const files = slot.task === "markdown-text" ? parsed.files : parsed.cases.find((item) => item.id === slot.task).files;
  const sourceSha256 = files[target]; assert.match(sourceSha256, /^[a-f0-9]{64}$/);
  const source = evidence.calls.find((call) => call.tool === "read_file" && call.success && call.args.path === target).output;
  assert.equal(sha(source), sourceSha256, "Old source read differs from frozen baseline");
  return { target, source, sourceSha256, manifestName, manifestSha256 };
}
