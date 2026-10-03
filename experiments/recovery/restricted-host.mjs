import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout, clearTimeout } from "node:timers";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { acceptsMaterialCall, assertCompactionEvents, assertDisabledInventory, assertPhaseItems, assertReadyReply, assertTurnLifecycles, completesActiveTurn, remainingTime } from "./access-policy.mjs";

// Only the fixed broker is callable; no raw diagnostics/configuration is retained.
export async function restrictedHost({ executable, cwd, dynamicTools, onTool, evidence, setupDeadline = performance.now() + 120000 }) {
  const isolation = { "features.memories": false, "memories.use_memories": false, "memories.generate_memories": false,
    "plugins.agentmemory@agentmemory.enabled": false };
  const configArgs = (config) => Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);
  const env = { ...process.env, AGENTMEMORY_INJECT_CONTEXT: "false", AGENTMEMORY_SDK_CHILD: "1" };
  delete env.CODEX_THREAD_ID; delete env.CODEX_SESSION_ID;
  evidence.version = execFileSync(executable, ["--version"], { env, encoding: "utf8", timeout: remainingTime(setupDeadline, performance.now()) }).trim();
  const servers = JSON.parse(execFileSync(executable, [...configArgs(isolation), "mcp", "list", "--json"], { env, encoding: "utf8", timeout: remainingTime(setupDeadline, performance.now()), stdio: ["ignore", "pipe", "ignore"] })).map((item) => ({ name: item.name, type: item.transport.type }));
  assert.ok(servers.every((item) => /^[a-zA-Z0-9_-]+$/.test(item.name) && ["stdio", "streamable_http"].includes(item.type)));
  const overrides = { ...isolation, "windows.sandbox": "unelevated", "features.shell_tool": false, "features.unified_exec": false,
    "features.apps": false, "features.multi_agent": false, "features.skill_search": false,
    "features.tool_suggest": false, web_search: "disabled" };
  for (const item of servers) {
    overrides[`mcp_servers.${item.name}.enabled`] = false;
    overrides[`mcp_servers.${item.name}.${item.type === "stdio" ? "command" : "url"}`] = item.type === "stdio" ? "disabled-by-access-probe" : "http://127.0.0.1:9";
  }
  const child = spawn(executable, ["app-server", "--stdio", ...configArgs(overrides)], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  child.stdin.on("error", () => { evidence.transportError = true; child.kill(); });
  const pending = new Map();
  const events = [];
  let threadId;
  let sequence = 0;
  let stopped = false;
  let accepting = false;
  let activeTurn;
  let phase = "idle";
  let epoch = 0;
  let turnReady = Promise.resolve();
  const current = () => ({ phase, epoch, threadId, activeTurn, accepting });
  let queue = Promise.resolve();
  const exited = new Promise((done) => {
    function stop() {
      stopped = true;
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("Host stopped")); }
      pending.clear(); done();
    }
    child.once("exit", stop);
    child.on("error", () => { evidence.processError = true; if (!child.pid) stop(); });
  });
  const streamsClosed = new Promise((done) => child.once("close", () => done(true)));
  const send = (message) => { if (!stopped) child.stdin.write(`${JSON.stringify(message)}\n`); };
  evidence.inventory = []; evidence.itemTypes = []; evidence.phaseItems = []; evidence.turns = {}; evidence.turnPhases = {}; evidence.lifecycle = []; evidence.messages = []; evidence.otherRequests = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message.method && pending.has(message.id)) {
      const call = pending.get(message.id);
      pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error("Host RPC failed")); else call.resolve(message.result);
    } else if (message.method === "item/tool/call" && message.id !== undefined) {
      const arrival = { phase, epoch, threadId: message.params.threadId, turnId: message.params.turnId };
      const readyAtArrival = turnReady;
      if (phase !== "recovery") evidence.otherRequests.push(`tool_in_${phase}`);
      queue = queue.then(async () => {
        let result;
        try {
          await readyAtArrival;
          assert.ok(acceptsMaterialCall(arrival, current()));
          result = await onTool(message.params.tool, message.params.arguments, () => acceptsMaterialCall(arrival, current()));
        } catch { evidence.otherRequests.push("broker_error"); result = { success: false, text: "Tool rejected" }; }
        send({ id: message.id, result: { success: result.success, contentItems: [{ type: "inputText", text: result.text }] } });
      });
    } else if (message.method && message.id !== undefined) {
      evidence.otherRequests.push(message.method);
      send({ id: message.id, error: { code: -32601, message: "No other client tools" } });
    } else if (message.method) {
      events.push(message);
      if (["turn/started", "turn/completed", "item/started", "item/completed"].includes(message.method)) {
        evidence.lifecycle.push({ phase, epoch, method: message.method, threadId: message.params?.threadId,
          turnId: message.params?.turn?.id ?? message.params?.turnId, status: message.params?.turn?.status });
      }
      if (completesActiveTurn(message, threadId, activeTurn)) accepting = false;
      if (["item/started", "item/completed"].includes(message.method)) {
        evidence.itemTypes.push(message.params?.item?.type);
        evidence.phaseItems.push({ phase, epoch, method: message.method, threadId: message.params?.threadId, turnId: message.params?.turnId, type: message.params?.item?.type, itemId: message.params?.item?.id });
        if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") evidence.messages.push(message.params.item.text);
      }
    }
  });
  function request(method, params, deadline = setupDeadline) {
    return new Promise((resolve, reject) => {
      if (stopped) { reject(new Error("Host stopped")); return; }
      const timeout = remainingTime(deadline, performance.now());
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Host RPC timeout")); }, timeout);
      pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
  }
  async function waitExit() {
    let timer;
    try { return await Promise.race([exited.then(() => true), new Promise((done) => { timer = setTimeout(() => done(false), 3000); })]); }
    finally { clearTimeout(timer); }
  }
  async function close() {
    accepting = false;
    phase = "closed"; epoch += 1;
    child.stdin.end();
    if (!stopped) child.kill();
    if (!(await waitExit())) child.kill("SIGKILL");
    const complete = await waitExit();
    let timer;
    let drained;
    try { drained = await Promise.race([streamsClosed, new Promise((done) => { timer = setTimeout(() => done(false), 3000); })]); }
    finally { clearTimeout(timer); }
    await queue;
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
    evidence.streamsDrained = drained;
    return complete && drained;
  }
  try {
    await request("initialize", { clientInfo: { name: "ctxpack-real-smoke", version: "1" }, capabilities: { experimentalApi: true } });
    send({ method: "initialized" });
    const { config } = await request("config/read", { includeLayers: false });
    evidence.contextIsolation = { memories: config.features?.memories, useMemories: config.memories?.use_memories,
      generateMemories: config.memories?.generate_memories, agentmemoryPlugin: config.plugins?.["agentmemory@agentmemory"]?.enabled,
      injectionEnvironment: env.AGENTMEMORY_INJECT_CONTEXT, sdkChild: env.AGENTMEMORY_SDK_CHILD };
    assert.deepEqual(evidence.contextIsolation, { memories: false, useMemories: false, generateMemories: false,
      agentmemoryPlugin: false, injectionEnvironment: "false", sdkChild: "1" });
    const started = await request("thread/start", { model: "gpt-6.1-sol", allowProviderModelFallback: false,
      cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [], dynamicTools,
      baseInstructions: "You are a coding-task participant. Use only the provided material tools. Do not access unrelated files, credentials or network.",
      developerInstructions: "During handoff preparation, remember the supplied history, use no tools and only answer READY. During recovery, read the current source and acceptance tests, implement within scope, and run the fixed tests. The host enables tools only during recovery. Do not delegate or claim tests passed without tool evidence." });
    threadId = started.thread.id;
    evidence.model = started.model; evidence.requestedEffort = "medium";
    assert.equal(started.model, "gpt-6.1-sol");
    let cursor;
    do {
      const inventory = await request("mcpServerStatus/list", { threadId, detail: "full", limit: 100, ...(cursor ? { cursor } : {}) });
      for (const item of inventory.data) evidence.inventory.push({ name: item.name, status: item.runtimeStatus, tools: Object.keys(item.tools ?? {}), resources: item.resources.length, resourceTemplates: item.resourceTemplates.length });
      cursor = inventory.nextCursor;
    } while (cursor);
    assertDisabledInventory(servers.map((item) => item.name), evidence.inventory);
  } catch (error) { evidence.cleanupComplete = await close(); throw error; }
  function assertProtocol() {
    assertPhaseItems(evidence.phaseItems, threadId, evidence.turns);
    assertTurnLifecycles(evidence.lifecycle, threadId, evidence.turns, evidence.turnPhases);
    assert.deepEqual(evidence.otherRequests, []);
  }
  async function waitFor(predicate, offset, deadline) {
    while (performance.now() < deadline && !stopped) {
      const found = events.slice(offset).find((event) => event.params?.threadId === threadId && predicate(event));
      if (found) return found;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error("Phase completion deadline exceeded");
  }
  return {
    close, abort: () => child.kill(),
    assertFinalProtocol() {
      assert.equal(evidence.streamsDrained, true);
      assertProtocol();
    },
    async compact(deadline) {
      assert.equal(phase, "prepared");
      remainingTime(deadline, performance.now());
      phase = "compact"; epoch += 1; accepting = false; activeTurn = undefined;
      evidence.turnPhases[epoch] = phase;
      const offset = events.length;
      const priorTurns = Object.values(evidence.turns);
      await request("thread/compact/start", { threadId }, deadline);
      const started = await waitFor((event) => event.method === "turn/started", offset, deadline);
      const compactTurn = started.params.turn.id;
      assert.ok(compactTurn && !priorTurns.includes(compactTurn));
      evidence.turns[epoch] = compactTurn;
      await waitFor((event) => completesActiveTurn(event, threadId, compactTurn), offset, deadline);
      await queue;
      remainingTime(deadline, performance.now());
      const identity = assertCompactionEvents(events.slice(offset), threadId, priorTurns);
      assertProtocol();
      evidence.compaction = { threadId, ...identity, type: "contextCompaction", completed: true };
      phase = "compacted";
    },
    async turn(prompt, deadline, requestedPhase = "recovery") {
      assert.ok(["prepare", "recovery"].includes(requestedPhase));
      assert.ok(requestedPhase === "prepare" ? phase === "idle" : ["idle", "compacted"].includes(phase));
      remainingTime(deadline, performance.now());
      phase = requestedPhase; epoch += 1; activeTurn = undefined;
      evidence.turnPhases[epoch] = phase;
      const offset = events.length;
      accepting = phase === "recovery";
      let bind;
      turnReady = new Promise((done) => { bind = done; });
      try {
        const started = await request("turn/start", { threadId, environments: [], effort: "medium", input: [{ type: "text", text: prompt }] }, deadline);
        activeTurn = started.turn.id;
        evidence.turns[epoch] = activeTurn;
        if (events.slice(offset).some((event) => completesActiveTurn(event, threadId, activeTurn))) accepting = false;
        bind();
        const completed = await waitFor((event) => completesActiveTurn(event, threadId, activeTurn), offset, deadline);
        accepting = false;
        await queue;
        remainingTime(deadline, performance.now());
        assert.equal(completed.params.turn.status, "completed");
        if (requestedPhase === "prepare") {
          assertReadyReply(events.slice(offset).filter((event) => event.method === "item/completed" && event.params?.threadId === threadId && event.params?.turnId === activeTurn && event.params?.item?.type === "agentMessage").map((event) => event.params.item.text));
        }
        assertProtocol();
        phase = requestedPhase === "prepare" ? "prepared" : "recovered";
      } finally {
        accepting = false; bind();
      }
    },
  };
}
