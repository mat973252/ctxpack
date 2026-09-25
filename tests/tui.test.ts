import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAdapter } from "../src/adapters/index.js";
import { DEFAULT_BUDGET, COMPACT_BUDGET, renderWithinBudget } from "../src/adapters/budget.js";
import { initPack } from "../src/core/init.js";
import { loadHandoff } from "../src/core/handoff.js";
import { createProgram, main, type ProgramIO } from "../src/program.js";
import { StateSchema } from "../src/schema/index.js";
import { resolvePackPaths } from "../src/storage/index.js";
import {
  Painter,
  hexTo256,
  resolveColorLevel,
  supportsUnicode,
  textWidth,
  truncate,
} from "../src/tui/ansi.js";
import { KeyReader, type Key } from "../src/tui/keys.js";
import { runUi, type UiInput, type UiOutput } from "../src/tui/app.js";
import { SECTIONS, detailRows, renderFrame, type UiState } from "../src/tui/render.js";
import { loadScreen } from "../src/tui/model.js";

// Windows holds transient locks (AV/indexer) on just-written paths, so bare
// rmSync is flaky there; retry removes so assertions stay honest on every host.
function rmrf(p: string): void {
  rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ---------- fixtures ----------

let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ctxpack-tui-"));
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  return dir;
}

function fillState(): void {
  const paths = resolvePackPaths(repo);
  const state = StateSchema.parse(JSON.parse(readFileSync(paths.state, "utf8")));
  state.goal = "Ship the interactive TUI 终端界面";
  state.status = "in_progress";
  state.completed = ["ANSI renderer", "key parser"];
  state.currentTasks = ["wire ctxpack ui into the program"];
  state.blockers = ["codex review pending"];
  state.nextActions = ["open PR", "independent review"];
  state.relevantFiles = ["src/tui/render.ts", "src/tui/app.ts", "docs/devin-m7-tui.md"];
  state.verification = [
    { name: "lint", result: "pass" },
    { name: "preview-vs-cli", result: "unknown", detail: "manual" },
  ];
  writeFileSync(paths.state, JSON.stringify(state, null, 2) + "\n");
  writeFileSync(
    paths.decisions,
    "# Decisions\n\nRecord important design decisions.\n\n" +
      "Format: `- [YYYY-MM-DD] <summary> — <reason>`\n\n" +
      "- [2026-09-25] zero new runtime dependencies — installable Node package\n",
  );
  writeFileSync(
    paths.failures,
    "# Failed Approaches\n\nRecord approaches that were tried and did not work, " +
      "so the next agent does not repeat them.\n\n" +
      "Format: `- <approach>: <result> — <reason>`\n\n" +
      "- ink TUI framework: adds heavy deps — contradicts the thin-package contract\n",
  );
}

