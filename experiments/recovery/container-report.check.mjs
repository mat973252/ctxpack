import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBaselineFailures, expectedTitles } from "./container-report.mjs";

function report() {
  return { numTotalTests: 8, numFailedTests: 8, numPassedTests: 0, numPendingTests: 0, numTodoTests: 0, success: false,
    testResults: [{ name: "/workspace/tests/recovery-case.test.ts", message: "", status: "failed", assertionResults: expectedTitles.map((title) => ({
      title, fullName: `real recovery: preserve user Markdown ${title}`, status: "failed",
      failureMessages: [`AssertionError: expected user Markdown at /workspace/tests/recovery-case.test.ts:${title.includes("through") ? 54 : 34}:1`],
    })) }] };
}
test("count substrings, wrong assertions, load errors and unhandled failures are not expected red", () => {
  assertBaselineFailures(report(), []);
  const count = report(); count.numFailedTests = 18;
  const setup = report(); setup.testResults[0].assertionResults[0].failureMessages = ["Error: setup failed"];
  const location = report(); location.testResults[0].assertionResults[0].failureMessages = ["AssertionError: expected at tests/recovery-case.test.ts:52:1"];
  const load = report(); load.testResults[0].message = "Cannot load file";
  for (const invalid of [count, setup, location, load]) assert.throws(() => assertBaselineFailures(invalid, []));
  assert.throws(() => assertBaselineFailures(report(), ["Unhandled rejection"]));
});
