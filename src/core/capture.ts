import path from "node:path";
import { GitError, captureGitState } from "../git/index.js";
import type { GitState, Manifest, State } from "../schema/index.js";
import {
  PACK_DIR,
  StorageError,
  findGitRoot,
  readManifest,
  readState,
  resolvePackPaths,
  writeJson,
} from "../storage/index.js";
import { existsSync, statSync } from "node:fs";

export interface CaptureOptions {
  cwd: string;
  now?: () => Date;
}

export interface CaptureResult {
  root: string;
  dir: string;
  manifest: Manifest;
  state: State;
  git: GitState;
}

/**
 * Reads the Git work tree and persists the result to `state.git`, bumping `manifest.updatedAt`.
 * All reads and validation happen before any write, so a failure never touches existing files.
 */
export function capturePack(options: CaptureOptions): CaptureResult {
  const root = findGitRoot(options.cwd);
  if (!root) {
    throw new StorageError(
      `not a git repository (no .git found in ${path.resolve(options.cwd)} or any parent). ` +
        "ctxpack capture must run inside a Git repository.",
    );
  }
  const paths = resolvePackPaths(root);
  if (!existsSync(paths.dir) || !statSync(paths.dir).isDirectory()) {
    throw new StorageError(`no ${PACK_DIR}/ directory found at ${root}. Run \`ctxpack init\` first.`, paths.dir);
  }

  const manifest = readManifest(paths);
  const state = readState(paths);

  let git: GitState;
  try {
    git = captureGitState(root);
  } catch (error) {
    if (error instanceof GitError) throw new StorageError(`git capture failed: ${error.message}`);
    throw error;
  }

  const now = (options.now ?? (() => new Date))().toISOString();
  const nextState: State = { ...state, git };
  const nextManifest: Manifest = { ...manifest, updatedAt: now };

  writeJson(paths.state, nextState);
  writeJson(paths.manifest, nextManifest);

  return { root, dir: paths.dir, manifest: nextManifest, state: nextState, git };
}

export function renderCapture(result: CaptureResult): string {
  const { git } = result;
  const lines: string[] = [];
  lines.push(`Captured git state into ${path.relative(result.root, result.dir) || PACK_DIR}/state.json`);
  const where =
    git.headState === "unborn"
      ? `${git.branch ?? "(unknown)"} (no commits yet)`
      : git.headState === "detached"
        ? `detached HEAD at ${git.head?.slice(0, 12)}`
        : `${git.branch} @ ${git.head?.slice(0, 12)}`;
  lines.push(`  ${where}`);
  const changed = git.changedFiles ?? [];
  const staged = git.stat?.staged;
  const unstaged = git.stat?.unstaged;
  lines.push(
    `  changed files: ${changed.length}` +
      (staged ? ` | staged: ${staged.files} (+${staged.insertions} -${staged.deletions})` : "") +
      (unstaged ? ` | unstaged: ${unstaged.files} (+${unstaged.insertions} -${unstaged.deletions})` : ""),
  );
  lines.push(`  recent commits: ${git.recentCommits?.length ?? 0}`);
  return lines.join("\n") + "\n";
}
