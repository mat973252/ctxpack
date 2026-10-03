import assert from "node:assert/strict";
import { it } from "node:test";
import { assertHistoricalVitest } from "./historical-environment-report.mjs";

const lens = () => ({ numTotalTests: 14, numPassedTests: 13, numFailedTests: 1, numPendingTests: 0,
  testResults: [{ assertionResults: [
    { fullName: "incremental Recorder reads one committed snapshot when another connection finishes between queries", title: "reads one committed snapshot when another connection finishes between queries", status: "failed", failureMessages: ["a running run cannot end with run.completed"] },
    ...Array.from({ length: 13 }, (_, index) => ({ fullName: `unchanged-${index}`, title: `unchanged-${index}`, status: "passed", failureMessages: [] })),
  ] }] });

it("accepts the historical WAL failure with the remaining assertions passing", () => {
  assert.equal(assertHistoricalVitest("lens-wal", lens(), []).length, 1);
});
it("rejects a same-count failure attributed to another test", () => {
  const report = lens();
  report.testResults[0].assertionResults[0].fullName = "another failure with the same message";
  assert.throws(() => assertHistoricalVitest("lens-wal", report, []));
});
it("rejects replacing the other passing tests with skips", () => {
  const report = lens();
  report.numPassedTests = 0;
  report.numPendingTests = 13;
  for (const test of report.testResults[0].assertionResults.slice(1)) test.status = "pending";
  assert.throws(() => assertHistoricalVitest("lens-wal", report, []));
});
it("rejects pending assertions even if the summary falsely calls them passed", () => {
  const report = lens();
  report.testResults[0].assertionResults[1].status = "pending";
  assert.throws(() => assertHistoricalVitest("lens-wal", report, []));
});
