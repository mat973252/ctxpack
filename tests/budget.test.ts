import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adapterNames, resolveAdapter } from "../src/adapters/index.js";
import {
  COMPACT_BUDGET,
  DEFAULT_BUDGET,
  applyPlan,
  estimateTokens,
  renderWithinBudget,
  resolveBudget,
} from "../src/adapters/budget.js";
import { buildView } from "../src/adapters/view.js";
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

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "ctxpack-budget-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** A small pack that always fits the default budget. */
function smallInput(): HandoffInput {
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
        completed: ["SQLite RunStore"],
        currentTasks: ["Restore execution after crash"],
        blockers: ["No idempotency keys"],
        nextActions: ["Add effect ID", "Persist effect completion"],
        relevantFiles: ["src/runtime/run.ts"],
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
            { sha: "a".repeat(40), shortSha: "aaaaaaa", author: "Dev", date: "2026-09-25T00:00:00.000Z", subject: "Add checkpoint API" },
          ],
        },
      },
      artifacts: { schemaVersion: 1, artifacts: [] },
    },
    markdown: {
      decisions: "# Decisions\n\n- [2026-09-25] SQLite first — simplest durable store\n",
      failures: "# Failed Approaches\n\n- Rerunning effects: duplicates side effects — no idempotency keys\n",
    },
  };
}

/** A pack sized like a large project: long lists, notes, history, many files. */
function largeInput(): HandoffInput {
  const input = smallInput();
  input.pack.state = {
    ...input.pack.state,
    completed: Array.from({ length: 40 }, (_, i) => `Completed subsystem ${i} with a fairly long description of the work done`),
    relevantFiles: Array.from({ length: 60 }, (_, i) => `src/area-${i % 10}/module-${i}/file-${i}.ts`),
    verification: [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `suite ${i}`, result: "pass" as const })),
      { name: "crash recovery", result: "fail" as const, detail: "times out" },
    ],
    git: {
      ...input.pack.state.git,
      changedFiles: Array.from({ length: 80 }, (_, i) => `src/changed/file-${i}.ts`),
      recentCommits: Array.from({ length: 5 }, (_, i) => ({
        sha: `${i}`.repeat(40),
        shortSha: `${i}`.repeat(7),
        author: "Dev",
        date: "2026-09-25T00:00:00.000Z",
        subject: `Commit subject ${i}`,
      })),
    },
  };
  input.markdown = {
    project:
      "# Project\n\n" +
      Array.from({ length: 12 }, (_, i) => `Long project note line ${i} describing scope and constraints at length.`).join("\n"),
    decisions:
      "# Decisions\n\n" +
      Array.from({ length: 20 }, (_, i) => `- [2026-09-2${i % 10}] Decision number ${i} with a long summary — an equally long reason explaining the tradeoffs of choice ${i}`).join("\n") +
      "\nA freeform paragraph that does not match the item format and is kept verbatim.\n",
    failures:
      "# Failed Approaches\n\n" +
      Array.from({ length: 6 }, (_, i) => `- Approach ${i}: failed badly — reason ${i} explains why it cannot work`).join("\n") +
      "\nVerbatim failure note that is long and freeform.\n",
  };
  return input;
}

describe("estimateTokens", () => {
  it("approximates ~4 chars per token for ASCII and 1 per non-ASCII char", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("测试")).toBe(2);
    expect(estimateTokens("ab测试")).toBe(3);
  });
});

describe("resolveBudget", () => {
  it("defaults to 4000, --compact to 2000, and --budget wins over --compact", () => {
    expect(resolveBudget({})).toEqual({ budget: DEFAULT_BUDGET, budgetOverridesCompact: false });
    expect(resolveBudget({ compact: true })).toEqual({ budget: COMPACT_BUDGET, budgetOverridesCompact: false });
    expect(resolveBudget({ budget: "3000" })).toEqual({ budget: 3000, budgetOverridesCompact: false });
    expect(resolveBudget({ compact: true, budget: "3000" })).toEqual({ budget: 3000, budgetOverridesCompact: true });
  });

  it.each(["abc", "0", "-5", "2.5", "3e2", "", "  ", "1_000", "0x10"])(
    "rejects invalid budget %j",
    (raw) => {
      expect(() => resolveBudget({ budget: raw })).toThrow(/invalid --budget/);
    },
  );
});

describe("applyPlan", () => {
  it("never trims critical facts", () => {
    const view = buildView(largeInput());
    const minimal = applyPlan(view, {
      projectNotes: 0,
      decisionNotes: 0,
      failureNotes: 0,
      decisionEntries: 0,
      completed: 0,
      relevantFiles: 0,
      recentCommits: 0,
      maxPassVerification: 0,
      showChangedFiles: false,
      markers: true,
    });
    expect(minimal.view.goal).toBe(view.goal);
    expect(minimal.view.currentTasks).toEqual(view.currentTasks);
    expect(minimal.view.blockers).toEqual(view.blockers);
    expect(minimal.view.nextActions).toEqual(view.nextActions);
    expect(minimal.view.failures.entries).toEqual(view.failures.entries);
    expect(minimal.view.verification).toEqual([
      { name: "crash recovery", result: "fail", detail: "times out" },
    ]);
    expect(minimal.view.relevantFiles).toHaveLength(1); // marker only
    expect(minimal.view.git.changedFiles).toBeUndefined();
    expect(minimal.view.git.recentCommits).toHaveLength(0);
  });
});

