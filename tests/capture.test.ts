import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capturePack } from "../src/core/capture.js";
import { initPack } from "../src/core/init.js";
import { loadStatus, renderStatus } from "../src/core/status.js";
import { captureGitState, parseLog, parseNumstat, parseStatus } from "../src/git/index.js";
import { main, type ProgramIO } from "../src/program.js";
import { GitStateSchema, ManifestSchema, StateSchema } from "../src/schema/index.js";
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
  const file = path.join(repo, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function readState() {
  return StateSchema.parse(JSON.parse(readFileSync(resolvePackPaths(repo).state, "utf8")));
}

function readManifest() {
  return ManifestSchema.parse(JSON.parse(readFileSync(resolvePackPaths(repo).manifest, "utf8")));
}

function hashTree(dir: string, skip: string[] = [".git"]): string {
  const hash = createHash("sha256");
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (skip.includes(name)) continue;
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
  repo = mkdtempSync(path.join(tmpdir(), "ctxpack-capture-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["config", "commit.gpgsign", "false"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("captureGitState", () => {
  it("handles a repository with no commits yet", () => {
    const state = captureGitState(repo);
    expect(state).toEqual({
      headState: "unborn",
      branch: "main",
      changes: [],
      changedFiles: [],
      clean: true,
      stat: {
        staged: { files: 0, insertions: 0, deletions: 0, binary: 0 },
        unstaged: { files: 0, insertions: 0, deletions: 0, binary: 0 },
      },
      recentCommits: [],
    });

    write("a.txt", "one\n");
    git(["add", "a.txt"]);
    write("b.txt", "two\n");
    const withFiles = captureGitState(repo);
    expect(withFiles.headState).toBe("unborn");
    expect(withFiles.head).toBeUndefined();
    expect(withFiles.changedFiles).toEqual(["a.txt", "b.txt"]);
    expect(withFiles.stat?.staged).toEqual({ files: 1, insertions: 1, deletions: 0, binary: 0 });
    expect(withFiles.recentCommits).toEqual([]);
  });

  it("matches git for branch, HEAD, clean tree and recent commits (max 5)", () => {
    const shas: string[] = [];
    for (let i = 1; i <= 7; i++) {
      write("a.txt", `line ${i}\n`);
      shas.push(commit(`commit ${i}`));
    }
    const state = captureGitState(repo);
    expect(state.headState).toBe("branch");
    expect(state.branch).toBe("main");
    expect(state.head).toBe(shas[6]);
    expect(state.clean).toBe(true);
    expect(state.changedFiles).toEqual([]);
    expect(state.recentCommits?.map((c) => c.sha)).toEqual(shas.slice(2).reverse());
    expect(state.recentCommits?.map((c) => c.subject)).toEqual([
      "commit 7",
      "commit 6",
      "commit 5",
      "commit 4",
      "commit 3",
    ]);
    const first = state.recentCommits?.[0];
    expect(first?.author).toBe("Test");
    expect(first?.shortSha).toBe(git(["rev-parse", "--short", "HEAD"]).trim());
    expect(first?.date).toBe(git(["log", "-1", "--format=%aI"]).trim());
  });

  it("reports unstaged, staged, untracked files with spaces and non-ASCII names, plus diff stats", () => {
    write("a.txt", "a1\na2\n");
    write("sub/b file.txt", "b\n");
    write("中文 名.txt", "c\n");
    write("removed.txt", "gone\n");
    write("old.txt", "same content\n");
    commit("baseline");

    write("a.txt", "a1\na2 changed\na3\n"); // unstaged: +2 -1
    write("sub/b file.txt", "b\nb2\n"); // staged: +1
    git(["add", "sub/b file.txt"]);
    write("中文 名.txt", "c\nc2\n"); // unstaged non-ASCII: +1
    write("new file.txt", "n\n"); // untracked with space
    write("новый.txt", "n\n"); // untracked non-ASCII
    rmSync(path.join(repo, "removed.txt")); // unstaged delete: -1
    git(["mv", "old.txt", "renamed old.txt"]); // staged rename
    writeFileSync(path.join(repo, "bin.dat"), Buffer.from([0, 1, 2, 255]));
    git(["add", "bin.dat"]); // staged binary

    const state = captureGitState(repo);
    expect(GitStateSchema.parse(state)).toEqual(state);
    expect(state.clean).toBe(false);
    expect(state.changedFiles).toEqual([
      "a.txt",
      "bin.dat",
      "new file.txt",
      "removed.txt",
      "renamed old.txt",
      "sub/b file.txt",
      "новый.txt",
      "中文 名.txt",
    ]);

    const byPath = new Map(state.changes?.map((c) => [c.path, c]));
    expect(byPath.get("a.txt")).toEqual({ path: "a.txt", index: " ", worktree: "M" });
    expect(byPath.get("sub/b file.txt")).toEqual({ path: "sub/b file.txt", index: "M", worktree: " " });
    expect(byPath.get("中文 名.txt")).toEqual({ path: "中文 名.txt", index: " ", worktree: "M" });
    expect(byPath.get("new file.txt")).toEqual({ path: "new file.txt", index: "?", worktree: "?" });
    expect(byPath.get("новый.txt")).toEqual({ path: "новый.txt", index: "?", worktree: "?" });
    expect(byPath.get("removed.txt")).toEqual({ path: "removed.txt", index: " ", worktree: "D" });
    expect(byPath.get("renamed old.txt")).toEqual({
      path: "renamed old.txt",
      index: "R",
      worktree: " ",
      from: "old.txt",
    });
    expect(byPath.get("bin.dat")).toEqual({ path: "bin.dat", index: "A", worktree: " " });

    // Cross-check the file set against git's own porcelain output.
    const porcelain = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
      .split("\0")
      .filter((e) => e.length > 3 && e[2] === " ")
      .map((e) => e.slice(3))
      .sort();
    expect(state.changedFiles).toEqual(porcelain);

    expect(state.stat).toEqual({
      staged: { files: 3, insertions: 1, deletions: 0, binary: 1 },
      unstaged: { files: 3, insertions: 3, deletions: 2, binary: 0 },
    });
    const shortstat = git(["diff", "--shortstat"]).trim();
    expect(shortstat).toBe("3 files changed, 3 insertions(+), 2 deletions(-)");
    const cachedShortstat = git(["diff", "--cached", "--shortstat"]).trim();
    expect(cachedShortstat).toBe("3 files changed, 1 insertion(+)");
  });

  it("reports detached HEAD without a branch", () => {
    write("a.txt", "1\n");
    const first = commit("one");
    write("a.txt", "2\n");
    commit("two");
    git(["checkout", "-q", first]);
    const state = captureGitState(repo);
    expect(state.headState).toBe("detached");
    expect(state.branch).toBeUndefined();
    expect(state.head).toBe(first);
    expect(state.recentCommits).toHaveLength(1);
  });

  it("ignores changes inside .ctxpack/ (tracked, staged and untracked)", () => {
    write("a.txt", "1\n");
    initPack({ cwd: repo });
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "with pack"]);
    write(".ctxpack/project.md", "# changed\n");
    write(".ctxpack/decisions.md", "# staged\n");
    git(["add", ".ctxpack/decisions.md"]);
    write(".ctxpack/snapshots/x.json", "{}\n");
    const state = captureGitState(repo);
    expect(state.clean).toBe(true);
    expect(state.changedFiles).toEqual([]);
    expect(state.stat?.staged.files).toBe(0);
    expect(state.stat?.unstaged.files).toBe(0);
    write("a.txt", "2\n");
    expect(captureGitState(repo).changedFiles).toEqual(["a.txt"]);
  });
});

