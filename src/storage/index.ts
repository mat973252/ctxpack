import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  ArtifactsSchema,
  ManifestSchema,
  StateSchema,
  type Artifacts,
  type ContextPack,
  type Manifest,
  type State,
} from "../schema/index.js";

export const PACK_DIR = ".ctxpack";

export const PACK_FILES = {
  manifest: "manifest.json",
  state: "state.json",
  project: "project.md",
  decisions: "decisions.md",
  failures: "failures.md",
  commands: "commands.md",
  artifacts: "artifacts.json",
} as const;

export const SNAPSHOTS_DIR = "snapshots";

export class StorageError extends Error {
  constructor(
    message: string,
    readonly file?: string,
    readonly code = "storage_error",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface PackPaths {
  root: string;
  dir: string;
  manifest: string;
  state: string;
  project: string;
  decisions: string;
  failures: string;
  commands: string;
  artifacts: string;
  snapshots: string;
}

export function resolvePackPaths(root: string): PackPaths {
  const dir = path.join(root, PACK_DIR);
  return {
    root,
    dir,
    manifest: path.join(dir, PACK_FILES.manifest),
    state: path.join(dir, PACK_FILES.state),
    project: path.join(dir, PACK_FILES.project),
    decisions: path.join(dir, PACK_FILES.decisions),
    failures: path.join(dir, PACK_FILES.failures),
    commands: path.join(dir, PACK_FILES.commands),
    artifacts: path.join(dir, PACK_FILES.artifacts),
    snapshots: path.join(dir, SNAPSHOTS_DIR),
  };
}

export function findGitRoot(start: string): string | undefined {
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function packExists(paths: PackPaths): boolean {
  return existsSync(paths.dir);
}

export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readJsonFile<T>(file: string, schema: z.ZodType<T>, label: string): T {
  const rel = path.basename(file);
  if (!existsSync(file)) {
    throw new StorageError(`${label} not found: ${rel}`, file, "file_missing");
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new StorageError(`cannot read ${label} (${rel}): ${describe(error)}`, file, "file_unreadable");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new StorageError(`${label} (${rel}) is not valid JSON: ${describe(error)}`, file, "invalid_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
      .join("\n");
    throw new StorageError(`${label} (${rel}) failed schema validation:\n${issues}`, file, "invalid_schema");
  }
  return result.data;
}

export function readManifest(paths: PackPaths): Manifest {
  assertCaptureComplete(paths);
  return readJsonFile(paths.manifest, ManifestSchema, "manifest");
}

export function readState(paths: PackPaths): State {
  assertCaptureComplete(paths);
  return readJsonFile(paths.state, StateSchema, "state");
}

export function readArtifacts(paths: PackPaths): Artifacts {
  return readJsonFile(paths.artifacts, ArtifactsSchema, "artifacts");
}

export function readPack(paths: PackPaths): ContextPack {
  if (!existsSync(paths.dir) || !statSync(paths.dir).isDirectory()) {
    throw new StorageError(
      `no ${PACK_DIR}/ directory found at ${paths.root}. Run \`ctxpack init\` first.`,
      paths.dir,
      "pack_missing",
    );
  }
  return consistentRead(paths, () => ({
    manifest: readManifest(paths),
    state: readState(paths),
    artifacts: readArtifacts(paths),
  }));
}

const CAPTURE_PENDING = ".capture-pending";
const CAPTURE_REVISION = ".capture-revision";

export function assertCaptureComplete(paths: PackPaths): void {
  const pending = path.join(paths.dir, CAPTURE_PENDING);
  if (existsSync(pending)) {
    throw new StorageError(
      `[capture_incomplete] Capture is in progress or was interrupted. Inspect ${pending}; do not remove it while capture is running. Original JSON backups, when prepared, are inside.`,
      pending, "capture_incomplete",
    );
  }
}

function revision(paths: PackPaths): string {
  const file = path.join(paths.dir, CAPTURE_REVISION);
  try { return existsSync(file) ? readFileSync(file, "utf8") : ""; }
  catch (error) {
    throw new StorageError(`cannot read capture revision: ${describe(error)}`, file, "file_unreadable");
  }
}

export function consistentRead<T>(paths: PackPaths, read: () => T): T {
  const before = revision(paths);
  assertCaptureComplete(paths);
  const result = read();
  assertCaptureComplete(paths);
  if (revision(paths) !== before) {
    throw new StorageError("[capture_changed] Capture changed while reading; retry the read.", paths.dir, "capture_changed");
  }
  return result;
}

export function readCaptureState(paths: PackPaths): { manifest: Manifest; state: State } {
  return consistentRead(paths, () => ({ manifest: readManifest(paths), state: readState(paths) }));
}

/** Initialization shares the capture writer marker; readers never accept partial repair. */
export function initializeConsistently<T>(paths: PackPaths, initialize: (markWriting: () => void) => T): T {
  assertCaptureComplete(paths);
  const pending = path.join(paths.dir, CAPTURE_PENDING);
  try { mkdirSync(pending); }
  catch (error) {
    if (existsSync(pending)) assertCaptureComplete(paths);
    throw error;
  }
  const nextRevision = path.join(pending, "revision.next");
  let writing = false;
  try {
    const result = initialize(() => { writing = true; });
    writeFileSync(nextRevision, randomUUID() + "\n", { encoding: "utf8", flush: true });
    renameSync(nextRevision, path.join(paths.dir, CAPTURE_REVISION));
    rmdirSync(pending);
    return result;
  } catch (error) {
    if (!writing) {
      if (existsSync(nextRevision)) unlinkSync(nextRevision);
      rmdirSync(pending);
    }
    throw error;
  }
}

/** Keep interrupted multi-file writes visible and preserve exact preimages for recovery. */
export function commitCapture(
  paths: PackPaths,
  previous: { manifest: Manifest; state: State },
  next: { manifest: Manifest; state: State },
): void {
  assertCaptureComplete(paths);
  const pending = path.join(paths.dir, CAPTURE_PENDING);
  try { mkdirSync(pending); }
  catch (error) {
    if (existsSync(pending)) assertCaptureComplete(paths);
    throw error;
  }
  const names = ["state.before.json", "manifest.before.json", "state.next.json", "manifest.next.json", "revision.next"];
  const cleanup = () => {
    for (const name of names) {
      const file = path.join(pending, name);
      if (existsSync(file)) unlinkSync(file);
    }
    rmdirSync(pending);
  };
  let publishing = false;
  try {
    const oldState = readFileSync(paths.state, "utf8");
    const oldManifest = readFileSync(paths.manifest, "utf8");
    if (JSON.stringify(StateSchema.parse(JSON.parse(oldState))) !== JSON.stringify(previous.state) ||
        JSON.stringify(ManifestSchema.parse(JSON.parse(oldManifest))) !== JSON.stringify(previous.manifest)) {
      throw new StorageError("[capture_changed] Pack changed before capture could write; retry capture.", paths.dir, "capture_changed");
    }
    const stage = (name: string, text: string) => writeFileSync(path.join(pending, name), text, { encoding: "utf8", flush: true });
    stage("state.before.json", oldState);
    stage("manifest.before.json", oldManifest);
    stage("state.next.json", JSON.stringify(next.state, null, 2) + "\n");
    stage("manifest.next.json", JSON.stringify(next.manifest, null, 2) + "\n");
    stage("revision.next", randomUUID() + "\n");
    publishing = true;
    renameSync(path.join(pending, "state.next.json"), paths.state);
    renameSync(path.join(pending, "manifest.next.json"), paths.manifest);
    renameSync(path.join(pending, "revision.next"), path.join(paths.dir, CAPTURE_REVISION));
    cleanup();
  } catch (error) {
    // Before publication no original JSON changed; after it starts, keep the
    // marker even on an ordinary error. A killed process cannot run a rollback.
    if (!publishing) cleanup();
    throw error;
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
