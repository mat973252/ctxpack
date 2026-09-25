/**
 * Incremental key parser for `ctxpack ui` (M7). Decodes raw-mode stdin bytes into named keys:
 * arrow/application-cursor sequences, Shift-Tab, PageUp/PageDown, Home/End, Esc (alone),
 * Ctrl+C, Enter, Tab and plain printable characters. UTF-8 is decoded with a streaming
 * decoder so multi-byte characters split across reads stay intact. Escape sequences that
 * arrive split across reads are held until complete; a bare ESC resolves as the Esc key
 * after `escDelayMs` or when the next byte can not extend it.
 */

export type Key =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "pageup" }
  | { kind: "pagedown" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "enter" }
  | { kind: "tab" }
  | { kind: "backtab" }
  | { kind: "esc" }
  | { kind: "ctrlc" }
  | { kind: "backspace" }
  | { kind: "char"; char: string };

const SEQUENCES: ReadonlyMap<string, Key> = new Map([
  ["\x1b[A", { kind: "up" }],
  ["\x1b[B", { kind: "down" }],
  ["\x1b[C", { kind: "right" }],
  ["\x1b[D", { kind: "left" }],
  ["\x1bOA", { kind: "up" }],
  ["\x1bOB", { kind: "down" }],
  ["\x1bOC", { kind: "right" }],
  ["\x1bOD", { kind: "left" }],
  ["\x1b[Z", { kind: "backtab" }],
  ["\x1b[H", { kind: "home" }],
  ["\x1b[F", { kind: "end" }],
  ["\x1bOH", { kind: "home" }],
  ["\x1bOF", { kind: "end" }],
  ["\x1b[1~", { kind: "home" }],
  ["\x1b[4~", { kind: "end" }],
  ["\x1b[5~", { kind: "pageup" }],
  ["\x1b[6~", { kind: "pagedown" }],
]);

const MAX_SEQUENCE = 5;

/** True when `pending` could still grow into a known escape sequence. */
function isPartialSequence(pending: string): boolean {
  for (const seq of SEQUENCES.keys()) {
    if (seq.startsWith(pending)) return true;
  }
  return false;
}

export class KeyReader {
  private buf = "";
  private readonly decoder = new TextDecoder("utf-8");
  private escTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly onKey: (key: Key) => void,
    private readonly escDelayMs = 30,
  ) {}

  feed(chunk: Buffer): void {
    this.buf += this.decoder.decode(chunk, { stream: true });
    this.drain(false);
  }

  /** Stop accepting input; drops any pending bytes and the Esc timer. */
  close(): void {
    if (this.escTimer !== undefined) {
      clearTimeout(this.escTimer);
      this.escTimer = undefined;
    }
    this.buf = "";
  }

  private scheduleEsc(): void {
    if (this.escTimer !== undefined) clearTimeout(this.escTimer);
    this.escTimer = setTimeout(() => {
      this.escTimer = undefined;
      this.drain(true);
    }, this.escDelayMs);
    this.escTimer.unref();
  }

  private drain(escTimedOut: boolean): void {
    for (;;) {
      if (this.buf === "") return;
      if (this.buf.startsWith("\x1b")) {
        // Try the longest known sequence first.
        let emitted = false;
        for (let len = Math.min(this.buf.length, MAX_SEQUENCE); len >= 3 && !emitted; len--) {
          const key = SEQUENCES.get(this.buf.slice(0, len));
          if (key !== undefined) {
            this.buf = this.buf.slice(len);
            this.onKey(key);
            emitted = true;
          }
        }
        if (emitted) continue;
        if (isPartialSequence(this.buf)) {
          if (this.buf === "\x1b" && escTimedOut) {
            this.buf = "";
            this.onKey({ kind: "esc" });
            return;
          }
          if (this.buf === "\x1b") this.scheduleEsc();
          return; // wait for the rest of a possible sequence
        }
        // ESC followed by a non-sequence byte: emit Esc, then keep parsing the rest.
        this.buf = this.buf.slice(1);
        this.onKey({ kind: "esc" });
        continue;
      }
      const code = this.buf.charCodeAt(0);
      if (code === 0x03) {
        this.buf = this.buf.slice(1);
        this.onKey({ kind: "ctrlc" });
        continue;
      }
      if (code === 0x0d || code === 0x0a) {
        this.buf = this.buf.slice(1);
        this.onKey({ kind: "enter" });
        continue;
      }
      if (code === 0x09) {
        this.buf = this.buf.slice(1);
        this.onKey({ kind: "tab" });
        continue;
      }
      if (code === 0x7f || code === 0x08) {
        this.buf = this.buf.slice(1);
        this.onKey({ kind: "backspace" });
        continue;
      }
      if (code < 0x20 || (code >= 0xd800 && code <= 0xdbff && this.buf.length < 2)) {
        // Other control bytes are ignored; a lone high surrogate needs its pair.
        if (code < 0x20) {
          this.buf = this.buf.slice(1);
          continue;
        }
        return;
      }
      const char = String.fromCodePoint(this.buf.codePointAt(0) ?? code);
      this.buf = this.buf.slice(char.length);
      this.onKey({ kind: "char", char });
    }
  }

  static isQuitKey(key: Key): boolean {
    return key.kind === "ctrlc";
  }
}
