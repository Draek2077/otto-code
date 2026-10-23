import { StringDecoder } from "node:string_decoder";

/** Minimal ANSI screen and input primitives. Importing never touches a TTY. */

const ESC = "\x1b";
const CSI = `${ESC}[`;

export const ansi = {
  altScreenOn: `${CSI}?1049h`,
  altScreenOff: `${CSI}?1049l`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  home: `${CSI}H`,
  clearScreen: `${CSI}2J`,
  clearToEol: `${CSI}K`,
  clearBelow: `${CSI}J`,
  reset: `${CSI}0m`,
};

export const style = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  inverse: `${CSI}7m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  magenta: `${CSI}35m`,
  cyan: `${CSI}36m`,
  white: `${CSI}37m`,
  grey: `${CSI}90m`,
  brightGreen: `${CSI}92m`,
  brightYellow: `${CSI}93m`,
  brightCyan: `${CSI}96m`,
};

export const BOX = {
  h: "─",
  v: "│",
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  full: "█",
  light: "░",
};

/** Options for a titled box. */
export interface BoxOptions {
  title?: string;
  lines: string[];
  innerWidth: number;
  footer?: string | null;
  accent?: string;
}

/** Printable width, ignoring ANSI escapes. */
export function width(text: string): number {
  return [...stripStyles(text)].reduce((sum, char) => sum + cellWidth(char), 0);
}

function cellWidth(char: string): number {
  if (/\p{Mark}/u.test(char) || char === "\u200d" || char === "\ufe0f") return 0;
  const code = char.codePointAt(0) ?? 0;
  const wide =
    code >= 0x1100 &&
    (code <= 0x115f ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      code >= 0x1f300);
  return wide ? 2 : 1;
}

/** Keep renderer SGR colors, remove cursor commands, OSC links and controls from host text. */
export function safeLine(text: string): string {
  return lineTokens(text).join("");
}

export function stripStyles(text: string): string {
  return lineTokens(text)
    .filter((token) => !token.startsWith(ESC))
    .join("");
}

/** Recognize ANSI introducers as characters, then match printable parameters.
 * This keeps the original SGR grammar without regexes containing control bytes. */
function lineTokens(text: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === ESC) {
      const sequence = escapeSequence(text.slice(index + 1));
      if (sequence.color) tokens.push(ESC + sequence.text);
      index += 1 + sequence.text.length;
      continue;
    }
    const code = text.codePointAt(index) ?? 0;
    const printable = code >= 32 && !(code >= 127 && code <= 159);
    const token = String.fromCodePoint(code);
    if (printable) tokens.push(token);
    index += token.length;
  }
  return tokens;
}

function escapeSequence(rest: string): { text: string; color: boolean } {
  if (rest.startsWith("]")) {
    let index = 1;
    while (index < rest.length) {
      if (rest.charCodeAt(index) === 7) return { text: rest.slice(0, index + 1), color: false };
      if (rest[index] === ESC && rest[index + 1] === "\\")
        return { text: rest.slice(0, index + 2), color: false };
      index += 1;
    }
    return { text: rest, color: false };
  }
  const csi = /^\[[0-?]*[ -/]*[@-~]/.exec(rest)?.[0];
  if (csi) return { text: csi, color: /^\[[0-9;]*m$/.test(csi) };
  return { text: rest.slice(0, 1), color: false };
}

export function truncate(text: string, max: number): string {
  const plain = safeLine(text);
  if (width(plain) <= max) return plain;
  if (max <= 0) return "";
  let out = "";
  let cells = 0;
  for (const token of lineTokens(plain)) {
    if (token.startsWith(ESC)) {
      out += token;
      continue;
    }
    const size = cellWidth(token);
    if (cells + size > max - 1) break;
    out += token;
    cells += size;
  }
  return `${out}…${style.reset}`;
}

export function pad(text: string, max: number): string {
  const gap = max - width(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

/** A titled box as an array of lines. */
export function box({
  title,
  lines,
  innerWidth,
  footer = null,
  accent = style.grey,
}: BoxOptions): string[] {
  const out: string[] = [];
  const label = title ? ` ${title} ` : "";
  const dashes = Math.max(0, innerWidth - width(label));
  out.push(`${accent}${BOX.tl}${label}${BOX.h.repeat(dashes)}${BOX.tr}${style.reset}`);
  for (const line of lines) {
    out.push(
      `${accent}${BOX.v}${style.reset}${pad(truncate(line, innerWidth), innerWidth)}${accent}${BOX.v}${style.reset}`,
    );
  }
  if (footer !== null) {
    out.push(
      `${accent}${BOX.v}${style.reset}${pad(truncate(footer, innerWidth), innerWidth)}${accent}${BOX.v}${style.reset}`,
    );
  }
  out.push(`${accent}${BOX.bl}${BOX.h.repeat(innerWidth)}${BOX.br}${style.reset}`);
  return out;
}

/** Horizontal meter, coloured by how close to the limit it sits. */
export function meter(fraction: number, cells: number): string {
  cells = Math.max(0, Math.floor(cells));
  if (!Number.isFinite(fraction)) fraction = 0;
  const clamped = Math.max(0, Math.min(1.2, fraction));
  const filled = Math.min(cells, Math.round(clamped * cells));
  let colour = style.brightGreen;
  if (clamped > 1) colour = style.red;
  else if (clamped > 0.9) colour = style.brightYellow;
  return `${colour}${BOX.full.repeat(filled)}${style.grey}${BOX.light.repeat(Math.max(0, cells - filled))}${style.reset}`;
}

export interface TerminalOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(text: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export interface TuiScreen {
  readonly columns: number;
  readonly rows: number;
  readonly entered: boolean;
  enter(): void;
  leave(): void;
  render(lines: string[]): void;
  invalidate(): void;
  onResize(listener: () => void): () => void;
}

export class Screen implements TuiScreen {
  out: TerminalOutput;
  previous: string[];
  entered: boolean;

  constructor(stream: TerminalOutput = process.stdout) {
    this.out = stream;
    this.previous = [];
    this.entered = false;
  }

  get columns(): number {
    return this.out.columns || 100;
  }
  get rows(): number {
    return this.out.rows || 30;
  }

  enter(): void {
    if (this.entered) return;
    this.entered = true;
    this.previous = [];
    this.out.write(ansi.altScreenOn + ansi.hideCursor + ansi.clearScreen + ansi.home);
  }

  leave(): void {
    if (!this.entered) return;
    this.entered = false;
    this.out.write(ansi.showCursor + ansi.altScreenOff);
  }

  /** Repaint only the lines that changed. */
  render(lines: string[]): void {
    lines = lines.map((line) => truncate(line, Math.max(1, this.columns - 1)));
    let frame = ansi.home;
    const height = Math.min(lines.length, this.rows - 1);
    for (let i = 0; i < height; i += 1) {
      if (this.previous[i] === lines[i]) {
        frame += `${CSI}${i + 2};1H`;
        continue;
      }
      frame += `${CSI}${i + 1};1H${lines[i]}${ansi.clearToEol}`;
    }
    if (this.previous.length > height) {
      frame += `${CSI}${height + 1};1H${ansi.clearBelow}`;
    }
    this.out.write(frame);
    this.previous = lines.slice(0, height);
  }

  invalidate(): void {
    this.previous = [];
    this.out.write(ansi.clearScreen);
  }

  onResize(listener: () => void): () => void {
    this.out.on("resize", listener);
    return () => {
      this.out.off("resize", listener);
    };
  }
}

/** Decode a raw stdin chunk into a key name. */
export function decodeKey(chunk: unknown): string | null {
  const s = String(chunk);
  const named: Record<string, string> = {
    "\x1b[A": "up",
    "\x1b[B": "down",
    "\x1b[C": "right",
    "\x1b[D": "left",
    "\x1b[H": "home",
    "\x1b[F": "end",
    "\x1b[5~": "pageup",
    "\x1b[6~": "pagedown",
    "\r": "enter",
    "\n": "enter",
    "\t": "tab",
    "\x1b[Z": "shifttab",
    "\x7f": "backspace",
    "\b": "backspace",
    "\x1b": "escape",
    "\x03": "ctrl-c",
    "\x04": "ctrl-d",
    " ": "space",
  };
  if (named[s]) return named[s];
  if (s.length === 1) return s;
  return null;
}

export function onKeys(
  handler: (key: string, chunk: unknown) => void,
  stream: NodeJS.ReadStream = process.stdin,
): () => void {
  if (!stream.isTTY || typeof stream.setRawMode !== "function")
    throw new Error("The interactive UI needs terminal input.");
  const wasRaw = stream.isRaw;
  const wasFlowing = stream.readableFlowing === true;
  stream.setRawMode(true);
  stream.resume();
  const decoder = new StringDecoder("utf8");
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  const keys = new KeyDecoder((key) => handler(key, key));
  const listener = (chunk: Buffer | string): void => {
    clearTimeout(escapeTimer);
    keys.push(typeof chunk === "string" ? chunk : decoder.write(chunk));
    if (keys.pendingEscape) escapeTimer = setTimeout(() => keys.flush(), 35);
  };
  stream.on("data", listener);
  return () => {
    stream.off("data", listener);
    clearTimeout(escapeTimer);
    stream.setRawMode(wasRaw);
    if (!wasFlowing) stream.pause();
  };
}

/** Escape sequences can span chunks; pasted text can contain many keys. */
export class KeyDecoder {
  private buffer = "";
  constructor(private readonly emit: (key: string) => void) {}
  get pendingEscape(): boolean {
    return this.buffer.startsWith(ESC);
  }
  push(text: string): void {
    this.buffer += text;
    while (this.buffer) {
      if (this.buffer.startsWith(ESC)) {
        const rest = this.buffer.slice(1);
        const sequence = /^(?:\[[0-?]*[ -/]*[@-~]|O[A-Z])/.exec(rest)?.[0];
        if (sequence) {
          const normalized = sequence.startsWith("O") ? "[" + sequence.slice(1) : sequence;
          const key = decodeKey(ESC + normalized);
          this.buffer = this.buffer.slice(sequence.length + 1);
          if (key) this.emit(key);
          continue;
        }
        if (this.buffer === ESC || /^\[[0-?]*[ -/]*$/.test(rest)) return;
        this.buffer = this.buffer.slice(1);
        this.emit("escape");
        continue;
      }
      const char = [...this.buffer][0];
      this.buffer = this.buffer.slice(char.length);
      const key = decodeKey(char);
      if (key) this.emit(key);
    }
  }
  flush(): void {
    if (this.buffer.startsWith(ESC)) this.emit("escape");
    this.buffer = "";
  }
}
