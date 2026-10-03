import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { recoveryContainer } from "./recovery-container.mjs";
import { restrictedHost } from "./restricted-host.mjs";
import { applyHistoricalEdit } from "./historical-edits.mjs";
import { historicalCase, taskCommand } from "./historical-case.mjs";
import { manualHandoff, prepareHandoffInputs, recoveryPrompt } from "./handoff-inputs.mjs";
import { assertCandidateFiles, candidateCommands, verifyHistoricalCandidate } from "./verify-historical-candidate.mjs";
import { assertIndependentCwd, assertInputEvidence, claimSamplingSlot, runtimeSnapshot, samplingLimits, sourceFiles } from "./sampling-plan.mjs";

const { values } = parseArgs({ options: { codex: { type: "string" }, image: { type: "string" }, id: { type: "string" }, condition: { type: "string" },
  plan: { type: "string" }, "plan-sha256": { type: "string" }, slot: { type: "string" } } });
assert.ok(values.codex, "Supply verified --codex");
assert.ok(values.condition === undefined || ["manual", "native", "ctxpack"].includes(values.condition));
assert.ok(values.plan ? values.slot && values["plan-sha256"] && !values.id && !values.condition && !values.image : !values.slot && !values["plan-sha256"]);
const sampling = values.plan ? claimSamplingSlot(values.plan, values["plan-sha256"], values.slot, resolve(values.codex)) : undefined;
const condition = sampling?.metadata.condition ?? values.condition;
const task = historicalCase(sampling?.metadata.task ?? values.id ?? "markdown-text");
const approved = { files: task.files };
const frozenImage = task.imageId;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const root = sampling?.root ?? mkdtempSync(join(tmpdir(), "ctxpack-real-smoke-"));
let cwd;
const executedSources = join(root, "executed-sources");
function captureSource(file) {
  const bytes = readFileSync(new URL(file, import.meta.url));
  writeFileSync(join(executedSources, file), bytes);
  return sha(bytes);
}
const limits = samplingLimits;
const evidence = { schema: "ctxpack.real-smoke/6", id: task.id, condition: condition ?? "coding", formalSample: Boolean(sampling),
  ...(sampling ? { sampling: sampling.metadata } : {}), createdAt: new Date().toISOString(), result: "unverified", limits,
  calls: [], host: {}, violations: [], firstRequiredRead: null, sourceHashes: {} };
