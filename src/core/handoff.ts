import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ContextPack } from "../schema/index.js";
import { StorageError, findGitRoot, readPack, resolvePackPaths, type PackPaths } from "../storage/index.js";
import { MARKDOWN_TEMPLATES } from "./init.js";

export interface HandoffOptions {
  cwd: string;
}

export type MarkdownKey = "project" | "decisions" | "failures" | "commands";

/** Raw text of the `.ctxpack/*.md` files; `undefined` when a file does not exist. */
export type PackMarkdown = Partial<Record<MarkdownKey, string>>;

export interface HandoffInput {
  pack: ContextPack;
  markdown: PackMarkdown;
}

export interface Decision {
  date?: string;
  summary: string;
  reason?: string;
}

export interface Failure {
  approach: string;
  result: string;
  reason?: string;
}

/** Structured entries parsed from a Markdown file plus every other non-template line kept verbatim. */
export interface ParsedMarkdown<T> {
  entries: T[];
  notes: string[];
}

const MARKDOWN_KEYS: readonly MarkdownKey[] = ["project", "decisions", "failures", "commands"];

/**
 * Reads `.ctxpack/` without modifying anything. Missing or invalid JSON fails with a StorageError;
 * missing Markdown files are tolerated and rendered as "not recorded".
 */
export function loadHandoff(options: HandoffOptions): HandoffInput {
  const root = findGitRoot(options.cwd) ?? path.resolve(options.cwd);
  const paths = resolvePackPaths(root);
  let pack: ContextPack;
  try {
    pack = readPack(paths);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(error instanceof Error ? error.message : String(error));
  }
  return { pack, markdown: readMarkdown(paths) };
}

function readMarkdown(paths: PackPaths): PackMarkdown {
  const markdown: PackMarkdown = {};
  for (const key of MARKDOWN_KEYS) {
    const file = paths[key];
    if (!existsSync(file)) continue;
    try {
      markdown[key] = readFileSync(file, "utf8");
    } catch (error) {
      throw new StorageError(
        `cannot read ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`,
        file,
      );
    }
  }
  return markdown;
}

const DECISION_RE = /^[-*]\s+\[(?<date>[^\]]+)\]\s+(?<rest>.+)$/;
const FAILURE_RE = /^[-*]\s+(?<approach>[^:]+):\s*(?<rest>.+)$/;
const REASON_SEPARATOR = /\s+(?:—|--)\s+/;

/** Parses `- [YYYY-MM-DD] <summary> — <reason>` items; other content is preserved in `notes`. */
export function parseDecisions(text: string): ParsedMarkdown<Decision> {
  return parseList(text, "decisions", (line) => {
    const m = DECISION_RE.exec(line);
    const groups = m?.groups;
    if (groups?.date === undefined || groups.rest === undefined) return undefined;
    const [summary, reason] = splitReason(groups.rest);
    return { date: groups.date.trim(), summary, ...(reason ? { reason } : {}) };
  });
}

/** Parses `- <approach>: <result> — <reason>` items; other content is preserved in `notes`. */
export function parseFailures(text: string): ParsedMarkdown<Failure> {
  return parseList(text, "failures", (line) => {
    const m = FAILURE_RE.exec(line);
    const groups = m?.groups;
    if (groups?.approach === undefined || groups.rest === undefined) return undefined;
    const [result, reason] = splitReason(groups.rest);
    return { approach: groups.approach.trim(), result, ...(reason ? { reason } : {}) };
  });
}

/** Drop only an unchanged initial template; matching text elsewhere belongs to the user. */
export function stripTemplate(text: string, key: MarkdownKey): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const template = MARKDOWN_TEMPLATES[key];
  const body = normalized.startsWith(template) ? normalized.slice(template.length) : normalized;
  const lines = body.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  return lines;
}

function parseList<T>(
  text: string,
  key: MarkdownKey,
  parseItem: (line: string) => T | undefined,
): ParsedMarkdown<T> {
  const entries: T[] = [];
  const notes: string[] = [];
  let fence: string | undefined;
  for (const line of stripTemplate(text, key)) {
    if (fence !== undefined) {
      notes.push(line);
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length) fence = undefined;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && !(opening[1]?.[0] === "`" && opening[2]?.includes("`"))) {
      fence = opening[1];
      notes.push(line);
      continue;
    }
    const entry = parseItem(line.trim());
    if (entry) entries.push(entry);
    else notes.push(line);
  }
  return { entries, notes };
}

function splitReason(rest: string): [string, string | undefined] {
  const idx = rest.search(REASON_SEPARATOR);
  if (idx < 0) return [rest.trim(), undefined];
  const sep = REASON_SEPARATOR.exec(rest.slice(idx));
  const head = rest.slice(0, idx).trim();
  const tail = rest.slice(idx + (sep?.[0].length ?? 0)).trim();
  return [head, tail || undefined];
}
