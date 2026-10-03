import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { URL } from "node:url";
import { recoveryContainer } from "./recovery-container.mjs";
import { assertHistoricalVitest } from "./historical-environment-report.mjs";

const { values } = parseArgs({ options: { material: { type: "string" }, image: { type: "string" } } });
assert.ok(values.material && values.image, "--material controller manifest and --image exact image ID required");
const approved = JSON.parse(readFileSync(values.material, "utf8"));
const id = approved.id;
assert.ok(["ctx-fences", "lens-wal", "relay-clock", "permit-proxy"].includes(id));
const relayPackages = ["adapter-pi", "artifact-fs", "cli", "core", "epistemic", "mcp", "storage-sqlite"];
const javaModules = ["core", "policy", "execution", "approval", "audit", "jdbc", "redis", "spring-ai", "spring-boot-autoconfigure", "spring-boot-starter", "playground"];
const isJava = id === "permit-proxy";
const dependencyPaths = isJava ? [] : ["node_modules", ...(id === "relay-clock" ? relayPackages.map((name) => `packages/${name}/node_modules`) : [])];
const cachePaths = isJava || id === "relay-clock" ? [] : ["node_modules/.vite-temp", "node_modules/.vite"];
const dependencyRoots = isJava ? ["/opt/maven-repository", "/usr/share/maven"] : dependencyPaths.map((path) => `/workspace/${path}`);
const profile = { dependencyPaths, cachePaths, ...(isJava ? { envNames: ["CI", "HOME", "JAVA_HOME", "JAVA_VERSION", "LANG", "LANGUAGE", "LC_ALL", "MAVEN_CONFIG", "MAVEN_HOME", "MAVEN_USER_HOME", "PATH"] } : {}) };
const root = mkdtempSync(join(tmpdir(), `historical-env-${id}-`));
let commands = 0;
function docker(args, timeout = 60000) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  writeFileSync(join(root, `command-${++commands}.log`), JSON.stringify({ args, status: result.status, signal: result.signal }) + "\n" + result.stdout + "\n" + result.stderr);
  return result;
}
const checked = (args, timeout) => {
  const result = docker(args, timeout);
  assert.equal(result.status, 0, `Docker command ${commands} failed`);
  return result.stdout.trim();
};
const container = recoveryContainer(checked, profile);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const evidence = { schema: "ctxpack.historical-environment/1", id, image: values.image,
  scriptSha256: hash(readFileSync(new URL(import.meta.url))), containerHelperSha256: hash(readFileSync(new URL("./recovery-container.mjs", import.meta.url))),
  reportHelperSha256: hash(readFileSync(new URL("./historical-environment-report.mjs", import.meta.url))),
  materialManifestSha256: hash(readFileSync(values.material)), result: "unverified" };
