import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptsMaterialCall, assertCompactionEvents, assertHostTransport, assertPhaseItems, assertReadyReply, assertTurnLifecycles, completesActiveTurn, remainingTime } from "./access-policy.mjs";

test("a queued preparation request cannot become a recovery tool", () => {
  const current = { phase: "recovery", epoch: 2, threadId: "thread", activeTurn: "new", accepting: true };
  const arrival = { phase: "prepare", epoch: 1, threadId: "thread", turnId: "new" };
  assert.equal(acceptsMaterialCall(arrival, current), false);
  assert.equal(acceptsMaterialCall({ ...arrival, phase: "recovery", epoch: 2 }, current), true);
  for (const change of [{ epoch: 3 }, { phase: "closed" }, { accepting: false }, { activeTurn: "old" }, { threadId: "other" }]) {
    assert.equal(acceptsMaterialCall({ ...arrival, phase: "recovery", epoch: 2 }, { ...current, ...change }), false);
  }
});
test("a late completion cannot close a different or not-yet-bound turn", () => {
  const event = { method: "turn/completed", params: { threadId: "thread", turn: { id: "old" } } };
  assert.equal(completesActiveTurn(event, "thread", "new"), false);
  assert.equal(completesActiveTurn(event, "thread", undefined), false);
  assert.equal(completesActiveTurn(event, "thread", "old"), true);
  assert.equal(completesActiveTurn(event, "other", "old"), false);
});
test("native compaction is allowed only in its requested phase on the same thread", () => {
  const item = { phase: "compact", epoch: 2, threadId: "thread", turnId: "compact-turn", type: "contextCompaction" };
  assertPhaseItems([item], "thread", { 2: "compact-turn" });
  for (const phase of ["idle", "prepare", "prepared", "recovery", "closed"]) {
    assert.throws(() => assertPhaseItems([{ ...item, phase }], "thread"));
  }
  assert.throws(() => assertPhaseItems([{ ...item, threadId: "other" }], "thread"));
  assert.throws(() => assertPhaseItems([{ ...item, type: "commandExecution" }], "thread"));
  assert.throws(() => assertPhaseItems([{ ...item, type: "agentMessage", turnId: "previous" }], "thread"));
  assert.throws(() => assertPhaseItems([{ ...item, phase: "prepare", type: "dynamicToolCall" }], "thread"));
  assert.throws(() => assertPhaseItems([{ ...item, phase: "closed", type: "dynamicToolCall" }], "thread"));
});
test("compaction needs a fresh turn and matching started/completed item identity", () => {
  const turn = (method) => ({ method, params: { threadId: "thread", turn: { id: "new", status: "completed" } } });
  const item = (method) => ({ method, params: { threadId: "thread", turnId: "new", item: { type: "contextCompaction", id: "compact-item" } } });
  const events = [turn("turn/started"), item("item/started"), item("item/completed"), turn("turn/completed")];
  assert.deepEqual(assertCompactionEvents(events, "thread", ["old"]), { turnId: "new", itemId: "compact-item" });
  assert.throws(() => assertCompactionEvents(events, "thread", ["new"]));
  assert.throws(() => assertCompactionEvents(events.slice(1), "thread", []));
  assert.throws(() => assertCompactionEvents([...events, events[0]], "thread", []));
  const mismatched = JSON.parse(JSON.stringify(events)); mismatched[2].params.item.id = "old-item";
  assert.throws(() => assertCompactionEvents(mismatched, "thread", []));
});
test("all setup RPCs use remaining time and cannot start after expiration", () => {
  assert.equal(remainingTime(120000, 95000), 25000);
  assert.equal(remainingTime(120000, 1), 30000);
  assert.throws(() => remainingTime(120000, 120000));
  assert.throws(() => remainingTime(120000, 120001));
});
test("a late message from a prior turn does not become recovery evidence", () => {
  const item = { phase: "recovery", epoch: 3, threadId: "thread", turnId: "current", type: "agentMessage" };
  assertPhaseItems([item], "thread", { 3: "current" });
  assert.throws(() => assertPhaseItems([{ ...item, turnId: "old" }], "thread", { 3: "current" }));
  assert.throws(() => assertPhaseItems([item], "thread", {}));
});
test("final lifecycle audit rejects same-turn late items and duplicate completed notifications", () => {
  const event = (method) => ({ method, epoch: 1, phase: "recovery", threadId: "thread", turnId: "turn", status: "completed" });
  const valid = [event("turn/started"), event("item/started"), event("item/completed"), event("turn/completed")];
  const audit = (events) => assertTurnLifecycles(events, "thread", { 1: "turn" }, { 1: "recovery" });
  audit(valid);
  assert.throws(() => audit([...valid, event("item/completed")]));
  assert.throws(() => audit([...valid, event("turn/completed")]));
  assert.throws(() => audit([event("item/started"), ...valid]));
  assert.throws(() => audit([...valid, { ...event("turn/started"), epoch: 2 }]));
});
test("preparation cannot add a solution or extra message to READY", () => {
  assertReadyReply(["READY\n"]);
  for (const messages of [[], ["READY", "Use a transaction"], ["READY: solution follows"], ["Done"]]) {
    assert.throws(() => assertReadyReply(messages));
  }
});

test("recorded transport or process errors prevent accepting an otherwise completed host", () => {
  assertHostTransport({});
  for (const flags of [{ transportError: true }, { processError: true }, { transportError: true, processError: true }]) {
    assert.throws(() => assertHostTransport({ streamsDrained: true, cleanupComplete: true, ...flags }));
  }
});
