import path from "node:path";
import type { ContextPack } from "../schema/index.js";
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
  return lines.join("\n").trimEnd() + "\n";
}

function section(title: string, items: string[], numbered = false): string {
  const body =
    items.length === 0
      ? "  (none)"
      : items.map((item, i) => (numbered ? `  ${i + 1}. ${item}` : `  - ${item}`)).join("\n");
  return `${title} (${items.length}):\n${body}\n`;
}
