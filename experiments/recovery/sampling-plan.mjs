import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { parseArgs } from "node:util";
import { historicalCase } from "./historical-case.mjs";
import { prepareHandoffInputs } from "./handoff-inputs.mjs";

export const sourceFiles = ["run-real-smoke.mjs", "sampling-plan.mjs", "handoff-inputs.mjs", "access-policy.mjs",
  "restricted-host.mjs", "recovery-container.mjs", "historical-edits.mjs", "historical-case.mjs",
  "verify-historical-candidate.mjs", "JavaEditScope.java", "historical-environments-2026-10-03.json",
  "real-task-files.json", "smoke-environment.json", "HISTORICAL-EXECUTION.md", "SAMPLING-PROTOCOL.md"];
export const samplingLimits = Object.freeze({ read_file: 24, apply_edit: 4, run_tests: 4, wallMs: 480000 });
const tasks = ["markdown-text", "ctx-fences", "lens-wal", "relay-clock", "permit-proxy"];
const conditions = ["manual", "native", "ctxpack"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => readFileSync(new URL(file, import.meta.url));
export function makeSlots() {
  const slots = [];
  for (let repeat = 1; repeat <= 3; repeat++) {
    for (const [taskIndex, task] of tasks.entries()) {
      for (let position = 0; position < 3; position++) {
        const condition = conditions[(taskIndex + repeat - 1 + position) % 3];
        slots.push({ id: `${String(slots.length + 1).padStart(2, "0")}-${task}-${condition}-r${repeat}`, task, condition, repeat, position });
      }
    }
  }
  return slots;
}
export function runtimeSnapshot(executable) {
  const version = (command, args) => execFileSync(command, args, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
  return {
    sourceHashes: Object.fromEntries(sourceFiles.map((file) => [file, sha(read(file))])),
    builtFilesSha256: Object.fromEntries(readdirSync(dist).sort().map((file) => [file, sha(readFileSync(join(dist, file)))])),
    dependencyInputsSha256: Object.fromEntries(["package.json", "pnpm-lock.yaml"].map((file) => [file, sha(read(`../../${file}`))])),
    node: { version: process.version, sha256: sha(readFileSync(process.execPath)) },
    typescriptSha256: sha(readFileSync(createRequire(import.meta.url).resolve("typescript"))),
    codex: { version: version(executable, ["--version"]), sha256: sha(readFileSync(executable)) },
    java: version("java", ["--version"]), python: version("python", ["--version"]),
  };
}
export function assertInputEvidence(expected, actual) {
  for (const field of ["inputsSha256", "builtFilesSha256", "dependencyInputsSha256"]) assert.deepEqual(actual[field], expected[field], `Frozen ${field} changed`);
}
export function assertIndependentCwd(cwd) {
  for (let path = resolve(cwd); ; path = dirname(path)) {
    for (const file of ["AGENTS.md", "AGENTS.override.md"]) assert.equal(existsSync(join(path, file)), false, `Model cwd inherits project instructions: ${join(path, file)}`);
    if (dirname(path) === path) break;
  }
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 10000 });
  assert.equal(git.status, 128, "Model cwd must be outside Git repositories");
}
export function createSamplingPlan(id, executable) {
  assert.match(id, /^[a-z0-9][a-z0-9-]{0,63}$/);
  const runtime = runtimeSnapshot(executable);
  assert.match(runtime.java, /^openjdk 21\./);
  assert.equal(runtime.codex.version, "codex-cli 0.160.0");
  const inputs = Object.fromEntries(tasks.map((task) => {
    const prepared = prepareHandoffInputs(historicalCase(task)).evidence;
    return [task, { inputsSha256: prepared.inputsSha256, builtFilesSha256: prepared.builtFilesSha256, dependencyInputsSha256: prepared.dependencyInputsSha256 }];
  }));
  assert.deepEqual(runtimeSnapshot(executable), runtime);
  return { schema: "ctxpack.formal-plan/1", id, createdAt: new Date().toISOString(), model: "gpt-6.1-sol", effort: "medium",
    setupWallMs: 120000, limits: samplingLimits, runtime, inputs, slots: makeSlots() };
}
export function reserveSlot(directory, slots, slotId, planSha256) {
  const index = slots.findIndex((slot) => slot.id === slotId);
  assert.ok(index >= 0, "Unknown slot");
  const parent = join(directory, "slots");
  if (index > 0) {
    const previous = JSON.parse(readFileSync(join(parent, slots[index - 1].id, "completion.json"), "utf8"));
    assert.equal(previous.terminal, true, "Previous slot has not reached a verified terminal state");
    assert.equal(previous.planSha256, planSha256, "Completion belongs to another plan");
    assert.equal(previous.slotId, slots[index - 1].id, "Wrong preceding slot completion");
  }
  mkdirSync(parent, { recursive: true });
  const root = join(parent, slotId);
  mkdirSync(root); // Atomic claim: never overwrite or retry an occupied slot, including failed slots.
  writeFileSync(join(root, "claim.json"), JSON.stringify({ slot: slots[index], planSha256, pid: process.pid, claimedAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  return root;
}
export function claimSamplingSlot(planFile, expectedHash, slotId, executable) {
  const bytes = readFileSync(planFile);
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  assert.equal(sha(bytes), expectedHash, "Wrong frozen plan");
  const plan = JSON.parse(bytes);
  assert.equal(plan.schema, "ctxpack.formal-plan/1");
  assert.equal(plan.model, "gpt-6.1-sol"); assert.equal(plan.effort, "medium");
  assert.equal(plan.setupWallMs, 120000); assert.deepEqual(plan.limits, samplingLimits);
  assert.deepEqual(plan.slots, makeSlots());
  assert.deepEqual(runtimeSnapshot(executable), plan.runtime, "Frozen runtime changed");
  const slot = plan.slots.find((item) => item.id === slotId); assert.ok(slot);
  const root = reserveSlot(dirname(resolve(planFile)), plan.slots, slotId, expectedHash);
  return { root, plan, planBytes: bytes, metadata: { batchId: plan.id, planSha256: expectedHash, ...slot } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { id: { type: "string" }, codex: { type: "string" }, out: { type: "string" } } });
  assert.ok(values.id && values.codex && values.out, "Supply --id --codex --out in a new batch directory");
  const plan = createSamplingPlan(values.id, resolve(values.codex));
  const bytes = `${JSON.stringify(plan, null, 2)}\n`;
  mkdirSync(dirname(resolve(values.out)), { recursive: true });
  writeFileSync(values.out, bytes, { flag: "wx" });
  console.log(JSON.stringify({ planFile: resolve(values.out), planSha256: sha(bytes), slots: plan.slots.length }));
}
