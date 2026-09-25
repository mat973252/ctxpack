import { Command } from "commander";
import { renderGenericHandoff } from "./adapters/generic.js";
import { capturePack, renderCapture } from "./core/capture.js";
import { loadHandoff } from "./core/handoff.js";
import { initPack } from "./core/init.js";
import { loadStatus, renderStatus } from "./core/status.js";
import { StorageError } from "./storage/index.js";

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
      "\nM3: `init`, `status`, `capture` and `handoff` are available.\n" +
        "Planned commands (handoff --to codex/pi/claude) will be added in later milestones.",
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
    .action(() => {
      const input = run(() => loadHandoff({ cwd: io.cwd() }));
      io.stdout(renderGenericHandoff(input));
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
      io.stderr(`${NAME}: error: ${error.message}\n`);
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
