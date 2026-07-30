/** Minimal ANSI screen and input primitives - no dependencies. */

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
  return String(text).replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function truncate(text: string, max: number): string {
  const plain = String(text);
  if (width(plain) <= max) return plain;
  // Only called on unstyled strings, so a plain slice is safe.
  return `${plain.slice(0, Math.max(0, max - 1))}…`;
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
  const clamped = Math.max(0, Math.min(1.2, fraction));
  const filled = Math.min(cells, Math.round(clamped * cells));
  let colour = style.brightGreen;
  if (clamped > 1) colour = style.red;
  else if (clamped > 0.9) colour = style.brightYellow;
  return `${colour}${BOX.full.repeat(filled)}${style.grey}${BOX.light.repeat(Math.max(0, cells - filled))}${style.reset}`;
}

export class Screen {
  out: NodeJS.WriteStream;
  previous: string[];
  entered: boolean;

  constructor(stream: NodeJS.WriteStream = process.stdout) {
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
    this.out.write(ansi.altScreenOn + ansi.hideCursor + ansi.clearScreen + ansi.home);
  }

  leave(): void {
    if (!this.entered) return;
    this.entered = false;
    this.out.write(ansi.showCursor + ansi.altScreenOff);
  }

  /** Repaint only the lines that changed. */
  render(lines: string[]): void {
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
  if (stream.isTTY) stream.setRawMode(true);
  stream.resume();
  stream.setEncoding("utf8");
  const listener = (chunk: unknown): void => {
    const key = decodeKey(chunk);
    if (key) handler(key, chunk);
  };
  stream.on("data", listener);
  return () => {
    stream.off("data", listener);
    if (stream.isTTY) stream.setRawMode(false);
    stream.pause();
  };
}
