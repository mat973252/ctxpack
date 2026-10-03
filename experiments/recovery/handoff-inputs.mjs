import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

export const taskFacts = Object.freeze({
  "markdown-text": "初始模板后的用户正文、重复模板文本、内部空行和Markdown硬换行应保留；CRLF归一为LF；纯模板不输出；四个handoff入口保持正文且不写工作树。围栏分类是另一任务，不修改它。",
  "ctx-fences": "围栏内的决策/失败列表是示例，保留在notes；围栏外真实条目正常解析；短围栏、异类标记不能提前结束示例，未闭合围栏持续保留为notes。不修改模板处理。",
  "lens-wal": "WAL写者在元数据与事件查询之间提交终态时，getRun必须返回同一已提交快照，不能混合；不能提交调用者外层事务，失败后仍可继续读取。",
  "relay-clock": "业务沙箱测试的等待辅助函数不能因墙钟调整提前超时或延长五秒预算；恰好截止时拒绝。这是测试辅助维护，其他测试断言冻结。",
  "permit-proxy": "真实CGLIB类代理应能注册原方法注解，执行仍经过原代理advice及审批/幂等流程；代理final工具方法明确拒绝，普通对象final方法仍支持。",
});
export const taskHistory = (task) => {
  assert.ok(Object.hasOwn(taskFacts, task.id));
  return {
    goal: taskFacts[task.id],
    completed: ["历史基线与冻结回归已校准，修复尚未实施。"],
    currentTasks: ["接手者尚未查看当前文件，必须重新读取，不把交接文字当作现状。"],
    nextActions: ["读取目标源码和冻结回归，按允许范围修复，再运行regression和check。"],
  };
};
export function manualHandoff(task) {
  const history = taskHistory(task);
  return `目标：${history.goal}\n已完成：${history.completed.join("\n")}\n当前：${history.currentTasks.join("\n")}\n下一步：${history.nextActions.join("\n")}`;
}
export function recoveryPrompt(task, scope, limits) {
  return `接手已复现、尚未修复的历史任务。根据本次交接恢复工作。
只允许修改${task.source}，范围：${scope}。先读取该文件和${task.test}。可读取索引中其他文件。不得更改测试、依赖、配置或规避断言。每次apply_edit替换完整候选，不累计旧编辑。用run_tests的regression和check验证最终修改，再报告结果。
工具预算：${limits.read_file}次读、${limits.apply_edit}次修改、${limits.run_tests}次测试，所有调用总计${limits.wallMs / 1000}秒，失败请求也计数。禁止其他工具、网络、路径或委派。文件索引：${JSON.stringify(Object.keys(task.files))}`;
}

// Control-side preparation only. Native mode still needs a real same-thread compaction.
export function prepareHandoffInputs(task) {
  const directory = mkdtempSync(join(tmpdir(), "ctxpack-handoff-inputs-"));
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" });
  assert.equal(git.status, 128, "Preparation must be outside any Git checkout");
  const pack = join(directory, ".ctxpack"); mkdirSync(pack);
  const json = (name, value) => writeFileSync(join(pack, name), `${JSON.stringify(value, null, 2)}\n`);
  json("manifest.json", { version: "0.1", project: task.id, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z", schemaVersion: 1 });
  json("state.json", { ...taskHistory(task), status: "in_progress", blockers: [], relevantFiles: [...new Set([task.source, task.test])], verification: [], git: {} });
  json("artifacts.json", { schemaVersion: 1, artifacts: [] });
  const snapshot = () => Object.fromEntries(readdirSync(pack).sort().map((name) => [name, readFileSync(join(pack, name), "utf8")]));
  const before = snapshot();
  const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const cliSha256 = sha(readFileSync(cli));
  const rendered = spawnSync(process.execPath, [cli, "handoff", "--to", "codex", "--budget", "4000"], { cwd: directory, encoding: "utf8", timeout: 30000 });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(sha(readFileSync(cli)), cliSha256, "CLI changed while preparing inputs");
  assert.deepEqual(snapshot(), before, "Handoff must not mutate the prepared pack");
  const manual = manualHandoff(task);
  const nativePreparation = `${manual}\n这是交接准备阶段，记住以上事实，不使用工具，只回答READY。`;
  const inputs = { manual, nativePreparation, ctxpack: rendered.stdout };
  for (const [name, text] of Object.entries(inputs)) {
    for (const fact of Object.values(taskHistory(task)).flat()) assert.ok(text.includes(fact), `${name} lost a source fact`);
    writeFileSync(join(directory, `${name}.txt`), text);
  }
  const evidence = { schema: "ctxpack.handoff-inputs/1", id: task.id, cliSha256,
    inputsSha256: Object.fromEntries(Object.entries(inputs).map(([name, text]) => [name, sha(text)])),
    stateSha256: sha(before["state.json"]), nativeCompacted: false, formalSamples: 0 };
  writeFileSync(join(directory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return { directory, inputs, evidence };
}
