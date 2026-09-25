/**
 * Pure frame renderer for `ctxpack ui` (M7). Turns `UiState` into an array of terminal rows
 * (exactly `rows` lines, each `cols` display cells wide) — no I/O, fully testable.
 * Wide terminals (>= 100 cols) get a left navigation column; narrow terminals get a section
 * strip so 80x24 stays readable. Paint roles go through `Painter`, so every layout works
 * identically at color levels none/16/256/truecolor.
 */
import { adapterNames, resolveAdapter } from "../adapters/index.js";
import { BudgetExceededError, estimateTokens, renderWithinBudget } from "../adapters/budget.js";
import type { Painter, Spec } from "./ansi.js";
import { padEnd, textWidth, truncate } from "./ansi.js";
import { gitSummary, type UiModel, type Screen } from "./model.js";

export const MIN_COLS = 40;
export const MIN_ROWS = 10;
/** Below this width the nav column collapses into a one-line section strip. */
export const WIDE_COLS = 100;

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "progress", label: "Progress" },
  { id: "decisions", label: "Decisions" },
  { id: "failures", label: "Failures" },
  { id: "blockers", label: "Blockers" },
  { id: "next", label: "Next actions" },
  { id: "verify", label: "Verification" },
  { id: "files", label: "Files" },
  { id: "git", label: "Git" },
  { id: "handoff", label: "Handoff" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export interface Overlay {
  action: "capture" | "init";
  title: string;
  lines: string[];
}

export interface Message {
  text: string;
  tone: "info" | "ok" | "error";
}

export interface UiState {
  screen: Screen;
  section: number;
  focus: "nav" | "detail";
  scroll: number;
  previewTarget: string;
  previewBudget: number;
  overlay: Overlay | undefined;
  message: Message | undefined;
  cols: number;
  rows: number;
}

interface Cell {
  t: string;
  s?: Spec;
}
type Row = Cell[];

const cell = (t: string, s?: Spec): Cell => (s === undefined ? { t } : { t, s });

function paintRow(row: Row, width: number, painter: Painter): string {
  let out = "";
  let used = 0;
  for (const c of row) {
    const avail = width - used;
    if (avail <= 0) break;
    const text = truncate(c.t, avail);
    out += c.s === undefined ? text : painter.apply(text, c.s);
    used += textWidth(text);
  }
  return out + " ".repeat(Math.max(0, width - used));
}

function hbar(left: Row, right: Row, width: number): Row {
  const leftW = left.reduce((n, c) => n + textWidth(c.t), 0);
  const rightW = right.reduce((n, c) => n + textWidth(c.t), 0);
  const gap = Math.max(1, width - leftW - rightW);
  return [...left, cell(" ".repeat(gap)), ...right];
}

function hline(width: number, unicode: boolean): Row {
  return [cell((unicode ? "─" : "-").repeat(width), "muted")];
}

function itemRows(items: string[], marker: string, spec: Spec | undefined, empty = "(not recorded)"): Row[] {
  if (items.length === 0) return [[cell("  "), cell(empty, "muted")]];
  return items.map((item) => [cell(`  ${marker} `), cell(item, spec)]);
}

function statusBadgeSpec(status: string): Spec {
  switch (status) {
    case "in_progress":
      return "badgeMint";
    case "blocked":
      return "badgeDanger";
    case "completed":
      return "badgeAccent";
    default:
      return "badgeMuted";
  }
}

function mMark(painter: Painter): Row {
  if (painter.unicode) {
    return [cell("▐M▌", "mark"), cell("●", "mint")];
  }
  return [cell(" M ", "mark"), cell("*", "mint")];
}

function countFor(id: SectionId, model: UiModel): string {
  switch (id) {
    case "progress":
      return `${model.completed.length}+${model.currentTasks.length}`;
    case "decisions":
      return `${model.decisions.entries?.length ?? 0}`;
    case "failures":
      return `${model.failures.entries?.length ?? 0}`;
    case "blockers":
      return `${model.blockers.length}`;
    case "next":
      return `${model.nextActions.length}`;
    case "verify":
      return `${model.verification.length}`;
    case "files":
      return `${model.relevantFiles.length}`;
    default:
      return "";
  }
}

function titleRow(label: string, scroll: number, total: number, height: number, width: number, unicode: boolean): Row {
  const fill = unicode ? "─" : "-";
  const right: Row =
    total > height ? [cell(`${Math.min(total, scroll + height)}/${total}`, "muted")] : [];
  const left: Row = [cell(` ${label} `, "title")];
  const lw = textWidth(label) + 2;
  const rw = right.reduce((n, c) => n + textWidth(c.t), 0);
  return [...left, cell(fill.repeat(Math.max(1, width - lw - rw - 1)), "muted"), cell(" "), ...right];
}

/** Rows for the detail pane of the currently selected section. */
export function detailRows(state: UiState, painter: Painter): Row[] {
  if (state.screen.kind !== "pack") return errorRows(state.screen, painter);
  const model = state.screen.model;
  const section = SECTIONS[state.section]?.id ?? "overview";
  switch (section) {
    case "overview":
      return overviewRows(model);
    case "progress":
      return progressRows(model, painter);
    case "decisions":
      return decisionRows(model);
    case "failures":
      return failureRows(model);
    case "blockers":
      return itemRows(model.blockers, painter.unicode ? "▲" : "!", "danger");
    case "next":
      return model.nextActions.length === 0
        ? [[cell("  "), cell("(not recorded)", "muted")]]
        : model.nextActions.map((item, i) => [cell(`  ${i + 1}. `, "accent"), cell(item)]);
    case "verify":
      return verifyRows(model, painter);
    case "files":
      return itemRows(model.relevantFiles, "-", undefined);
    case "git":
      return gitRows(model, painter);
    case "handoff":
      return handoffRows(state, painter); // painter unused inside; kept for symmetry
  }
}

function overviewRows(model: UiModel): Row[] {
  const rows: Row[] = [
    [cell("  Project   ", "muted"), cell(model.project, "paper")],
    [cell("  ctxpack   ", "muted"), cell(`${model.version} · schema v${model.schemaVersion}`)],
    [cell("  Updated   ", "muted"), cell(model.updatedAt)],
    [cell("  Pack      ", "muted"), cell(`${model.packDir}/ (${model.root})`)],
    [],
    [cell("  Goal", "title")],
    [cell("    " + (model.goal || "(not recorded)"), model.goal ? "paper" : "muted")],
    [],
    [cell("  Git       ", "muted"), cell(gitSummary(model.git))],
  ];
  return rows;
}

function progressRows(model: UiModel, painter: Painter): Row[] {
  const done = painter.unicode ? "✓" : "x";
  const rows: Row[] = [
    [cell(` Completed (${model.completed.length})`, "title")],
    ...itemRows(model.completed, done, "accent"),
    [],
    [cell(` Current tasks (${model.currentTasks.length})`, "title")],
    ...itemRows(model.currentTasks, painter.unicode ? "▸" : ">", "paper"),
  ];
  return rows;
}

function decisionRows(model: UiModel): Row[] {
  const rows: Row[] = [];
  const entries = model.decisions.entries;
  if (entries === undefined) {
    rows.push([cell("  decisions.md not present", "muted")]);
  } else if (entries.length === 0) {
    rows.push([cell("  (not recorded)", "muted")]);
  } else {
    for (const d of entries) {
      rows.push([cell("  - "), cell(`[${d.date ?? "?"}]`, "mint"), cell(` ${d.summary}`)]);
      if (d.reason !== undefined) {
        rows.push([cell(`      reason: ${d.reason}`, "muted")]);
      }
    }
  }
  for (const note of model.decisions.notes) {
    rows.push([cell(`  ${note}`, "muted")]);
  }
  return rows;
}

function failureRows(model: UiModel): Row[] {
  const rows: Row[] = [];
  const entries = model.failures.entries;
  if (entries === undefined) {
    rows.push([cell("  failures.md not present", "muted")]);
  } else if (entries.length === 0) {
    rows.push([cell("  (not recorded)", "muted")]);
  } else {
    for (const f of entries) {
      rows.push([cell("  - "), cell(f.approach, "danger"), cell(`: ${f.result}`)]);
      if (f.reason !== undefined) {
        rows.push([cell(`      reason: ${f.reason}`, "muted")]);
      }
    }
  }
  for (const note of model.failures.notes) {
    rows.push([cell(`  ${note}`, "muted")]);
  }
  return rows;
}

function verifyRows(model: UiModel, painter: Painter): Row[] {
  if (model.verification.length === 0) return [[cell("  "), cell("(not recorded)", "muted")]];
  const ok = painter.unicode ? "✓" : "x";
  const bad = painter.unicode ? "✗" : "!";
  const unk = "?";
  return model.verification.map((v) => {
    const spec: Spec = v.result === "pass" ? "accent" : v.result === "fail" ? "danger" : "muted";
    const mark = v.result === "pass" ? ok : v.result === "fail" ? bad : unk;
    return [cell(`  ${mark} `, spec), cell(v.name), cell(` ${v.result.toUpperCase()}`, spec), cell(v.detail ? ` (${v.detail})` : "", "muted")];
  });
}

function gitRows(model: UiModel, painter: Painter): Row[] {
  const git = model.git;
  if (git.headState === undefined && git.branch === undefined && git.head === undefined) {
    return [
      [cell("  Git state not captured yet.", "muted")],
      [cell("  Press "), cell("c", "mint"), cell(" to run `ctxpack capture` (writes .ctxpack/state.json after confirmation).", "muted")],
    ];
  }
  const rows: Row[] = [];
  const kv = (label: string, value: string, spec?: Spec) =>
    rows.push([cell(`  ${label.padEnd(12)}`, "muted"), cell(value, spec)]);
  if (git.branch !== undefined) kv("Branch", git.branch, "mint");
  if (git.headState !== undefined) kv("HEAD state", git.headState);
  if (git.head !== undefined) kv("HEAD", git.head);
  if (git.clean !== undefined) kv("Clean", git.clean ? "yes" : "no", git.clean ? "accent" : "danger");
  if (git.stat !== undefined) {
    kv("Staged", `${git.stat.staged.files} files, +${git.stat.staged.insertions} -${git.stat.staged.deletions}`);
    kv("Unstaged", `${git.stat.unstaged.files} files, +${git.stat.unstaged.insertions} -${git.stat.unstaged.deletions}`);
  }
  const commits = git.recentCommits ?? [];
  if (commits.length > 0) {
    rows.push([]);
    rows.push([cell(` Recent commits (${commits.length})`, "title")]);
    for (const c of commits) {
      rows.push([cell("  " + c.shortSha, "mint"), cell(" " + c.subject), cell(` (${c.author}, ${c.date})`, "muted")]);
    }
  }
  const files = git.changedFiles ?? [];
  if (files.length > 0) {
    rows.push([]);
    rows.push([cell(` Changed files (${files.length})`, "title")]);
    for (const f of files) {
      rows.push([cell("  " + (painter.unicode ? "•" : "*"), "muted"), cell(" " + f)]);
    }
  }
  return rows;
}

function handoffRows(state: UiState, _painter: Painter): Row[] {
  void _painter;
  if (state.screen.kind !== "pack") return [];
  const targets = adapterNames();
  const tabs = targets
    .map((name, i) => `${i + 1} ${name}`)
    .join("   ");
  const header: Row[] = [
    [cell(` targets: `, "muted"), cell(tabs, "mint")],
    [
      cell("  preview: ", "muted"),
      cell(`ctxpack handoff --to ${state.previewTarget}`, "paper"),
      cell(` --budget ${state.previewBudget}`, "paper"),
      cell("  (byte-identical to the CLI command)", "muted"),
    ],
    [],
  ];
  const adapter = resolveAdapter(state.previewTarget);
  let body: string;
  try {
    body = renderWithinBudget(adapter, state.screen.input, state.previewBudget);
  } catch (error) {
    const message =
      error instanceof BudgetExceededError
        ? error.message
        : `cannot render handoff: ${error instanceof Error ? error.message : String(error)}`;
    return [...header, [cell(`  ${message}`, "danger")]];
  }
  const est = estimateTokens(body);
  header[1]!.push(cell(`   ~${est}/${state.previewBudget} est. tokens`, "mint"));
  const lines = body.replace(/\n$/, "").split("\n");
  for (const line of lines) {
    header.push([cell(line === "" ? " " : line)]);
  }
  return header;
}

function errorRows(screen: Screen, _painter: Painter): Row[] {
  void _painter;
  switch (screen.kind) {
    case "nogit":
      return [
        [cell("  Not a Git repository", "danger")],
        [cell(`  ${screen.cwd}`, "muted")],
        [],
        [cell("  ctxpack ui reads .ctxpack/ inside a Git work tree.", "muted")],
        [cell("  cd into a repository (or `git init` + `ctxpack init`) and run again.", "muted")],
      ];
    case "nopack":
      return [
        [cell("  No .ctxpack/ found", "danger")],
        [cell(`  ${screen.root}`, "muted")],
        [],
        [cell("  Press "), cell("i", "mint"), cell(" to run `ctxpack init` here (writes .ctxpack/ after confirmation),", "muted")],
        [cell("  or run `ctxpack init` from a terminal. Existing files are never overwritten.", "muted")],
      ];
    case "broken":
      return [
        [cell("  .ctxpack/ state is invalid", "danger")],
        [],
        ...screen.message.split("\n").map((line) => [cell(`  ${line}`, "muted")] as Row),
        [],
        [cell("  Fix the file or restore it, then press "), cell("r", "mint"), cell(" to reload.", "muted")],
        [cell("  Nothing was modified; `ctxpack init` never overwrites existing files.", "muted")],
      ];
    case "pack":
      return [];
  }
}

function navCount(id: SectionId, model: UiModel): string {
  return countFor(id, model);
}

function hints(state: UiState, unicode: boolean): Row {
  const parts: string[] = [];
  if (state.screen.kind === "pack" || state.screen.kind === "broken" || state.screen.kind === "nopack") {
    if (state.focus === "nav") {
      parts.push(unicode ? "↑/k ↓/j section" : "k/j section", unicode ? "Tab/→ open" : "Tab open", unicode ? "←/→ move" : "h/l move");
      if (state.screen.kind === "pack") {
        parts.push("1-4 target", "b budget", "c capture");
      }
      if (state.screen.kind !== "pack") parts.push("i init", "r reload");
      parts.push("q quit");
    } else {
      parts.push(unicode ? "↑↓/jk scroll" : "j/k scroll", "PgUp/PgDn page", unicode ? "Esc/← back" : "Esc/h back", "q quit");
    }
  } else {
    parts.push("q quit");
  }
  return [cell(` ${parts.join("  ·  ")}`, "muted")];
}

/** Renders the full frame: exactly `rows` lines, each `cols` cells wide. */
export function renderFrame(state: UiState, painter: Painter): string[] {
  const { cols, rows } = state;
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    const out = new Array<string>(rows).fill(" ".repeat(cols));
    const msg = `terminal too small (${cols}x${rows})`;
    const need = `need ≥ ${MIN_COLS}x${MIN_ROWS}`;
    const y = Math.max(0, Math.floor(rows / 2) - 1);
    const place = (line: string, at: number, spec: Spec) => {
      if (at < rows && cols > textWidth(line)) {
        out[at] = paintRow([cell(" ".repeat(Math.floor((cols - textWidth(line)) / 2)) + line, spec)], cols, painter);
      }
    };
    place(msg, y, "danger");
    place(need, y + 1, "muted");
    return out;
  }

  const frame: string[] = [];
  const screen = state.screen;
  const model = screen.kind === "pack" ? screen.model : undefined;

  // Row 0: header — M mark, app name, project, status badge on the right.
  const headerLeft: Row = [
    cell(" "),
    ...mMark(painter),
    cell(" ctxpack ui", "bold"),
  ];
  if (model !== undefined) headerLeft.push(cell("  ·  "), cell(model.project, "paper"));
  const headerRight: Row =
    model === undefined
      ? [cell("not initialized", "badgeMuted"), cell(" ")]
      : [cell(model.status.toUpperCase(), statusBadgeSpec(model.status)), cell(" ")];
  frame.push(paintRow(hbar(headerLeft, headerRight, cols), cols, painter));

  // Row 1: hairline separator.
  frame.push(paintRow(hline(cols, painter.unicode), cols, painter));

  const bodyHeight = rows - 4;
  const wide = cols >= WIDE_COLS;
  const all = detailRows(state, painter);
  const maxScroll = Math.max(0, all.length - (bodyHeight - (wide ? 1 : 2)));
  const scroll = Math.max(0, Math.min(state.scroll, maxScroll));
  const visible = all.slice(scroll, scroll + bodyHeight - (wide ? 1 : 2));
  const title = SECTIONS[state.section]?.label ?? "?";

  const detailHeight = bodyHeight - (wide ? 1 : 2);
  const detailWidth = wide ? cols - 26 : cols;
  const detailLines: Row[] = [
    titleRow(title, scroll, all.length, detailHeight, detailWidth, painter.unicode),
    ...visible,
  ];

  if (wide) {
    // Left nav column (24 cells) + separator + detail.
    const navW = 25;
    for (let i = 0; i < bodyHeight; i++) {
      const navRow: Row =
        i < SECTIONS.length && model !== undefined ? navLine(i, state, model) : [];
      const d = detailLines[i] ?? [];
      const line =
        paintRow(navRow, navW, painter) +
        paintRow([cell(painter.unicode ? "│" : "|", "muted")], 1, painter) +
        paintRow(d, cols - navW - 1, painter);
      frame.push(line);
    }
  } else {
    // Section strip on the first body row, then detail.
    const strip: Row = [
      cell(" ", "muted"),
      cell(painter.unicode ? "◂" : "<", "accent"),
      cell(` ${state.section + 1}/${SECTIONS.length} `, "muted"),
      cell(title, "title"),
      cell(painter.unicode ? " ▸" : " >", "accent"),
    ];
    for (let i = 0; i < bodyHeight; i++) {
      if (i === 0) {
        frame.push(paintRow(strip, cols, painter));
      } else {
        frame.push(paintRow(detailLines[i - 1] ?? [], cols, painter));
      }
    }
  }

  // Footer separator + hints/message.
  frame.push(paintRow(hline(cols, painter.unicode), cols, painter));
  if (state.message !== undefined) {
    const spec: Spec = state.message.tone === "error" ? "danger" : state.message.tone === "ok" ? "accent" : "muted";
    frame.push(paintRow([cell(` ${state.message.text}`, spec)], cols, painter));
  } else {
    frame.push(paintRow(hints(state, painter.unicode), cols, painter));
  }

  if (state.overlay !== undefined) overlay(frame, state.overlay, painter, cols);
  return frame;
}

