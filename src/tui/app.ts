/**
 * Interactive loop for `ctxpack ui` (M7). Owns the terminal (alternate screen, hidden
 * cursor, raw-mode stdin) and always restores it on exit — q, Esc, Ctrl+C, errors and
 * resize all end in the same cleanup path. Navigation and previews are read-only; the
 * only write actions (init/capture) go through a labeled confirmation overlay first.
 */
import { adapterNames } from "../adapters/index.js";
import { COMPACT_BUDGET, DEFAULT_BUDGET } from "../adapters/budget.js";
import { capturePack, renderCapture } from "../core/capture.js";
import { initPack } from "../core/init.js";
import { Painter, resolveColorLevel, supportsUnicode, type ColorFlag } from "./ansi.js";
import { KeyReader, type Key } from "./keys.js";
import { loadScreen } from "./model.js";
import { SECTIONS, renderFrame, type UiState } from "./render.js";

/** Structural subset of a stdin TTY so tests can inject fakes. */
export interface UiInput {
  isTTY: boolean;
  setRawMode?(enabled: boolean): void;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  removeListener?(event: "data", listener: (chunk: Buffer) => void): void;
  resume(): void;
  pause(): void;
}

/** Structural subset of a stdout TTY. */
export interface UiOutput {
  isTTY: boolean;
  columns?: number | undefined;
  rows?: number | undefined;
  write(text: string): unknown;
  on?(event: "resize", listener: () => void): void;
  removeListener?(event: "resize", listener: () => void): void;
}

export interface UiOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: UiInput;
  stdout: UiOutput;
  stderr: (text: string) => void;
  colorFlag?: ColorFlag | undefined;
  /** Resolved preview budget (already validated by the caller). */
  budget: number;
  /** Initial handoff preview target. */
  target: string;
  platform?: NodeJS.Platform;
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ALT_SCREEN = "\x1b[?1049h";
const MAIN_SCREEN = "\x1b[?1049l";
const HOME_CLEAR = "\x1b[H";

/**
 * Runs the TUI until the user quits. Returns the exit code; writes its own diagnostics to
 * `stderr` for non-TTY invocation so callers can propagate the code without re-reporting.
 */