let commandCount = 0;
let host;
let hostClosed = false;
let deadline = Infinity;
let startedAt;
let candidate;
let candidateEdit;
let fatal = false;
let stage = "initialization";
let setupDeadline = Infinity;
let preparationAt;
const counts = {};
const readPaths = new Set();
const testPasses = {};
function docker(args, timeout = 30000) {
  assert.ok(performance.now() < deadline, "No command may start after the shared deadline");
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: Math.floor(Math.max(1, Math.min(timeout, deadline - performance.now()))), maxBuffer: 4 * 1024 * 1024 });
  try { writeFileSync(join(root, `command-${++commandCount}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`); }
  catch { evidence.loggingFailed = true; }
  if (result.error) { fatal = true; throw new Error("Docker command timed out or failed to start"); }
  return result;
}
function checked(args, timeout) {
  const result = docker(args, timeout);
  assert.equal(result.status, 0, "Docker command failed");
  return result.stdout.trim();
}
const worker = recoveryContainer(checked, task.profile);
const read = (environment, path) => JSON.parse(environment.exec(["node", "-e", "process.stdout.write(JSON.stringify(require('node:fs').readFileSync(process.argv[1], 'utf8')))", `/workspace/${path}`]));
const writeCandidate = (environment, text) => environment.exec(["node", "-e", "require('node:fs').writeFileSync(process.argv[1], Buffer.from(process.argv[2], 'base64'))", `/workspace/${task.source}`, Buffer.from(text).toString("base64")]);
function assertFiles(environment, expectedCandidate) {
  assertCandidateFiles(task, environment.files(), expectedCandidate);
}
function runSuite(environment, suite) {
  let output = "";
  for (const args of candidateCommands(task, suite)) {
    assertFiles(environment, candidate);
    assert.ok(performance.now() < deadline);
    const result = docker(["exec", environment.id, ...taskCommand(task, args)], task.id === "relay-clock" ? 240000 : 180000);
    output += result.stdout + result.stderr;
    if (result.status !== 0) return { status: result.status, stdout: output, stderr: "" };
  }
  return { status: 0, stdout: output, stderr: "" };
}
try {
  cwd = join(sampling ? mkdtempSync(join(tmpdir(), "ctxpack-sampling-host-")) : root, "empty-host");
  mkdirSync(cwd); mkdirSync(executedSources);
  assertIndependentCwd(cwd);
  evidence.hostCwd = cwd;
  if (sampling) writeFileSync(join(root, "plan.json"), sampling.planBytes, { flag: "wx" });
  evidence.sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, captureSource(file)]));
  writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
  stage = "environment";
  const imageId = checked(["image", "inspect", values.image ?? frozenImage, "--format", "{{.Id}}"]);
  assert.equal(imageId, frozenImage);
  evidence.imageId = imageId;
  evidence.workerProfile = worker.start(imageId, approved.files);
  const original = read(worker, task.source);
  candidate = original;
  async function onTool(tool, args, isOpen) {
    const call = { tool, args, ms: performance.now() - startedAt };
    evidence.calls.push(call);
    try {
      assert.ok(isOpen() && !fatal && performance.now() < deadline);
      assert.ok(Object.hasOwn(limits, tool) && tool !== "wallMs");
      counts[tool] = (counts[tool] ?? 0) + 1;
      assert.ok(counts[tool] <= limits[tool]);
      assertFiles(worker, candidate);
      let text;
      if (tool === "read_file") {
        assert.deepEqual(Object.keys(args), ["path"]);
        assert.ok(Object.hasOwn(approved.files, args.path));
        text = read(worker, args.path);
        call.repeated = readPaths.has(args.path); readPaths.add(args.path);
      } else if (tool === "apply_edit") {
        assert.ok(readPaths.has(task.source) && readPaths.has(task.test));
        const next = applyHistoricalEdit(task.id, original, args);
        assert.ok(isOpen() && performance.now() < deadline);
        writeCandidate(worker, next); candidate = next; candidateEdit = args;
        text = JSON.stringify({ written: task.source, candidateSha256: sha(candidate) });
      } else {
        assert.deepEqual(Object.keys(args), ["suite"]);
        assert.ok(["regression", "check"].includes(args.suite));
        if (candidateEdit) {
          const candidateHash = sha(candidate);
          const approvalFile = join(root, `review-${candidateHash}.approved`);
          const waitingAt = performance.now();
          writeFileSync(join(root, "pending-review.json"), JSON.stringify({ id: task.id, candidateSha256: candidateHash, edit: candidateEdit, approvalFile }, null, 2));
          writeFileSync(join(root, "pending-candidate.txt"), candidate);
          try { while (!existsSync(approvalFile) && performance.now() < deadline && isOpen()) await setTimeout(100); }
          finally { call.sourceReviewWaitMs = performance.now() - waitingAt; }
          assert.ok(isOpen() && performance.now() < deadline);
          assert.equal(readFileSync(approvalFile, "utf8").trim(), candidateHash);
        }
        const result = runSuite(worker, args.suite);
        call.exitCode = result.status; call.candidateSha256 = sha(candidate);
        if (result.status === 0) testPasses[args.suite] = sha(candidate);
        text = JSON.stringify({ exitCode: result.status, output: (result.stdout + result.stderr).slice(-24000) });
      }
      assertFiles(worker, candidate);
      assert.ok(performance.now() <= deadline);
      call.success = true; call.output = text; call.elapsedMs = performance.now() - startedAt - call.ms;
      if (evidence.firstRequiredRead === null && tool === "read_file" && [task.source, task.test].includes(args.path)) {
        evidence.firstRequiredRead = { callIndex: evidence.calls.length - 1, path: args.path, startedMs: call.ms, completedMs: call.ms + call.elapsedMs };
      }
      writeFileSync(join(root, "calls.json"), JSON.stringify(evidence.calls, null, 2));
      return { success: true, text };
    } catch {
      call.success = false; evidence.violations.push(tool);
      call.elapsedMs = performance.now() - startedAt - call.ms;
      call.failureCode = performance.now() >= deadline ? "deadline_exceeded" : fatal ? "environment_command_error" : "scope_budget_or_integrity_rejected";
      try { writeFileSync(join(root, "calls.json"), JSON.stringify(evidence.calls, null, 2)); } catch { evidence.loggingFailed = true; }
      if (fatal) host?.abort();
      return { success: false, text: "Rejected by frozen task scope, budget or integrity check. Stop if the environment is unavailable." };
    }
  }
  const tools = [
    ["read_file", "Read one listed material file, preserving its text.", "path", { type: "string" }],
    ["run_tests", "Run only the frozen regression test or complete repository check (lint, tests, build).", "suite", { type: "string", enum: ["regression", "check"] }],
  ].map(([name, description, key, schema]) => ({ type: "function", name, description, inputSchema: { type: "object", properties: { [key]: schema }, required: [key], additionalProperties: false } }));
  const properties = task.id === "permit-proxy" ? { fromAnnotated: { type: "string" }, create: { type: "string" }, imports: { type: "array", items: { type: "string" } } }
    : task.id === "lens-wal" ? { body: { type: "string" }, helpers: { type: "string" } } : { body: { type: "string" } };
  const scope = task.id === "permit-proxy" ? "fromAnnotated/create的花括号内部正文，以及最多4个新增普通导入的完整限定名；其他字节冻结"
    : task.id === "lens-wal" ? "getRun花括号内部的原始正文（包含换行和缩进），以及紧接方法后新增的最多4个必要private实例辅助方法（helpers包含前置换行/缩进）；禁止字段、构造器、装饰器、静态成员或改签名"
      : `${{ "markdown-text": "stripTemplate", "ctx-fences": "parseList", "relay-clock": "until" }[task.id]}函数体内部正文，不含外层花括号或声明，最多8000字符`;
  tools.push({ type: "function", name: "apply_edit", description: `从冻结原文重新应用完整候选（不累计前次编辑）。范围：${scope}。`, inputSchema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } });
  preparationAt = performance.now();
  stage = "preparation";
  setupDeadline = preparationAt + 120000;
  const prepared = condition ? prepareHandoffInputs(task, setupDeadline) : undefined;
  if (prepared) evidence.handoff = { directory: prepared.directory, ...prepared.evidence };
  if (sampling) assertInputEvidence(sampling.plan.inputs[task.id], prepared.evidence);
  host = await restrictedHost({ executable: resolve(values.codex), cwd, dynamicTools: tools, onTool, evidence: evidence.host, setupDeadline });
  if (sampling) assert.equal(evidence.host.version, sampling.plan.runtime.codex.version);
  if (condition === "native") {
    await host.turn(prepared.inputs.nativePreparation, setupDeadline, "prepare");
    await host.compact(setupDeadline);
    evidence.handoff.nativeCompacted = true;
  }
  assert.ok(performance.now() < setupDeadline);
  evidence.preparationMs = performance.now() - preparationAt;
  const history = condition === "native" ? "" : condition === "ctxpack" ? prepared.inputs.ctxpack : prepared?.inputs.manual ?? manualHandoff(task);
  const prompt = `${history}\n\n${recoveryPrompt(task, scope, limits)}`;
  evidence.prompt = prompt;
  console.log(JSON.stringify({ root, phase: "prepared" }));
  startedAt = performance.now(); deadline = startedAt + limits.wallMs;
  stage = "recovery";
  await host.turn(prompt, deadline);
  evidence.recoveryMs = performance.now() - startedAt;
  evidence.host.cleanupComplete = await host.close(); hostClosed = true;
  stage = "protocol";
  host.assertFinalProtocol();
  deadline = Infinity;
  assert.deepEqual(evidence.violations, []);
  stage = "candidate";
  assert.ok(candidateEdit);
  assert.equal(testPasses.regression, sha(candidate)); assert.equal(testPasses.check, sha(candidate));
  assertFiles(worker, candidate);
  writeFileSync(join(root, "candidate-edit.json"), JSON.stringify(candidateEdit));
  writeFileSync(join(root, "candidate.txt"), candidate);
  writeFileSync(join(root, "candidate.diff"), worker.exec(["git", "diff", "--", task.source]));
  evidence.candidateSha256 = sha(candidate);
  stage = "verification";
  evidence.verification = verifyHistoricalCandidate(task.id, candidateEdit, sha(candidate));
  assert.equal(evidence.verification.evidence.result, "verified_pending_source_review");
  evidence.result = "verified_pending_source_review";
} catch {
  evidence.result = "failed"; evidence.failedAfterCommand = commandCount; process.exitCode = 1;
  evidence.failure = { phase: stage, code: performance.now() >= (stage === "preparation" ? setupDeadline : deadline)
    ? "deadline_exceeded" : fatal ? "environment_command_error" : evidence.violations.length ? "broker_rejection" : `${stage}_failed` };
} finally {
  if (startedAt !== undefined && evidence.recoveryMs === undefined) evidence.recoveryMs = performance.now() - startedAt;
  if (preparationAt !== undefined && evidence.preparationMs === undefined) evidence.preparationMs = performance.now() - preparationAt;
  deadline = Infinity;
  if (!hostClosed) evidence.host.cleanupComplete = host ? await host.close() : evidence.host.cleanupComplete ?? true;
  evidence.workerCleanupComplete = worker.close(); evidence.verifierCleanupComplete = evidence.verification?.evidence.cleanupComplete ?? true;
  if (!evidence.host.cleanupComplete || !evidence.workerCleanupComplete || !evidence.verifierCleanupComplete) {
    evidence.cleanupFailure = true; evidence.failure ??= { phase: "cleanup", code: "cleanup_failed" };
    evidence.result = "cleanup_failed"; process.exitCode = 1;
  }
  try {
    if (sampling) {
      try { assert.deepEqual(runtimeSnapshot(resolve(values.codex)), sampling.plan.runtime); evidence.runtimeUnchanged = true; }
      catch { evidence.runtimeUnchanged = false; evidence.result = "runtime_changed"; process.exitCode = 1; }
    }
    if (candidateEdit) { writeFileSync(join(root, "candidate-edit.json"), JSON.stringify(candidateEdit)); writeFileSync(join(root, "candidate.txt"), candidate); }
    if (evidence.loggingFailed) { evidence.result = "evidence_write_failed"; process.exitCode = 1; }
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
    if (sampling) writeFileSync(join(root, "completion.json"), JSON.stringify({ terminal: true, result: evidence.result,
      planSha256: sampling.metadata.planSha256, slotId: sampling.metadata.id, completedAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  } catch { evidence.result = "evidence_write_failed"; process.exitCode = 1; }
  console.log(JSON.stringify({ root, result: evidence.result, calls: evidence.calls.length, verification: evidence.verification?.root }));
}