function navLine(i: number, state: UiState, model: UiModel): Row {
  const def = SECTIONS[i];
  if (def === undefined) return [];
  const selected = i === state.section;
  const count = navCount(def.id, model);
  const label = truncate(` ${def.label}`, 21);
  const padded = padEnd(label, 21);
  const row: Row = selected
    ? [cell(padded, "selected")]
    : [cell(padded, state.focus === "nav" ? "paper" : "muted")];
  if (count !== "") row.push(cell(padEnd(count, 4), "muted"));
  return row;
}

/** Paints a centered bordered overlay into the frame (write-action confirmations). */
function overlay(frame: string[], box: Overlay, painter: Painter, cols: number): void {
  const inner = Math.min(cols - 6, 62);
  if (inner < 20) return; // too small to draw a box; nothing is confirmed without it
  const u = painter.unicode;
  const tl = u ? "╭" : "+";
  const tr = u ? "╮" : "+";
  const bl = u ? "╰" : "+";
  const br = u ? "╯" : "+";
  const hz = u ? "─" : "-";
  const vt = u ? "│" : "|";
  const title = ` ${box.title} `;
  const leftPad = Math.max(0, Math.floor((inner - textWidth(title)) / 2));
  const top = tl + hz.repeat(leftPad) + title + hz.repeat(inner - leftPad - textWidth(title)) + tr;
  const rows: Row[] = [[cell(top, "muted")]];
  const spacer: Row = [cell(vt, "muted"), cell(" ".repeat(inner)), cell(vt, "muted")];
  rows.push(spacer);
  for (const l of box.lines) {
    for (const chunk of wrap(l, inner - 2)) {
      rows.push([cell(vt, "muted"), cell(" " + padEnd(chunk, inner - 2) + " "), cell(vt, "muted")]);
    }
  }
  rows.push(spacer);
  rows.push([cell(bl + hz.repeat(inner) + br, "muted")]);
  const boxW = inner + 2;
  const left = Math.max(0, Math.floor((cols - boxW) / 2));
  const start = Math.max(1, Math.floor((frame.length - rows.length) / 2));
  for (let i = 0; i < rows.length && start + i < frame.length; i++) {
    const painted = paintRow(rows[i] ?? [], boxW, painter);
    frame[start + i] = " ".repeat(left) + painted + " ".repeat(Math.max(0, cols - left - boxW));
  }
}

function wrap(text: string, width: number): string[] {
  if (textWidth(text) <= width) return [text];
  const out: string[] = [];
  let line = "";
  let used = 0;
  for (const word of text.split(" ")) {
    const w = textWidth(word) + (line === "" ? 0 : 1);
    if (used + w > width && line !== "") {
      out.push(line);
      line = word;
      used = textWidth(word);
    } else {
      line = line === "" ? word : line + " " + word;
      used += w;
    }
  }
  if (line !== "") out.push(line);
  return out;
}
