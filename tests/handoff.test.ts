import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderGenericHandoff } from "../src/adapters/generic.js";
import { parseDecisions, parseFailures, type HandoffInput } from "../src/core/handoff.js";
import { initPack } from "../src/core/init.js";
import { main, type ProgramIO } from "../src/program.js";
import { resolvePackPaths } from "../src/storage/index.js";

let repo: string;

function hashTree(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === ".git") continue;
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(path.relative(dir, full).split(path.sep).join("/")).update("\0").update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

function makeIO(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: ProgramIO = { cwd: () => cwd, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
  return { io, out, err };
}

function writeState(extra: Record<string, unknown> = {}) {
  const paths = resolvePackPaths(repo);
  const state = {
    goal: "",
    status: "not_started",
    completed: [],
    currentTasks: [],
    blockers: [],
    nextActions: [],
    relevantFiles: [],
    verification: [],
    git: {},
    ...extra,
  };
  writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n", "utf8");
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "ctxpack-handoff-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("parseDecisions / parseFailures", () => {
  it("parses the declared minimal format and keeps freeform lines verbatim", () => {
    const decisions = parseDecisions(
      "# Decisions\n\nRecord important design decisions.\n\n" +
        "Format: `- [YYYY-MM-DD] <summary> — <reason>`\n\n" +
        "- [2026-09-25] SQLite first — simplest durable store\n" +
        "Freeform note that must not be lost.\n",
    );
    expect(decisions.entries).toEqual([
      { date: "2026-09-25", summary: "SQLite first", reason: "simplest durable store" },
    ]);
    expect(decisions.notes).toEqual(["Freeform note that must not be lost."]);
  });

  it("parses failure items with approach, result and reason", () => {
    const failures = parseFailures(
      "- Re-running effects after resume: duplicates side effects — no idempotency keys\n",
    );
    expect(failures.entries).toEqual([
      {
        approach: "Re-running effects after resume",
        result: "duplicates side effects",
        reason: "no idempotency keys",
      },
    ]);
  });
});

describe("renderGenericHandoff", () => {
  function fullInput(): HandoffInput {
    return {
      pack: {
        manifest: {
          version: "0.1",
          project: "relay",
          createdAt: "2026-09-25T00:00:00.000Z",
          updatedAt: "2026-09-25T01:00:00.000Z",
          schemaVersion: 1,
        },
        state: {
          goal: "Implement durable resume",
          status: "in_progress",
          completed: ["SQLite RunStore", "Checkpoint API"],
          currentTasks: ["Restore execution after process crash"],
          blockers: ["Side effects do not yet have idempotency keys"],
          nextActions: ["Add effect ID", "Persist effect completion", "Add crash recovery test"],
          relevantFiles: ["src/runtime/run.ts", "src/store/sqlite.ts"],
          verification: [
            { name: "unit tests", result: "pass" },
            { name: "crash recovery", result: "fail", detail: "times out" },
          ],
          git: {
            headState: "branch",
            branch: "feat/resume",
            head: "a".repeat(40),
            clean: false,
            changedFiles: ["src/runtime/run.ts"],
            stat: {
              staged: { files: 0, insertions: 0, deletions: 0, binary: 0 },
              unstaged: { files: 1, insertions: 12, deletions: 3, binary: 0 },
            },
            recentCommits: [
              {
                sha: "a".repeat(40),
                shortSha: "aaaaaaa",
                author: "Dev",
                date: "2026-09-25T00:00:00.000Z",
                subject: "Add checkpoint API",
              },
            ],
          },
        },
        artifacts: { schemaVersion: 1, artifacts: [] },
      },
      markdown: {
        project: "# Project\n\nDescribe the project purpose, scope and constraints.\n\nResumable workflow engine.\n",
        decisions:
          "# Decisions\n\n- [2026-09-25] SQLite first — simplest durable store\n",
        failures:
          "# Failed Approaches\n\n- Re-running effects after resume: duplicates side effects — no idempotency keys\n",
      },
    };
  }

  it("answers the five handoff questions", () => {
    const out = renderGenericHandoff(fullInput());
    // what is being done
    expect(out).toContain("Implement durable resume");
    // how far along
    expect(out).toContain("SQLite RunStore");
    expect(out).toContain("Restore execution after process crash");
    // current problems
    expect(out).toContain("idempotency keys");
    // next steps
    expect(out).toContain("1. Add effect ID");
    // failed routes and why
    expect(out).toContain("Re-running effects after resume: duplicates side effects");
    expect(out).toContain("Reason: no idempotency keys");
    // plus decisions, files, verification, git
    expect(out).toContain("SQLite first");
    expect(out).toContain("src/runtime/run.ts");
    expect(out).toContain("unit tests: PASS");
    expect(out).toContain("crash recovery: FAIL (times out)");
    expect(out).toContain("Branch: feat/resume");
    expect(out).toContain("last `ctxpack capture`");
  });

  it("is deterministic across renders", () => {
    const input = fullInput();
    expect(renderGenericHandoff(input)).toBe(renderGenericHandoff(input));
  });

  it("uses explicit placeholders instead of implying completion", () => {
    const input = fullInput();
    input.pack.state = {
      goal: "",
      status: "not_started",
      completed: [],
      currentTasks: [],
      blockers: [],
      nextActions: [],
      relevantFiles: [],
      verification: [],
      git: {},
    };
    input.markdown = {};
    const out = renderGenericHandoff(input);
    expect(out).toContain("(not recorded)");
    expect(out).toContain("`ctxpack capture` has not run yet");
    expect(out).toContain("no decisions.md");
    expect(out).toContain("no failures.md");
  });

  it("preserves freeform markdown that does not match the list format", () => {
    const input = fullInput();
    input.markdown.decisions = "# Decisions\n\nWe chose append-only logs after benchmarking.\n";
    const out = renderGenericHandoff(input);
    expect(out).toContain("We chose append-only logs after benchmarking.");
  });
});

describe("handoff command", () => {
  it("prints a handoff and leaves .ctxpack/ and the work tree byte-identical", async () => {
    initPack({ cwd: repo });
    writeState({
      goal: "Ship the demo",
      status: "in_progress",
      completed: ["init"],
      currentTasks: ["handoff"],
      blockers: ["none found"],
      nextActions: ["wire renderer"],
      relevantFiles: ["src/cli.ts"],
      verification: [{ name: "vitest", result: "pass" }],
    });
    const paths = resolvePackPaths(repo);
    writeFileSync(paths.decisions, "# Decisions\n\n- [2026-09-25] Keep it simple — fewer moving parts\n", "utf8");

    const before = hashTree(repo);
    const { io, out, err } = makeIO(repo);
    const code = await main(["node", "ctxpack", "handoff"], io);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out.join("")).toContain("Ship the demo");
    expect(out.join("")).toContain("Keep it simple");
    expect(hashTree(repo)).toBe(before);

    const second = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff"], second.io)).toBe(0);
    expect(second.out.join("")).toBe(out.join(""));
  });

  it("fails with a clear error when .ctxpack/ is missing", async () => {
    const { io, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff"], io)).toBe(1);
    expect(err.join("")).toContain("ctxpack init");
  });

  it("fails on corrupt state.json without modifying it", async () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    writeFileSync(paths.state, "{not json", "utf8");
    const before = readFileSync(paths.state, "utf8");
    const { io, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff"], io)).toBe(1);
    expect(err.join("")).toContain("state.json");
    expect(readFileSync(paths.state, "utf8")).toBe(before);
  });
});
