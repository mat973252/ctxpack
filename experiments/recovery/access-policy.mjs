import assert from "node:assert/strict";

export function assertDisabledInventory(expectedNames, inventory) {
  const actualNames = inventory.map((server) => server.name);
  assert.equal(new Set(actualNames).size, actualNames.length, "Duplicate MCP inventory entry");
  assert.deepEqual([...actualNames].sort(), [...expectedNames].sort(), "Incomplete or unexpected MCP inventory");
  assert.ok(inventory.every((server) => server.status === "disabled" && server.tools.length === 0 && server.resources === 0 && server.resourceTemplates === 0), "MCP runtime not proven disabled");
}

export function assertOnlyMaterialItems(itemTypes) {
  assert.ok(itemTypes.every((type) => ["userMessage", "agentMessage", "reasoning", "dynamicToolCall"].includes(type)), "A native or unknown item was observed");
}
