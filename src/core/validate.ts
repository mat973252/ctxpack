import path from "node:path";
import { GitError, captureGitState } from "../git/index.js";
import type { ContextPack, GitState, ProgressStatus } from "../schema/index.js";
import { PACK_DIR, StorageError, findGitRoot, readPack, resolvePackPaths } from "../storage/index.js";

export interface ValidateOptions {
  cwd: string;
}

export interface FieldIssue {
  field: "goal" | "nextActions";
  message: string;
  advice: string;
}

export type GitCheckKind =
  /** `.ctxpack/` lives outside any Git work tree; there is nothing to compare against. */
  | "no_repository"
  /** `state.git` carries no head/branch information (e.g. `{}` right after `init`). */
  | "not_captured"
  /** At least one stored stable field differs from the current work tree. */
  | "changed"
  /** Every stored stable field matches, but the snapshot lacks some stable fields (legacy capture). */
  | "incomplete"
  /** All stable fields present and equal, work tree was clean when captured. */
  | "match_clean"
  /** All stable fields present and equal, but the captured tree was dirty: contents are unproven. */
  | "match_dirty";

export interface GitCheck {
  kind: GitCheckKind;
  /** Stable fields whose stored value differs from the current work tree (sorted). */
  changedFields: StableGitField[];
  /** Stable fields absent from the stored snapshot (sorted). */
  missingFields: StableGitField[];
  stored: GitState;
  current?: GitState;
}

export interface ValidateResult {
  root: string;
  dir: string;
  status: ProgressStatus;
  blockers: string[];
  fields: { ok: boolean; issues: FieldIssue[] };
  git: GitCheck;
  ok: boolean;
}

/** Fields compared between the stored snapshot and the live work tree. `recentCommits` (author/date) is deliberately excluded. */
export const STABLE_GIT_FIELDS = [
  "branch",
  "changedFiles",
  "changes",
  "clean",
  "head",
  "headState",
  "stat",
] as const;
export type StableGitField = (typeof STABLE_GIT_FIELDS)[number];

const STATE_FILE = `${PACK_DIR}/state.json`;

/**
 * Read-only handoff preflight: loads the pack with the existing storage layer, checks the required
 * handoff fields and compares the stored Git snapshot against the current work tree. Never writes.
 */
export function validatePack(options: ValidateOptions): ValidateResult {
  const gitRoot = findGitRoot(options.cwd);
  const root = gitRoot ?? path.resolve(options.cwd);
  const paths = resolvePackPaths(root);
  let pack: ContextPack;
  try {
    pack = readPack(paths);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(error instanceof Error ? error.message : String(error));
  }

  const { state } = pack;
  const fields = checkFields(state.goal, state.status, state.nextActions);
  const git = checkGit(state.git, gitRoot);

  return {
    root,
    dir: paths.dir,
    status: state.status,
    blockers: state.blockers,
    fields,
    git,
    ok: fields.ok && git.kind === "match_clean",
  };
}

function checkFields(goal: string, status: ProgressStatus, nextActions: string[]): ValidateResult["fields"] {
  const issues: FieldIssue[] = [];
  if (goal.trim() === "") {
    issues.push({
      field: "goal",
      message: "goal is blank",
      advice: `edit ${STATE_FILE} and set "goal" to a nonblank one-line summary of what the next agent must achieve`,
    });
  }
  if (status !== "completed" && !nextActions.some((a) => a.trim() !== "")) {
    issues.push({
      field: "nextActions",
      message: `nextActions has no nonblank entry (required unless status is "completed"; status is "${status}")`,
      advice: `edit ${STATE_FILE} and add at least one concrete step to "nextActions"`,
    });
  }
  return { ok: issues.length === 0, issues };
}

function checkGit(stored: GitState, gitRoot: string | undefined): GitCheck {
  const base = { stored, changedFields: [] as StableGitField[], missingFields: [] as StableGitField[] };
  if (gitRoot === undefined) return { kind: "no_repository", ...base };
  if (stored.headState === undefined && stored.branch === undefined && stored.head === undefined) {
    return { kind: "not_captured", ...base };
  }

  let current: GitState;
  try {
    current = captureGitState(gitRoot);
  } catch (error) {
    if (error instanceof GitError) throw new StorageError(`git read failed: ${error.message}`);
    throw error;
  }

  const changedFields: StableGitField[] = [];
  const missingFields: StableGitField[] = [];
  for (const field of STABLE_GIT_FIELDS) {
    if (!(field in stored)) {
      // These absences are part of the capture format, not legacy data.
      if (field === "head" && stored.headState === "unborn") continue;
      if (field === "branch" && stored.headState === "detached") continue;
      missingFields.push(field);
      continue;
    }
    if (canonical(stored[field]) !== canonical(current[field])) changedFields.push(field);
  }

  const result = { ...base, changedFields, missingFields, current };
  if (changedFields.length > 0) return { kind: "changed", ...result };
  if (missingFields.length > 0) return { kind: "incomplete", ...result };
  return { kind: stored.clean === true ? "match_clean" : "match_dirty", ...result };
}

