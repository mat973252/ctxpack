import assert from "node:assert/strict";

export const expectedTitles = [
  ...["project", "decisions", "failures", "commands"].map((key) => `preserves ${key} text`),
  ...["generic", "codex", "pi", "claude"].map((target) => `preserves text through ${target} without writing`),
];

export function assertBaselineFailures(report, unhandledErrors) {
  assert.deepEqual(unhandledErrors, []);
  assert.equal(report.numTotalTests, 8);
  assert.equal(report.numFailedTests, 8);
  assert.equal(report.numPassedTests, 0);
  assert.equal(report.numPendingTests, 0);
  assert.equal(report.numTodoTests, 0);
  assert.equal(report.success, false);
  assert.equal(report.testResults.length, 1);
  const suite = report.testResults[0];
  assert.equal(suite.name, "/workspace/tests/recovery-case.test.ts");
  assert.equal(suite.message, "");
  assert.equal(suite.status, "failed");
  assert.deepEqual(suite.assertionResults.map((test) => test.title).sort(), [...expectedTitles].sort());
  for (const test of suite.assertionResults) {
    assert.equal(test.fullName, `real recovery: preserve user Markdown ${test.title}`);
    assert.equal(test.status, "failed");
    assert.equal(test.failureMessages.length, 1);
    assert.match(test.failureMessages[0], /^AssertionError: expected/);
    const line = test.title.includes("through") ? 54 : 34;
    assert.ok(test.failureMessages[0].includes(`tests/recovery-case.test.ts:${line}:`));
  }
}
