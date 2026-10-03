import assert from "node:assert/strict";

export function assertHistoricalVitest(id, report, errors) {
  assert.ok(id === "ctx-fences" || id === "lens-wal");
  assert.deepEqual(errors, []);
  assert.equal(report.numTotalTests, id === "ctx-fences" ? 4 : 14);
  assert.equal(report.numFailedTests, id === "ctx-fences" ? 4 : 1);
  assert.equal(report.numPassedTests, id === "ctx-fences" ? 0 : 13);
  assert.equal(report.numPendingTests, 0);
  assert.equal(report.numTodoTests ?? 0, 0);
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
  assert.equal(assertions.length, report.numTotalTests);
  assert.equal(new Set(assertions.map((test) => test.fullName)).size, assertions.length);
  assert.equal(assertions.filter((test) => test.status === "passed").length, report.numPassedTests);
  const failures = assertions.filter((test) => test.status === "failed");
  assert.equal(failures.length, report.numFailedTests);
  const names = id === "ctx-fences" ? [
    "keeps backtick decision examples in notes and parses the following fact",
    "does not close a tilde example with a shorter fence",
    "does not close a backtick example with the other fence marker",
    "keeps an unclosed decision example entirely in notes",
  ].map((name) => `real recovery: fenced examples are not recorded facts ${name}`)
    : ["incremental Recorder reads one committed snapshot when another connection finishes between queries"];
  assert.deepEqual(failures.map((test) => test.fullName).sort(), names.sort());
  for (const failure of failures) assert.match(failure.failureMessages[0], id === "ctx-fences" ? /AssertionError: expected/ : /a running run cannot end with run.completed/);
  return failures;
}
