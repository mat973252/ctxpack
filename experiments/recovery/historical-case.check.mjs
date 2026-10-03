import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalCase, assertTargetRegression, assertNodeReports } from "./historical-case.mjs";

test("unrelated passing cases cannot replace frozen regression identities", () => {
  for (const id of ["markdown-text", "ctx-fences", "lens-wal", "relay-clock", "permit-proxy"]) {
    const task = historicalCase(id);
    assert.throws(() => assertTargetRegression(task, Array.from({ length: task.regressionTotal }, (_, index) => `unrelated${index}`)));
    assert.throws(() => assertTargetRegression(task, []));
  }
});
test("the exact two clock regressions are required even if a duplicate would preserve counts", () => {
  const task = historicalCase("relay-clock");
  const names = ["business waits tolerate wall-clock adjustments", "business waits still reject an expired monotonic deadline"];
  assertTargetRegression(task, names);
  assert.throws(() => assertTargetRegression(task, [names[0], names[0]]));
});

test("Node file summaries and one aggregate are checked separately", () => {
  const summary = (tests, file) => ({ type: "test:summary", file, counts: { tests, passed: tests, failed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: tests, suites: 0 } });
  const events = [summary(2, "/workspace/a.test.js"), summary(5, "/workspace/b.test.js"), summary(7)];
  assert.equal(assertNodeReports(events, ["a.test.js", "b.test.js"]).passed, 7);
  for (const invalid of [[...events, summary(7)], [events[0], events[0], events[2]], [events[0], events[1], summary(8)],
    [...events, { type: "test:fail" }], [...events, { type: "test:pass", skip: true }]]) {
    assert.throws(() => assertNodeReports(invalid, ["a.test.js", "b.test.js"]));
  }
});
