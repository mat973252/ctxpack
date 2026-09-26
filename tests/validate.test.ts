import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capturePack } from "../src/core/capture.js";
import { loadHandoff } from "../src/core/handoff.js";
import { initPack } from "../src/core/init.js";
import { renderValidate, validatePack } from "../src/core/validate.js";
import { resolveAdapter } from "../src/adapters/index.js";
import { createProgram, main, type ProgramIO } from "../src/program.js";
import { StateSchema, type State } from "../src/schema/index.js";
import { StorageError, resolvePackPaths } from "../src/storage/index.js";

let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function commit(message: string): string {
  git(["add", "-A", "--", ".", ":(exclude,top).ctxpack"]);
  git(["commit", "-q", "--allow-empty", "-m", message]);
  return git(["rev-parse", "HEAD"]).trim();
}

function write(rel: string, content: string): void {
  writeFileSync(path.join(repo, rel), content);
}

function readState(): State {
  return StateSchema.parse(JSON.parse(readFileSync(resolvePackPaths(repo).state, "utf8")));
}

function patchState(patch: (state: State) => void): void {
  const state = readState();
  patch(state);
  writeFileSync(resolvePackPaths(repo).state, JSON.stringify(state, null, 2) + "\n");
}

/** Sorted (path, mtimeMs, sha256) triples of every file under `dir` — detects any write, even a same-content rewrite. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
        out.push(`${path.relative(dir, full).split(path.sep).join("/")} ${st.mtimeMs} ${hash}`);
      }
    }
  };
  walk(dir);
  return out;
}

function makeIO(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: ProgramIO = { cwd: () => cwd, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
  return { io, out, err };
}

/** A pack with the required fields filled in so tests can focus on the Git checks. */
function readyPack(): void {
  initPack({ cwd: repo, now: () => new Date("2026-09-26T00:00:00.000Z") });
  patchState((s) => {
    s.goal = "Implement durable resume";
    s.status = "in_progress";
    s.nextActions = ["Add effect ID"];
  });
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "ctxpack-validate-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["config", "commit.gpgsign", "false"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("validatePack: required fields", () => {
  it("fails a freshly initialized pack with advice for goal, nextActions and the missing Git snapshot", () => {
    initPack({ cwd: repo });
    const result = validatePack({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.fields.ok).toBe(false);
    expect(result.fields.issues.map((i) => i.field)).toEqual(["goal", "nextActions"]);
    for (const issue of result.fields.issues) expect(issue.advice).toContain(".ctxpack/state.json");
    expect(result.git.kind).toBe("not_captured");
    const text = renderValidate(result);
    expect(text).toContain("FAIL");
    expect(text).toContain("ctxpack capture");
    expect(text).not.toMatch(/PASS/);
  });

  it("treats whitespace-only goal and nextActions as missing", () => {
    initPack({ cwd: repo });
    patchState((s) => {
      s.goal = "  \n\t";
      s.status = "in_progress";
      s.nextActions = ["", "   ", "\n"];
    });
    const result = validatePack({ cwd: repo });
    expect(result.fields.issues.map((i) => i.field)).toEqual(["goal", "nextActions"]);
    expect(result.fields.issues[1]?.message).toMatch(/nonblank/);
  });

  it("does not require nextActions when status is completed", () => {
    write("a.txt", "1\n");
    commit("baseline");
    initPack({ cwd: repo });
    patchState((s) => {
      s.goal = "Ship it";
      s.status = "completed";
      s.nextActions = [];
    });
    capturePack({ cwd: repo });
    const result = validatePack({ cwd: repo });
    expect(result.fields.ok).toBe(true);
    expect(result.fields.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does not fail a blocked project: recorded blockers are legitimate handoff state", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    patchState((s) => {
      s.status = "blocked";
      s.blockers = ["waiting on idempotency keys"];
    });
    capturePack({ cwd: repo });
    const result = validatePack({ cwd: repo });
    expect(result.ok).toBe(true);
    const text = renderValidate(result);
    expect(text).toContain("BLOCKED");
    expect(text).toContain("1 recorded blocker");
    expect(text).toMatch(/Result: PASS/);
  });
});

