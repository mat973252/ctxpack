import type { HandoffInput } from "../core/handoff.js";
import {
  NOT_RECORDED,
  bullets,
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
 * Codex-flavored handoff: a flat, task-brief layout an agent can paste directly into a working
 * prompt. Failed approaches are highlighted up front so they are not re-tried; the rest of the
 * context follows as compact reference sections. Not an official Codex format.
 */
export function renderCodexHandoff(input: HandoffInput): string {
  const view = buildView(input);
  const blocks: string[] = [];

  blocks.push(
    `# Task Handoff — ${view.manifest.project} (ctxpack pack for a Codex session)\n\n` +
      `This document is the captured work state of another agent. It is read-only context, not a\n` +
      `specification of finished work: fields marked ${NOT_RECORDED} are unknown to the previous\n` +
      `agent, and nothing below is verified beyond what Verification records. Pack last updated:\n` +
      `${view.manifest.updatedAt}. Git facts are a snapshot from the last \`ctxpack capture\`,\n` +
      `not a live read — run \`git status\` yourself before relying on them.`,
  );

  const steps: string[] = [];
  if (view.status === "completed") {
    steps.push("- Confirm nothing remains: work below was marked COMPLETED, so verify rather than redo it.");
  } else {
    steps.push(
      `- Continue the in-flight work below (status ${view.status.toUpperCase()}) instead of restarting it.`,
    );
    steps.push("- Start with the first unchecked item under `## Next Actions`.");
  }
  steps.push("- Do NOT re-try approaches in `## Do Not Retry` — they already failed for the reasons given.");
  steps.push("- Treat anything failing under `## Verification` as unresolved until re-verified.");
  blocks.push(["## Instructions", "", ...steps].join("\n"));

  blocks.push(
    [
      "## Goal",
      "",
      view.goal || `${NOT_RECORDED} — .ctxpack/state.json has no goal.`,
      "",
      `Status: ${view.status.toUpperCase()}`,
    ].join("\n"),
  );

  blocks.push(["## Next Actions", "", ...numbered(view.nextActions)].join("\n"));

  const failureLines: string[] = [];
  if (view.failures.entries === undefined) {
    failureLines.push(`${NOT_RECORDED} — no failures.md in .ctxpack/.`);
  } else if (isSectionEmpty(view.failures)) {
    failureLines.push(`${NOT_RECORDED} — failures.md has no entries yet.`);
  } else {
    for (const f of view.failures.entries ?? []) {
      failureLines.push(`- ${f.approach} — FAILED: ${f.result}${f.reason ? ` (${f.reason})` : ""}`);
    }
    failureLines.push(...view.failures.notes);
  }
  blocks.push(["## Do Not Retry", "", ...failureLines].join("\n"));

  const ref: string[] = [
    "## Reference",
    "",
    "### Completed",
    ...bullets(view.completed),
    "",
    "### In progress",
    ...bullets(view.currentTasks),
    "",
    "### Blockers",
    ...bullets(view.blockers),
  ];
  const decisions = decisionLines(view.decisions);
  ref.push("", "### Decisions", ...decisions);
  if (view.projectNotes.length > 0) ref.push("", "### Project notes", ...view.projectNotes);
  blocks.push(ref.join("\n"));

  const ver: string[] = ["## Verification", ""];
  if (view.verification.length === 0) ver.push(NOT_RECORDED);
  else ver.push(...view.verification.map((v) => `- ${verificationLine(v)}`));
  blocks.push(ver.join("\n"));

  blocks.push(["## Relevant Files", "", ...bullets(view.relevantFiles)].join("\n"));

  const git: string[] = ["## Repo State (last capture)", ""];
  if (!hasGitCapture(view.git)) {
    git.push(`${NOT_RECORDED} — \`ctxpack capture\` has not run yet.`);
  } else {
    git.push(...gitFacts(view.git));
    if (view.git.changedFiles !== undefined && view.git.changedFiles.length > 0) {
      git.push("", `Changed files (${view.git.changedFiles.length}):`);
      git.push(...view.git.changedFiles.map((f) => `- ${f}`));
    }
    const commits = commitLines(view.git);
    if (commits.length > 0) git.push("", "Recent commits:", ...commits);
  }
  blocks.push(git.join("\n"));

  return blocks.join("\n\n") + "\n";
}

function decisionLines(section: Section<{ date?: string; summary: string; reason?: string }>): string[] {
  if (section.entries === undefined) return [`${NOT_RECORDED} — no decisions.md in .ctxpack/.`];
  if (isSectionEmpty(section)) return [`${NOT_RECORDED} — decisions.md has no entries yet.`];
  const lines = section.entries.map(
    (d) => `- ${d.summary}${d.reason ? ` — ${d.reason}` : ""}${d.date ? ` (${d.date})` : ""}`,
  );
  lines.push(...section.notes);
  return lines;
}
