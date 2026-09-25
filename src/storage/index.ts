import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
    throw new StorageError(`${label} not found: ${rel}`, file);
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new StorageError(`cannot read ${label} (${rel}): ${describe(error)}`, file);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new StorageError(`${label} (${rel}) is not valid JSON: ${describe(error)}`, file);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
      .join("\n");
    throw new StorageError(`${label} (${rel}) failed schema validation:\n${issues}`, file);
  }
  return result.data;
}

export function readManifest(paths: PackPaths): Manifest {
  return readJsonFile(paths.manifest, ManifestSchema, "manifest");
}

export function readState(paths: PackPaths): State {
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
    );
  }
  return {
    manifest: readManifest(paths),
    state: readState(paths),
    artifacts: readArtifacts(paths),
  };
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
