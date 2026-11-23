import { describe, expect, it } from "vitest";
import {
  ansi,
  box,
  KeyDecoder,
  meter,
  safeLine,
  Screen,
  style,
  truncate,
  width,
} from "./screen.js";
import type { TerminalOutput } from "./screen.js";

class Output implements TerminalOutput {
  columns = 20;
  rows = 6;
  chunks: string[] = [];
  listeners = new Set<() => void>();
  write(text: string): void {
    this.chunks.push(text);
  }
  on(_event: "resize", listener: () => void): void {
    this.listeners.add(listener);
  }
  off(_event: "resize", listener: () => void): void {
    this.listeners.delete(listener);
  }
}

describe("terminal screen and keyboard adapters", () => {
  it("does nothing during construction and restores the screen exactly once", () => {
    const output = new Output();
    const screen = new Screen(output);
    expect(output.chunks).toEqual([]);
    screen.enter();
    screen.enter();
    screen.leave();
    screen.leave();
    expect(output.chunks).toEqual([
      ansi.altScreenOn + ansi.hideCursor + ansi.clearScreen + ansi.home,
      ansi.showCursor + ansi.altScreenOff,
    ]);
  });
  it("repaints changed lines only and resets the frame after reentry", () => {
    const output = new Output();
    const screen = new Screen(output);
    screen.enter();
    screen.render(["first", "second"]);
    screen.render(["first", "changed"]);
    expect(output.chunks.at(-1)).not.toContain("first");
    expect(output.chunks.at(-1)).toContain("changed");
    screen.leave();
    screen.enter();
    screen.render(["first"]);
    expect(output.chunks.at(-1)).toContain("first");
    const detach = screen.onResize(() => {});
    expect(output.listeners.size).toBe(1);
    detach();
    expect(output.listeners.size).toBe(0);
  });
  it("clips styled lines by printable width without breaking ANSI or wide glyphs", () => {
    const clipped = truncate(`${style.cyan}模型abcdef${style.reset}`, 7);
    expect(width(clipped)).toBe(7);
    expect(clipped).toContain("…");
    expect(clipped.endsWith(style.reset)).toBe(true);
    const lines = box({
      title: "Brain",
      lines: [`${style.cyan}abcdefghijk${style.reset}`],
      innerWidth: 8,
    });
    expect(lines.map(width)).toEqual([10, 10, 10]);
  });
  it("removes host-provided terminal control sequences before rendering", () => {
    const output = new Output();
    const screen = new Screen(output);
    screen.enter();
    screen.render(["log\x1b[2J\x1b]52;c;c2VjcmV0\x07\r\nnext"]);
    expect(output.chunks.at(-1)).not.toContain("\x1b]52");
    expect(output.chunks.at(-1)).not.toContain("\x1b[2J");
    expect(safeLine("a\x1b[H\x1b[31mb\x1b[0m")).toBe("a\x1b[31mb\x1b[0m");
  });
  it("decodes split arrow sequences, multiple keys, spaces and control keys", () => {
    const keys: string[] = [];
    const decoder = new KeyDecoder((key) => keys.push(key));
    decoder.push("\x1b[");
    expect(keys).toEqual([]);
    decoder.push("Aab \r\x03");
    expect(keys).toEqual(["up", "a", "b", "space", "enter", "ctrl-c"]);
    decoder.push("\x1b");
    decoder.flush();
    expect(keys.at(-1)).toBe("escape");
  });
  it("ignores unknown complete terminal sequences and handles SS3 arrows", () => {
    const keys: string[] = [];
    const decoder = new KeyDecoder((key) => keys.push(key));
    decoder.push("\x1b[200~hello\x1b[201~\x1bOB");
    expect(keys).toEqual(["h", "e", "l", "l", "o", "down"]);
  });
  it("keeps zero-width truncation and unavailable meter samples bounded", () => {
    expect(truncate("a", 0)).toBe("");
    expect(width(meter(Number.NaN, 10))).toBe(10);
    expect(width(meter(2, 10))).toBe(10);
  });
});