describe("renderWithinBudget", () => {
  const CRITICAL_FACTS = [
    "Implement durable resume",
    "Restore execution after crash",
    "No idempotency keys",
    "Add effect ID",
    "Approach 0",
    "reason 0 explains why it cannot work",
    "crash recovery",
    "FAIL",
  ];

  it.each(adapterNames())("keeps a small pack fully intact for %s", (name) => {
    const adapter = resolveAdapter(name);
    const out = renderWithinBudget(adapter, smallInput(), DEFAULT_BUDGET);
    expect(out).toContain(adapter.render(smallInput()).split("\n\n---\n")[0]);
    expect(out).not.toContain("Omitted for budget");
    expect(out).toContain(`${DEFAULT_BUDGET} est. tokens`);
    expect(estimateTokens(out)).toBeLessThanOrEqual(DEFAULT_BUDGET);
  });

  it.each(adapterNames())("fits a large pack into budget 3000 for %s", (name) => {
    const adapter = resolveAdapter(name);
    const input = largeInput();
    const out = renderWithinBudget(adapter, input, 3000);
    expect(estimateTokens(out)).toBeLessThanOrEqual(3000);
    for (const fact of CRITICAL_FACTS) expect(out).toContain(fact);
    expect(out).toContain("Omitted for budget");
    expect(out).toContain("omitted for the token budget");
    // archive content dropped
    expect(out).not.toContain("Commit subject 0");
    expect(out).not.toContain("src/changed/file-79.ts");
    // no half-truncated lines: every output line ends with full words or markers
    expect(out).not.toMatch(/\.\.\.$/m);
    // deterministic
    expect(renderWithinBudget(adapter, input, 3000)).toBe(out);
  });

  it("keeps the same preserved facts across all four formats", () => {
    const input = largeInput();
    for (const fact of CRITICAL_FACTS) {
      for (const name of adapterNames()) {
        expect(renderWithinBudget(resolveAdapter(name), input, 3000)).toContain(fact);
      }
    }
  });

  it("throws when even Critical facts exceed the budget", () => {
    const input = largeInput();
    expect(() => renderWithinBudget(resolveAdapter("generic"), input, 50)).toThrow(
      /Critical facts alone.*larger --budget/s,
    );
  });
});

describe("handoff CLI budget flags", () => {
  function seedLarge() {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    const input = largeInput();
    writeFileSync(paths.state, JSON.stringify(input.pack.state, null, 2) + "\n", "utf8");
    writeFileSync(paths.decisions, input.markdown.decisions!, "utf8");
    writeFileSync(paths.failures, input.markdown.failures!, "utf8");
    writeFileSync(paths.project, input.markdown.project!, "utf8");
    return paths;
  }

  it.each(adapterNames())(
    "serves %s within --budget 3000 read-only and byte-stable",
    async (target) => {
      seedLarge();
      const before = hashTree(repo);
      const first = makeIO(repo);
      const code = await main(["node", "ctxpack", "handoff", "--to", target, "--budget", "3000"], first.io);
      expect(code).toBe(0);
      const output = first.out.join("");
      expect(estimateTokens(output)).toBeLessThanOrEqual(3000);
      expect(output).toContain("Implement durable resume");
      expect(hashTree(repo)).toBe(before);
      const second = makeIO(repo);
      expect(await main(["node", "ctxpack", "handoff", "--to", target, "--budget", "3000"], second.io)).toBe(0);
      expect(second.out.join("")).toBe(output);
    },
  );

  it("--compact outputs less than or equal to the compact budget", async () => {
    seedLarge();
    const { io, out } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff", "--compact"], io)).toBe(0);
    expect(estimateTokens(out.join(""))).toBeLessThanOrEqual(COMPACT_BUDGET);
  });

  it("--budget overrides --compact with a stderr note", async () => {
    seedLarge();
    const { io, out, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff", "--compact", "--budget", "3500"], io)).toBe(0);
    expect(err.join("")).toContain("overrides --compact");
    expect(estimateTokens(out.join(""))).toBeLessThanOrEqual(3500);
    expect(out.join("")).toContain("3500 est. tokens");
  });

  it.each(["abc", "0", "-5", "2.5"])("exits non-zero on --budget %j", async (raw) => {
    seedLarge();
    const before = hashTree(repo);
    const { io, out, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff", "--budget", raw], io)).toBe(1);
    expect(err.join("")).toContain("invalid --budget");
    expect(out.join("")).toBe("");
    expect(hashTree(repo)).toBe(before);
  });

  it("fails clearly on a budget too small for Critical facts, without touching .ctxpack/", async () => {
    const paths = seedLarge();
    const before = hashTree(repo);
    const stateBefore = readFileSync(paths.state, "utf8");
    const { io, out, err } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff", "--budget", "80"], io)).toBe(1);
    expect(err.join("")).toMatch(/Critical facts alone.*larger --budget/s);
    expect(out.join("")).toBe("");
    expect(hashTree(repo)).toBe(before);
    expect(readFileSync(paths.state, "utf8")).toBe(stateBefore);
  });

  it("keeps key semantics of a small pack under default budget", async () => {
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
          git: {},
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const { io, out } = makeIO(repo);
    expect(await main(["node", "ctxpack", "handoff"], io)).toBe(0);
    const output = out.join("");
    for (const fact of ["Ship the demo", "init", "handoff", "none found", "wire renderer", "src/cli.ts", "vitest: PASS"]) {
      expect(output).toContain(fact);
    }
    expect(output).not.toContain("Omitted for budget");
  });
});