describe("git parsers", () => {
  it("parses porcelain status with renames and untracked entries", () => {
    const out = "R  new name.txt\0old.txt\0?? x y.txt\0 M 中文.txt\0";
    expect(parseStatus(out)).toEqual([
      { path: "new name.txt", index: "R", worktree: " ", from: "old.txt" },
      { path: "x y.txt", index: "?", worktree: "?" },
      { path: "中文.txt", index: " ", worktree: "M" },
    ]);
  });

  it("parses numstat including binary and rename records", () => {
    const out = "3\t1\ta.txt\0-\t-\tbin.dat\0" + "0\t0\t\0old.txt\0new.txt\0";
    expect(parseNumstat(out)).toEqual({ files: 3, insertions: 3, deletions: 1, binary: 1 });
  });

  it("parses log records", () => {
    const rec = ["abc", "ab", "Ann", "2026-09-25T00:00:00+00:00", "subject with\ttab"].join("\u001f");
    expect(parseLog(`${rec}\0`)).toEqual([
      { sha: "abc", shortSha: "ab", author: "Ann", date: "2026-09-25T00:00:00+00:00", subject: "subject with\ttab" },
    ]);
    expect(parseLog("")).toEqual([]);
  });
});

describe("capturePack", () => {
  it("writes state.git and manifest.updatedAt only, preserving user state and other files", () => {
    write("a.txt", "1\n");
    commit("baseline");
    const t0 = new Date("2026-09-25T00:00:00.000Z");
    initPack({ cwd: repo, now: () => t0 });
    const paths = resolvePackPaths(repo);

    const state = readState();
    state.goal = "Implement durable resume";
    state.status = "in_progress";
    state.blockers = ["missing idempotency keys"];
    state.git = { branch: "stale", head: "deadbeef", changedFiles: ["old"] };
    writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
    writeFileSync(paths.decisions, "# Decisions\n\n- SQLite first\n");
    writeFileSync(paths.artifacts, JSON.stringify({ schemaVersion: 1, artifacts: [{ path: "x" }] }) + "\n");
    const beforeOthers = hashTree(paths.dir, ["state.json", "manifest.json"]);
    const beforeManifest = readManifest();

    write("a.txt", "2\n");
    const t1 = new Date("2026-09-25T01:00:00.000Z");
    const sub = path.join(repo, "nested", "dir");
    mkdirSync(sub, { recursive: true });
    const result = capturePack({ cwd: sub, now: () => t1 });
    expect(result.root).toBe(repo);

    const after = readState();
    expect(after.goal).toBe("Implement durable resume");
    expect(after.status).toBe("in_progress");
    expect(after.blockers).toEqual(["missing idempotency keys"]);
    expect(after.git.branch).toBe("main");
    expect(after.git.head).toBe(git(["rev-parse", "HEAD"]).trim());
    expect(after.git.changedFiles).toEqual(["a.txt"]); // empty nested/ dir is invisible to git
    expect({ ...after, git: {} }).toEqual({ ...state, git: {} });

    const manifest = readManifest();
    expect(manifest).toEqual({ ...beforeManifest, updatedAt: t1.toISOString() });
    expect(hashTree(paths.dir, ["state.json", "manifest.json"])).toBe(beforeOthers);
  });

  it("is stable across repeated captures when the work tree is unchanged", () => {
    write("a.txt", "1\n");
    commit("baseline");
    initPack({ cwd: repo });
    write("a.txt", "2\n");
    write("new.txt", "n\n");
    const fixed = () => new Date("2026-09-25T02:00:00.000Z");
    capturePack({ cwd: repo, now: fixed });
    const first = readFileSync(resolvePackPaths(repo).state, "utf8");
    capturePack({ cwd: repo, now: fixed });
    capturePack({ cwd: repo, now: fixed });
    expect(readFileSync(resolvePackPaths(repo).state, "utf8")).toBe(first);
    expect(readManifest().updatedAt).toBe(fixed().toISOString());
  });

  it("does not store diff bodies or file contents", () => {
    write("secret.txt", "SUPER_SECRET_LINE_ONE\n");
    commit("baseline");
    initPack({ cwd: repo });
    write("secret.txt", "SUPER_SECRET_LINE_TWO\n");
    capturePack({ cwd: repo });
    const dir = resolvePackPaths(repo).dir;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isFile()) expect(readFileSync(full, "utf8")).not.toMatch(/SUPER_SECRET/);
    }
  });

  it("still reads M1-shaped state (git: {} or partial fields)", () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    for (const gitValue of [{}, { branch: "main" }, { branch: "main", head: "abc", changedFiles: ["x"] }]) {
      const s = readState();
      s.git = gitValue;
      writeFileSync(paths.state, JSON.stringify(s, null, 2) + "\n");
      expect(() => loadStatus({ cwd: repo })).not.toThrow();
    }
    expect(renderStatus(loadStatus({ cwd: repo }))).toContain("Branch: main");
  });

  it("fails without touching files when state is corrupt, pack is missing, or cwd is not a repo", () => {
    write("a.txt", "1\n");
    commit("baseline");
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);

    writeFileSync(paths.state, "{ not json");
    const before = hashTree(paths.dir);
    expect(() => capturePack({ cwd: repo })).toThrow(StorageError);
    expect(() => capturePack({ cwd: repo })).toThrow(/state \(state\.json\) is not valid JSON/);
    expect(hashTree(paths.dir)).toBe(before);

    writeFileSync(paths.state, JSON.stringify({ goal: 1 }));
    const before2 = hashTree(paths.dir);
    expect(() => capturePack({ cwd: repo })).toThrow(/failed schema validation/);
    expect(hashTree(paths.dir)).toBe(before2);

    rmSync(paths.dir, { recursive: true, force: true });
    expect(() => capturePack({ cwd: repo })).toThrow(/no \.ctxpack\/ directory found/);
    expect(existsSync(paths.dir)).toBe(false);

    const plain = mkdtempSync(path.join(tmpdir(), "ctxpack-nogit-"));
    try {
      expect(() => capturePack({ cwd: plain })).toThrow(/not a git repository/);
      expect(readdirSync(plain)).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("cli capture", () => {
  it("prints a summary and exits 0; status shows the captured git section", async () => {
    write("a.txt", "1\n");
    commit("baseline");
    initPack({ cwd: repo });
    write("a.txt", "2\n");
    const a = makeIO(repo);
    expect(await main(["node", "ctxpack", "capture"], a.io)).toBe(0);
    const out = a.out.join("");
    expect(out).toContain("Captured git state into .ctxpack/state.json");
    expect(out).toContain("main @ ");
    expect(out).toContain("changed files: 1");
    expect(out).toContain("recent commits: 1");

    const b = makeIO(repo);
    expect(await main(["node", "ctxpack", "status"], b.io)).toBe(0);
    expect(b.out.join("")).toContain("Branch: main");
    expect(b.out.join("")).toContain("Changed files: 1");
  });

  it("returns non-zero with a diagnostic when not initialized or state is corrupt", async () => {
    const a = makeIO(repo);
    expect(await main(["node", "ctxpack", "capture"], a.io)).toBe(1);
    expect(a.err.join("")).toMatch(/ctxpack: error: no \.ctxpack\/ directory found/);

    initPack({ cwd: repo });
    writeFileSync(resolvePackPaths(repo).state, "nope");
    const b = makeIO(repo);
    expect(await main(["node", "ctxpack", "capture"], b.io)).toBe(1);
    expect(b.err.join("")).toMatch(/state \(state\.json\) is not valid JSON/);
    expect(b.out).toEqual([]);
    expect(readFileSync(resolvePackPaths(repo).state, "utf8")).toBe("nope");
  });
});
