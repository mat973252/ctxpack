import type { HandoffInput } from "../core/handoff.js";
import {
  NOT_RECORDED,
  buildView,
  commitLines,
  gitFacts,
  hasGitCapture,
  isSectionEmpty,
  numbered,
  verificationLine,
  type Section,
} from "./view.js";

/**
 * Pi-flavored handoff: a compact single column of `KEY: value` fields plus short labeled lists,
 * sized to drop straight into a small terminal agent's prompt. Not an official Pi format.
 */
export function renderPiHandoff(input: HandoffInput): string {
  const view = buildView(input);
  const lines: string[] = [];

  lines.push(`CTXPACK HANDOFF — ${view.manifest.project} (for a pi session)`);
  lines.push("This is captured work state from another agent — a handoff, not a record of done work.");
  lines.push(`Fields marked ${NOT_RECORDED} are unrecorded, not verified. Updated: ${view.manifest.updatedAt}.`);
  lines.push("");

  lines.push(`GOAL: ${view.goal || `${NOT_RECORDED} — .ctxpack/state.json has no goal.`}`);
  lines.push(`STATUS: ${view.status.toUpperCase()}`);
  for (const note of view.projectNotes) lines.push(`PROJECT: ${note}`);

  pushList(lines, "DONE", view.completed);
  pushList(lines, "DOING", view.currentTasks);
  pushDecisions(lines, view.decisions);
  pushFailures(lines, view.failures);
  pushList(lines, "BLOCKED", view.blockers);

  lines.push("");
  lines.push("NEXT:");
  if (view.nextActions.length === 0) lines.push(`  ${NOT_RECORDED}`);
  else lines.push(...numbered(view.nextActions).map((n) => `  ${n}`));

  lines.push("");
  pushList(lines, "FILES", view.relevantFiles);

  lines.push("");
  lines.push("VERIFY:");
  if (view.verification.length === 0) lines.push(`  ${NOT_RECORDED}`);
  else lines.push(...view.verification.map((v) => `  - ${verificationLine(v)}`));

  lines.push("");
  lines.push("GIT (last capture, not live):");
  if (!hasGitCapture(view.git)) {
    lines.push(`  ${NOT_RECORDED} — \`ctxpack capture\` has not run yet.`);
  } else {
    lines.push(...gitFacts(view.git).map((g) => `  ${g}`));
    for (const f of view.git.changedFiles ?? []) lines.push(`  changed: ${f}`);
    lines.push(...commitLines(view.git).map((c) => `  ${c}`));
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function pushList(lines: string[], label: string, items: string[]): void {
  lines.push(`${label}:`);
  if (items.length === 0) lines.push(`  ${NOT_RECORDED}`);
  else lines.push(...items.map((i) => `  - ${i}`));
}

function pushDecisions(lines: string[], section: Section<{ date?: string; summary: string; reason?: string }>): void {
  lines.push("DECISIONS:");
  if (section.entries === undefined) lines.push(`  ${NOT_RECORDED} — no decisions.md in .ctxpack/.`);
  else if (isSectionEmpty(section)) lines.push(`  ${NOT_RECORDED} — decisions.md has no entries yet.`);
  else {
    for (const d of section.entries) {
      lines.push(`  - ${d.summary}${d.reason ? ` (why: ${d.reason})` : ""}${d.date ? ` [${d.date}]` : ""}`);
    }
    lines.push(...section.notes.map((n) => `  ${n}`));
  }
}

function pushFailures(lines: string[], section: Section<{ approach: string; result: string; reason?: string }>): void {
  lines.push("FAILED (do not retry):");
  if (section.entries === undefined) lines.push(`  ${NOT_RECORDED} — no failures.md in .ctxpack/.`);
  else if (isSectionEmpty(section)) lines.push(`  ${NOT_RECORDED} — failures.md has no entries yet.`);
  else {
    for (const f of section.entries) {
      lines.push(`  - ${f.approach} → ${f.result}${f.reason ? ` (why: ${f.reason})` : ""}`);
    }
    lines.push(...section.notes.map((n) => `  ${n}`));
  }
}
