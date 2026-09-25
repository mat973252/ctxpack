import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initPack } from "../src/core/init.js";
import { loadStatus, renderStatus } from "../src/core/status.js";
import { main, type ProgramIO } from "../src/program.js";
import { ArtifactsSchema, ManifestSchema, StateSchema } from "../src/schema/index.js";
import { StorageError, resolvePackPaths } from "../src/storage/index.js";

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
  repo = mkdtempSync(path.join(tmpdir(), "ctxpack-test-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("init", () => {
  it("creates the full .ctxpack structure with valid contents", () => {
    const fixed = new Date("2026-09-25T00:00:00.000Z");
    const result = initPack({ cwd: repo, now: () => fixed });
    const paths = resolvePackPaths(repo);
    expect(result.root).toBe(repo);
    expect(result.kept).toEqual([]);
    expect(result.created.sort()).toEqual(
      [
        ".ctxpack/artifacts.json",
        ".ctxpack/commands.md",
        ".ctxpack/decisions.md",
        ".ctxpack/failures.md",
        ".ctxpack/manifest.json",
        ".ctxpack/project.md",
        ".ctxpack/state.json",
      ].sort(),
    );
    expect(statSync(paths.snapshots).isDirectory()).toBe(true);

    const manifest = ManifestSchema.parse(JSON.parse(readFileSync(paths.manifest, "utf8")));
    expect(manifest).toEqual({
      version: "0.1",
      project: path.basename(repo),
      createdAt: fixed.toISOString(),
      updatedAt: fixed.toISOString(),
      schemaVersion: 1,
    });
    const state = StateSchema.parse(JSON.parse(readFileSync(paths.state, "utf8")));
    expect(state).toEqual({
      goal: "",
      status: "not_started",
      completed: [],
      currentTasks: [],
      blockers: [],
      nextActions: [],
      relevantFiles: [],
      verification: [],
      git: {},
    });
    expect(ArtifactsSchema.parse(JSON.parse(readFileSync(paths.artifacts, "utf8")))).toEqual({
      schemaVersion: 1,
      artifacts: [],
    });
    for (const md of [paths.project, paths.decisions, paths.failures, paths.commands]) {
      expect(readFileSync(md, "utf8").startsWith("# ")).toBe(true);
    }
  });

  it("honours --project and works from a subdirectory", () => {
    const sub = path.join(repo, "a", "b");
    mkdirSync(sub, { recursive: true });
    const result = initPack({ cwd: sub, project: "relay" });
    expect(result.root).toBe(repo);
    const manifest = ManifestSchema.parse(JSON.parse(readFileSync(resolvePackPaths(repo).manifest, "utf8")));
    expect(manifest.project).toBe("relay");
  });

  it("refuses to run outside a git repository", () => {
    const plain = mkdtempSync(path.join(tmpdir(), "ctxpack-nogit-"));
    try {
      expect(() => initPack({ cwd: plain })).toThrow(/not a git repository/);
      expect(existsSync(path.join(plain, ".ctxpack"))).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing valid state on a second init", () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    const state = StateSchema.parse(JSON.parse(readFileSync(paths.state, "utf8")));
    state.goal = "Implement durable resume";
    state.status = "in_progress";
    state.blockers.push("missing idempotency keys");
    writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
    writeFileSync(paths.decisions, "# Decisions\n\n- SQLite first\n");
    const before = hashTree(paths.dir);

    const second = initPack({ cwd: repo });
    expect(second.created).toEqual([]);
    expect(second.kept).toHaveLength(7);
    expect(hashTree(paths.dir)).toBe(before);
  });

  it("recreates only missing files and keeps the rest", () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    rmSync(paths.commands);
    rmSync(paths.snapshots, { recursive: true });
    const result = initPack({ cwd: repo });
    expect(result.created).toEqual([".ctxpack/commands.md"]);
    expect(existsSync(paths.snapshots)).toBe(true);
  });

  it("refuses to touch a pack whose state.json is corrupt", () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    writeFileSync(paths.state, "{ not json");
    rmSync(paths.commands);
    expect(() => initPack({ cwd: repo })).toThrow(StorageError);
    expect(() => initPack({ cwd: repo })).toThrow(/state \(state\.json\) is not valid JSON/);
    expect(existsSync(paths.commands)).toBe(false);
    expect(readFileSync(paths.state, "utf8")).toBe("{ not json");
  });
});

describe("status", () => {
  it("renders goal, progress and blockers without modifying the tree", () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    const state = StateSchema.parse(JSON.parse(readFileSync(paths.state, "utf8")));
    state.goal = "Implement durable resume";
    state.status = "blocked";
    state.completed = ["SQLite RunStore"];
    state.currentTasks = ["Restore after crash"];
    state.blockers = ["No idempotency keys"];
    state.nextActions = ["Add effect ID", "Add crash test"];
    state.verification = [{ name: "unit tests", result: "pass" }];
    writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
    const before = hashTree(repo);

    const text = renderStatus(loadStatus({ cwd: repo }));
    expect(text).toContain("Implement durable resume");
    expect(text).toContain("Status: BLOCKED");
    expect(text).toContain("- SQLite RunStore");
    expect(text).toContain("- No idempotency keys");
    expect(text).toContain("1. Add effect ID");
    expect(text).toContain("unit tests: PASS");
    expect(hashTree(repo)).toBe(before);
  });

  it("fails clearly when no pack exists", () => {
    expect(() => loadStatus({ cwd: repo })).toThrow(/no \.ctxpack\/ directory found/);
  });

  it("fails clearly on invalid JSON and on schema violations", () => {
    initPack({ cwd: repo });
    const paths = resolvePackPaths(repo);
    writeFileSync(paths.state, "{ broken");
    expect(() => loadStatus({ cwd: repo })).toThrow(/state \(state\.json\) is not valid JSON/);
    writeFileSync(paths.state, JSON.stringify({ goal: 1 }));
    expect(() => loadStatus({ cwd: repo })).toThrow(/failed schema validation/);
    expect(() => loadStatus({ cwd: repo })).toThrow(/goal/);
    rmSync(paths.manifest);
    expect(() => loadStatus({ cwd: repo })).toThrow(/manifest not found/);
  });
});

describe("cli", () => {
  it("returns 0 on success and prints init/status output", async () => {
    const a = makeIO(repo);
    expect(await main(["node", "ctxpack", "init"], a.io)).toBe(0);
    expect(a.out.join("")).toMatch(/Initialized ctxpack at .*\.ctxpack/);

    const b = makeIO(repo);
    expect(await main(["node", "ctxpack", "init"], b.io)).toBe(0);
    expect(b.out.join("")).toContain("already initialized");

    const c = makeIO(repo);
    expect(await main(["node", "ctxpack", "status"], c.io)).toBe(0);
    expect(c.out.join("")).toContain("Status: NOT_STARTED");
  });

  it("returns non-zero with a diagnostic when status has no pack or corrupt JSON", async () => {
    const a = makeIO(repo);
    expect(await main(["node", "ctxpack", "status"], a.io)).toBe(1);
    expect(a.err.join("")).toMatch(/ctxpack: error: no \.ctxpack\/ directory found/);

    initPack({ cwd: repo });
    writeFileSync(resolvePackPaths(repo).manifest, "nope");
    const b = makeIO(repo);
    expect(await main(["node", "ctxpack", "status"], b.io)).toBe(1);
    expect(b.err.join("")).toMatch(/manifest \(manifest\.json\) is not valid JSON/);
    expect(b.out).toEqual([]);
  });
});
