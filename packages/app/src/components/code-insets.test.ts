import { describe, expect, it } from "vitest";
import { lineNumberGutterWidth } from "./code-insets";

describe("lineNumberGutterWidth", () => {
  it("retains the editor's two-digit minimum by default", () => {
    const shortFileWidth = lineNumberGutterWidth(99, 12, 4);
    const longFileWidth = lineNumberGutterWidth(12_345, 12, 4);

    expect(shortFileWidth).toBe(20);
    expect(longFileWidth).toBe(44);
    expect(longFileWidth).toBeGreaterThan(shortFileWidth);
  });

  it("supports a one-digit compact lane for paired diff coordinates", () => {
    expect(lineNumberGutterWidth(9, 12, 0, 1)).toBe(8);
    expect(lineNumberGutterWidth(99, 12, 0, 1)).toBe(16);
    expect(lineNumberGutterWidth(12_345, 12, 0, 1)).toBe(40);
  });
});
