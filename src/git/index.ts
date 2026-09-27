import { execFileSync } from "node:child_process";
import type { GitChange, GitCommit, GitDiffStat, GitState } from "../schema/index.js";
import { PACK_DIR } from "../storage/index.js";

export const RECENT_COMMIT_LIMIT = 5;

export class GitError extends Error {
  constructor(
    message: string,
    readonly command?: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitRunner {
  (args: string[]): string;
}

/** Runs `git` inside `root`; throws GitError with stderr on non-zero exit. */
export function createGitRunner(root: string): GitRunner {
  return (args) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        // Read-only queries must never opportunistically rewrite .git/index.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      const cmd = `git ${args.join(" ")}`;
      if (isExecError(error)) {
        if (error.code === "ENOENT") {
          throw new GitError("git executable not found on PATH", cmd);
        }
        const stderr = (error.stderr ?? "").toString().trim();
        throw new GitError(`\`${cmd}\` failed${stderr ? `: ${stderr}` : ""}`, cmd);
      }
      throw new GitError(`\`${cmd}\` failed: ${error instanceof Error ? error.message : String(error)}`, cmd);
    }
  };
}

interface ExecError {
  code?: string;
  status?: number | null;
  stderr?: string | Buffer;
}

function isExecError(error: unknown): error is ExecError {
  return typeof error === "object" && error !== null && ("status" in error || "code" in error);
}

/** Pathspec that limits git to the repository while excluding ctxpack's own directory. */
const PATHSPEC = ["--", ".", `:(exclude,top)${PACK_DIR}`];

export function captureGitState(root: string, git: GitRunner = createGitRunner(root)): GitState {
  // Verify we are inside a real work tree before running anything else.
  if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
    throw new GitError(`${root} is not inside a Git work tree`);
  }

  const head = tryGit(git, ["rev-parse", "--verify", "--quiet", "HEAD"])?.trim();
  const symbolic = tryGit(git, ["symbolic-ref", "--quiet", "--short", "HEAD"])?.trim();

  const state: GitState = {};
  if (head === undefined) {
    // Unborn branch: no commits yet. symbolic-ref still reports the branch name.
    state.headState = "unborn";
    if (symbolic) state.branch = symbolic;
  } else if (symbolic) {
    state.headState = "branch";
    state.branch = symbolic;
    state.head = head;
  } else {
    state.headState = "detached";
    state.head = head;
  }

  const changes = parseStatus(git(["status", "--porcelain=v1", "-z", "--untracked-files=all", ...PATHSPEC]));
  state.changes = changes;
  state.changedFiles = [...new Set(changes.map((c) => c.path))].sort();
  state.clean = changes.length === 0;

  // Without HEAD, `git diff --cached` has no base; compare the index against the empty tree instead.
  const stagedBase = head === undefined ? [EMPTY_TREE] : [];
  state.stat = {
    staged: parseNumstat(git(["diff", "--cached", "--numstat", "-z", ...stagedBase, ...PATHSPEC])),
    unstaged: parseNumstat(git(["diff", "--numstat", "-z", ...PATHSPEC])),
  };

  state.recentCommits =
    head === undefined
      ? []
      : parseLog(git(["log", `--max-count=${RECENT_COMMIT_LIMIT}`, "-z", `--format=${LOG_FORMAT}`]));

  return state;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const US = "\u001f";
const LOG_FORMAT = ["%H", "%h", "%an", "%aI", "%s"].join(`%x1f`);

function tryGit(git: GitRunner, args: string[]): string | undefined {
  try {
    return git(args);
  } catch (error) {
    if (error instanceof GitError && error.command) return undefined;
    throw error;
  }
}

/** Parses `git status --porcelain=v1 -z`. Rename/copy entries carry the origin path as a second NUL-terminated field. */
export function parseStatus(output: string): GitChange[] {
  const fields = output.split("\0");
  const changes: GitChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    if (entry.length < 4 || entry[2] !== " ") {
      throw new GitError(`unexpected git status entry: ${JSON.stringify(entry)}`);
    }
    const index = entry[0]!;
    const worktree = entry[1]!;
    const filePath = entry.slice(3);
    const change: GitChange = { path: filePath, index, worktree };
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
      const from = fields[++i];
      if (from) change.from = from;
    }
    changes.push(change);
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Parses `git diff --numstat -z`. Binary files report `-\t-` and are counted separately. */
export function parseNumstat(output: string): GitDiffStat {
  const stat = emptyStat();
  const fields = output.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(entry);
    if (!match) throw new GitError(`unexpected git numstat entry: ${JSON.stringify(entry)}`);
    const [, added, deleted, rest] = match;
    // With -z, renames emit "ins\tdel\t\0old\0new\0"; skip the two extra path fields.
    if (rest === "") i += 2;
    stat.files += 1;
    if (added === "-" || deleted === "-") stat.binary += 1;
    else {
      stat.insertions += Number(added);
      stat.deletions += Number(deleted);
    }
  }
  return stat;
}

export function parseLog(output: string): GitCommit[] {
  return output
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, shortSha, author, date, subject] = record.split(US);
      if (!sha || !shortSha || author === undefined || date === undefined || subject === undefined) {
        throw new GitError(`unexpected git log record: ${JSON.stringify(record)}`);
      }
      return { sha, shortSha, author, date, subject };
    });
}

function emptyStat(): GitDiffStat {
  return { files: 0, insertions: 0, deletions: 0, binary: 0 };
}
