import path from "node:path";
import type { ContextPack, GitState } from "../schema/index.js";
import { StorageError, findGitRoot, readPack, resolvePackPaths } from "../storage/index.js";

export interface StatusOptions {
  cwd: string;
}

export function loadStatus(options: StatusOptions): ContextPack {
  const root = findGitRoot(options.cwd) ?? path.resolve(options.cwd);
  const paths = resolvePackPaths(root);
  try {
    return readPack(paths);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(error instanceof Error ? error.message : String(error));
  }
}

export function renderStatus(pack: ContextPack): string {
  const { manifest, state } = pack;
  const lines: string[] = [];
  lines.push(`Project: ${manifest.project} (ctxpack ${manifest.version}, schema v${manifest.schemaVersion})`);
  lines.push(`Updated: ${manifest.updatedAt}`);
  lines.push("");
  lines.push("Goal:");
  lines.push(`  ${state.goal || "(not set)"}`);
  lines.push("");
  lines.push(`Status: ${state.status.toUpperCase()}`);
  lines.push("");
  lines.push(section("Completed", state.completed));
  lines.push(section("Current tasks", state.currentTasks));
  lines.push(section("Blockers", state.blockers));
  lines.push(section("Next actions", state.nextActions, true));
  lines.push(section("Relevant files", state.relevantFiles));
  lines.push(
    section(
      "Verification",
      state.verification.map((v) => `${v.name}: ${v.result.toUpperCase()}${v.detail ? ` (${v.detail})` : ""}`),
    ),
  );
  lines.push(renderGit(state.git));
  return lines.join("\n").trimEnd() + "\n";
}

function renderGit(git: GitState): string {
  if (git.headState === undefined && git.branch === undefined && git.head === undefined) {
    return "Git:\n  (not captured; run `ctxpack capture`)\n";
  }
  const out: string[] = ["Git:"];
  if (git.branch !== undefined) out.push(`  Branch: ${git.branch}`);
  if (git.headState !== undefined) out.push(`  HEAD state: ${git.headState}`);
  if (git.head !== undefined) out.push(`  HEAD: ${git.head}`);
  if (git.changedFiles !== undefined) out.push(`  Changed files: ${git.changedFiles.length}`);
  if (git.stat !== undefined) {
    const s = git.stat;
    out.push(`  Staged: ${s.staged.files} files, +${s.staged.insertions} -${s.staged.deletions}`);
    out.push(`  Unstaged: ${s.unstaged.files} files, +${s.unstaged.insertions} -${s.unstaged.deletions}`);
  }
  if (git.recentCommits !== undefined) {
    out.push(`  Recent commits (${git.recentCommits.length}):`);
    for (const c of git.recentCommits) out.push(`    ${c.shortSha} ${c.subject}`);
  }
  return out.join("\n") + "\n";
}

function section(title: string, items: string[], numbered = false): string {
  const body =
    items.length === 0
      ? "  (none)"
      : items.map((item, i) => (numbered ? `  ${i + 1}. ${item}` : `  - ${item}`)).join("\n");
  return `${title} (${items.length}):\n${body}\n`;
}
