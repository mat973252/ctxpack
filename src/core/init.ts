import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ArtifactsSchema,
  ManifestSchema,
  StateSchema,
  createDefaultArtifacts,
  createDefaultManifest,
  createDefaultState,
} from "../schema/index.js";
import {
  PACK_DIR,
  StorageError,
  assertCaptureComplete,
  consistentRead,
  initializeConsistently,
  ensureDir,
  findGitRoot,
  readJsonFile,
  resolvePackPaths,
  writeJson,
  type PackPaths,
} from "../storage/index.js";

export interface InitOptions {
  cwd: string;
  project?: string;
  now?: () => Date;
}

export interface InitResult {
  root: string;
  dir: string;
  created: string[];
  kept: string[];
}

export const MARKDOWN_TEMPLATES: Record<"project" | "decisions" | "failures" | "commands", string> = {
  project: "# Project\n\nDescribe the project purpose, scope and constraints.\n",
  decisions:
    "# Decisions\n\nRecord important design decisions.\n\n" +
    "Format: `- [YYYY-MM-DD] <summary> — <reason>`\n",
  failures:
    "# Failed Approaches\n\nRecord approaches that were tried and did not work, " +
    "so the next agent does not repeat them.\n\n" +
    "Format: `- <approach>: <result> — <reason>`\n",
  commands: "# Commands\n\nList the commands used to install, lint, test, build and run.\n",
};

export function initPack(options: InitOptions): InitResult {
  const root = findGitRoot(options.cwd);
  if (!root) {
    throw new StorageError(
      `not a git repository (no .git found in ${path.resolve(options.cwd)} or any parent). ` +
        "ctxpack init must run inside a Git repository.",
    );
  }

  const paths = resolvePackPaths(root);
  assertCaptureComplete(paths);
  const now = (options.now ?? (() => new Date))().toISOString();
  const project = options.project?.trim() || path.basename(root) || PACK_DIR;
  const created: string[] = [];
  const kept: string[] = [];

  // Validate existing JSON files before touching anything so a corrupt pack is never overwritten.
  const inspect = () => {
    const existing = {
      manifest: existsSync(paths.manifest),
      state: existsSync(paths.state),
      artifacts: existsSync(paths.artifacts),
    };
    if (existing.manifest) readJsonFile(paths.manifest, ManifestSchema, "manifest");
    if (existing.state) readJsonFile(paths.state, StateSchema, "state");
    if (existing.artifacts) readJsonFile(paths.artifacts, ArtifactsSchema, "artifacts");
    return existing;
  };
  const complete = consistentRead(paths, () => {
    const existing = inspect();
    return Object.values(existing).every(Boolean) &&
      [paths.project, paths.decisions, paths.failures, paths.commands].every(existsSync) &&
      existsSync(paths.snapshots) && statSync(paths.snapshots).isDirectory();
  });
  if (complete) return {
    root, dir: paths.dir, created,
    kept: [paths.manifest, paths.state, paths.artifacts, paths.project, paths.decisions, paths.failures, paths.commands].map((file) => rel(paths, file)),
  };

  ensureDir(paths.dir);
  return initializeConsistently(paths, (markWriting) => {
    // Revalidate after acquiring the writer marker; another writer may have finished.
    const existing = inspect();
    ensureDir(paths.snapshots);

    const track = (file: string, wasCreated: boolean) =>
      (wasCreated ? created : kept).push(rel(paths, file));

    if (existing.manifest) track(paths.manifest, false);
    else {
      markWriting();
      writeJson(paths.manifest, createDefaultManifest(project, now));
      track(paths.manifest, true);
    }

    if (existing.state) track(paths.state, false);
    else {
      markWriting();
      writeJson(paths.state, createDefaultState());
      track(paths.state, true);
    }

    if (existing.artifacts) track(paths.artifacts, false);
    else {
      markWriting();
      writeJson(paths.artifacts, createDefaultArtifacts());
      track(paths.artifacts, true);
    }

    for (const key of ["project", "decisions", "failures", "commands"] as const) {
      const file = paths[key];
      if (existsSync(file)) track(file, false);
      else {
        markWriting();
        writeFileSync(file, MARKDOWN_TEMPLATES[key], "utf8");
        track(file, true);
      }
    }

    return { root, dir: paths.dir, created, kept };
  });
}

function rel(paths: PackPaths, file: string): string {
  return path.relative(paths.root, file).split(path.sep).join("/");
}
