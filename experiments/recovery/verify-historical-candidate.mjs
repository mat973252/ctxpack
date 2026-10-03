import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync, execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { parseArgs } from "node:util";
import { historicalCase, assertTargetRegression, assertNodeReports, taskCommand } from "./historical-case.mjs";
import { applyHistoricalEdit } from "./historical-edits.mjs";
import { recoveryContainer } from "./recovery-container.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
export function assertCandidateFiles(task, files, candidate) {
  const expected = { ...task.files, [task.source]: sha(candidate) };
  for (const [path, hash] of Object.entries(expected)) assert.equal(files[path], hash, `Changed material: ${path}`);
  const extra = Object.keys(files).filter((path) => !Object.hasOwn(expected, path));
  assert.ok(extra.every((path) => task.generated.some((prefix) => path.startsWith(prefix))), "Unexpected generated file");
}

const maven = ["sh", "./mvnw", "-B", "-ntp", "-o", "-s", "/opt/empty-settings.xml", "-gs", "/opt/empty-settings.xml", "-Dmaven.repo.local=/opt/maven-repository"];
// Fixed commands only. Reports are obtained out of the container after successful exit.
export function candidateCommands(task, suite) {
  assert.ok(["regression", "check"].includes(suite));
  if (task.id === "permit-proxy") return [[...maven, ...(suite === "regression" ? ["-pl", "agent-permit-spring-ai", "-am", "-Dtest=GuardedToolMethodsAcceptanceTest", "-Dsurefire.failIfNoSpecifiedTests=false", "clean", "test"] : ["clean", "verify"])]];
  if (task.id === "relay-clock") return suite === "regression" ? [["pnpm", "exec", "tsc", "-b"], ["node", "--test", "--test-name-pattern=business waits", "packages/mcp/dist/test/business-sandbox.test.js"]] : [["pnpm", "check"]];
  if (suite === "regression") return [["pnpm", "exec", "vitest", "run", task.test]];
  return task.id === "lens-wal" ? [["pnpm", "lint"], ["pnpm", "test"], ["pnpm", "build"]] : [["pnpm", "check"]];
}