/** JSON with object keys sorted so equal snapshots compare equal regardless of key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function renderValidate(result: ValidateResult): string {
  const lines: string[] = [];
  lines.push(`ctxpack validate: ${result.ok ? "PASS" : "FAIL"}`);
  lines.push(`Pack: ${path.relative(result.root, result.dir) || PACK_DIR}/ in ${result.root}`);
  lines.push("");

  lines.push("Required fields:");
  if (result.fields.ok) {
    lines.push("  ok    goal is set");
    lines.push(
      result.status === "completed"
        ? "  ok    nextActions not required (status is completed)"
        : "  ok    nextActions has at least one nonblank entry",
    );
  } else {
    for (const issue of result.fields.issues) {
      lines.push(`  FAIL  ${issue.message}`);
      lines.push(`        next: ${issue.advice}`);
    }
  }
  lines.push("");

  lines.push(`Progress: ${result.status.toUpperCase()}`);
  if (result.status === "blocked" || result.blockers.length > 0) {
    lines.push(
      `  ${result.blockers.length} recorded blocker(s); recorded blockers are legitimate handoff state, not a validation failure`,
    );
  }
  lines.push("");

  lines.push(`Git snapshot: ${describeGit(result.git)}`);
  for (const note of gitNotes(result.git)) lines.push(`  ${note}`);
  lines.push("");

  lines.push(`Result: ${result.ok ? "PASS" : "FAIL"} — ${verdict(result)}`);
  return lines.join("\n") + "\n";
}

function describeGit(git: GitCheck): string {
  const where = (g: GitState | undefined) =>
    g === undefined
      ? ""
      : g.headState === "unborn"
        ? ` (${g.branch ?? "(unknown)"}, no commits yet)`
        : g.headState === "detached"
          ? ` (detached HEAD at ${g.head?.slice(0, 12)})`
          : ` (${g.branch ?? "(unknown)"} @ ${g.head?.slice(0, 12) ?? "(unknown)"})`;
  switch (git.kind) {
    case "no_repository":
      return "not inside a Git work tree; the snapshot cannot be compared";
    case "not_captured":
      return "not captured";
    case "changed":
      return `changed metadata: ${git.changedFields.join(", ")}`;
    case "incomplete":
      return `incomplete legacy snapshot: missing ${git.missingFields.join(", ")}`;
    case "match_clean":
      return `matching clean metadata${where(git.stored)}`;
    case "match_dirty":
      return `matching dirty metadata${where(git.stored)}: ${git.stored.changedFiles?.length ?? 0} uncommitted file(s)`;
  }
}

function gitNotes(git: GitCheck): string[] {
  switch (git.kind) {
    case "no_repository":
      return ["next: run ctxpack inside the Git repository that owns this .ctxpack/ directory"];
    case "not_captured":
      return ["next: run `ctxpack capture` before handing off"];
    case "changed":
      return [
        ...git.changedFields.map((f) => `${f}: stored ${short(git.stored[f])} -> current ${short(git.current?.[f])}`),
        "next: review the difference, then run `ctxpack capture` to refresh the snapshot",
      ];
    case "incomplete":
      return [
        "the known fields match the current work tree, but this snapshot predates the full capture format",
        "next: run `ctxpack capture` to record a complete snapshot",
      ];
    case "match_clean":
      return [
        "metadata consistency only: this is not proof of semantic freshness, complete context or current verification",
        "manifest.updatedAt is the pack update time, not a trustworthy capture age",
      ];
    case "match_dirty":
      return [
        "review needed: filenames and diff counts cannot prove that uncommitted file contents are unchanged",
        "next: commit or stash the work, or re-check the listed files by hand, then run `ctxpack capture`",
      ];
  }
}

function verdict(result: ValidateResult): string {
  const reasons: string[] = [];
  if (!result.fields.ok) reasons.push(`${result.fields.issues.length} required field issue(s)`);
  switch (result.git.kind) {
    case "match_clean":
      break;
    case "match_dirty":
      reasons.push("dirty snapshot requires review");
      break;
    case "changed":
      reasons.push("Git metadata changed since capture");
      break;
    case "incomplete":
      reasons.push("Git snapshot incomplete");
      break;
    case "not_captured":
      reasons.push("Git state not captured");
      break;
    case "no_repository":
      reasons.push("not a Git repository");
      break;
  }
  if (reasons.length === 0) return "required fields present and the clean Git snapshot matches the work tree";
  return reasons.join("; ") + " (see next steps above)";
}

function short(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (typeof value === "string") return value.length > 12 && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 12) : value;
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === "object" && value !== null && "staged" in value && "unstaged" in value) {
    const s = value as GitState["stat"] & object;
    return `staged ${s.staged.files}f +${s.staged.insertions} -${s.staged.deletions}, unstaged ${s.unstaged.files}f +${s.unstaged.insertions} -${s.unstaged.deletions}`;
  }
  return JSON.stringify(value);
}
