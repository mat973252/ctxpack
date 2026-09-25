import type { HandoffInput } from "../core/handoff.js";
import { renderClaudeHandoff, renderClaudeView } from "./claude.js";
import { renderCodexHandoff, renderCodexView } from "./codex.js";
import { renderGenericHandoff, renderGenericView } from "./generic.js";
import { renderPiHandoff, renderPiView } from "./pi.js";
import type { HandoffView } from "./view.js";

export interface HandoffAdapter {
  name: string;
  /** Full-fidelity render straight from a ContextPack (kept for tests and callers). */
  render(input: HandoffInput): string;
  /** Render an already-planned view; used by the token-budget path with identical layout. */
  renderView(view: HandoffView): string;
}

const ADAPTERS: readonly HandoffAdapter[] = [
  { name: "generic", render: renderGenericHandoff, renderView: renderGenericView },
  { name: "codex", render: renderCodexHandoff, renderView: renderCodexView },
  { name: "pi", render: renderPiHandoff, renderView: renderPiView },
  { name: "claude", render: renderClaudeHandoff, renderView: renderClaudeView },
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
