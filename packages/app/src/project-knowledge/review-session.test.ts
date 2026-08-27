import { describe, expect, it } from "vitest";
import { applyDirectReplacements, buildKnowledgeReviewInstruction } from "./review-session";

describe("Project Knowledge review directives", () => {
  it("applies an exact replacement only when its saved context identifies one passage", () => {
    const source = "The daemon owns the writes. The daemon serves the reads.";
    const result = applyDirectReplacements(source, [
      {
        id: "replace-1",
        kind: "replace",
        selectedText: "daemon",
        beforeContext: "The ",
        afterContext: " owns",
        value: "service",
      },
    ]);
    expect(result).toEqual({
      content: "The service owns the writes. The daemon serves the reads.",
      error: null,
    });
  });

  it("refuses an ambiguous replacement and tells the model to preserve accepted exact text", () => {
    const directive = {
      id: "replace-1",
      kind: "replace" as const,
      selectedText: "daemon",
      beforeContext: "",
      afterContext: "",
      value: "service",
    };
    expect(applyDirectReplacements("daemon and daemon", [directive]).error).toMatch(
      /one exact passage/,
    );
    expect(buildKnowledgeReviewInstruction([directive])).toContain(
      "Preserve their replacement text verbatim",
    );
  });
});
