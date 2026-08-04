import { describe, expect, it } from "vitest";

import { addModelVisibleStructuredContent } from "./otto-tool-serialization.js";
import type { OttoToolResult } from "./types.js";

const HEAD_CHARS = 26_000;
const TAIL_CHARS = 4_000;

function modelVisibleText(structuredContent: unknown): string {
  const result: OttoToolResult = { content: [], structuredContent };
  const [block] = addModelVisibleStructuredContent(result).content;
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected a single text block");
  }
  return block.text;
}

describe("addModelVisibleStructuredContent", () => {
  it("serializes compactly - indentation is token inflation replayed every round", () => {
    const text = modelVisibleText({ agents: [], nested: { a: 1, b: 2 } });

    expect(text).toContain('{"agents":[],"nested":{"a":1,"b":2}}');
    expect(text).not.toContain("\n  ");
    expect(text).not.toContain('": ');
  });

  it("keeps the array-summary preamble ahead of the JSON", () => {
    const text = modelVisibleText({
      agents: [{ id: "agent-1" }, { id: "agent-2" }],
    });

    expect(text.startsWith("agents_count=2\nagents_ids=agent-1,agent-2\n\n{")).toBe(true);
  });

  it("truncates results over 30K chars head-heavy with an explicit marker", () => {
    const text = modelVisibleText({ blob: "x".repeat(60_000) });

    expect(text.length).toBeLessThan(60_000);
    expect(text).toMatch(/\n\[\.\.\. \d+ characters truncated \.\.\.\]\n/);

    const [head, tail] = text.split(/\n\[\.\.\. \d+ characters truncated \.\.\.\]\n/);
    expect(head).toHaveLength(HEAD_CHARS);
    expect(tail).toHaveLength(TAIL_CHARS);
    // Head-heavy: the retained head is far larger than the retained tail.
    expect(head.length).toBeGreaterThan(tail.length);
  });

  it("truncates non-object structured content the same way", () => {
    const raw = JSON.stringify("y".repeat(60_000));
    const text = modelVisibleText("y".repeat(60_000));

    const removed = raw.length - HEAD_CHARS - TAIL_CHARS;
    expect(text).toBe(
      `${raw.slice(0, HEAD_CHARS)}\n[... ${removed} characters truncated ...]\n${raw.slice(-TAIL_CHARS)}`,
    );
  });

  it("leaves results under the cap untouched", () => {
    const text = modelVisibleText({ note: "small" });

    expect(text).toBe('{"note":"small"}');
  });

  it("does not overwrite content the tool already produced", () => {
    const result: OttoToolResult = {
      content: [{ type: "text", text: "handwritten" }],
      structuredContent: { agents: [] },
    };

    expect(addModelVisibleStructuredContent(result)).toBe(result);
  });
});
