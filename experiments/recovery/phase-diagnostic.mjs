import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";
import { restrictedHost } from "./restricted-host.mjs";
import { assertIndependentCwd, reserveSlot, sourceFiles } from "./sampling-plan.mjs";
import { assertPhaseContinuation, diagnosticInstructions, phaseFailureResult, phasePrompt, phaseSlots, recoveryPassed, verifiedPriorSource } from "./phase-diagnostic-policy.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const files = [...sourceFiles, "phase-diagnostic.mjs", "phase-diagnostic-policy.mjs", "phase-diagnostic.check.mjs", "host-phases.check.mjs", "access-policy.check.mjs", "PHASE-DIAGNOSTIC.md"];
const priorHash = "3945cdb73da31df26bf060bd0bbeb2cad80697a47a367b7cf44a5febe021d043";
function runtime(executable) {
  return { nodeVersion: process.version, nodeSha256: sha(readFileSync(process.execPath)),
    codexVersion: execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10000 }).trim(),
    codexSha256: sha(readFileSync(executable)),
    sourceHashes: Object.fromEntries(files.map((file) => [file, sha(readFileSync(new URL(file, import.meta.url)))])) };
}
export function createPhasePlan(priorBatch, executable) {
  const priorBytes = readFileSync(join(priorBatch, "plan.json"));
  assert.equal(sha(priorBytes), priorHash);
  const prior = JSON.parse(priorBytes);
  for (const slot of prior.slots) {
    const completion = readJson(join(priorBatch, "slots", slot.id, "completion.json"));
    assert.ok(completion.terminal && completion.slotId === slot.id && completion.planSha256 === priorHash);
  }
  const inputs = {};
  for (const slotId of ["10-relay-clock-manual-r1", "01-markdown-text-manual-r1"]) {
    const root = join(priorBatch, "slots", slotId);
    const slot = prior.slots.find((item) => item.id === slotId); assert.ok(slot);
    const review = readJson(join(root, "final-source-review.json"));
    const evidence = readJson(join(root, "evidence.json"));
    for (const [file, hash] of Object.entries(prior.runtime.sourceHashes)) {
      assert.equal(sha(readFileSync(join(root, "executed-sources", file))), hash, "Old archived source changed");
    }
    const manifestName = slot.task === "markdown-text" ? "real-task-files.json" : "historical-environments-2026-10-03.json";
    const material = verifiedPriorSource({ prior, priorHash, slot, evidence, review,
      manifest: readFileSync(join(root, "executed-sources", manifestName)) });
    const handoffs = {};
    for (const name of ["manual", "nativePreparation", "ctxpack"]) {
      const text = readFileSync(join(evidence.handoff.directory, `${name}.txt`), "utf8");
      assert.equal(sha(text), prior.inputs[evidence.id].inputsSha256[name]);
      handoffs[name] = text;
    }
    inputs[evidence.id] = { priorSlot: slotId, ...material, handoffs,
      handoffHashes: prior.inputs[evidence.id].inputsSha256, marker: `phase-read-${randomUUID()}` };
  }
  const frozenRuntime = runtime(executable);
  assert.equal(frozenRuntime.codexVersion, "codex-cli 0.160.0");
  return { schema: "ctxpack.phase-plan/1", id: "phase-diagnostic-20261003-v1", createdAt: new Date().toISOString(),
    priorPlanSha256: priorHash, model: "gpt-6.1-sol", effort: "medium", setupWallMs: 120000,
    recoveryWallMs: 60000, readBudget: 4, runtime: frozenRuntime, inputs, slots: phaseSlots() };
}
export async function runPhaseSlot(planFile, expectedHash, slotId, executable) {
  const bytes = readFileSync(planFile);
  assert.match(expectedHash, /^[a-f0-9]{64}$/); assert.equal(sha(bytes), expectedHash);
  const plan = JSON.parse(bytes);
  assert.equal(plan.schema, "ctxpack.phase-plan/1");
  assert.equal(plan.model, "gpt-6.1-sol"); assert.equal(plan.effort, "medium");
  assert.equal(plan.setupWallMs, 120000); assert.equal(plan.recoveryWallMs, 60000); assert.equal(plan.readBudget, 4);
  assert.deepEqual(plan.slots, phaseSlots()); assert.deepEqual(runtime(executable), plan.runtime);
  const slot = plan.slots.find((item) => item.id === slotId); assert.ok(slot);
  const material = plan.inputs[slot.task];
  assert.equal(sha(material.source), material.sourceSha256);
  for (const [name, text] of Object.entries(material.handoffs)) assert.equal(sha(text), material.handoffHashes[name]);
  const directory = dirname(resolve(planFile));
  const index = plan.slots.findIndex((item) => item.id === slotId);
  if (index > 0) assertPhaseContinuation(readJson(join(directory, "slots", plan.slots[index - 1].id, "completion.json")));
  const root = reserveSlot(directory, plan.slots, slotId, expectedHash);
  const evidence = { schema: "ctxpack.phase-result/1", slot, planSha256: expectedHash, result: "unverified",
    createdAt: new Date().toISOString(), host: {}, calls: [], violations: [], firstReadMs: null,
    developerInstructions: diagnosticInstructions(slot.style), recoveryMs: null };
  let host;
  let stage = "initialization";
  let startedAt;
  let deadline;
  let recoveryMessageOffset;
  const write = (name, value) => writeFileSync(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
  try {
    writeFileSync(join(root, "plan.json"), bytes, { flag: "wx" });
    mkdirSync(join(root, "executed-sources"));
    for (const file of files) writeFileSync(join(root, "executed-sources", file), readFileSync(new URL(file, import.meta.url)), { flag: "wx" });
    evidence.hostCwd = mkdtempSync(join(tmpdir(), "ctxpack-phase-host-"));
    assertIndependentCwd(evidence.hostCwd);
    const preparationAt = performance.now();
    const setupDeadline = preparationAt + plan.setupWallMs;
    const dynamicTools = [{ type: "function", name: "read_file", description: "Read the named diagnostic source and its synthetic marker.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }];
    async function onTool(tool, args, isOpen) {
      const call = { tool, args, ms: performance.now() - startedAt, success: false };
      evidence.calls.push(call);
      try {
        assert.ok(isOpen() && performance.now() < deadline && evidence.calls.length <= plan.readBudget);
        assert.equal(tool, "read_file"); assert.deepEqual(Object.keys(args), ["path"]); assert.equal(args.path, material.target);
        const text = JSON.stringify({ path: material.target, source: material.source, marker: material.marker });
        assert.ok(isOpen() && performance.now() < deadline);
        call.success = true; call.returnedMarker = material.marker; call.sourceSha256 = material.sourceSha256;
        call.elapsedMs = performance.now() - startedAt - call.ms;
        evidence.firstReadMs ??= call.ms + call.elapsedMs;
        return { success: true, text };
      } catch {
        evidence.violations.push("read_rejected");
        return { success: false, text: "Rejected by diagnostic scope or budget" };
      } finally { write("calls.json", evidence.calls); }
    }
    stage = "preparation";
    host = await restrictedHost({ executable, cwd: evidence.hostCwd, dynamicTools, onTool, evidence: evidence.host,
      setupDeadline, developerInstructions: evidence.developerInstructions });
    if (slot.condition === "native") {
      evidence.preparePrompt = phasePrompt(slot.style, "prepare", material.handoffs.nativePreparation);
      await host.turn(evidence.preparePrompt, setupDeadline, "prepare");
      await host.compact(setupDeadline);
    }
    evidence.preparationMs = performance.now() - preparationAt;
    const history = slot.condition === "native" ? "" : material.handoffs[slot.condition];
    evidence.recoveryPrompt = phasePrompt(slot.style, "recovery", `${history}\n\n只读诊断：调用read_file读取${material.target}，然后只返回JSON对象，唯一字段marker取自实际工具结果。不得实施历史修复、运行测试或调用其他工具。`);
    stage = "recovery"; startedAt = performance.now(); deadline = startedAt + plan.recoveryWallMs;
    recoveryMessageOffset = evidence.host.messages.length;
    await host.turn(evidence.recoveryPrompt, deadline);
    evidence.recoveryMs = performance.now() - startedAt;
    evidence.host.cleanupComplete = await host.close();
    stage = "protocol"; host.assertFinalProtocol();
    assert.ok(evidence.host.cleanupComplete); assert.deepEqual(evidence.violations, []);
    evidence.recoveryMessages = evidence.host.messages.slice(recoveryMessageOffset);
    evidence.result = recoveryPassed(evidence.calls, evidence.recoveryMessages, material.target, material.marker) ? "passed" : "task_failed";
  } catch (error) {
    evidence.result = phaseFailureResult(error, stage); evidence.failureCode = `${stage}_failed`;
  } finally {
    if (startedAt !== undefined && evidence.recoveryMs === null) evidence.recoveryMs = performance.now() - startedAt;
    if (host && !evidence.host.cleanupComplete) evidence.host.cleanupComplete = await host.close();
    if (host) {
      try { host.assertFinalProtocol(); assert.deepEqual(evidence.violations, []); }
      catch { evidence.result = "failed"; evidence.failureCode = "final_protocol_failed"; }
    }
    if (recoveryMessageOffset !== undefined) evidence.recoveryMessages = evidence.host.messages.slice(recoveryMessageOffset);
    try { evidence.runtimeUnchanged = JSON.stringify(runtime(executable)) === JSON.stringify(plan.runtime); }
    catch { evidence.runtimeUnchanged = false; evidence.failureCode ??= "runtime_check_failed"; }
    if (!evidence.runtimeUnchanged || (host && !evidence.host.cleanupComplete)) evidence.result = "failed";
    write("evidence.json", evidence);
    write("completion.json", { terminal: true, slotId, planSha256: expectedHash, result: evidence.result, completedAt: new Date().toISOString() });
  }
  return { root, result: evidence.result };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { "create-plan": { type: "string" }, "prior-batch": { type: "string" },
    codex: { type: "string" }, plan: { type: "string" }, "plan-sha256": { type: "string" }, slot: { type: "string" } } });
  const executable = resolve(values.codex);
  if (values["create-plan"]) {
    const plan = createPhasePlan(resolve(values["prior-batch"]), executable);
    const out = resolve(values["create-plan"]); mkdirSync(dirname(out), { recursive: true });
    const bytes = `${JSON.stringify(plan, null, 2)}\n`; writeFileSync(out, bytes, { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ out, sha256: sha(bytes), slots: plan.slots })}\n`);
  } else {
    const result = await runPhaseSlot(resolve(values.plan), values["plan-sha256"], values.slot, executable);
    process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.result === "passed" ? 0 : 1;
  }
}
