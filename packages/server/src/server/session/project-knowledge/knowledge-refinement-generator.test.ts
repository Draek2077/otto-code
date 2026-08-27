import { describe, expect, it, vi } from "vitest";
import {
  KnowledgeRefinementError,
  buildKnowledgeRefinementPrompt,
  createKnowledgeRefinementGenerator,
} from "./knowledge-refinement-generator.js";

describe("Knowledge refinement generator", () => {
  it("scopes every anchored refinement to its exact source fragment", () => {
    const prompt = buildKnowledgeRefinementPrompt({
      content: "The replacement is already here.",
      directives: [
        {
          kind: "refine",
          selectedText: "already here",
          beforeContext: "The replacement is ",
          afterContext: ".",
          value: "Make this more precise.",
        },
      ],
    });
    expect(prompt).toContain("Direct replacements were already applied before this pass.");
    expect(prompt).toContain("Make this more precise.");
  });

  it("splices structured responses into only the requested source ranges", async () => {
    const generate = vi.fn(async () => ({ replacements: [{ id: "note-1", content: "Refined" }] }));
    const generator = createKnowledgeRefinementGenerator({
      generation: { generate, resolveAgent: async () => null } as never,
    });
    await expect(
      generator.propose({
        cwd: "/repo",
        content: "# Original\n",
        directives: [
          {
            id: "note-1",
            kind: "refine",
            anchor: { kind: "text", start: 2, end: 10 },
            value: "Tighten the heading.",
          },
        ],
      }),
    ).resolves.toBe("# Refined\n");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ agentTitle: "Knowledge Refinement" }),
    );
  });

  it("rejects a missing refinement pass", () => {
    expect(() => buildKnowledgeRefinementPrompt({ content: "Article", directives: [] })).toThrow(
      KnowledgeRefinementError,
    );
  });
});
