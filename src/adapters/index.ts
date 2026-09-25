import type { HandoffInput } from "../core/handoff.js";
import { renderClaudeHandoff } from "./claude.js";
import { renderCodexHandoff } from "./codex.js";
import { renderGenericHandoff } from "./generic.js";
import { renderPiHandoff } from "./pi.js";

export interface HandoffAdapter {
  name: string;
  render(input: HandoffInput): string;
}

const ADAPTERS: readonly HandoffAdapter[] = [
  { name: "generic", render: renderGenericHandoff },
  { name: "codex", render: renderCodexHandoff },
  { name: "pi", render: renderPiHandoff },
  { name: "claude", render: renderClaudeHandoff },
];

export const DEFAULT_ADAPTER = "generic";

export function adapterNames(): string[] {
  return ADAPTERS.map((a) => a.name);
}

export function resolveAdapter(name: string | undefined): HandoffAdapter {
  const target = name ?? DEFAULT_ADAPTER;
  const adapter = ADAPTERS.find((a) => a.name === target);
  if (adapter === undefined) {
    throw new Error(
      `unknown handoff target "${target}". Available targets: ${adapterNames().join(", ")}`,
    );
  }
  return adapter;
}
