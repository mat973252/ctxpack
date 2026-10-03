import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalCase } from "./historical-case.mjs";
import { prepareHandoffInputs, recoveryPrompt, taskFacts } from "./handoff-inputs.mjs";

for (const id of Object.keys(taskFacts)) {
  test(`${id}: actual CLI keeps the same facts without leaking them into the shared recovery prompt`, () => {
    const task = historicalCase(id);
    const ready = prepareHandoffInputs(task);
    assert.ok(ready.inputs.nativePreparation.startsWith(ready.inputs.manual));
    const prompt = recoveryPrompt(task, "frozen scope", { read_file: 24, apply_edit: 4, run_tests: 4, wallMs: 480000 });
    assert.ok(!prompt.includes(taskFacts[id]));
    assert.ok(prompt.includes(task.source));
    assert.ok(prompt.includes(task.test));
    assert.ok(prompt.includes("480秒"));
    assert.equal(ready.evidence.nativeCompacted, false);
    assert.equal(ready.evidence.formalSamples, 0);
  });
}
