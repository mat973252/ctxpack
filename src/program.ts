import { Command } from "commander";
import { adapterNames, resolveAdapter, type HandoffAdapter } from "./adapters/index.js";
import {
  BudgetExceededError,
  COMPACT_BUDGET,
  DEFAULT_BUDGET,
  renderWithinBudget,
  resolveBudget,
} from "./adapters/budget.js";
import { capturePack, renderCapture } from "./core/capture.js";
import { loadHandoff } from "./core/handoff.js";
import { initPack } from "./core/init.js";
import { loadStatus, renderStatus } from "./core/status.js";
import { StorageError } from "./storage/index.js";
import { COLOR_FLAGS, type ColorFlag } from "./tui/ansi.js";
import { runUi } from "./tui/app.js";

export const NAME = "ctxpack";
export const VERSION = "0.0.1";
export const DESCRIPTION =
  "Local-first context packing and handoff CLI for coding agents";

export interface ProgramIO {
  cwd: () => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIO: ProgramIO = {
  cwd: () => process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    /** When true the message was already reported (e.g. by the TUI) — do not reprint it. */
    readonly quiet = false,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function createProgram(io: ProgramIO = defaultIO): Command {
  const program = new Command();
  program
    .name(NAME)
    .description(DESCRIPTION)
    .version(VERSION, "-v, --version", "print the ctxpack version")
    .helpOption("-h, --help", "show this help")
    .showHelpAfterError()
    .addHelpText(
      "after",
      "\nM7: `init`, `status`, `capture`, `handoff` and `ui` are available.\n" +
        "`handoff --to <target>` renders an agent-specific format (codex, pi, claude); default is generic.\n" +
        `handoff output is capped at an estimated ${DEFAULT_BUDGET} tokens by default; ` +
        `--compact uses ${COMPACT_BUDGET}, and --budget <n> sets it explicitly (--budget wins over --compact).`,
    );

  program
    .command("init")
    .description("create the .ctxpack/ directory in the current Git repository")
    .option("-p, --project <name>", "project name recorded in manifest.json (default: repo directory name)")
    .action((opts: { project?: string }) => {
      const result = run(() =>
        initPack({ cwd: io.cwd(), ...(opts.project !== undefined ? { project: opts.project } : {}) }),
      );
      const lines: string[] = [];
      if (result.created.length === 0) {
        lines.push(`ctxpack already initialized at ${result.dir} (nothing changed)`);
      } else {
        lines.push(`Initialized ctxpack at ${result.dir}`);
        for (const file of result.created) lines.push(`  created ${file}`);
      }
      for (const file of result.kept) lines.push(`  kept    ${file}`);
      io.stdout(lines.join("\n") + "\n");
    });

  program
    .command("status")
    .description("show goal, progress and blockers from .ctxpack/ (read-only)")
    .action(() => {
      const pack = run(() => loadStatus({ cwd: io.cwd() }));
      io.stdout(renderStatus(pack));
    });

  program
    .command("capture")
    .description("record branch, HEAD, changed files, diff stat and recent commits into .ctxpack/state.json")
    .action(() => {
      const result = run(() => capturePack({ cwd: io.cwd() }));
      io.stdout(renderCapture(result));
    });

  program
    .command("handoff")
    .description("print a self-contained Markdown handoff for the next agent (read-only)")
    .option("--to <target>", `agent-specific output format (${adapterNames().join(", ")})`)
    .option("--compact", `shrink the output to ~${COMPACT_BUDGET} est. tokens`)
    .option(
      "--budget <tokens>",
      `estimated token budget (default ${DEFAULT_BUDGET}); overrides --compact`,
    )
    .action((opts: { to?: string; compact?: boolean; budget?: string }) => {
      let adapter: HandoffAdapter;
      let resolved: ReturnType<typeof resolveBudget>;
      try {
        adapter = resolveAdapter(opts.to);
        resolved = resolveBudget(opts);
      } catch (error) {
        throw new CliError(error instanceof Error ? error.message : String(error));
      }
      if (resolved.budgetOverridesCompact) {
        io.stderr(`${NAME}: note: --budget ${resolved.budget} overrides --compact\n`);
      }
      const input = run(() => loadHandoff({ cwd: io.cwd() }));
      let output: string;
      try {
        output = renderWithinBudget(adapter, input, resolved.budget);
      } catch (error) {
        if (error instanceof BudgetExceededError) throw new CliError(error.message);
        throw error;
      }
      io.stdout(output);
    });

  program
    .command("ui")
    .description(
      "interactive terminal UI over .ctxpack/ (read-only; init/capture require explicit confirmation)",
    )
    .option("--to <target>", `initial handoff preview format (${adapterNames().join(", ")})`)
    .option("--compact", `start handoff previews at ~${COMPACT_BUDGET} est. tokens`)
    .option(
      "--budget <tokens>",
      `initial preview budget (default ${DEFAULT_BUDGET}); overrides --compact`,
    )
    .option(
      "--color <mode>",
      `color mode (${COLOR_FLAGS.join(", ")}); NO_COLOR always wins, even over an explicit flag`,
      "auto",
    )
    .action(async (opts: { to?: string; compact?: boolean; budget?: string; color: string }) => {
      let adapter: HandoffAdapter;
      let resolved: ReturnType<typeof resolveBudget>;
      try {
        adapter = resolveAdapter(opts.to);
        resolved = resolveBudget(opts);
      } catch (error) {
        throw new CliError(error instanceof Error ? error.message : String(error));
      }
      if (!COLOR_FLAGS.includes(opts.color as ColorFlag)) {
        throw new CliError(
          `invalid --color "${opts.color}": expected one of ${COLOR_FLAGS.join(", ")}`,
        );
      }
      if (resolved.budgetOverridesCompact) {
        io.stderr(`${NAME}: note: --budget ${resolved.budget} overrides --compact\n`);
      }
      const code = await runUi({
        cwd: io.cwd(),
        env: process.env,
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: io.stderr,
        colorFlag: opts.color as ColorFlag,
        budget: resolved.budget,
        target: adapter.name,
      });
      if (code !== 0) throw new CliError("ui exited", code, true);
    });

  program.action(() => {
    program.outputHelp();
  });

  return program;
}

export async function main(argv: string[], io: ProgramIO = defaultIO): Promise<number> {
  try {
    await createProgram(io).parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      if (!error.quiet) io.stderr(`${NAME}: error: ${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }
}

function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof StorageError) throw new CliError(error.message);
    throw error;
  }
}
