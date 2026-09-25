import { Command } from "commander";

export const NAME = "ctxpack";
export const VERSION = "0.0.1";
export const DESCRIPTION =
  "Local-first context packing and handoff CLI for coding agents";

export function createProgram(): Command {
  const program = new Command();
  program
    .name(NAME)
    .description(DESCRIPTION)
    .version(VERSION, "-v, --version", "print the ctxpack version")
    .helpOption("-h, --help", "show this help")
    .showHelpAfterError()
    .addHelpText(
      "after",
      "\nM0 skeleton: no packing commands are implemented yet.\n" +
        "Planned commands (capture, normalize, handoff) will be added in later milestones.",
    );

  program.action(() => {
    program.outputHelp();
  });

  return program;
}
