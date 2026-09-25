import type { HandoffInput } from "../core/handoff.js";
import type { HandoffAdapter } from "./index.js";
import { buildView, type HandoffView } from "./view.js";

/**
 * Token-budget machinery for `ctxpack handoff` (M5).
 *
 * Estimator (deliberately simple and fully documented in README): an output's estimated
 * token count is `ceil(asciiChars / 4) + nonAsciiChars`. This is a deterministic character
 * heuristic — it is NOT any specific model's tokenizer. For typical English handoff text it
 * roughly tracks the common "~4 chars per token" rule of thumb; for non-ASCII text (e.g.
 * Chinese) it assumes ~1 token per character, which is closer to real tokenizers but still
 * approximate. Emoji and exotic scripts can be under- or over-counted. Treat the number as
 * an upper-bound-ish estimate, never as exact model tokens.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 128) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

export const DEFAULT_BUDGET = 4000;
export const COMPACT_BUDGET = 2000;
const ALL = Number.POSITIVE_INFINITY;

/**
 * Which content tier each field belongs to (see docs/devin-m5.md):
 * - Critical — never trimmed: goal, status, current tasks, blockers, next actions,
 *   failed approaches with reasons, failed verification entries. If these alone exceed the
 *   budget the command fails loudly instead of silently dropping them.
 * - Relevant — trimmed in bounded steps: decisions with reasons, completed items,
 *   relevant files, compact git facts (branch/HEAD/clean/stat), passing verification entries.
 * - Archive — dropped first: long freeform notes (project.md notes, verbatim decision/failure
 *   notes), recent commit history, and the full changed-file list.
 */
export interface BudgetPlan {
  /** Max items kept per field; Infinity = keep all. */
  projectNotes: number;
  decisionNotes: number;
  failureNotes: number;
  decisionEntries: number;
  completed: number;
  relevantFiles: number;
  recentCommits: number;
  /** Max passing verification entries kept; failing entries are always kept. */
  maxPassVerification: number;
  /** When false the whole changed-file list is dropped (header count stays truthful). */
  showChangedFiles: boolean;
  /** Whether inline "… N more omitted" markers may be emitted into lists. */
  markers: boolean;
}

/** Deterministic ladder from full output down to critical-only; first fitting plan wins. */
const PLANS: readonly BudgetPlan[] = [
  {
    projectNotes: ALL,
    decisionNotes: ALL,
    failureNotes: ALL,
    decisionEntries: ALL,
    completed: ALL,
    relevantFiles: ALL,
    recentCommits: ALL,
    maxPassVerification: ALL,
    showChangedFiles: true,
    markers: true,
  },
  {
    // Archive tier off: freeform notes, commit history, changed-file list.
    projectNotes: 0,
    decisionNotes: 0,
    failureNotes: 0,
    decisionEntries: ALL,
    completed: ALL,
    relevantFiles: ALL,
    recentCommits: 0,
    maxPassVerification: ALL,
    showChangedFiles: false,
    markers: true,
  },
  {
    projectNotes: 0,
    decisionNotes: 0,
    failureNotes: 0,
    decisionEntries: 6,
    completed: 8,
    relevantFiles: 8,
    recentCommits: 0,
    maxPassVerification: 10,
    showChangedFiles: false,
    markers: true,
  },
  {
    projectNotes: 0,
    decisionNotes: 0,
    failureNotes: 0,
    decisionEntries: 3,
    completed: 4,
    relevantFiles: 4,
    recentCommits: 0,
    maxPassVerification: 5,
    showChangedFiles: false,
    markers: true,
  },
  {
    // Critical-only: everything Relevant is omitted; Critical is never capped.
    projectNotes: 0,
    decisionNotes: 0,
    failureNotes: 0,
    decisionEntries: 0,
    completed: 0,
    relevantFiles: 0,
    recentCommits: 0,
    maxPassVerification: 0,
    showChangedFiles: false,
    markers: true,
  },
];

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface ResolvedBudget {
  budget: number;
  /** True when --budget was given and overrode --compact. */
  budgetOverridesCompact: boolean;
}

/**
 * Resolves the effective budget. `--budget` wins over `--compact` when both are given
 * (documented in --help and README). Invalid, zero, negative and non-integer values are
 * rejected so callers can exit non-zero with a clear diagnostic.
 */
export function resolveBudget(options: { compact?: boolean; budget?: string }): ResolvedBudget {
  const raw = options.budget;
  if (raw !== undefined) {
    if (!/^[0-9]+$/.test(raw.trim()) || BigInt(raw.trim()) === 0n) {
      throw new BudgetExceededError(
        `invalid --budget "${raw}": expected a positive integer number of estimated tokens`,
      );
    }
    const budget = Number(raw.trim());
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      throw new BudgetExceededError(
        `invalid --budget "${raw}": expected a positive integer number of estimated tokens`,
      );
    }
    return { budget, budgetOverridesCompact: options.compact === true };
  }
  return { budget: options.compact ? COMPACT_BUDGET : DEFAULT_BUDGET, budgetOverridesCompact: false };
}

interface Planned {
  view: HandoffView;
  /** Human-readable omission notes for the footer, e.g. "12 relevant file(s)". */
  omissions: string[];
}

function marker(dropped: number, label: string, hint: string): string {
  return `_… ${dropped} more ${label} omitted for the token budget — full list in ${hint}_`;
}

function capList(
  items: string[],
  cap: number,
  label: string,
  hint: string,
  markers: boolean,
  omissions: string[],
): string[] {
  if (items.length <= cap) return items;
  const dropped = items.length - cap;
  omissions.push(`${dropped} ${label}`);
  const kept = items.slice(0, cap);
  if (markers) kept.push(marker(dropped, label, hint));
  return kept;
}