export function verifyHistoricalCandidate(id, edit, approvedSha256) {
  assert.match(approvedSha256, /^[a-f0-9]{64}$/, "Review must approve the exact candidate hash before execution");
  const task = historicalCase(id);
  const root = mkdtempSync(join(tmpdir(), `historical-candidate-${id}-`));
  const evidence = { schema: "ctxpack.historical-candidate/1", id, result: "unverified", imageId: task.imageId, approvedSha256,
    sourceHashes: Object.fromEntries(["verify-historical-candidate.mjs", "historical-case.mjs", "historical-edits.mjs", "JavaEditScope.java", "recovery-container.mjs",
      "historical-environments-2026-10-03.json", "real-task-files.json", "smoke-environment.json"].map((name) => [name, sha(readFileSync(new URL(name, import.meta.url)))])) };
  let commands = 0;
  const checked = (args, timeout = 60000) => {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    writeFileSync(join(root, `command-${++commands}.log`), JSON.stringify({ args, status: result.status, signal: result.signal }) + "\n" + result.stdout + "\n" + result.stderr);
    assert.equal(result.status, 0, `Command ${commands} failed`);
    return result.stdout.trim();
  };
  const container = recoveryContainer(checked, task.profile);
  let phase = "start";
  try {
    evidence.profile = container.start(task.imageId, task.files);
    const original = JSON.parse(container.exec(["node", "-e", "process.stdout.write(JSON.stringify(require('node:fs').readFileSync(process.argv[1], 'utf8')))", `/workspace/${task.source}`]));
    const candidate = applyHistoricalEdit(id, original, edit);
    assert.equal(sha(candidate), approvedSha256);
    evidence.candidateSha256 = sha(candidate);
    writeFileSync(join(root, "candidate.txt"), candidate);
    container.exec(["node", "-e", "require('node:fs').writeFileSync(process.argv[1], Buffer.from(process.argv[2], 'base64'))", `/workspace/${task.source}`, Buffer.from(candidate).toString("base64")]);
    assertCandidateFiles(task, container.files(), candidate);
    phase = "check";
    for (const args of candidateCommands(task, "check")) container.exec(taskCommand(task, args), 240000);
    evidence.checkExit = 0;
    assertCandidateFiles(task, container.files(), candidate);
    phase = "structured_results";
    if (id === "permit-proxy") {
      const reports = JSON.parse(container.exec(["node", "-e", `const fs=require('node:fs'); const reports=[]; for (const dir of ${JSON.stringify(task.generated)}) { const path=dir+'surefire-reports'; if(fs.existsSync(path)) for(const name of fs.readdirSync(path).sort()) if(/^TEST-.*\\.xml$/.test(name)) reports.push(fs.readFileSync(path+'/'+name,'utf8')); } console.log(JSON.stringify(reports));`]));
      writeFileSync(join(root, "surefire-reports.json"), JSON.stringify(reports));
      const parsed = JSON.parse(execFileSync("python", ["-X", "utf8", "-c", "import sys,json,xml.etree.ElementTree as E; suites=[E.fromstring(x) for x in json.load(sys.stdin)]; print(json.dumps({'tests':sum(int(s.attrib['tests']) for s in suites),'cases':sum(len(s.findall('testcase')) for s in suites),'bad':sum(len(t.findall(k)) for s in suites for t in s.findall('testcase') for k in ['failure','error','skipped']),'failed':sum(int(s.attrib.get(k,0)) for s in suites for k in ['failures','errors','skipped']),'identities':[t.attrib.get('classname','')+'#'+t.attrib['name'] for s in suites for t in s.findall('testcase')],'suites':len(suites)}))"], { input: JSON.stringify(reports), encoding: "utf8" }));
      assert.equal(parsed.tests, task.total); assert.equal(parsed.cases, task.total);
      assert.equal(parsed.bad, 0); assert.equal(parsed.failed, 0);
      assert.equal(new Set(parsed.identities).size, task.total);
      const prefix = "io.github.agentpermit4j.springai.consumer.GuardedToolMethodsAcceptanceTest#";
      assertTargetRegression(task, parsed.identities.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)));
      evidence.tests = parsed;
    } else if (id === "relay-clock") {
      const reporter = "export default async function* (source) { for await (const event of source) if (['test:fail','test:pass','test:summary'].includes(event.type)) yield JSON.stringify({type:event.type,name:event.data.name,file:event.data.file,counts:event.data.counts,skip:event.data.skip,todo:event.data.todo})+'\\n'; }";
      container.exec(["node", "-e", "require('node:fs').writeFileSync('/tmp/verify-node-reporter.mjs', process.argv[1])", reporter]);
      const packages = task.profile.dependencyPaths.filter((path) => path.startsWith("packages/")).map((path) => path.split("/")[1]);
      const summaries = [];
      const regression = [];
      for (const name of packages) {
        const prefix = `packages/${name}/`;
        const files = Object.keys(task.files).filter((path) => path.startsWith(prefix) && path.endsWith(".test.ts"))
          .map((path) => prefix + "dist/" + path.slice(prefix.length).replace(/\.ts$/, ".js"));
        assert.ok(files.length > 0);
        const output = container.exec(taskCommand(task, ["node", "--test", "--test-reporter=/tmp/verify-node-reporter.mjs", ...files]), 180000);
        const events = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        writeFileSync(join(root, `tests-${name}.json`), JSON.stringify(events));
        regression.push(...events.filter((event) => event.type === "test:pass" && event.file === "/workspace/packages/mcp/dist/test/business-sandbox.test.js" && event.name.startsWith("business waits ")).map((event) => event.name));
        const counts = assertNodeReports(events, files);
        summaries.push({ name, counts });
      }
      assert.equal(summaries.reduce((sum, item) => sum + item.counts.tests, 0), task.total);
      assertTargetRegression(task, regression);
      evidence.tests = { total: task.total, passed: task.total, packages: summaries };
    } else {
      const reporter = "import { writeFileSync } from 'node:fs'; export default class { onFinished(_files, errors) { writeFileSync('/tmp/verify-errors.json', JSON.stringify(errors.map(error => error.name || 'error'))); } }";
      container.exec(["node", "-e", "require('node:fs').writeFileSync('/tmp/verify-reporter.mjs', process.argv[1])", reporter]);
      container.exec(["pnpm", "exec", "vitest", "run", "--reporter=json", "--reporter=/tmp/verify-reporter.mjs", "--outputFile=/tmp/verify-tests.json"], 180000);
      const report = JSON.parse(container.exec(["cat", "/tmp/verify-tests.json"]));
      const errors = JSON.parse(container.exec(["cat", "/tmp/verify-errors.json"]));
      writeFileSync(join(root, "tests.json"), JSON.stringify(report));
      const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
      assert.equal(report.success, true); assert.equal(report.numTotalTests, task.total); assert.equal(report.numPassedTests, task.total);
      assert.equal(report.numFailedTests, 0); assert.equal(report.numPendingTests, 0); assert.equal(report.numTodoTests, 0);
      assert.equal(assertions.length, task.total);
      assert.ok(assertions.every((item) => item.status === "passed" && item.failureMessages.length === 0));
      assert.ok(report.testResults.every((suite) => suite.status === "passed" && suite.message === ""));
      assert.deepEqual(errors, []);
      assertTargetRegression(task, report.testResults.filter((suite) => suite.name === `/workspace/${task.test}`).flatMap((suite) => suite.assertionResults.map((item) => item.title)));
      evidence.tests = { total: task.total, passed: assertions.length, unhandled: errors };
    }
    assertCandidateFiles(task, container.files(), candidate);
    writeFileSync(join(root, "candidate.diff"), container.exec(["git", "diff", "--", task.source]));
    evidence.result = "verified_pending_source_review";
  } catch (error) {
    evidence.result = "failed";
    evidence.failure = { phase, command: commands, kind: error instanceof assert.AssertionError ? "assertion" : "execution_error" };
  } finally {
    evidence.cleanupComplete = container.close();
    if (!evidence.cleanupComplete) evidence.result = "cleanup_failed";
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
  }
  return { root, evidence };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { id: { type: "string" }, edit: { type: "string" }, "approved-sha256": { type: "string" } } });
  const result = verifyHistoricalCandidate(values.id, JSON.parse(readFileSync(values.edit, "utf8")), values["approved-sha256"]);
  console.log(JSON.stringify({ root: result.root, result: result.evidence.result, failure: result.evidence.failure, cleanupComplete: result.evidence.cleanupComplete }));
  if (result.evidence.result !== "verified_pending_source_review") process.exitCode = 1;
}
