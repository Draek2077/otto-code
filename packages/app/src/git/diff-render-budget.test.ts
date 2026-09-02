import type { ParsedDiffFile } from "@otto-code/protocol/messages";
import { describe, expect, it } from "vitest";
import { MAX_DIFF_RENDER_LINES, exceedsDiffRenderBudget } from "./diff-render-budget";

function diffWithLines(count: number): ParsedDiffFile {
  return {
    path: "src/generated.ts",
    isNew: false,
    isDeleted: false,
    additions: count,
    deletions: 0,
    hunks: [
      {
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: count,
        lines: Array.from({ length: count }, () => ({ type: "add" as const, content: "value" })),
      },
    ],
  };
}

describe("diff render budget", () => {
  it("allows the exact renderer line limit", () => {
    expect(exceedsDiffRenderBudget([diffWithLines(MAX_DIFF_RENDER_LINES)])).toBe(false);
  });

  it("rejects a payload before the canvas model can be built", () => {
    expect(exceedsDiffRenderBudget([diffWithLines(MAX_DIFF_RENDER_LINES + 1)])).toBe(true);
  });
});