function capNotes(
  notes: string[],
  cap: number,
  label: string,
  hint: string,
  markers: boolean,
  omissions: string[],
): string[] {
  return capList(notes, cap, label, hint, markers, omissions);
}

/** Applies a plan to a view: caps Relevant/Archive fields, records omissions. Never touches Critical. */
export function applyPlan(view: HandoffView, plan: BudgetPlan): Planned {
  const omissions: string[] = [];
  const out: HandoffView = {
    ...view,
    git: { ...view.git },
    decisions: { entries: view.decisions.entries, notes: [...view.decisions.notes] },
    failures: { entries: view.failures.entries, notes: [...view.failures.notes] },
  };

  out.projectNotes = capList(
    view.projectNotes,
    plan.projectNotes,
    "project note(s)",
    ".ctxpack/project.md",
    plan.markers,
    omissions,
  );

  const decisionEntries = view.decisions.entries;
  let cappedDecisionEntries = decisionEntries;
  if (decisionEntries !== undefined && decisionEntries.length > plan.decisionEntries) {
    const dropped = decisionEntries.length - plan.decisionEntries;
    omissions.push(`${dropped} decision(s)`);
    cappedDecisionEntries = decisionEntries.slice(0, plan.decisionEntries);
    if (plan.markers) {
      out.decisions.notes.push(marker(dropped, "decision(s)", ".ctxpack/decisions.md"));
    }
  }
  out.decisions.entries = cappedDecisionEntries;
  out.decisions.notes = capNotes(
    out.decisions.notes,
    plan.decisionNotes === 0 ? plan.decisionNotes : plan.decisionNotes,
    "decision note(s)",
    ".ctxpack/decisions.md",
    plan.markers,
    omissions,
  );

  // Failure entries (approach + result + reason) are Critical and never capped;
  // only the verbatim freeform notes are Archive content.
  out.failures.notes = capNotes(
    view.failures.notes,
    plan.failureNotes,
    "failure note(s)",
    ".ctxpack/failures.md",
    plan.markers,
    omissions,
  );

  out.completed = capList(
    view.completed,
    plan.completed,
    "completed item(s)",
    ".ctxpack/state.json",
    plan.markers,
    omissions,
  );
  out.relevantFiles = capList(
    view.relevantFiles,
    plan.relevantFiles,
    "relevant file(s)",
    ".ctxpack/state.json",
    plan.markers,
    omissions,
  );

  // Failed verification entries are Critical; passing entries are Relevant and capped.
  // Original ordering is preserved so a fitting plan renders identically to M4 output.
  if (view.verification.length > 0) {
    const failing = view.verification.filter((v) => v.result !== "pass");
    const passing = view.verification.filter((v) => v.result === "pass");
    const kept = new Set([...failing, ...passing.slice(0, plan.maxPassVerification)]);
    const dropped = passing.length - Math.min(passing.length, plan.maxPassVerification);
    out.verification = view.verification.filter((v) => kept.has(v));
    if (dropped > 0) {
      omissions.push(`${dropped} passing verification entr${dropped === 1 ? "y" : "ies"}`);
      if (out.verification.length === 0 && plan.markers) {
        // Keep one real entry so the section never misrenders as "(not recorded)".
        out.verification = [passing[0]!];
      }
    }
  }

  // Git facts (branch/HEAD/clean/stat) are small Relevant content and always kept.
  if (view.git.recentCommits !== undefined && view.git.recentCommits.length > plan.recentCommits) {
    const dropped = view.git.recentCommits.length - plan.recentCommits;
    omissions.push(`${dropped} recent commit(s)`);
    out.git.recentCommits = view.git.recentCommits.slice(0, plan.recentCommits);
  }
  if (!plan.showChangedFiles && view.git.changedFiles !== undefined && view.git.changedFiles.length > 0) {
    omissions.push(`changed-file list (${view.git.changedFiles.length} files)`);
    out.git.changedFiles = undefined;
  }

  return { view: out, omissions };
}

function budgetFooter(est: number, budget: number, omissions: string[]): string {
  const lines = [
    "---",
    `_ctxpack: ~${est}/${budget} est. tokens — chars/4 heuristic estimate, not any model's exact count (see README)._`,
  ];
  if (omissions.length > 0) {
    lines.push(`_Omitted for budget: ${omissions.join(", ")} — full state stays in .ctxpack/._`);
  }
  return "\n\n" + lines.join("\n") + "\n";
}

/**
 * Renders `input` within `budget` estimated tokens by walking the plan ladder.
 * Deterministic: same input + same budget → same output. Throws BudgetExceededError when even
 * the Critical-only plan exceeds the budget, telling the user to raise --budget.
 */
export function renderWithinBudget(
  adapter: HandoffAdapter,
  input: HandoffInput,
  budget: number,
): string {
  const fullView = buildView(input);
  let smallest: { est: number } | undefined;
  for (const plan of PLANS) {
    const { view, omissions } = applyPlan(fullView, plan);
    const body = adapter.renderView(view);
    // Fixed-point: the footer reports the estimate of the whole document including itself.
    let est = estimateTokens(body);
    let out = body;
    for (let i = 0; i < 4; i++) {
      out = body + budgetFooter(est, budget, omissions);
      const next = estimateTokens(out);
      if (next === est) break;
      est = next;
    }
    if (est <= budget) return out;
    smallest = { est };
  }
  throw new BudgetExceededError(
    `handoff needs ~${smallest?.est ?? "?"} est. tokens for Critical facts alone (goal, status, ` +
      `tasks, blockers, next actions, failed approaches, failed verification), but the budget is ` +
      `${budget}. Re-run with a larger --budget <n>.`,
  );
}
