import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { URL } from "node:url";
import { assertBaselineFailures } from "./container-report.mjs";

const { values } = parseArgs({ options: { image: { type: "string" } } });
assert.ok(values.image, "--image must name an already built baseline image");
const root = mkdtempSync(join(tmpdir(), "ctxpack-container-probe-"));
const id = randomUUID();
const name = `ctxpack-probe-${id}`;
const volume = `${name}-workspace`;
const label = `ctxpack.recovery-probe=${id}`;
const approved = JSON.parse(readFileSync(new URL("./real-task-files.json", import.meta.url), "utf8"));
const evidence = { schema: "ctxpack.container-probe/2", result: "unverified", root, tests: {},
  sourceHashes: Object.fromEntries(["Containerfile", "probe-container-isolation.mjs", "container-report.mjs", "real-task-files.json"].map((file) => [file, createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex")])) };
let container;
let commandCount = 0;
function docker(args, timeout = 30000) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 });
  // All commands target this synthetic fixture; no credential values are passed.
  try { writeFileSync(join(root, `command-${++commandCount}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`); }
  catch { evidence.loggingFailed = true; }
  assert.equal(result.error, undefined, "Docker command did not finish");
  return result;
}
function checked(args, timeout) {
  const result = docker(args, timeout);
  assert.equal(result.status, 0, "Docker command failed; see local command log");
  return result.stdout.trim();
}
function namedResources(kind, resourceName) {
  return checked([kind, "ls", ...(kind === "container" ? ["--all"] : []), "--filter", `name=${resourceName}`, "--format", "{{json .}}"])
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((resource) => (kind === "container" ? resource.Names : resource.Name) === resourceName);
}
function removeOwned(kind, resourceName) {
  for (const resource of namedResources(kind, resourceName)) {
    const target = kind === "container" ? resource.ID : resource.Name;
    const inspected = JSON.parse(checked([kind, "inspect", target]))[0];
    const labels = kind === "container" ? inspected.Config.Labels : inspected.Labels;
    assert.equal(labels["ctxpack.recovery-probe"], id, "Refuse to remove a foreign resource");
    checked([kind, "rm", ...(kind === "container" ? ["--force"] : []), target]);
  }
  assert.equal(namedResources(kind, resourceName).length, 0);
}
const treeProbe = `
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir).sort()) {
      if (dir === '/workspace' && ['.git', 'node_modules'].includes(entry)) continue;
      const full = path.join(dir, entry), stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Unexpected source symlink');
      if (stat.isDirectory()) walk(full);
      else files[path.relative('/workspace', full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  }
  walk('/workspace'); console.log(JSON.stringify(files));
`;
try {
  const imageId = checked(["image", "inspect", values.image, "--format", "{{.Id}}"]);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  evidence.imageId = imageId;
  checked(["volume", "create", "--label", label, volume]);
  container = checked(["run", "--detach", "--name", name, "--label", label,
    "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "128", "--memory", "1073741824", "--cpus", "2", "--user", "1000:1000",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=134217728", "--mount", `type=volume,source=${volume},target=/workspace`,
    imageId, "sleep", "infinity"]);
  assert.match(container, /^[a-f0-9]{64}$/);
  const inspected = JSON.parse(checked(["inspect", container]))[0];
  const host = inspected.HostConfig;
  assert.equal(inspected.Config.Labels["ctxpack.recovery-probe"], id);
  assert.equal(inspected.Config.User, "1000:1000");
  assert.equal(host.NetworkMode, "none");
  assert.equal(host.ReadonlyRootfs, true);
  assert.equal(host.Privileged, false);
  assert.deepEqual(host.CapDrop, ["ALL"]);
  assert.ok(host.SecurityOpt.includes("no-new-privileges:true"));
  assert.equal(host.PidsLimit, 128);
  assert.equal(host.Memory, 1073741824);
  assert.equal(host.NanoCpus, 2000000000);
  assert.deepEqual(inspected.Mounts.map((mount) => ({ type: mount.Type, name: mount.Name, destination: mount.Destination, rw: mount.RW })), [{ type: "volume", name: volume, destination: "/workspace", rw: true }]);
  const envNames = inspected.Config.Env.map((entry) => entry.split("=", 1)[0]).sort();
  assert.deepEqual(envNames, ["CI", "NODE_VERSION", "PATH", "YARN_VERSION"]);
  evidence.profile = { user: inspected.Config.User, network: host.NetworkMode, readOnlyRoot: host.ReadonlyRootfs,
    capDrop: host.CapDrop, securityOpt: host.SecurityOpt, memory: host.Memory, pids: host.PidsLimit,
    nanoCpus: host.NanoCpus, envNames, mountTypes: inspected.Mounts.map((mount) => mount.Type), tmpfs: host.Tmpfs };
  assert.deepEqual(JSON.parse(checked(["exec", container, "node", "-e", treeProbe])), approved.files);
  evidence.approvedFiles = Object.keys(approved.files).length;
  evidence.baselineArchiveSha256 = approved.archiveSha256;
  evidence.pnpmVersion = checked(["exec", container, "pnpm", "--version"]);
  assert.equal(evidence.pnpmVersion, "10.17.1");
  evidence.gitVersion = checked(["exec", container, "git", "--version"]);

  const probe = `
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    import { createConnection } from 'node:net';
    import { networkInterfaces } from 'node:os';
    const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const status = readFileSync('/proc/self/status', 'utf8');
    assert.equal(process.getuid(), 1000);
    assert.match(status, /^CapEff:\\s+0+$/m);
    assert.match(status, /^NoNewPrivs:\\s+1$/m);
    const interfaces = Object.values(networkInterfaces()).flat();
    assert.ok(interfaces.every((entry) => entry.internal));
    for (const path of ['/var/run/docker.sock', '/run/docker.sock', '/mnt/c', '/mnt/d', '/host']) assert.equal(existsSync(path), false);
    let rootWrite;
    try { writeFileSync('/etc/ctxpack-probe', 'synthetic'); rootWrite = 'allowed'; } catch (error) { rootWrite = error.code; }
    assert.ok(['EROFS', 'EACCES'].includes(rootWrite));
    writeFileSync('/workspace/.probe-write', 'synthetic');
    assert.equal(readFileSync('/workspace/.probe-write', 'utf8'), 'synthetic');
    unlinkSync('/workspace/.probe-write');
    const network = await new Promise((resolve) => {
      const socket = createConnection({ host: '192.0.2.1', port: 443 });
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve('connected'); });
      socket.once('timeout', () => { socket.destroy(); resolve('timeout'); });
      socket.once('error', (error) => resolve(error.code));
    });
    assert.ok(['ENETUNREACH', 'EHOSTUNREACH'].includes(network));
    console.log(JSON.stringify({ node: process.version, uid: process.getuid(), rootWrite, network,
      handoffSha256: sha('/workspace/src/core/handoff.ts'),
      handoffLfSha256: createHash('sha256').update(readFileSync('/workspace/src/core/handoff.ts', 'utf8').replace(/\\r\\n/g, '\\n')).digest('hex'),
      regressionSha256: sha('/workspace/tests/recovery-case.test.ts') }));
  `;
  const observed = JSON.parse(checked(["exec", container, "node", "--input-type=module", "-e", probe]));
  evidence.observed = observed;
  assert.equal(observed.handoffLfSha256, "0f0cdd1e8d9f66079b05a1aa9f54224eb6bad9bfa8c9db688d32d094f1bad9cf");
  assert.equal(observed.regressionSha256, "699a5855bebfdfbf8fb5f00e7056e75c90622410f52f0dbf2f22b42e7fdc3ff6");
  // Vitest 3's JSON reporter ignores onFinished errors, so capture those separately.
  const errorReporter = "import { writeFileSync } from 'node:fs'; export default class { onFinished(_files, errors) { writeFileSync('/tmp/unhandled.json', JSON.stringify(errors.map(error => error.name || 'error'))); } }";
  checked(["exec", container, "node", "-e", "require('node:fs').writeFileSync('/tmp/error-reporter.mjs', process.argv[1])", errorReporter]);
  const tested = docker(["exec", container, "pnpm", "exec", "vitest", "run", "tests/recovery-case.test.ts", "--reporter=json", "--reporter=/tmp/error-reporter.mjs", "--outputFile=/tmp/recovery-report.json"], 120000);
  evidence.tests = { exitCode: tested.status, commandLog: `command-${commandCount}.log` };
  assert.equal(tested.status, 1);
  const report = JSON.parse(checked(["exec", container, "cat", "/tmp/recovery-report.json"]));
  const errors = JSON.parse(checked(["exec", container, "cat", "/tmp/unhandled.json"]));
  assertBaselineFailures(report, errors);
  evidence.tests.failedTests = report.numFailedTests;
  evidence.tests.titles = report.testResults[0].assertionResults.map((test) => test.title);
  evidence.tests.unhandledErrors = errors;
  assert.deepEqual(JSON.parse(checked(["exec", container, "node", "-e", treeProbe])), approved.files);
  assert.equal(checked(["exec", container, "git", "status", "--porcelain"]), "");
  evidence.result = "bounded_container_probe_passed";
} catch {
  evidence.result = "failed";
  evidence.failedAfterCommand = commandCount;
  process.exitCode = 1;
} finally {
  // Remove only this invocation's resources, never prune global Docker state.
  evidence.cleanupComplete = true;
  for (const [kind, resourceName] of [["container", name], ["volume", volume]]) {
    try { removeOwned(kind, resourceName); }
    catch { evidence.cleanupComplete = false; }
  }
  if (!evidence.cleanupComplete) { evidence.result = "cleanup_failed"; process.exitCode = 1; }
  if (evidence.loggingFailed) { evidence.result = "evidence_write_failed"; process.exitCode = 1; }
  try { writeFileSync(join(root, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`); }
  catch { evidence.result = "evidence_write_failed"; process.exitCode = 1; }
  console.log(JSON.stringify({ root, result: evidence.result, cleanupComplete: evidence.cleanupComplete }));
}
