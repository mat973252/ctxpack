import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adapterNames, resolveAdapter } from "../src/adapters/index.js";
import type { HandoffInput } from "../src/core/handoff.js";
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
        "# Decisions\n\nRecord important design decisions.\n\n" +
        "Format: `- [YYYY-MM-DD] <summary> — <reason>`\n\n" +
        "- [2026-09-25] SQLite first — simplest durable store\n",
      failures:
        "# Failed Approaches\n\nRecord approaches that were tried and did not work, " +
        "so the next agent does not repeat them.\n\n" +
        "Format: `- <approach>: <result> — <reason>`\n\n" +
        "- Re-running effects after resume: duplicates side effects — no idempotency keys\n",
    },
  };
}

/** Facts every format must carry: the M3 key semantics. */
const REQUIRED_FACTS = [
  "relay", // project
  "Implement durable resume", // goal
  "SQLite RunStore", // completed
  "Restore execution after process crash", // current task
  "SQLite first", // decision
  "simplest durable store", // decision reason
  "Re-running effects after resume", // failed approach
  "idempotency keys", // blocker + failure reason
  "Add effect ID", // next action
  "src/runtime/run.ts", // relevant file
  "unit tests", // verification
  "crash recovery", // failing verification
  "feat/resume", // branch from last capture
];

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "ctxpack-adapters-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("resolveAdapter", () => {
  it("lists every supported target including generic", () => {
    expect(adapterNames()).toEqual(["generic", "codex", "pi", "claude"]);
    expect(resolveAdapter(undefined).name).toBe("generic");
    expect(resolveAdapter("codex").name).toBe("codex");
  });

  it("rejects unknown targets and names the available ones", () => {
    expect(() => resolveAdapter("cursor")).toThrow(/unknown handoff target "cursor"/);
    expect(() => resolveAdapter("cursor")).toThrow(/generic, codex, pi, claude/);
  });
});

describe.each(["codex", "pi", "claude"] as const)("adapter: %s", (target) => {
  const render = () => resolveAdapter(target).render(fullInput());

  it("preserves all M3 key semantics", () => {
    const out = render();
    for (const fact of REQUIRED_FACTS) expect(out).toContain(fact);
  });

  it("marks the output as a handoff, not finished work", () => {
    const out = render().toLowerCase();
    expect(out).toContain("handoff");
    expect(out).toContain("not recorded");
    expect(out).not.toMatch(/all (?:tasks|work) (?:done|complete)/);
  });

  it("keeps failing verification and git-staleness caveats visible", () => {
    const out = render();
    expect(out).toContain("FAIL");
    expect(out).toContain("capture");
  });

  it("is deterministic across renders", () => {
    expect(render()).toBe(render());
  });

  it("differs in layout from the other formats", () => {
    const outputs = new Set(["generic", "codex", "pi", "claude"].map((n) => resolveAdapter(n).render(fullInput())));
    expect(outputs.size).toBe(4);
  });
});

describe("empty pack placeholders", () => {
  it.each(["codex", "pi", "claude"] as const)("%s never implies completion", (target) => {
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
    const out = resolveAdapter(target).render(input);
    expect(out).toContain("(not recorded)");
    expect(out).toContain("has not run yet");
  });
});

describe("handoff --to", () => {
  function seededRepo() {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    writeFileSync(
      paths.state,
      JSON.stringify(
        {
          goal: "Ship the demo",
          status: "in_progress",
          completed: ["init"],
          currentTasks: ["handoff"],
          blockers: ["none found"],
          nextActions: ["wire renderer"],
          relevantFiles: ["src/cli.ts"],
          verification: [{ name: "vitest", result: "pass" }],
          git: { headState: "branch", branch: "main", head: "b".repeat(40), clean: true },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    writeFileSync(paths.decisions, "# Decisions\n\n- [2026-09-25] Keep it simple — fewer moving parts\n", "utf8");
    writeFileSync(paths.failures, "# Failed Approaches\n\n- Big rewrite: broke everything — too much at once\n", "utf8");
  }

  it.each(["generic", "codex", "pi", "claude"] as const)(
    "prints the %s format read-only and byte-stable",
    async (target) => {
      seededRepo();
      const before = hashTree(repo);
      const first = makeIO(repo);
      const code = await main(["node", "ctxpack", "handoff", "--to", target], first.io);
      expect(code).toBe(0);
      expect(first.err).toEqual([]);
      expect(first.out.join("")).toContain("Ship the demo");
      expect(first.out.join("")).toContain("Keep it simple");
      expect(first.out.join("")).toContain("Big rewrite");
      expect(hashTree(repo)).toBe(before);

      const second = makeIO(repo);
      expect(await main(["node", "ctxpack", "handoff", "--to", target], second.io)).toBe(0);
      expect(second.out.join("")).toBe(first.out.join(""));
    },
  );

  it("keeps plain `handoff` byte-identical to `--to generic`", async () => {
    seededRepo();
    const a = makeIO(repo);
    const b = makeIO(repo);
    await main(["node", "ctxpack", "handoff"], a.io);
    await main(["node", "ctxpack", "handoff", "--to", "generic"], b.io);
    expect(a.out.join("")).toBe(b.out.join(""));
  });

  it("exits non-zero with the target list for an unknown --to", async () => {
    seededRepo();
    const { io, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff", "--to", "gemini"], io)).toBe(1);
    expect(err.join("")).toContain('unknown handoff target "gemini"');
    expect(err.join("")).toContain("generic, codex, pi, claude");
  });

  it("still exits non-zero on corrupt state.json for any --to", async () => {
    seededRepo();
    const paths = resolvePackPaths(repo);
    writeFileSync(paths.state, "{corrupt", "utf8");
    const before = readFileSync(paths.state, "utf8");
    const { io, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff", "--to", "pi"], io)).toBe(1);
    expect(err.join("")).toContain("state.json");
    expect(readFileSync(paths.state, "utf8")).toBe(before);
  });
});