let phase = "start";
try {
  evidence.container = container.start(values.image, approved.files);
  phase = "permissions";
  const permissions = `
    const fs = require('node:fs'), net = require('node:net');
    const writes = {};
    for (const dir of ['/', ...${JSON.stringify(dependencyRoots)}]) {
      try { fs.writeFileSync(dir + '/ctxpack-readonly-probe', 'probe'); writes[dir] = 'WRITABLE'; fs.unlinkSync(dir + '/ctxpack-readonly-probe'); }
      catch(error) { writes[dir] = error.code; }
    }
    const socket = net.createConnection({host:'1.1.1.1',port:443});
    let finished = false;
    function done(network) { if (finished) return; finished = true; socket.destroy(); console.log(JSON.stringify({node:process.version,uid:process.getuid(),writes,network,status:fs.readFileSync('/proc/self/status','utf8').split('\\n').filter(line=>/^(CapEff|NoNewPrivs):/.test(line))})); }
    socket.once('connect',()=>done('CONNECTED')); socket.once('error',error=>done(error.code)); socket.setTimeout(2000,()=>done('TIMEOUT'));
  `;
  evidence.permissions = JSON.parse(container.exec(["node", "-e", permissions]));
  assert.equal(evidence.permissions.uid, 1000);
  assert.equal(evidence.permissions.network, "ENETUNREACH");
  assert.ok(Object.values(evidence.permissions.writes).every((value) => value === "EROFS"));
  assert.ok(evidence.permissions.status.some((line) => /^CapEff:\s+0+$/.test(line)));
  assert.ok(evidence.permissions.status.some((line) => /^NoNewPrivs:\s+1$/.test(line)));
  const dependencies = `
    const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
    const hash=crypto.createHash('sha256'); let files=0,links=0;
    const caches=new Set(${JSON.stringify(cachePaths.map((path) => `/workspace/${path}`))});
    function walk(file) {
      if(caches.has(file)) return;
      const stat=fs.lstatSync(file); hash.update(file+'\\0');
      if(stat.isSymbolicLink()) { links++; hash.update('link:'+fs.readlinkSync(file)+'\\0'); }
      else if(stat.isDirectory()) { for(const name of fs.readdirSync(file).sort()) walk(path.join(file,name)); }
      else { files++; hash.update(fs.readFileSync(file)); }
    }
    for(const dir of ${JSON.stringify(dependencyRoots)}) walk(dir);
    console.log(JSON.stringify({sha256:hash.digest('hex'),files,links}));
  `;
  evidence.dependenciesBefore = JSON.parse(container.exec(["node", "-e", dependencies]));
  evidence.runtime = container.exec(isJava ? ["sh", "./mvnw", "--version"] : ["pnpm", "--version"]);
  phase = "baseline_regression";
  if (id === "ctx-fences" || id === "lens-wal") {
    const reporter = "import { writeFileSync } from 'node:fs'; export default class { onFinished(_files, errors) { writeFileSync('/tmp/unhandled.json', JSON.stringify(errors.map(error => error.name || 'error'))); } }";
    container.exec(["node", "-e", "require('node:fs').writeFileSync('/tmp/error-reporter.mjs', process.argv[1])", reporter]);
    const result = docker(["exec", container.id, "pnpm", "exec", "vitest", "run", approved.material.test,
      "--reporter=json", "--reporter=/tmp/error-reporter.mjs", "--outputFile=/tmp/tests.json"], 120000);
    assert.equal(result.status, 1);
    const report = JSON.parse(container.exec(["cat", "/tmp/tests.json"]));
    const errors = JSON.parse(container.exec(["cat", "/tmp/unhandled.json"]));
    writeFileSync(join(root, "tests.json"), JSON.stringify(report, null, 2));
    const failures = assertHistoricalVitest(id, report, errors);
    evidence.tests = { exit: result.status, total: report.numTotalTests, failed: report.numFailedTests, unhandled: errors, names: failures.map((test) => test.title) };
  } else if (id === "relay-clock") {
    container.exec(["pnpm", "exec", "tsc", "-b"], 120000);
    const reporter = "export default async function* (source) { for await (const event of source) if (['test:fail','test:summary'].includes(event.type)) yield JSON.stringify({type:event.type,name:event.data.name,counts:event.data.counts,message:event.data.details?.error?.cause?.message ?? event.data.details?.error?.message})+'\\n'; }";
    container.exec(["node", "-e", "require('node:fs').writeFileSync('/tmp/node-reporter.mjs', process.argv[1])", reporter]);
    const result = docker(["exec", container.id, "node", "--test", "--test-name-pattern=business waits", "--test-reporter=/tmp/node-reporter.mjs", "packages/mcp/dist/test/business-sandbox.test.js"], 60000);
    assert.equal(result.status, 1);
    const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const failures = events.filter((event) => event.type === "test:fail");
    assert.deepEqual(failures.map((event) => event.name), ["business waits tolerate wall-clock adjustments", "business waits still reject an expired monotonic deadline"]);
    assert.match(failures[0].message, /business condition timed out/);
    assert.match(failures[1].message, /exact deadline must fail/);
    const summaries = events.filter((event) => event.type === "test:summary");
    assert.ok(summaries.length > 0);
    for (const summary of summaries) assert.deepEqual(summary.counts,
      { tests: 2, failed: 2, passed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 2, suites: 0 });
    evidence.tests = { exit: result.status, failures, summaries };
  } else {
    const result = docker(["exec", container.id, "sh", "./mvnw", "-B", "-ntp", "-o", "-s", "/opt/empty-settings.xml", "-gs", "/opt/empty-settings.xml", "-Dmaven.repo.local=/opt/maven-repository",
      "-pl", "agent-permit-spring-ai", "-am", "-Dtest=GuardedToolMethodsAcceptanceTest", "-Dsurefire.failIfNoSpecifiedTests=false", "clean", "test"], 180000);
    assert.equal(result.status, 1);
    const xml = container.exec(["cat", "agent-permit-spring-ai/target/surefire-reports/TEST-io.github.agentpermit4j.springai.consumer.GuardedToolMethodsAcceptanceTest.xml"]);
    writeFileSync(join(root, "tests.xml"), xml);
    const parsed = JSON.parse(execFileSync("python", ["-X", "utf8", "-c", "import sys,json,xml.etree.ElementTree as E; s=E.fromstring(sys.stdin.read()); print(json.dumps({'tests':int(s.attrib['tests']),'failures':int(s.attrib['failures']),'errors':int(s.attrib['errors']),'skipped':int(s.attrib['skipped']),'failed':[{'name':t.attrib['name'],'message':e.attrib.get('message','')} for t in s.findall('testcase') for e in t if e.tag in ('failure','error')]}))"], { input: xml, encoding: "utf8" }));
    assert.deepEqual([parsed.tests, parsed.failures, parsed.errors, parsed.skipped], [4, 1, 1, 0]);
    assert.deepEqual(parsed.failed.map((item) => item.name).sort(), ["discoversClassProxyAnnotationsWithoutBypassingAdviceApprovalOrIdempotency", "rejectsFinalToolOnClassProxyBeforeAnyInvocation"]);
    assert.ok(parsed.failed.some((item) => item.message === "at least one public annotated tool is required"));
    assert.ok(parsed.failed.some((item) => item.message.includes("Expected java.lang.IllegalArgumentException to be thrown")));
    evidence.tests = { exit: result.status, ...parsed };
  }
  phase = "postcheck";
  const after = container.files();
  for (const [path, sha256] of Object.entries(approved.files)) assert.equal(after[path], sha256, `Material changed: ${path}`);
  const extra = Object.keys(after).filter((path) => !Object.hasOwn(approved.files, path));
  const generated = id === "relay-clock" ? relayPackages.map((name) => `packages/${name}/dist/`) : isJava ? javaModules.map((name) => `agent-permit-${name}/target/`) : [];
  assert.ok(extra.every((path) => generated.some((prefix) => path.startsWith(prefix))), "Unexpected generated file");
  assert.equal(container.exec(["git", "status", "--porcelain"]), "");
  evidence.dependenciesAfter = JSON.parse(container.exec(["node", "-e", dependencies]));
  assert.deepEqual(evidence.dependenciesAfter, evidence.dependenciesBefore);
  evidence.originalFileCount = Object.keys(approved.files).length;
  evidence.generatedFileCount = extra.length;
  evidence.result = "bounded_historical_environment_passed";
} catch (error) {
  evidence.failure = { phase, kind: error instanceof assert.AssertionError ? "assertion" : "execution_error", command: commands };
  process.exitCode = 1;
} finally {
  evidence.cleanupComplete = container.close();
  if (!evidence.cleanupComplete) { evidence.result = "cleanup_failed"; process.exitCode = 1; }
  writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ root, result: evidence.result, failure: evidence.failure, cleanupComplete: evidence.cleanupComplete }));
}
