/**
 * Read-side model for `ctxpack ui` (M7). Reuses the exact same loaders as the CLI so the TUI
 * never re-implements validation: `loadHandoff` gives a schema-checked pack plus the raw
 * Markdown, and the same parsers used by `handoff` extract decisions/failures for display.
 */
import path from "node:path";
import {
  loadHandoff,
  parseDecisions,
  parseFailures,
  stripTemplate,
  type Decision,
  type Failure,
  type HandoffInput,
} from "../core/handoff.js";
import type { GitState, ProgressStatus, Verification } from "../schema/index.js";
import { findGitRoot, packExists, resolvePackPaths } from "../storage/index.js";

export interface UiModel {
  root: string;
  /** Repo-relative pack dir, always ".ctxpack" today. */
  packDir: string;
  project: string;
  version: string;
  schemaVersion: number;
  updatedAt: string;
  goal: string;
  status: ProgressStatus;
  completed: string[];
  currentTasks: string[];
  blockers: string[];
  nextActions: string[];
  relevantFiles: string[];
  verification: Verification[];
  projectNotes: string[];
  decisions: { entries: Decision[] | undefined; notes: string[] };
  failures: { entries: Failure[] | undefined; notes: string[] };
  git: GitState;
}

export type Screen =
  | { kind: "pack"; root: string; input: HandoffInput; model: UiModel }
  | { kind: "nogit"; cwd: string }
  | { kind: "nopack"; root: string }
  | { kind: "broken"; root: string; message: string };

/** Loads the current screen; never writes anything. */
export function loadScreen(cwd: string): Screen {
  const root = findGitRoot(cwd);
  if (root === undefined) {
    return { kind: "nogit", cwd: path.resolve(cwd) };
  }
  const paths = resolvePackPaths(root);
  if (!packExists(paths)) {
    return { kind: "nopack", root };
  }
  try {
    const input = loadHandoff({ cwd });
    return { kind: "pack", root, input, model: toModel(root, input) };
  } catch (error) {
    return {
      kind: "broken",
      root,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function toModel(root: string, input: HandoffInput): UiModel {
  const { manifest, state } = input.pack;
  const { markdown } = input;
  const decisions = markdown.decisions === undefined ? undefined : parseDecisions(markdown.decisions);
  const failures = markdown.failures === undefined ? undefined : parseFailures(markdown.failures);
  return {
    root,
    packDir: path.basename(resolvePackPaths(root).dir),
    project: manifest.project,
    version: manifest.version,
    schemaVersion: manifest.schemaVersion,
    updatedAt: manifest.updatedAt,
    goal: state.goal.trim(),
    status: state.status,
    completed: state.completed,
    currentTasks: state.currentTasks,
    blockers: state.blockers,
    nextActions: state.nextActions,
    relevantFiles: state.relevantFiles,
    verification: state.verification,
    projectNotes: markdown.project === undefined ? [] : stripTemplate(markdown.project, "project"),
    decisions: { entries: decisions?.entries, notes: decisions?.notes ?? [] },
    failures: { entries: failures?.entries, notes: failures?.notes ?? [] },
    git: state.git,
  };
}

/** One-line Git summary for the header/overview; "(not captured)" before the first capture. */
export function gitSummary(git: GitState): string {
  if (git.headState === undefined && git.branch === undefined && git.head === undefined) {
    return "git: not captured (press c to run ctxpack capture)";
  }
  const where =
    git.headState === "unborn"
      ? `${git.branch ?? "?"} (no commits)`
      : git.headState === "detached"
        ? `detached @ ${git.head?.slice(0, 12) ?? "?"}`
        : `${git.branch} @ ${git.head?.slice(0, 12) ?? "?"}`;
  const clean = git.clean === undefined ? "" : git.clean ? " · clean" : ` · ${git.changedFiles?.length ?? "?"} changed`;
  return `${where}${clean}`;
}
