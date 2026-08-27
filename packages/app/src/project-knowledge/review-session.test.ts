import { describe, expect, it } from "vitest";
import { applyDirectReplacements } from "./review-session";

describe("Project Knowledge review directives", () => {
  it("applies an exact replacement to its selected source range", () => {
    const source = "The daemon owns the writes. The daemon serves the reads.";
    const result = applyDirectReplacements(source, [
      {
        id: "replace-1",
        kind: "replace",
        anchor: { kind: "text", start: 4, end: 10, label: "daemon" },
        value: "service",
      },
    ]);
    expect(result).toEqual({
      content: "The service owns the writes. The daemon serves the reads.",
      refinements: [],
      error: null,
    });
  });

  it("moves refinement ranges after earlier direct replacements", () => {
    const result = applyDirectReplacements("daemon and daemon", [
      {
        id: "replace-1",
        kind: "replace",
        anchor: { kind: "text", start: 0, end: 6, label: "daemon" },
        value: "service",
      },
      {
        id: "refine-1",
        kind: "refine",
        anchor: { kind: "text", start: 11, end: 17, label: "daemon" },
        value: "Make this precise.",
      },
    ]);
    expect(result).toEqual({
      content: "service and daemon",
      refinements: [
        {
          id: "refine-1",
          kind: "refine",
          anchor: { kind: "text", start: 12, end: 18, label: "daemon" },
          value: "Make this precise.",
        },
      ],
      error: null,
    });
  });
});
