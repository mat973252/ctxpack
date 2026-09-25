import type { HandoffInput } from "../core/handoff.js";
import {
  NOT_RECORDED,
  bullets,
  buildView,
  commitLines,
  gitFacts,
  hasGitCapture,
  isSectionEmpty,
  verificationLine,
  type HandoffView,
} from "./view.js";

/**
 * Claude Code-flavored handoff: a structured Markdown document — project brief up front,
 * checkpoints as a task list, constraints and pitfalls called out — mirroring the way a
 * handoff/brief file is usually written for a Claude Code session. Not an official format.
 */
export function renderClaudeHandoff(input: HandoffInput): string {
  return renderClaudeView(buildView(input));
}

/** View-based render used by the token-budget path; identical layout to renderClaudeHandoff. */
export function renderClaudeView(view: HandoffView): string {
  const blocks: string[] = [];

  blocks.push(
    `# Project Handoff — ${view.manifest.project}\n\n` +
      `> **Context for a Claude Code session.** Produced by \`ctxpack handoff --to claude\`\n` +
      `> (ctxpack ${view.manifest.version}, schema v${view.manifest.schemaVersion}) on behalf of the\n` +
      `> previous agent. Pack last updated: ${view.manifest.updatedAt}.`,
  );

  blocks.push(
    [
      "> **How to read this document**",
      ">",
      "> - This is a *handoff*: the state another agent captured mid-task, not a claim of done work.",
      `> - ${NOT_RECORDED} means "not recorded", never "verified" or "complete".`,
      "> - Verification entries record results at capture time; re-run anything you depend on.",
      "> - Git state is a snapshot of the last `ctxpack capture`, not a live `git status`.",
    ].join("\n"),
  );

  if (view.projectNotes.length > 0) {
    blocks.push(["## Project Brief", "", ...view.projectNotes].join("\n"));
  }

  blocks.push(
    ["## Objective", "", view.goal || `${NOT_RECORDED} — .ctxpack/state.json has no goal.`].join("\n"),
  );

  blocks.push(
    [
      "## Progress",
      "",
      `Status: ${view.status.toUpperCase()}`,
      "",
      "Completed:",
      ...bullets(view.completed),
      "",
      "In progress:",
      ...bullets(view.currentTasks),
    ].join("\n"),
  );

  blocks.push(
    [
      "## Next Steps",
      "",
      ...(view.nextActions.length === 0 ? [NOT_RECORDED] : view.nextActions.map((a) => `- [ ] ${a}`)),
    ].join("\n"),
  );

  blocks.push(renderDecisions(view).join("\n"));

  const pitfallLines: string[] = [];
  if (view.failures.entries === undefined) {
    pitfallLines.push(`${NOT_RECORDED} — no failures.md in .ctxpack/.`);
  } else if (isSectionEmpty(view.failures)) {
    pitfallLines.push(`${NOT_RECORDED} — failures.md has no entries yet.`);
  } else {
    for (const f of view.failures.entries ?? []) {
      pitfallLines.push(`- ${f.approach} — ${f.result}`);
      if (f.reason) pitfallLines.push(`  - Why it failed: ${f.reason}`);
    }
    pitfallLines.push(...view.failures.notes);
  }
  if (view.blockers.length > 0) {
    pitfallLines.push("", "Active blockers:");
    pitfallLines.push(...view.blockers.map((b) => `- ${b}`));
  } else {
    pitfallLines.push("", "Active blockers: (not recorded)");
  }
  blocks.push(["## Constraints & Pitfalls", "", ...pitfallLines].join("\n"));

  blocks.push(["## Key Files", "", ...bullets(view.relevantFiles)].join("\n"));

  const ver: string[] = ["## Verification Status", ""];
  if (view.verification.length === 0) ver.push(NOT_RECORDED);
  else ver.push(...view.verification.map((v) => `- ${verificationLine(v)}`));
  blocks.push(ver.join("\n"));

  const git: string[] = ["## Repository State (at last capture)", ""];
  if (!hasGitCapture(view.git)) {
    git.push(`${NOT_RECORDED} — \`ctxpack capture\` has not run yet.`);
  } else {
    git.push(...gitFacts(view.git));
    if (view.git.changedFiles !== undefined && view.git.changedFiles.length > 0) {
      git.push("", "Touched files:");
      git.push(...view.git.changedFiles.map((f) => `- \`${f}\``));
    }
    const commits = commitLines(view.git);
    if (commits.length > 0) git.push("", "Recent history:", ...commits);
  }
  blocks.push(git.join("\n"));

  return blocks.join("\n\n") + "\n";
}

function renderDecisions(view: HandoffView): string[] {
  const heading = "## Decisions & Rationale";
  if (view.decisions.entries === undefined)
    return [heading, "", `${NOT_RECORDED} — no decisions.md in .ctxpack/.`];
  const lines: string[] = [heading, ""];
  if (isSectionEmpty(view.decisions)) {
    lines.push(`${NOT_RECORDED} — decisions.md has no entries yet.`);
    return lines;
  }
  for (const d of view.decisions.entries) {
    lines.push(`- **${d.summary}**${d.date ? ` (${d.date})` : ""}`);
    if (d.reason) lines.push(`  - Rationale: ${d.reason}`);
  }
  if (view.decisions.notes.length > 0) lines.push("", ...view.decisions.notes);
  return lines;
}