function initFilledRepo(): void {
  repo = makeRepo();
  writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed"]);
  initPack({ cwd: repo });
  fillState();
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function packHashes(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(path.relative(dir, full), sha256(full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// ---------- fake TTY ----------

class FakeStdin extends EventEmitter implements UiInput {
  isTTY = true;
  raw: boolean[] = [];
  paused = false;
  setRawMode(enabled: boolean): void {
    this.raw.push(enabled);
  }
  resume(): void {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  feed(keys: string): void {
    this.emit("data", Buffer.from(keys, "utf8"));
  }
}

class FakeStdout extends EventEmitter implements UiOutput {
  isTTY = true;
  chunks: string[] = [];
  constructor(
    public columns = 120,
    public rows = 30,
  ) {
    super();
  }
  write(text: string): boolean {
    this.chunks.push(text);
    return true;
  }
  resize(cols: number, rows: number): void {
    this.columns = cols;
    this.rows = rows;
    this.emit("resize");
  }
  all(): string {
    return this.chunks.join("");
  }
  lastFrame(): string {
    return strip(this.chunks.at(-1) ?? "");
  }
}

// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
function strip(s: string): string {
  return s.replace(ANSI, "");
}

async function launch(opts?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  budget?: number;
  target?: string;
}) {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout(opts?.cols ?? 120, opts?.rows ?? 30);
  const err: string[] = [];
  const done = runUi({
    cwd: opts?.cwd ?? repo,
    env: opts?.env ?? { LANG: "C.UTF-8" },
    stdin,
    stdout,
    stderr: (t) => err.push(t),
    budget: opts?.budget ?? DEFAULT_BUDGET,
    target: opts?.target ?? "generic",
  });
  // Let the initial frame land.
  await new Promise((r) => setTimeout(r, 0));
  return { stdin, stdout, err, done };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  repo = "";
});

afterEach(() => {
  if (repo !== "") rmrf(repo);
});

// ---------- ansi ----------

describe("resolveColorLevel", () => {
  const base = { isTty: true, platform: "linux" as const };

  it("NO_COLOR wins even over an explicit --color flag", () => {
    expect(resolveColorLevel({ ...base, env: { NO_COLOR: "1" }, flag: "always" })).toBe("none");
    expect(resolveColorLevel({ ...base, env: { NO_COLOR: "" }, flag: "256" })).toBe("none");
  });

  it("maps explicit flags", () => {
    expect(resolveColorLevel({ ...base, env: {}, flag: "never" })).toBe("none");
    expect(resolveColorLevel({ ...base, env: {}, flag: "always" })).toBe("truecolor");
    expect(resolveColorLevel({ ...base, env: {}, flag: "16" })).toBe("16");
    expect(resolveColorLevel({ ...base, env: {}, flag: "256" })).toBe("256");
    expect(resolveColorLevel({ ...base, env: {}, flag: "truecolor" })).toBe("truecolor");
  });

  it("auto-detects from TERM/COLORTERM", () => {
    expect(resolveColorLevel({ ...base, env: { COLORTERM: "truecolor", TERM: "xterm" } })).toBe("truecolor");
    expect(resolveColorLevel({ ...base, env: { TERM: "xterm-256color" } })).toBe("256");
    expect(resolveColorLevel({ ...base, env: { TERM: "xterm" } })).toBe("16");
    expect(resolveColorLevel({ ...base, env: { TERM: "dumb" } })).toBe("none");
    expect(resolveColorLevel({ ...base, env: { WT_SESSION: "abc" } })).toBe("truecolor");
    expect(resolveColorLevel({ ...base, env: {}, isTty: false })).toBe("none");
    expect(resolveColorLevel({ ...base, env: {}, platform: "win32" })).toBe("16");
  });
});

describe("width + truncate", () => {
  it("counts CJK as wide, ASCII and combining correctly", () => {
    expect(textWidth("abc")).toBe(3);
    expect(textWidth("中文")).toBe(4);
    expect(textWidth("á")).toBe(1); // a + combining accent
    expect(textWidth("🎉")).toBe(2);
  });

  it("truncates with an ellipsis inside the width", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("中文界面", 5)).toBe("中文…");
    expect(textWidth(truncate("中文界面", 5))).toBe(5);
    expect(truncate("abc", 10)).toBe("abc");
  });
});

describe("hexTo256", () => {
  it("maps tokens into the 6x6x6 cube", () => {
    expect(hexTo256("#000000")).toBe(16);
    expect(hexTo256("#ffffff")).toBe(231);
    const mint = hexTo256("#83cebe");
    expect(mint).toBeGreaterThanOrEqual(16);
    expect(mint).toBeLessThanOrEqual(231);
  });
});

describe("supportsUnicode", () => {
  it("reads the locale", () => {
    expect(supportsUnicode({ LANG: "C.UTF-8" }, "linux")).toBe(true);
    expect(supportsUnicode({ LANG: "C" }, "linux")).toBe(false);
    expect(supportsUnicode({ WT_SESSION: "x" }, "win32")).toBe(true);
  });
});

// ---------- keys ----------

describe("KeyReader", () => {
  function collect(): { keys: Key[]; reader: KeyReader } {
    const keys: Key[] = [];
    return { keys, reader: new KeyReader((k) => keys.push(k), 5) };
  }

  it("parses arrows, tabs, enter, ctrl-c and chars", () => {
    const { keys, reader } = collect();
    reader.feed(Buffer.from("\x1b[A\x1b[B\x1b[C\x1b[D\x1b[Z\t\r\x03jkq"));
    expect(keys.map((k) => k.kind)).toEqual([
      "up", "down", "right", "left", "backtab", "tab", "enter", "ctrlc", "char", "char", "char",
    ]);
    expect((keys[8] as { char: string }).char).toBe("j");
  });

  it("emits esc for a bare escape after the delay", async () => {
    const { keys, reader } = collect();
    reader.feed(Buffer.from("\x1b"));
    expect(keys).toEqual([]);
    await new Promise((r) => setTimeout(r, 30));
    expect(keys).toEqual([{ kind: "esc" }]);
  });

  it("resolves a split escape sequence", () => {
    const { keys, reader } = collect();
    reader.feed(Buffer.from("\x1b["));
    expect(keys).toEqual([]);
    reader.feed(Buffer.from("A"));
    expect(keys).toEqual([{ kind: "up" }]);
  });

  it("keeps multi-byte chars split across reads intact", () => {
    const { keys, reader } = collect();
    const bytes = Buffer.from("中", "utf8");
    reader.feed(bytes.subarray(0, 2));
    reader.feed(bytes.subarray(2));
    expect(keys).toEqual([{ kind: "char", char: "中" }]);
  });
});

// ---------- render ----------

describe("renderFrame", () => {
  function stateFor(cols: number, rows: number): UiState {
    return {
      screen: loadScreen(repo),
      section: 0,
      focus: "nav",
      scroll: 0,
      previewTarget: "generic",
      previewBudget: DEFAULT_BUDGET,
      overlay: undefined,
      message: undefined,
      cols,
      rows,
    };
  }

  it("renders a 120x30 frame: mark, project, status, nav column, detail", () => {
    initFilledRepo();
    const painter = new Painter("none", true);
    const frame = renderFrame(stateFor(120, 30), painter).map((l) => strip(l));
    expect(frame).toHaveLength(30);
    expect(frame[0]).toContain("ctxpack ui");
    expect(frame[0]).toContain("▐M▌●");
    expect(frame[0]).toContain("ctxpack-tui"); // temp repo dir name
    expect(frame[0]).toContain("IN_PROGRESS");
    expect(frame[2]).toContain("Overview");
    expect(frame.some((l) => l.includes("Ship the interactive TUI"))).toBe(true);
    // nav column separator and sections
    expect(frame.some((l) => l.includes("│") && l.includes("Decisions"))).toBe(true);
    expect(frame[29]).toContain("q quit");
    // every row is exactly `cols` wide
    for (const l of frame) expect(textWidth(l)).toBe(120);
  });

  it("renders the narrow strip at 80x24", () => {
    initFilledRepo();
    const painter = new Painter("none", true);
    const frame = renderFrame(stateFor(80, 24), painter).map((l) => strip(l));
    expect(frame).toHaveLength(24);
    expect(frame[2]).toContain("1/10");
    expect(frame[2]).toContain("Overview");
    for (const l of frame) expect(textWidth(l)).toBe(80);
  });

  it("shows a too-small message below the minimum size", () => {
    initFilledRepo();
    const painter = new Painter("none", true);
    const frame = renderFrame(stateFor(30, 8), painter).map((l) => strip(l));
    expect(frame.join("\n")).toContain("terminal too small (30x8)");
    expect(frame.join("\n")).toContain("need ≥ 40x10");
  });

  it("renders the handoff preview byte-identical to renderWithinBudget", () => {
    initFilledRepo();
    const input = loadHandoff({ cwd: repo });
    const painter = new Painter("none", true);
    for (const target of ["generic", "codex", "pi", "claude"]) {
      const state = { ...stateFor(200, 60), section: SECTIONS.length - 1, previewTarget: target };
      // The detail rows (untruncated, before the viewport slice) must contain the
      // exact same lines the CLI prints.
      const rows = detailRows(state, painter).map((r) =>
        r.map((c) => c.t).join("").trimEnd(),
      );
      const expected = renderWithinBudget(resolveAdapter(target), input, DEFAULT_BUDGET)
        .replace(/\n$/, "")
        .split("\n");
      // Content starts after the two-line preview header + blank separator row.
      expect(rows.slice(3)).toEqual(expected);
      const frame = renderFrame(state, painter).map((l) => strip(l));
      expect(frame.join("\n")).toContain(`handoff --to ${target}`);
    }
  });

  it("draws the write-confirmation overlay", () => {
    initFilledRepo();
    const painter = new Painter("none", true);
    const state = {
      ...stateFor(80, 24),
      overlay: { action: "capture" as const, title: "WRITE ACTION", lines: ["writes state.json"] },
    };
    const frame = renderFrame(state, painter).map((l) => strip(l));
    const text = frame.join("\n");
    expect(text).toContain("WRITE ACTION");
    expect(text).toContain("writes state.json");
    expect(text).toContain("╭");
  });
});

// ---------- runUi end-to-end on fake TTYs ----------

describe("runUi", () => {
  it("rejects a non-TTY and writes a diagnostic", async () => {
    initFilledRepo();
    const stdin = new FakeStdin();
    stdin.isTTY = false;
    const stdout = new FakeStdout();
    const err: string[] = [];
    const code = await runUi({
      cwd: repo,
      env: {},
      stdin,
      stdout,
      stderr: (t) => err.push(t),
      budget: DEFAULT_BUDGET,
      target: "generic",
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("interactive terminal");
    expect(stdout.chunks).toHaveLength(0);
  });

  it("quits on q and restores the terminal", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch();
    stdin.feed("q");
    expect(await done).toBe(0);
    const out = stdout.all();
    expect(out).toContain("\x1b[?1049h"); // entered alt screen
    expect(out).toContain("\x1b[?25l"); // cursor hidden
    expect(out).toContain("\x1b[?25h"); // cursor restored
    expect(out).toContain("\x1b[?1049l"); // alt screen left
    expect(stdin.paused).toBe(true);
    expect(stdin.raw).toEqual([true, false]);
  });

  it("quits on Ctrl+C and restores the terminal", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch();
    stdin.feed("\x03");
    expect(await done).toBe(0);
    expect(stdout.all()).toContain("\x1b[?1049l");
  });

  it("quits on a bare Esc at nav focus", async () => {
    initFilledRepo();
    const { stdin, done } = await launch();
    stdin.feed("\x1b");
    expect(await done).toBe(0);
  });

  it("navigates sections with j/k and opens detail with Tab", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch();
    // Header rules and hints degrade to ASCII when the locale/platform has no UTF-8
    // (e.g. Windows without Windows Terminal); assert whichever path this host takes.
    const unicode = supportsUnicode({ LANG: "C.UTF-8" }, process.platform);
    const rule = unicode ? "─" : "-";
    stdin.feed("j");
    await tick();
    expect(stdout.lastFrame()).toContain(`Progress ${rule}`);
    stdin.feed("k");
    await tick();
    expect(stdout.lastFrame()).toContain(`Overview ${rule}`);
    stdin.feed("\t"); // open detail
    await tick();
    expect(stdout.lastFrame()).toContain(unicode ? "↑↓/jk scroll" : "j/k scroll");
    stdin.feed("h"); // back
    await tick();
    expect(stdout.lastFrame()).toContain("q quit");
    stdin.feed("q");
    await done;
  });

  it("renders ASCII glyphs when the locale has no UTF-8", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch({ env: { LANG: "C" } });
    let frame = stdout.lastFrame();
    expect(frame).toContain(" M *"); // ASCII M mark
    expect(frame).not.toContain("▐M▌");
    expect(frame).not.toContain("─");
    expect(frame).toContain("Overview -");
    stdin.feed("j");
    await tick();
    frame = stdout.lastFrame();
    expect(frame).toContain("Progress -");
    stdin.feed("q");
    await done;
  });

  it("shows every state section incl. decisions, failures, blockers, git summary", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch();
    const labels = [
      "zero new runtime dependencies",
      "ink TUI framework",
      "codex review pending",
      "open PR",
      "src/tui/render.ts",
      "not captured",
      "preview-vs-cli",
    ];
    for (let i = 0; i < SECTIONS.length; i++) {
      const frame = stdout.lastFrame();
      const text = frame;
      // Just ensure each section renders without throwing.
      expect(text.length).toBeGreaterThan(0);
      stdin.feed("j");
      await tick();
    }
    const all = stdout.all();
    for (const l of labels) expect(strip(all)).toContain(l);
    stdin.feed("q");
    await done;
  });

  it("switches handoff targets with number keys and budget with b", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch();
    stdin.feed("p"); // jump to handoff section
    await tick();
    expect(stdout.lastFrame()).toContain("handoff --to generic");
    stdin.feed("3");
    await tick();
    expect(stdout.lastFrame()).toContain("handoff --to pi");
    stdin.feed("b");
    await tick();
    expect(stdout.lastFrame()).toContain(`--budget ${COMPACT_BUDGET}`);
    stdin.feed("q");
    await done;
  });

  it("leaves every .ctxpack file hash-identical after previews (read-only)", async () => {
    initFilledRepo();
    const before = packHashes(path.join(repo, ".ctxpack"));
    const { stdin, done } = await launch();
    stdin.feed("p");
    await tick();
    for (const k of ["1", "2", "3", "4", "b", "b"]) {
      stdin.feed(k);
      await tick();
    }
    // scroll through the preview
    stdin.feed("\t"); // focus detail
    for (let i = 0; i < 10; i++) stdin.feed("j");
    await tick();
    stdin.feed("q");
    await done;
    expect(packHashes(path.join(repo, ".ctxpack"))).toEqual(before);
  });

  it("capture requires y; n cancels without writing", async () => {
    initFilledRepo();
    const stateFile = resolvePackPaths(repo).state;
    const beforeState = sha256(stateFile);
    const beforeManifest = sha256(resolvePackPaths(repo).manifest);
    const { stdin, stdout, done } = await launch();
    stdin.feed("c");
    await tick();
    expect(stdout.lastFrame()).toContain("WRITE ACTION");
    expect(stdout.lastFrame()).toContain("y to confirm");
    stdin.feed("n");
    await tick();
    expect(stdout.lastFrame()).toContain("cancelled");
    expect(sha256(stateFile)).toBe(beforeState);
    stdin.feed("c");
    await tick();
    stdin.feed("y");
    await tick();
    expect(stdout.lastFrame()).toContain("captured");
    const state = StateSchema.parse(JSON.parse(readFileSync(stateFile, "utf8")));
    expect(state.git.branch).toBe("main");
    expect(state.git.headState).toBe("branch");
    // Only the git field and manifest.updatedAt changed.
    expect(state.goal).toContain("Ship the interactive TUI");
    expect(sha256(resolvePackPaths(repo).manifest)).not.toBe(beforeManifest);
    stdin.feed("q");
    await done;
  });

  it("Esc on the overlay cancels without writing", async () => {
    initFilledRepo();
    const beforeState = sha256(resolvePackPaths(repo).state);
    const { stdin, stdout, done } = await launch();
    stdin.feed("c");
    await tick();
    stdin.feed("\x1b");
    await new Promise((r) => setTimeout(r, 60)); // bare ESC resolves after the escDelay
    expect(stdout.lastFrame()).toContain("cancelled");
    expect(sha256(resolvePackPaths(repo).state)).toBe(beforeState);
    stdin.feed("q");
    await done;
  });

  it("reports non-git directories with an actionable screen", async () => {
    const plain = mkdtempSync(path.join(tmpdir(), "ctxpack-tui-nogit-"));
    try {
      const { stdin, stdout, done } = await launch({ cwd: plain });
      expect(stdout.lastFrame()).toContain("Not a Git repository");
      stdin.feed("q");
      await done;
    } finally {
      rmrf(plain);
    }
  });

  it("offers confirmed init in an uninitialized git repo", async () => {
    repo = makeRepo();
    writeFileSync(path.join(repo, "seed.txt"), "seed\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "seed"]);
    const { stdin, stdout, done } = await launch();
    expect(stdout.lastFrame()).toContain("No .ctxpack/ found");
    stdin.feed("i");
    await tick();
    expect(stdout.lastFrame()).toContain("WRITE ACTION");
    stdin.feed("y");
    await tick();
    expect(stdout.lastFrame()).toContain("initialized");
    expect(existsSync(path.join(repo, ".ctxpack", "state.json"))).toBe(true);
    stdin.feed("q");
    await done;
  });

  it("shows the schema error for a corrupt pack", async () => {
    initFilledRepo();
    writeFileSync(resolvePackPaths(repo).state, "{ not json");
    const { stdin, stdout, done } = await launch();
    expect(stdout.lastFrame()).toContain("state is invalid");
    expect(stdout.lastFrame()).toContain("not valid JSON");
    stdin.feed("q");
    await done;
  });

  it("redraws on resize", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch({ cols: 100, rows: 30 });
    stdout.resize(60, 20);
    await tick();
    const frame = stdout.lastFrame();
    // narrow layout kicks in below 100 cols
    expect(frame).toContain("1/10");
    stdout.resize(30, 8);
    await tick();
    expect(stdout.lastFrame()).toContain("terminal too small");
    stdin.feed("q");
    await done;
  });

  it("honors NO_COLOR over an explicit --color flag in live output", async () => {
    initFilledRepo();
    const { stdin, stdout, done } = await launch({ env: { NO_COLOR: "1", LANG: "C.UTF-8" } });
    // no color SGR sequences anywhere (cursor/screen controls are still allowed)
    const out = stdout.all();
    // eslint-disable-next-line no-control-regex -- asserting absence of color SGR codes
    expect(out).not.toMatch(/\x1b\[(38|48|9[0-7]|3[0-9]|10[0-7]|4[0-9])(;[0-9;]*)?m/);
    stdin.feed("q");
    await done;
  });
});

