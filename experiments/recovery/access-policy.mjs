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

export function acceptsMaterialCall(arrival, current) {
  return arrival.phase === "recovery" && current.phase === "recovery" && current.accepting &&
    arrival.epoch === current.epoch && arrival.threadId === current.threadId &&
    current.activeTurn !== undefined && arrival.turnId === current.activeTurn;
}
export function completesActiveTurn(event, threadId, activeTurn) {
  return activeTurn !== undefined && event.method === "turn/completed" &&
    event.params?.threadId === threadId && event.params?.turn?.id === activeTurn;
}
export function remainingTime(deadline, now, cap = 30000) {
  assert.ok(Number.isFinite(deadline) && deadline > now, "Phase deadline exceeded");
  return Math.max(1, Math.floor(Math.min(cap, deadline - now)));
}
export function assertPhaseItems(items, threadId, turns = {}) {
  for (const item of items) {
    assert.equal(item.threadId, threadId, "Item from another thread");
    if (item.type === "contextCompaction") {
      assert.equal(item.phase, "compact");
      assert.ok(turns[item.epoch], "Unbound compact turn");
      assert.equal(item.turnId, turns[item.epoch]);
    }
    else {
      assertOnlyMaterialItems([item.type]);
      if (item.type === "dynamicToolCall") assert.equal(item.phase, "recovery");
      else assert.ok(["prepare", "recovery"].includes(item.phase), "Late or unsolicited item");
      if (["prepare", "recovery"].includes(item.phase)) {
        assert.ok(turns[item.epoch], "Unbound item epoch");
        assert.equal(item.turnId, turns[item.epoch], "Item from another turn");
      }
    }
  }
}

export function assertCompactionEvents(events, threadId, priorTurns) {
  const relevant = events.filter((event) => event.params?.threadId === threadId);
  const starts = relevant.filter((event) => event.method === "turn/started");
  const ends = relevant.filter((event) => event.method === "turn/completed");
  const items = relevant.filter((event) => ["item/started", "item/completed"].includes(event.method));
  assert.equal(starts.length, 1); assert.equal(ends.length, 1); assert.equal(items.length, 2);
  const turnId = starts[0].params.turn.id;
  assert.ok(turnId && !priorTurns.includes(turnId));
  assert.equal(ends[0].params.turn.id, turnId); assert.equal(ends[0].params.turn.status, "completed");
  assert.equal(items[0].method, "item/started"); assert.equal(items[1].method, "item/completed");
  assert.ok(items[0].params.item.id); assert.equal(items[0].params.item.id, items[1].params.item.id);
  for (const item of items) { assert.equal(item.params.turnId, turnId); assert.equal(item.params.item.type, "contextCompaction"); }
  assert.ok(relevant.indexOf(starts[0]) < relevant.indexOf(items[0]) && relevant.indexOf(items[1]) < relevant.indexOf(ends[0]));
  return { turnId, itemId: items[0].params.item.id };
}

export function assertTurnLifecycles(events, threadId, turns, phases) {
  for (const event of events) {
    assert.equal(event.threadId, threadId);
    assert.ok(turns[event.epoch], "Lifecycle event in an unbound epoch");
    assert.equal(event.turnId, turns[event.epoch]);
    assert.equal(event.phase, phases[event.epoch]);
  }
  for (const epoch of Object.keys(turns)) {
    const group = events.filter((event) => String(event.epoch) === epoch);
    assert.equal(group.filter((event) => event.method === "turn/started").length, 1);
    assert.equal(group.filter((event) => event.method === "turn/completed").length, 1);
    assert.equal(group[0].method, "turn/started");
    assert.equal(group.at(-1).method, "turn/completed");
    assert.equal(group.at(-1).status, "completed");
    assert.ok(group.slice(1, -1).every((event) => ["item/started", "item/completed"].includes(event.method)));
  }
}
export class PreparationReplyError extends Error {}
export function assertHostTransport(evidence) {
  assert.ok(!evidence.transportError && !evidence.processError, "Host transport or process error was recorded");
}
export function assertReadyReply(messages) {
  if (messages.length !== 1 || messages[0].trim() !== "READY") throw new PreparationReplyError("Preparation must reply only READY");
}
