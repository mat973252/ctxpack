import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout, clearTimeout } from "node:timers";
import { performance } from "node:perf_hooks";
import { assertDisabledInventory, assertOnlyMaterialItems } from "./access-policy.mjs";

// Only the fixed broker is callable; no raw diagnostics/configuration is retained.
export async function restrictedHost({ executable, cwd, dynamicTools, onTool, evidence }) {
  evidence.version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
  const servers = JSON.parse(execFileSync(executable, ["mcp", "list", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).map((item) => ({ name: item.name, type: item.transport.type }));
  assert.ok(servers.every((item) => /^[a-zA-Z0-9_-]+$/.test(item.name) && ["stdio", "streamable_http"].includes(item.type)));
  const overrides = { "windows.sandbox": "unelevated", "features.shell_tool": false, "features.unified_exec": false,
    "features.apps": false, "features.multi_agent": false, "features.skill_search": false,
    "features.tool_suggest": false, web_search: "disabled" };
  for (const item of servers) {
    overrides[`mcp_servers.${item.name}.enabled`] = false;
    overrides[`mcp_servers.${item.name}.${item.type === "stdio" ? "command" : "url"}`] = item.type === "stdio" ? "disabled-by-access-probe" : "http://127.0.0.1:9";
  }
  const child = spawn(executable, ["app-server", "--stdio", ...Object.entries(overrides).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  child.stdin.on("error", () => { evidence.transportError = true; child.kill(); });
  const pending = new Map();
  const events = [];
  let threadId;
  let sequence = 0;
  let stopped = false;
  let accepting = false;
  let activeTurn;
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
  const send = (message) => { if (!stopped) child.stdin.write(`${JSON.stringify(message)}\n`); };
  evidence.inventory = []; evidence.itemTypes = []; evidence.messages = []; evidence.otherRequests = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message.method && pending.has(message.id)) {
      const call = pending.get(message.id);
      pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error("Host RPC failed")); else call.resolve(message.result);
    } else if (message.method === "item/tool/call" && message.id !== undefined) {
      queue = queue.then(async () => {
        let result;
        try {
          assert.equal(message.params.threadId, threadId);
          assert.ok(accepting && activeTurn === message.params.turnId);
          result = await onTool(message.params.tool, message.params.arguments, () => accepting && activeTurn === message.params.turnId);
        } catch { evidence.otherRequests.push("broker_error"); result = { success: false, text: "Tool rejected" }; }
        send({ id: message.id, result: { success: result.success, contentItems: [{ type: "inputText", text: result.text }] } });
      });
    } else if (message.method && message.id !== undefined) {
      evidence.otherRequests.push(message.method);
      send({ id: message.id, error: { code: -32601, message: "No other client tools" } });
    } else if (message.method) {
      events.push(message);
      if (message.method === "turn/completed" && message.params?.threadId === threadId) accepting = false;
      if (["item/started", "item/completed"].includes(message.method)) {
        evidence.itemTypes.push(message.params?.item?.type);
        if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") evidence.messages.push(message.params.item.text);
      }
    }
  });
  function request(method, params, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (stopped) { reject(new Error("Host stopped")); return; }
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
    child.stdin.end();
    if (!stopped) child.kill();
    if (!(await waitExit())) child.kill("SIGKILL");
    const complete = await waitExit();
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
    return complete;
  }
  try {
    await request("initialize", { clientInfo: { name: "ctxpack-real-smoke", version: "1" }, capabilities: { experimentalApi: true } });
    send({ method: "initialized" });
    const started = await request("thread/start", { model: "gpt-6.1-sol", allowProviderModelFallback: false,
      cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [], dynamicTools,
      baseInstructions: "You are a coding-task participant. Use only the provided material tools. Do not access unrelated files, credentials or network.",
      developerInstructions: "Read the current source and acceptance tests, implement the requested fix within its scope, then run the fixed tests. Do not delegate or claim tests passed without tool evidence." });
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
  return {
    close, abort: () => child.kill(),
    async turn(prompt, deadline) {
      const offset = events.length;
      accepting = true;
      const started = await request("turn/start", { threadId, environments: [], effort: "medium", input: [{ type: "text", text: prompt }] }, Math.max(1, Math.min(30000, deadline - performance.now())));
      activeTurn = started.turn.id;
      let completed;
      while (performance.now() < deadline && !stopped) {
        completed = events.slice(offset).find((event) => event.method === "turn/completed" && event.params?.threadId === threadId && event.params.turn.id === started.turn.id);
        if (completed) break;
        await new Promise((done) => setTimeout(done, 100));
      }
      await queue;
      accepting = false;
      assert.ok(performance.now() <= deadline, "Task deadline exceeded");
      assert.equal(completed?.params.turn.status, "completed");
      assertOnlyMaterialItems(evidence.itemTypes);
      assert.deepEqual(evidence.otherRequests, []);
    },
  };
}