describe("validatePack: Git snapshot", () => {
  it("passes on captured, clean, matching metadata and says so is metadata consistency only", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    capturePack({ cwd: repo });
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("match_clean");
    expect(result.ok).toBe(true);
    const text = renderValidate(result);
    expect(text).toMatch(/Result: PASS/);
    expect(text).toMatch(/metadata consistency only/i);
    expect(text).toMatch(/not proof of semantic freshness/i);
  });

  it("reports changed metadata when HEAD moves", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    capturePack({ cwd: repo });
    write("a.txt", "2\n");
    commit("second");
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("changed");
    expect(result.git.changedFields).toEqual(["head"]);
    expect(result.ok).toBe(false);
    const text = renderValidate(result);
    expect(text).toContain("head");
    expect(text).toContain("ctxpack capture");
  });

  it("reports changed metadata when the branch changes", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    capturePack({ cwd: repo });
    git(["checkout", "-q", "-b", "feature"]);
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("changed");
    expect(result.git.changedFields).toEqual(["branch"]);
    expect(result.ok).toBe(false);
  });

  it("reports changed metadata when the work tree status changes after a clean capture", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    capturePack({ cwd: repo });
    write("a.txt", "2\n");
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("changed");
    expect(result.git.changedFields).toEqual(["changedFiles", "changes", "clean", "stat"]);
    expect(result.ok).toBe(false);
  });

  it("keeps a dirty snapshot review-needed even when metadata and diff stats still match", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    write("a.txt", "x\n"); // +1 -1
    capturePack({ cwd: repo });
    const stored = readState().git;

    const same = validatePack({ cwd: repo });
    expect(same.git.kind).toBe("match_dirty");
    expect(same.git.changedFields).toEqual([]);
    expect(same.ok).toBe(false);

    write("a.txt", "y\n"); // still +1 -1 on the same file: content changed, metadata identical
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("match_dirty");
    expect(result.git.changedFields).toEqual([]);
    expect(result.ok).toBe(false);
    expect(readState().git).toEqual(stored);
    const text = renderValidate(result);
    expect(text).toMatch(/review/i);
    expect(text).toMatch(/cannot prove/i);
    expect(text).toMatch(/Result: FAIL/);
  });

  it("classifies a legacy partial snapshot as incomplete, but reports changes in known fields first", () => {
    write("a.txt", "1\n");
    const head = commit("baseline");
    readyPack();
    patchState((s) => {
      s.git = { branch: "main", head };
    });
    const legacy = validatePack({ cwd: repo });
    expect(legacy.git.kind).toBe("incomplete");
    expect(legacy.git.missingFields).toEqual(["changedFiles", "changes", "clean", "headState", "stat"]);
    expect(legacy.ok).toBe(false);
    expect(renderValidate(legacy)).toContain("ctxpack capture");

    git(["checkout", "-q", "-b", "other"]);
    const moved = validatePack({ cwd: repo });
    expect(moved.git.kind).toBe("changed");
    expect(moved.git.changedFields).toEqual(["branch"]);
  });

  it("does not compare recent commit author/date", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    capturePack({ cwd: repo });
    patchState((s) => {
      s.git.recentCommits = [{ sha: "x", shortSha: "x", author: "Someone Else", date: "2000-01-01T00:00:00Z", subject: "?" }];
    });
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("match_clean");
    expect(result.ok).toBe(true);
  });

  it("reports not captured for git: {}", () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    const result = validatePack({ cwd: repo });
    expect(result.git.kind).toBe("not_captured");
    expect(result.ok).toBe(false);
  });
});

describe("validatePack: errors and read-only guarantees", () => {
  it("fails with a diagnostic for a pack outside a Git repository", () => {
    const plain = mkdtempSync(path.join(tmpdir(), "ctxpack-validate-nogit-"));
    try {
      // A pack copied out of its repository (e.g. zipped and moved to another machine without .git).
      readyPack();
      cpSync(resolvePackPaths(repo).dir, resolvePackPaths(plain).dir, { recursive: true });
      const result = validatePack({ cwd: plain });
      expect(result.git.kind).toBe("no_repository");
      expect(result.ok).toBe(false);
      expect(renderValidate(result)).toMatch(/not (a|inside a) Git/i);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("throws StorageError for a missing or corrupt pack and the CLI exits 1", async () => {
    expect(() => validatePack({ cwd: repo })).toThrow(StorageError);
    expect(() => validatePack({ cwd: repo })).toThrow(/no \.ctxpack\/ directory found/);
    const a = makeIO(repo);
    expect(await main(["node", "ctxpack", "validate"], a.io)).toBe(1);
    expect(a.err.join("")).toMatch(/ctxpack: error: no \.ctxpack\/ directory found/);
    expect(a.out).toEqual([]);

    initPack({ cwd: repo });
    writeFileSync(resolvePackPaths(repo).state, "{ nope");
    expect(() => validatePack({ cwd: repo })).toThrow(/state \(state\.json\) is not valid JSON/);
    const b = makeIO(repo);
    expect(await main(["node", "ctxpack", "validate"], b.io)).toBe(1);
    expect(b.err.join("")).toMatch(/not valid JSON/);
    expect(readFileSync(resolvePackPaths(repo).state, "utf8")).toBe("{ nope");
  });

  it("never writes .ctxpack/ or the Git index and produces byte-identical output across runs", async () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    write("a.txt", "2\n");
    capturePack({ cwd: repo });
    writeFileSync(resolvePackPaths(repo).decisions, "# Decisions\n\n- [2026-09-26] keep it small\n");

    const indexFile = path.join(repo, ".git", "index");
    expect(existsSync(indexFile)).toBe(true);
    const packBefore = snapshot(resolvePackPaths(repo).dir);
    const indexBefore = snapshot(path.join(repo, ".git")).find((l) => l.startsWith("index "));

    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const io = makeIO(repo);
      expect(await main(["node", "ctxpack", "validate"], io.io)).toBe(1);
      runs.push(io.out.join(""));
      expect(io.err).toEqual([]);
    }
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    expect(runs[0]).toMatch(/Result: FAIL/);

    expect(snapshot(resolvePackPaths(repo).dir)).toEqual(packBefore);
    expect(snapshot(path.join(repo, ".git")).find((l) => l.startsWith("index "))).toBe(indexBefore);
  });

  it("exits 0 with a PASS report via the CLI and leaves existing handoff output unaffected", async () => {
    write("a.txt", "1\n");
    commit("baseline");
    readyPack();
    capturePack({ cwd: repo });
    const handoffBefore = resolveAdapter(undefined).render(loadHandoff({ cwd: repo }));

    const io = makeIO(repo);
    expect(await main(["node", "ctxpack", "validate"], io.io)).toBe(0);
    const out = io.out.join("");
    expect(out).toMatch(/^ctxpack validate: PASS/);
    expect(out).toMatch(/Result: PASS/);
    expect(io.err).toEqual([]);

    expect(resolveAdapter(undefined).render(loadHandoff({ cwd: repo }))).toBe(handoffBefore);
  });

  it("help lists validate", () => {
    expect(createProgram(makeIO(repo).io).helpInformation()).toMatch(/validate\s+.*read-only/);
  });
});
