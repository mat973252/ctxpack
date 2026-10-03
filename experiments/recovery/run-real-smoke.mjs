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
import { replaceBody } from "./smoke-body.mjs";

const { values } = parseArgs({ options: { codex: { type: "string" }, image: { type: "string" } } });
assert.ok(values.codex && values.image, "Supply verified --codex and --image");
const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const approved = load("./real-task-files.json");
const frozenImage = load("./smoke-environment.json").imageId;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const root = mkdtempSync(join(tmpdir(), "ctxpack-real-smoke-"));
const cwd = join(root, "empty-host"); mkdirSync(cwd);
const limits = { read_file: 24, replace_strip_template_body: 4, run_tests: 4, wallMs: 480000 };
const evidence = { schema: "ctxpack.real-smoke/1", result: "unverified", limits, calls: [], host: {}, violations: [],
  sourceHashes: Object.fromEntries(["run-real-smoke.mjs", "restricted-host.mjs", "recovery-container.mjs", "smoke-body.mjs", "real-task-files.json", "smoke-environment.json", "REAL-SMOKE.md"].map((file) => [file, sha(readFileSync(new URL(file, import.meta.url)))])) };
let commandCount = 0;
let host;
let hostClosed = false;
let deadline = Infinity;
let startedAt;
let candidate;
let candidateBody;
let fatal = false;
const counts = {};
const readPaths = new Set();
const testPasses = {};
function docker(args, timeout = 30000) {
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
const worker = recoveryContainer(checked);
const verifier = recoveryContainer(checked);
const read = (environment, path) => JSON.parse(environment.exec(["node", "-e", "process.stdout.write(JSON.stringify(require('node:fs').readFileSync(process.argv[1], 'utf8')))", `/workspace/${path}`]));
const writeCandidate = (environment, text) => environment.exec(["node", "-e", "require('node:fs').writeFileSync('/workspace/src/core/handoff.ts', Buffer.from(process.argv[1], 'base64'))", Buffer.from(text).toString("base64")]);
function assertFiles(environment, expectedCandidate) {
  const files = environment.files();
  const sourceFiles = Object.fromEntries(Object.entries(files).filter(([path]) => !path.startsWith("dist/")));
  assert.deepEqual(sourceFiles, { ...approved.files, "src/core/handoff.ts": sha(expectedCandidate) });
}
function runSuite(environment, suite) {
  const args = suite === "regression" ? ["pnpm", "exec", "vitest", "run", "tests/recovery-case.test.ts"] : ["pnpm", "check"];
  return docker(["exec", environment.id, ...args], 120000);
}
try {
  const imageId = checked(["image", "inspect", values.image, "--format", "{{.Id}}"]);
  assert.equal(imageId, frozenImage);
  evidence.imageId = imageId;
  evidence.workerProfile = worker.start(imageId, approved.files);
  const original = read(worker, "src/core/handoff.ts");
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
      } else if (tool === "replace_strip_template_body") {
        assert.deepEqual(Object.keys(args), ["body"]);
        assert.ok(readPaths.has("src/core/handoff.ts") && readPaths.has("tests/recovery-case.test.ts"));
        const next = replaceBody(original, args.body);
        writeCandidate(worker, next); candidate = next; candidateBody = args.body;
        text = JSON.stringify({ written: "src/core/handoff.ts", candidateSha256: sha(candidate) });
      } else {
        assert.deepEqual(Object.keys(args), ["suite"]);
        assert.ok(["regression", "check"].includes(args.suite));
        if (candidateBody) {
          const candidateHash = sha(candidate);
          const approvalFile = join(root, `review-${candidateHash}.approved`);
          const waitingAt = performance.now();
          writeFileSync(join(root, "pending-review.json"), JSON.stringify({ candidateSha256: candidateHash, body: candidateBody, approvalFile }, null, 2));
          while (!existsSync(approvalFile) && performance.now() < deadline && isOpen()) await setTimeout(100);
          assert.ok(isOpen() && performance.now() < deadline);
          assert.equal(readFileSync(approvalFile, "utf8").trim(), candidateHash);
          call.sourceReviewWaitMs = performance.now() - waitingAt;
        }
        const result = runSuite(worker, args.suite);
        call.exitCode = result.status; call.candidateSha256 = sha(candidate);
        if (result.status === 0) testPasses[args.suite] = sha(candidate);
        text = JSON.stringify({ exitCode: result.status, output: (result.stdout + result.stderr).slice(-24000) });
      }
      assertFiles(worker, candidate);
      assert.ok(performance.now() <= deadline);
      call.success = true; call.output = text; call.elapsedMs = performance.now() - startedAt - call.ms;
      writeFileSync(join(root, "calls.json"), JSON.stringify(evidence.calls, null, 2));
      return { success: true, text };
    } catch {
      call.success = false; evidence.violations.push(tool);
      if (fatal) host?.abort();
      return { success: false, text: "Rejected by frozen task scope, budget or integrity check. Stop if the environment is unavailable." };
    }
  }
  const tools = [
    ["read_file", "Read one listed material file, preserving its text.", "path", { type: "string" }],
    ["replace_strip_template_body", "Replace only the statements inside stripTemplate. Supply no outer braces or declaration; preserve its signature. Maximum 8000 characters.", "body", { type: "string" }],
    ["run_tests", "Run only the frozen regression test or complete repository check (lint, tests, build).", "suite", { type: "string", enum: ["regression", "check"] }],
  ].map(([name, description, key, schema]) => ({ type: "function", name, description, inputSchema: { type: "object", properties: { [key]: schema }, required: [key], additionalProperties: false } }));
  host = await restrictedHost({ executable: resolve(values.codex), cwd, dynamicTools: tools, onTool, evidence: evidence.host });
  const prompt = `接手一个已经复现、尚未修复的 Markdown 交接缺陷。四类 Markdown 文档的初始模板之后，同文正文、内部空行和 Markdown 行尾双空格被错误删除。修复要求：CRLF 归一化为 LF；纯初始模板不输出；正文中非前缀模板不能过滤；generic/codex/pi/claude 四入口保留相同正文（pi 按原格式加 PROJECT 前缀）；handoff 不写工作树。围栏条目解析是别的任务，不要改它。
只允许修改 src/core/handoff.ts 的 stripTemplate 函数体。先读取该文件和 tests/recovery-case.test.ts；可读取其他列出的材料理解类型/模板。不得更改测试、依赖、配置或规避断言。用 run_tests 的 regression 和 check 验证最终修改，再报告结果。
工具预算：24次读、4次修改、4次测试，所有调用总计480秒，失败请求也计数。禁止其他工具、网络、路径或委派。文件索引：${JSON.stringify(Object.keys(approved.files))}`;
  evidence.prompt = prompt;
  console.log(JSON.stringify({ root, phase: "prepared" }));
  startedAt = performance.now(); deadline = startedAt + limits.wallMs;
  await host.turn(prompt, deadline);
  evidence.recoveryMs = performance.now() - startedAt;
  evidence.host.cleanupComplete = await host.close(); hostClosed = true;
  deadline = Infinity;
  assert.deepEqual(evidence.violations, []);
  assert.ok(candidateBody);
  assert.equal(testPasses.regression, sha(candidate)); assert.equal(testPasses.check, sha(candidate));
  assertFiles(worker, candidate);
  writeFileSync(join(root, "candidate-body.txt"), candidateBody);
  writeFileSync(join(root, "candidate-handoff.ts"), candidate);
  writeFileSync(join(root, "candidate.diff"), worker.exec(["git", "diff", "--", "src/core/handoff.ts"]));
  evidence.candidateSha256 = sha(candidate);
  evidence.verifierProfile = verifier.start(imageId, approved.files);
  writeCandidate(verifier, replaceBody(read(verifier, "src/core/handoff.ts"), candidateBody));
  assertFiles(verifier, candidate);
  const verified = runSuite(verifier, "check");
  evidence.verifierCheckExit = verified.status;
  assert.equal(verified.status, 0);
  const reporter = "import { writeFileSync } from 'node:fs'; export default class { onFinished(_files, errors) { writeFileSync('/tmp/smoke-errors.json', JSON.stringify(errors.map(error => error.name || 'error'))); } }";
  verifier.exec(["node", "-e", "require('node:fs').writeFileSync('/tmp/smoke-reporter.mjs', process.argv[1])", reporter]);
  const results = docker(["exec", verifier.id, "pnpm", "exec", "vitest", "run", "--reporter=json", "--reporter=/tmp/smoke-reporter.mjs", "--outputFile=/tmp/smoke-tests.json"], 120000);
  assert.equal(results.status, 0);
  const report = JSON.parse(verifier.exec(["cat", "/tmp/smoke-tests.json"]));
  assert.equal(report.numTotalTests, 160); assert.equal(report.numPassedTests, 160);
  assert.equal(report.numFailedTests, 0); assert.equal(report.numPendingTests, 0); assert.equal(report.numTodoTests, 0);
  assert.equal(report.success, true);
  assert.ok(report.testResults.every((suite) => suite.message === "" && suite.status === "passed"));
  assert.deepEqual(JSON.parse(verifier.exec(["cat", "/tmp/smoke-errors.json"])), []);
  assertFiles(verifier, candidate);
  evidence.verifierPassedTests = report.numPassedTests;
  evidence.result = "verified_pending_source_review";
} catch {
  evidence.result = "failed"; evidence.failedAfterCommand = commandCount; process.exitCode = 1;
} finally {
  deadline = Infinity;
  if (!hostClosed) evidence.host.cleanupComplete = host ? await host.close() : evidence.host.cleanupComplete ?? true;
  evidence.workerCleanupComplete = worker.close(); evidence.verifierCleanupComplete = verifier.close();
  if (!evidence.host.cleanupComplete || !evidence.workerCleanupComplete || !evidence.verifierCleanupComplete) { evidence.result = "cleanup_failed"; process.exitCode = 1; }
  try {
    if (candidateBody) { writeFileSync(join(root, "candidate-body.txt"), candidateBody); writeFileSync(join(root, "candidate-handoff.ts"), candidate); }
    if (evidence.loggingFailed) { evidence.result = "evidence_write_failed"; process.exitCode = 1; }
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
  } catch { evidence.result = "evidence_write_failed"; process.exitCode = 1; }
  console.log(JSON.stringify({ root, result: evidence.result, calls: evidence.calls.length, passed: evidence.verifierPassedTests }));
}
