import assert from "node:assert/strict";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import { restrictedHost } from "./restricted-host.mjs";

const { values } = parseArgs({ options: { codex: { type: "string" } } });
assert.ok(values.codex);
const root = mkdtempSync(join(tmpdir(), "ctxpack-native-probe-"));
const cwd = join(root, "empty-host"); mkdirSync(cwd);
const path = `material-${randomUUID()}.txt`;
const marker = `VALUE_${randomUUID()}`;
const evidence = { schema: "ctxpack.native-probe/1", result: "unverified", calls: [], host: {},
  sourceHashes: Object.fromEntries(["run-native-probe.mjs", "restricted-host.mjs", "access-policy.mjs"].map((name) => [name, createHash("sha256").update(readFileSync(new URL(name, import.meta.url))).digest("hex")])) };
const prepareAt = performance.now();
const prepareDeadline = prepareAt + 120000;
let host;
try {
  host = await restrictedHost({ executable: resolve(values.codex), cwd, setupDeadline: prepareDeadline, evidence: evidence.host,
    dynamicTools: [{ type: "function", name: "read_file", description: "Read the one synthetic material named in the handoff.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }],
    onTool: async (tool, args, isOpen) => {
      evidence.calls.push({ tool, args });
      assert.ok(isOpen()); assert.equal(evidence.calls.length, 1); assert.equal(tool, "read_file"); assert.deepEqual(args, { path });
      return { success: true, text: marker };
    } });
  await host.turn(`交接准备：唯一材料名是${path}。后续恢复时调用read_file读取它并报告结果。现在不要使用工具，只回答READY。`, prepareDeadline, "prepare");
  await host.compact(prepareDeadline);
  evidence.preparationMs = performance.now() - prepareAt;
  assert.equal(evidence.calls.length, 0);
  const recoveryAt = performance.now();
  await host.turn("现在恢复：读取交接中唯一材料，原样报告工具返回值。必须读取一次，不猜测结果。", recoveryAt + 120000);
  evidence.recoveryMs = performance.now() - recoveryAt;
  assert.equal(evidence.calls.length, 1);
  assert.ok(evidence.host.messages.some((message) => message.includes(marker)));
  evidence.result = "verified_pending_cleanup";
} catch {
  evidence.result = "failed"; process.exitCode = 1;
} finally {
  evidence.cleanupComplete = host ? await host.close() : evidence.host.cleanupComplete === true;
  if (host) {
    try { host.assertFinalProtocol(); } catch { evidence.result = "protocol_failed"; process.exitCode = 1; }
  }
  if (!evidence.cleanupComplete) { evidence.result = "cleanup_failed"; process.exitCode = 1; }
  if (evidence.result === "verified_pending_cleanup") evidence.result = "verified_native_mechanism";
  writeFileSync(join(root, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ root, result: evidence.result, preparationMs: evidence.preparationMs, recoveryMs: evidence.recoveryMs }));
}
