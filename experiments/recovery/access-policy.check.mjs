import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDisabledInventory, assertOnlyMaterialItems } from "./access-policy.mjs";

const disabled = (name) => ({ name, status: "disabled", tools: [], resources: 0, resourceTemplates: 0 });

test("missing, duplicate, unexpected and live server inventories fail closed", () => {
  assertDisabledInventory(["one", "two"], [disabled("two"), disabled("one")]);
  for (const inventory of [[], [disabled("one")], [disabled("one"), disabled("one")], [disabled("one"), disabled("two"), disabled("extra")], [disabled("one"), { ...disabled("two"), status: "ready" }], [disabled("one"), { ...disabled("two"), tools: ["read"] }]]) {
    assert.throws(() => assertDisabledInventory(["one", "two"], inventory));
  }
});

test("a native item observed at start is rejected even without a completion", () => {
  assertOnlyMaterialItems(["userMessage", "dynamicToolCall", "agentMessage"]);
  assert.throws(() => assertOnlyMaterialItems(["userMessage", "commandExecution"]));
  assert.throws(() => assertOnlyMaterialItems([undefined]));
});
