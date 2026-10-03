import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { capturePack } from "../src/core/capture.js";
import { initPack } from "../src/core/init.js";
import { main } from "../src/program.js";
import { readManifest, readPack, readState, resolvePackPaths } from "../src/storage/index.js";
import { loadScreen } from "../src/tui/model.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ctxpack-transaction-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  initPack({ cwd: root });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("rejects an interrupted capture at every read and write entrypoint", async () => {
  const paths = resolvePackPaths(root);
  mkdirSync(path.join(paths.dir, ".capture-pending"));
  const state = readFileSync(paths.state, "utf8");
  const manifest = readFileSync(paths.manifest, "utf8");
  for (const read of [() => readPack(paths), () => readManifest(paths), () => readState(paths), () => capturePack({ cwd: root }), () => initPack({ cwd: root })]) {
    expect(read).toThrow(/capture_incomplete/);
  }
  expect(loadScreen(root).kind).toBe("broken");
  for (const command of ["status", "handoff", "validate", "capture", "init"]) {
    const errors: string[] = [];
    const output: string[] = [];
    expect(await main(["node", "ctxpack", command], { cwd: () => root, stdout: (text) => output.push(text), stderr: (text) => errors.push(text) })).toBe(1);
    expect(errors.join("")).toContain("capture_incomplete");
    expect(output).toEqual([]);
  }
  expect(readFileSync(paths.state, "utf8")).toBe(state);
  expect(readFileSync(paths.manifest, "utf8")).toBe(manifest);
});

it("keeps schema-v1 and hand-edited state usable after successful captures", () => {
  const paths = resolvePackPaths(root);
  const state = JSON.parse(readFileSync(paths.state, "utf8"));
  state.goal = "user goal";
  writeFileSync(paths.state, JSON.stringify(state));
  capturePack({ cwd: root });
  expect(readPack(paths).state.goal).toBe("user goal");
  expect(readPack(paths).manifest.schemaVersion).toBe(1);
  const revision = readFileSync(path.join(paths.dir, ".capture-revision"), "utf8");
  capturePack({ cwd: root });
  expect(readFileSync(path.join(paths.dir, ".capture-revision"), "utf8")).not.toBe(revision);
});

it("releases init's marker when preparation fails before any file write", () => {
  const paths = resolvePackPaths(root);
  const before = readPack(paths);
  rmSync(paths.snapshots, { recursive: true });
  writeFileSync(paths.snapshots, "not a directory");
  expect(() => initPack({ cwd: root })).toThrow();
  expect(existsSync(path.join(paths.dir, ".capture-pending"))).toBe(false);
  expect(readPack(paths)).toEqual(before);
  rmSync(paths.snapshots);
  expect(() => initPack({ cwd: root })).not.toThrow();
  expect(readPack(paths)).toEqual(before);
});

it.each(["state", "manifest", "revision"])("rejects the pack after a real process death following the %s rename", (stage) => {
  const paths = resolvePackPaths(root);
  const beforeState = readFileSync(paths.state, "utf8");
  const beforeManifest = readFileSync(paths.manifest, "utf8");
  const destination = stage === "revision" ? path.join(paths.dir, ".capture-revision") : paths[stage as "state" | "manifest"];
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(to) === ${JSON.stringify(destination)}) process.kill(process.pid, 'SIGKILL');
    };
    syncBuiltinESMExports();
    const { capturePack } = await import('./src/core/capture.ts');
    capturePack({ cwd: ${JSON.stringify(root)}, now: () => new Date('2030-01-01T00:00:00Z') });
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 15_000 });
  expect(child.error).toBeUndefined();
  expect(child.status).not.toBe(0);
  expect(readFileSync(paths.state, "utf8")).not.toBe(beforeState);
  if (stage === "state") expect(readFileSync(paths.manifest, "utf8")).toBe(beforeManifest);
  else expect(readFileSync(paths.manifest, "utf8")).not.toBe(beforeManifest);
  expect(readFileSync(path.join(paths.dir, ".capture-pending", "state.before.json"), "utf8")).toBe(beforeState);
  expect(readFileSync(path.join(paths.dir, ".capture-pending", "manifest.before.json"), "utf8")).toBe(beforeManifest);
  expect(() => readPack(paths)).toThrow(/capture_incomplete/);
  expect(() => capturePack({ cwd: root })).toThrow(/capture_incomplete/);
});

it("rejects a read spanning an otherwise completed capture generation", () => {
  const paths = resolvePackPaths(root);
  capturePack({ cwd: root });
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const read = fs.readFileSync;
    fs.readFileSync = (file, options) => {
      const content = read(file, options);
      if (String(file) === ${JSON.stringify(paths.state)}) fs.writeFileSync(${JSON.stringify(path.join(paths.dir, ".capture-revision"))}, 'another-completed-capture');
      return content;
    };
    syncBuiltinESMExports();
    const { readPack, resolvePackPaths } = await import('./src/storage/index.ts');
    try { readPack(resolvePackPaths(${JSON.stringify(root)})); process.exitCode = 1; }
    catch (error) { if (error.code !== 'capture_changed') throw error; }
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 15_000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
});

it("does not repair files when capture starts after init's entry check", () => {
  const paths = resolvePackPaths(root);
  rmSync(paths.commands);
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const read = fs.readFileSync;
    fs.readFileSync = (file, options) => {
      const content = read(file, options);
      if (String(file) === ${JSON.stringify(paths.manifest)}) fs.mkdirSync(${JSON.stringify(path.join(paths.dir, ".capture-pending"))});
      return content;
    };
    syncBuiltinESMExports();
    const { initPack } = await import('./src/core/init.ts');
    try { initPack({ cwd: ${JSON.stringify(root)} }); process.exitCode = 1; }
    catch (error) { if (error.code !== 'capture_incomplete') throw error; }
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { encoding: "utf8", timeout: 15_000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(existsSync(paths.commands)).toBe(false);
});
