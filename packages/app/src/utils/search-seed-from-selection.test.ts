import { describe, expect, it } from "vitest";
import { normalizeSearchSeed } from "./search-seed-from-selection";

describe("normalizeSearchSeed", () => {
  it("uses a single-line highlight, trimmed", () => {
    expect(normalizeSearchSeed("  useProjectSearch ")).toBe("useProjectSearch");
  });

  it("ignores an empty or whitespace-only selection", () => {
    expect(normalizeSearchSeed(null)).toBeNull();
    expect(normalizeSearchSeed("")).toBeNull();
    expect(normalizeSearchSeed(" \t ")).toBeNull();
  });

  it("ignores a selection that spans lines", () => {
    expect(normalizeSearchSeed("first\nsecond")).toBeNull();
    expect(normalizeSearchSeed("first\r\nsecond")).toBeNull();
  });

  it("keeps a selection whose only line break is surrounding whitespace", () => {
    expect(normalizeSearchSeed("\nsymbol\n")).toBe("symbol");
  });

  it("ignores a selection too long to be a search term", () => {
    expect(normalizeSearchSeed("x".repeat(501))).toBeNull();
  });
});
