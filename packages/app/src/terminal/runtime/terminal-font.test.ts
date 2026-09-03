import { describe, expect, it } from "vitest";

import {
  BUNDLED_NERD_SYMBOLS_FONT_FAMILY,
  BUNDLED_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_FAMILY,
  resolveTerminalFontFamily,
} from "./terminal-font";

describe("terminal font fallback", () => {
  it("uses Otto's loaded mono font and symbol fallback by default", () => {
    expect(DEFAULT_TERMINAL_FONT_FAMILY).toMatch(
      new RegExp(`^${BUNDLED_TERMINAL_FONT_FAMILY}, ${BUNDLED_NERD_SYMBOLS_FONT_FAMILY}`),
    );
    expect(resolveTerminalFontFamily(undefined)).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });

  it("preserves a custom text face while retaining Otto's symbol fallback", () => {
    expect(resolveTerminalFontFamily("Cascadia Mono")).toMatch(
      new RegExp(`^Cascadia Mono, ${BUNDLED_NERD_SYMBOLS_FONT_FAMILY}, `),
    );
  });
});
