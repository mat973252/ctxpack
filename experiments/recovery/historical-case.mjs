import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const cases = {
  "markdown-text": { source: "src/core/handoff.ts", test: "tests/recovery-case.test.ts", total: 160, regressionTotal: 8 },
  "ctx-fences": { source: "src/core/handoff.ts", test: "tests/recovery-fences.test.ts", total: 156, regressionTotal: 4 },
  "lens-wal": { source: "src/storage/sqlite/store.ts", test: "tests/incremental-recorder.test.ts", total: 266, regressionTotal: 14 },
  "relay-clock": { source: "packages/mcp/test/business-sandbox.test.ts", test: "packages/mcp/test/business-sandbox.test.ts", total: 208, regressionTotal: 2 },
  "permit-proxy": { source: "agent-permit-spring-ai/src/main/java/io/github/agentpermit4j/springai/GuardedToolMethods.java",
    test: "agent-permit-spring-ai/src/test/java/io/github/agentpermit4j/springai/consumer/GuardedToolMethodsAcceptanceTest.java", total: 216, regressionTotal: 4 },
};
const regressionNames = {
  "markdown-text": [...["project", "decisions", "failures", "commands"].map((name) => `preserves ${name} text`),
    ...["generic", "codex", "pi", "claude"].map((name) => `preserves text through ${name} without writing`)],
  "ctx-fences": ["keeps backtick decision examples in notes and parses the following fact", "does not close a tilde example with a shorter fence",
    "does not close a backtick example with the other fence marker", "keeps an unclosed decision example entirely in notes"],
  "lens-wal": ["reads one committed snapshot when another connection finishes between queries", "releases failed reads without committing a caller's transaction",
    "does not let returned event objects change an already committed prefix", "does not leave a partial run when start is rejected",
    "rejects stale writers and keeps their in-memory prefix unchanged", "preserves attached UNKNOWN Relay evidence while appending and completing",
    "keeps the default terminal-only behavior and requires an incremental store when opted in", "commits ordered running events and completes without rewriting earlier events",
    "rolls back a rejected append and terminal write before changing memory", "rejects duplicate IDs and invalid tool relationships before committing them",
    ...["before-start", "after-start", "after-tool-return", "before-finish"].map((phase) => `reads the committed prefix after killing at '${phase}'`)],
  "relay-clock": ["business waits tolerate wall-clock adjustments", "business waits still reject an expired monotonic deadline"],
  "permit-proxy": ["discoversClassProxyAnnotationsWithoutBypassingAdviceApprovalOrIdempotency", "rejectsFinalToolOnClassProxyBeforeAnyInvocation",
    "registersMultipleMethodsAndExecutesNormalizedArgumentsOnceWithTrustedIdentity", "rejectsDuplicateToolNamesAndUnprotectedMethodsAtRegistration"],
};
export function assertTargetRegression(task, names) {
  assert.equal(names.length, task.regressionTotal);
  assert.deepEqual([...names].sort(), [...regressionNames[task.id]].sort(), "Wrong regression identities");
}

export function assertNodeReports(events, files) {
  assert.ok(events.every((event) => event.type !== "test:fail" && !event.skip && !event.todo));
  const reports = events.filter((event) => event.type === "test:summary");
  const perFile = reports.filter((report) => report.file);
  const totals = reports.filter((report) => !report.file);
  assert.equal(totals.length, 1);
  assert.deepEqual(perFile.map((report) => report.file).sort(), files.map((file) => `/workspace/${file}`).sort());
  for (const report of reports) {
    for (const key of ["failed", "cancelled", "skipped", "todo"]) assert.equal(report.counts[key], 0);
    assert.equal(report.counts.tests, report.counts.passed);
  }
  for (const key of ["tests", "passed", "topLevel", "suites"]) {
    assert.equal(totals[0].counts[key], perFile.reduce((sum, report) => sum + report.counts[key], 0));
  }
  return totals[0].counts;
}

export function taskCommand(task, args) {
  // Match Relay's checked-in CI prerequisite without exposing any host environment.
  return task.id === "relay-clock" ? ["env", "HOME=/tmp", "PATH=/workspace/packages/adapter-pi/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", ...args] : args;
}
export function historicalCase(id) {
  assert.ok(Object.hasOwn(cases, id), "Unknown task");
  if (id === "markdown-text") return { id, ...cases[id], files: read("./real-task-files.json").files,
    imageId: read("./smoke-environment.json").imageId, profile: {}, generated: ["dist/"] };
  const frozen = read("./historical-environments-2026-10-03.json").cases.find((item) => item.id === id);
  const observed = frozen.observed.container;
  const profile = { dependencyPaths: observed.dependencyPaths, envNames: observed.envNames,
    cachePaths: Object.keys(observed.tmpfs).filter((path) => path.startsWith("/workspace/")).map((path) => path.slice("/workspace/".length)) };
  const javaModules = ["core", "policy", "execution", "approval", "audit", "jdbc", "redis", "spring-ai", "spring-boot-autoconfigure", "spring-boot-starter", "playground"];
  const generated = id === "permit-proxy" ? javaModules.map((name) => `agent-permit-${name}/target/`) : id === "relay-clock"
    ? observed.dependencyPaths.filter((path) => path.startsWith("packages/")).map((path) => path.replace(/node_modules$/, "dist/")) : ["dist/"];
  return { id, ...cases[id], files: frozen.files, imageId: frozen.imageId, profile, generated };
}
