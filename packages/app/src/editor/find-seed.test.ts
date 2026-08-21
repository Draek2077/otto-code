import { describe, expect, it } from "vitest";
import { resolveFindSeed } from "./find-seed";
import type { EditorSelection } from "./editor-contract";

function selection(overrides: Partial<EditorSelection> = {}): EditorSelection {
  return {
    text: "needle",
    lineStart: 12,
    lineEnd: 12,
    columnStart: 1,
    columnEnd: 7,
    isEmpty: false,
    ...overrides,
  };
}

describe("resolveFindSeed", () => {
  it("seeds a single-line selection", () => {
    expect(resolveFindSeed(selection())).toBe("needle");
  });

  it("keeps the existing term when nothing is selected", () => {
    expect(resolveFindSeed(selection({ text: "", isEmpty: true }))).toBeNull();
  });

  it("keeps the existing term for a multi-line selection", () => {
    expect(resolveFindSeed(selection({ text: "one\ntwo", lineEnd: 13 }))).toBeNull();
  });

  it("seeds whitespace, which is a legitimate thing to search for", () => {
    expect(resolveFindSeed(selection({ text: "  " }))).toBe("  ");
  });

  it("seeds a selection right at the length cap", () => {
    const term = "x".repeat(100);
    expect(resolveFindSeed(selection({ text: term }))).toBe(term);
  });

  it("keeps the existing term when the selection is too long to be a term", () => {
    expect(resolveFindSeed(selection({ text: "x".repeat(101) }))).toBeNull();
  });
});
