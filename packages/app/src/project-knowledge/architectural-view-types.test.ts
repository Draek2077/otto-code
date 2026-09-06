import { describe, expect, it } from "vitest";
import { detectArchitecturalViewType } from "./architectural-view-types";

describe("Interactive View type detection", () => {
  it("treats a Mermaid sequence diagram as an unambiguous Sequence View", () => {
    expect(
      detectArchitecturalViewType({
        title: "Cache fallback",
        markdown: "```mermaid\nsequenceDiagram\nClient->>API: request\n```",
      }),
    ).toEqual({ diagramType: "sequence", evidence: "Detected a Mermaid sequence diagram" });
  });

  it("treats a Mermaid state diagram as an unambiguous Lifecycle View", () => {
    expect(
      detectArchitecturalViewType({
        title: "Run state",
        markdown: "```mermaid\nstateDiagram-v2\nQueued --> Running\n```",
      }),
    ).toEqual({ diagramType: "lifecycle", evidence: "Detected a Mermaid state diagram" });
  });

  it("does not silently choose a type for ambiguous source", () => {
    expect(detectArchitecturalViewType({ title: "Overview", markdown: "A useful note." })).toBe(
      null,
    );
  });
});