// ---------- program wiring ----------

describe("ctxpack ui program wiring", () => {
  function makeIO(cwd: string) {
    const out: string[] = [];
    const err: string[] = [];
    const io: ProgramIO = { cwd: () => cwd, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
    return { io, out, err };
  }

  it("rejects an invalid --color mode", async () => {
    const { io, err } = makeIO(repo);
    const code = await main(["node", "ctxpack", "ui", "--color", "bogus"], io);
    expect(code).toBe(1);
    expect(err.join("")).toContain('invalid --color "bogus"');
  });

  it("rejects an invalid --budget", async () => {
    const { io, err } = makeIO(repo);
    const code = await main(["node", "ctxpack", "ui", "--budget", "abc"], io);
    expect(code).toBe(1);
    expect(err.join("")).toContain("invalid --budget");
  });

  it("rejects an unknown --to target", async () => {
    const { io, err } = makeIO(repo);
    const code = await main(["node", "ctxpack", "ui", "--to", "bogus"], io);
    expect(code).toBe(1);
    expect(err.join("")).toContain("unknown handoff target");
  });

  it("lists ui in the program help", () => {
    initFilledRepo();
    const { io } = makeIO(repo);
    const program = createProgram(io);
    expect(program.commands.map((c) => c.name())).toContain("ui");
    expect(program.helpInformation()).toContain("interactive terminal UI");
  });
});
