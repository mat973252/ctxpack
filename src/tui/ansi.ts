/**
 * Terminal color levels, visual tokens and display-width helpers for `ctxpack ui` (M7).
 *
 * Visual tokens follow mat973252.github.io (2026-09-25): --ink #142121, --paper #fbf9f8,
 * --mint #83cebe, --muted #61706b and accent #4aab96. True color degrades to the xterm-256
 * cube and then to the 16-color palette; `NO_COLOR` disables all SGR color even when a
 * --color flag is explicit (per https://no-color.org).
 */

export type ColorLevel = "none" | "16" | "256" | "truecolor";
export type ColorFlag = "auto" | "always" | "never" | "16" | "256" | "truecolor";

export const COLOR_FLAGS: readonly ColorFlag[] = ["auto", "always", "never", "16", "256", "truecolor"];

export const TOKENS = {
  ink: "#142121",
  paper: "#fbf9f8",
  mint: "#83cebe",
  muted: "#61706b",
  accent: "#4aab96",
  danger: "#e08080",
} as const;

export type TokenName = keyof typeof TOKENS;

export interface ColorContext {
  env: NodeJS.ProcessEnv;
  flag?: ColorFlag | undefined;
  isTty: boolean;
  platform?: NodeJS.Platform | undefined;
}

/**
 * Resolves the effective color level. `NO_COLOR` (any value, even empty) always wins over an
 * explicit --color flag. "auto" probes TERM/COLORTERM; on Windows without TERM a bare TTY
 * still gets the 16-color palette because conhost/Windows Terminal always support it.
 */
export function resolveColorLevel(ctx: ColorContext): ColorLevel {
  if ("NO_COLOR" in ctx.env) return "none";
  const flag = ctx.flag ?? "auto";
  if (flag === "never") return "none";
  if (flag !== "auto") return flag === "always" ? "truecolor" : flag;
  if (!ctx.isTty) return "none";
  if (ctx.env.WT_SESSION !== undefined || ctx.env.TERM_PROGRAM === "vscode") return "truecolor";
  const colorterm = (ctx.env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  const term = (ctx.env.TERM ?? "").toLowerCase();
  if (term === "" || term === "dumb" || term === "emacs") {
    return (ctx.platform ?? process.platform) === "win32" && term !== "dumb" && term !== "emacs" ? "16" : "none";
  }
  if (term.includes("direct") || term.includes("24bit") || term.includes("truecolor")) return "truecolor";
  if (term.includes("256")) return "256";
  return "16";
}

/** UTF-8-capable locale check; box-drawing/branch glyphs fall back to ASCII without it. */
export function supportsUnicode(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  if (env.WT_SESSION !== undefined) return true;
  if (platform === "win32") return false;
  const locale = `${env.LANG ?? ""} ${env.LC_ALL ?? ""} ${env.LC_CTYPE ?? ""}`.toLowerCase();
  return locale.includes("utf-8") || locale.includes("utf8");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Nearest xterm-256 palette index for a hex color (6x6x6 cube plus gray ramp). */
export function hexTo256(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 12) {
    const gray = Math.round((r + g + b) / 3);
    if (gray < 8) return 16;
    if (gray > 238) return 231;
    return 232 + Math.round((gray - 8) / 10);
  }
  const q = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

const BASIC_FG: Record<TokenName, number> = {
  ink: 30,
  paper: 97,
  mint: 96,
  muted: 90,
  accent: 36,
  danger: 91,
};

const BASIC_BG: Record<TokenName, number> = {
  ink: 40,
  paper: 107,
  mint: 106,
  muted: 100,
  accent: 46,
  danger: 101,
};

/** Named paint roles used by the layout; mapped to SGR per color level. */
export type Spec =
  | "mark"
  | "paper"
  | "mint"
  | "accent"
  | "muted"
  | "danger"
  | "bold"
  | "dim"
  | "title"
  | "selected"
  | "badgeMint"
  | "badgeAccent"
  | "badgeMuted"
  | "badgeDanger";

export class Painter {
  constructor(
    readonly level: ColorLevel,
    readonly unicode: boolean,
  ) {}

  apply(text: string, spec: Spec): string {
    if (this.level === "none") {
      // NO_COLOR: color SGR only is forbidden; inverse video keeps the selection readable.
      if (spec === "selected") return `\x1b[7m${text}\x1b[27m`;
      return text;
    }
    const seq = this.seq(spec);
    return seq === "" ? text : `\x1b[${seq}m${text}\x1b[0m`;
  }

  private fg(token: TokenName): string {
    if (this.level === "16") return String(BASIC_FG[token]);
    if (this.level === "256") return `38;5;${hexTo256(TOKENS[token])}`;
    const { r, g, b } = hexToRgb(TOKENS[token]);
    return `38;2;${r};${g};${b}`;
  }

  private bg(token: TokenName): string {
    if (this.level === "16") return String(BASIC_BG[token]);
    if (this.level === "256") return `48;5;${hexTo256(TOKENS[token])}`;
    const { r, g, b } = hexToRgb(TOKENS[token]);
    return `48;2;${r};${g};${b}`;
  }

  private seq(spec: Spec): string {
    switch (spec) {
      case "mark":
        return `${this.bg("ink")};${this.fg("paper")};1`;
      case "paper":
        return this.fg("paper");
      case "mint":
        return this.fg("mint");
      case "accent":
        return this.fg("accent");
      case "muted":
        return this.fg("muted");
      case "danger":
        return this.fg("danger");
      case "bold":
        return "1";
      case "dim":
        return "2";
      case "title":
        return `${this.fg("mint")};1`;
      case "selected":
        return `${this.bg("accent")};${this.fg("ink")}`;
      case "badgeMint":
        return `${this.fg("mint")};1`;
      case "badgeAccent":
        return `${this.fg("accent")};1`;
      case "badgeMuted":
        return this.fg("muted");
      case "badgeDanger":
        return `${this.fg("danger")};1`;
    }
  }
}

/** Display width of one code point: 0 for controls/combining, 2 for East-Asian wide + emoji. */
export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    cp === 0x200d ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    (cp >= 0x20d0 && cp <= 0x20f0)
  ) {
    return 0;
  }
  if (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f000 && cp <= 0x1ffff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  ) {
    return 2;
  }
  return 1;
}

export function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** Cuts `text` to fit `width`, appending "…" when something was dropped. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (textWidth(text) <= width) return text;
  const ellipsis = "…";
  let used = 0;
  let out = "";
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (used + w > width - 1) break;
    used += w;
    out += ch;
  }
  return out + ellipsis;
}

export function padEnd(text: string, width: number): string {
  const w = textWidth(text);
  return w >= width ? text : text + " ".repeat(width - w);
}