export function runUi(options: UiOptions): Promise<number> {
  const { stdin, stdout, stderr } = options;
  if (!stdin.isTTY || !stdout.isTTY) {
    stderr("ctxpack: error: `ctxpack ui` requires an interactive terminal (TTY on stdin and stdout)\n");
    return Promise.resolve(1);
  }
  if (!adapterNames().includes(options.target)) {
    stderr(
      `ctxpack: error: unknown handoff target "${options.target}". Available targets: ${adapterNames().join(", ")}\n`,
    );
    return Promise.resolve(1);
  }

  const level = resolveColorLevel({
    env: options.env,
    flag: options.colorFlag,
    isTty: stdout.isTTY,
    platform: options.platform,
  });
  const unicode = supportsUnicode(options.env, options.platform);
  const painter = new Painter(level, unicode);

  const state: UiState = {
    screen: loadScreen(options.cwd),
    section: 0,
    focus: "nav",
    scroll: 0,
    previewTarget: options.target,
    previewBudget: options.budget,
    overlay: undefined,
    message: undefined,
    cols: Math.max(1, stdout.columns ?? 80),
    rows: Math.max(1, stdout.rows ?? 24),
  };

  const actions = createActions(options, state);

  return new Promise<number>((resolve) => {
    let done = false;
    const reader = new KeyReader((key) => {
      if (done) return;
      try {
        dispatch(state, key, actions, quit);
      } catch (error) {
        state.overlay = undefined;
        state.message = {
          text: `error: ${error instanceof Error ? error.message : String(error)}`,
          tone: "error",
        };
      }
      if (!done) render();
    });

    const onResize = () => {
      if (done) return;
      state.cols = Math.max(1, stdout.columns ?? state.cols);
      state.rows = Math.max(1, stdout.rows ?? state.rows);
      render();
    };

    const render = () => {
      stdout.write(HOME_CLEAR + renderFrame(state, painter).join("\r\n") + "\x1b[0J");
    };

    const quit = (code: number) => {
      if (done) return;
      done = true;
      reader.close();
      cleanup();
      resolve(code);
    };

    const onData = (chunk: Buffer) => reader.feed(chunk);

    const cleanup = () => {
      stdout.removeListener?.("resize", onResize);
      stdin.removeListener?.("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write(SHOW_CURSOR + MAIN_SCREEN);
    };

    stdout.write(ALT_SCREEN + HIDE_CURSOR);
    stdin.setRawMode?.(true);
    stdout.on?.("resize", onResize);
    stdin.on("data", onData);
    stdin.resume();
    render();
  });
}

interface Actions {
  capture(): void;
  init(): void;
  reload(): void;
}

function createActions(options: UiOptions, state: UiState): Actions {
  const reload = () => {
    state.screen = loadScreen(options.cwd);
    state.scroll = 0;
  };
  return {
    capture() {
      const result = capturePack({ cwd: options.cwd });
      reload();
      const summary = renderCapture(result).split("\n")[1]?.trim() ?? "done";
      state.message = { text: `captured: ${summary}`, tone: "ok" };
    },
    init() {
      const result = initPack({ cwd: options.cwd });
      reload();
      state.message =
        result.created.length === 0
          ? { text: `ctxpack already initialized at ${result.dir} (nothing changed)`, tone: "info" }
          : { text: `initialized ${result.dir} (${result.created.length} files created)`, tone: "ok" };
    },
    reload() {
      reload();
      state.message = { text: "reloaded .ctxpack/", tone: "info" };
    },
  };
}

const CAPTURE_OVERLAY_LINES = [
  "ctxpack capture — WRITE operation",
  "",
  "Reads the Git work tree and writes .ctxpack/state.json (state.git)",
  "and .ctxpack/manifest.json (updatedAt). No other files change.",
  "",
  "Press y to confirm, or n / Esc to cancel.",
];

const INIT_OVERLAY_LINES = [
  "ctxpack init — WRITE operation",
  "",
  "Creates .ctxpack/{manifest,state,artifacts}.json, four Markdown",
  "files and snapshots/ in the current repository root.",
  "Existing valid files are kept; corrupt files abort with an error.",
  "",
  "Press y to confirm, or n / Esc to cancel.",
];

function dispatch(state: UiState, key: Key, actions: Actions, quit: (code: number) => void): void {
  // Confirmation overlay owns the keyboard while open.
  if (state.overlay !== undefined) {
    if (key.kind === "char" && (key.char === "y" || key.char === "Y")) {
      const action = state.overlay.action;
      state.overlay = undefined;
      state.message = undefined;
      if (action === "capture") actions.capture();
      else actions.init();
      return;
    }
    if (key.kind === "char" && (key.char === "n" || key.char === "N")) {
      const action = state.overlay.action;
      state.overlay = undefined;
      state.message = { text: `${action} cancelled — nothing written`, tone: "info" };
      return;
    }
    if (key.kind === "esc") {
      state.message = { text: `${state.overlay.action} cancelled — nothing written`, tone: "info" };
      state.overlay = undefined;
      return;
    }
    if (key.kind === "ctrlc") {
      quit(0);
      return;
    }
    return; // swallow all other keys while the confirmation is open
  }

  const screen = state.screen;
  const pack = screen.kind === "pack";

  switch (key.kind) {
    case "ctrlc":
      quit(0);
      return;
    case "esc":
      if (state.focus === "detail") state.focus = "nav";
      else quit(0);
      return;
    case "char": {
      const c = key.char;
      if (c === "q" || c === "Q") {
        quit(0);
        return;
      }
      if (c === "k") {
        move(state, -1);
        return;
      }
      if (c === "j") {
        move(state, 1);
        return;
      }
      if (c === "h") {
        back(state);
        return;
      }
      if (c === "l") {
        open(state);
        return;
      }
      if (pack) {
        const targetIndex = "1234".indexOf(c);
        if (targetIndex >= 0) {
          const name = adapterNames()[targetIndex];
          if (name !== undefined) {
            state.previewTarget = name;
            state.message = { text: `handoff target: ${name}`, tone: "info" };
          }
          return;
        }
        if (c === "b") {
          state.previewBudget =
            state.previewBudget === COMPACT_BUDGET ? DEFAULT_BUDGET : COMPACT_BUDGET;
          state.message = { text: `preview budget: ${state.previewBudget} est. tokens`, tone: "info" };
          return;
        }
        if (c === "c") {
          state.overlay = { action: "capture", title: "WRITE ACTION", lines: CAPTURE_OVERLAY_LINES };
          state.message = undefined;
          return;
        }
      }
      if (c === "i" && screen.kind !== "nogit") {
        state.overlay = { action: "init", title: "WRITE ACTION", lines: INIT_OVERLAY_LINES };
        state.message = undefined;
        return;
      }
      if (c === "r" && screen.kind !== "nogit") {
        state.message = undefined;
        actions.reload();
        return;
      }
      if (c === "p") {
        state.section = SECTIONS.length - 1;
        state.scroll = 0;
        return;
      }
      return;
    }
    case "up":
      move(state, -1);
      return;
    case "down":
      move(state, 1);
      return;
    case "left":
      back(state);
      return;
    case "right":
      open(state);
      return;
    case "tab":
    case "enter":
      open(state);
      return;
    case "backtab":
      back(state);
      return;
    case "pageup":
      if (state.focus === "detail") state.scroll = Math.max(0, state.scroll - pageSize(state));
      return;
    case "pagedown":
      if (state.focus === "detail") state.scroll = state.scroll + pageSize(state);
      return;
    case "home":
      if (state.focus === "detail") state.scroll = 0;
      return;
    case "end":
      if (state.focus === "detail") state.scroll = Number.MAX_SAFE_INTEGER; // clamped at render
      return;
    default:
      return;
  }
}

function move(state: UiState, delta: number): void {
  if (state.focus === "nav") {
    const n = SECTIONS.length;
    state.section = ((state.section + delta) % n + n) % n;
    state.scroll = 0;
    state.message = undefined;
  } else {
    state.scroll = Math.max(0, state.scroll + delta);
  }
}

function open(state: UiState): void {
  state.focus = "detail";
}

function back(state: UiState): void {
  if (state.focus === "detail") {
    state.focus = "nav";
  } else {
    // Left/back at nav level also moves the section for narrow layouts.
    const n = SECTIONS.length;
    state.section = ((state.section - 1 + n) % n) % n;
    state.scroll = 0;
  }
}

function pageSize(state: UiState): number {
  return Math.max(1, state.rows - 8);
}
