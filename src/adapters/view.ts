import type { GitState, Manifest, ProgressStatus, Verification } from "../schema/index.js";
import {
  parseDecisions,
  parseFailures,
  stripTemplate,
  type Decision,
  type Failure,
  type HandoffInput,
} from "../core/handoff.js";

export const NOT_RECORDED = "(not recorded)";

/**
 * Format-neutral view of one validated ContextPack. Every adapter renders from this so the
 * three agent formats differ only in layout, never in which facts they carry.
 */
export interface HandoffView {
  manifest: Manifest;
  projectNotes: string[];
  goal: string;
  status: ProgressStatus;
  completed: string[];
  currentTasks: string[];
  decisions: Section<Decision>;
  failures: Section<Failure>;
  blockers: string[];
  nextActions: string[];
  relevantFiles: string[];
  verification: Verification[];
  git: GitState;
}

export interface Section<T> {
  /** `undefined` when the Markdown file does not exist at all. */
  entries: T[] | undefined;
  notes: string[];
}

export function buildView(input: HandoffInput): HandoffView {
  const { manifest, state } = input.pack;
  const { markdown } = input;
  const decisions = markdown.decisions === undefined ? undefined : parseDecisions(markdown.decisions);
  const failures = markdown.failures === undefined ? undefined : parseFailures(markdown.failures);
  return {
    manifest,
    projectNotes: markdown.project === undefined ? [] : stripTemplate(markdown.project, "project"),
    goal: state.goal.trim(),
    status: state.status,
    completed: state.completed,
    currentTasks: state.currentTasks,
    decisions: { entries: decisions?.entries, notes: decisions?.notes ?? [] },
    failures: { entries: failures?.entries, notes: failures?.notes ?? [] },
    blockers: state.blockers,
    nextActions: state.nextActions,
    relevantFiles: state.relevantFiles,
    verification: state.verification,
    git: state.git,
  };
}

export function isSectionEmpty<T>(section: Section<T>): boolean {
  return (section.entries?.length ?? 0) === 0 && section.notes.length === 0;
}

export function hasGitCapture(git: GitState): boolean {
  return git.headState !== undefined || git.branch !== undefined || git.head !== undefined;
}

export function bullets(items: string[], empty = NOT_RECORDED): string[] {
  if (items.length === 0) return [empty];
  return items.map((item) => `- ${item}`);
}

export function numbered(items: string[], empty = NOT_RECORDED): string[] {
  if (items.length === 0) return [empty];
  return items.map((item, i) => `${i + 1}. ${item}`);
}

export function verificationLine(v: Verification): string {
  return `${v.name}: ${v.result.toUpperCase()}${v.detail ? ` (${v.detail})` : ""}`;
}

/** Git facts as `Label: value` lines (no heading), or `[]` when `ctxpack capture` never ran. */
export function gitFacts(git: GitState): string[] {
  const lines: string[] = [];
  if (git.branch !== undefined) lines.push(`Branch: ${git.branch}`);
  if (git.headState !== undefined) lines.push(`HEAD state: ${git.headState}`);
  if (git.head !== undefined) lines.push(`HEAD: ${git.head}`);
  if (git.clean !== undefined) lines.push(`Clean: ${git.clean ? "yes" : "no"}`);
  if (git.stat !== undefined) {
    const { staged, unstaged } = git.stat;
    lines.push(`Staged: ${staged.files} files (+${staged.insertions} -${staged.deletions})`);
    lines.push(`Unstaged: ${unstaged.files} files (+${unstaged.insertions} -${unstaged.deletions})`);
  }
  return lines;
}

export function commitLines(git: GitState): string[] {
  return (git.recentCommits ?? []).map((c) => `- ${c.shortSha} ${c.subject} (${c.author}, ${c.date})`);
}
