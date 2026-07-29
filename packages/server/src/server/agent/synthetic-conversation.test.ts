import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { generateSyntheticConversation } from "./synthetic-conversation.js";

describe("generateSyntheticConversation", () => {
  // ── Determinism ────────────────────────────────────────────────────────

  it("is deterministic: same seed + count produces identical output", () => {
    const a = generateSyntheticConversation({ seed: 42, itemCount: 50 });
    const b = generateSyntheticConversation({ seed: 42, itemCount: 50 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different conversations", () => {
    const a = generateSyntheticConversation({ seed: 1, itemCount: 30 });
    const b = generateSyntheticConversation({ seed: 2, itemCount: 30 });
    expect(a).not.toEqual(b);
  });

  // ── Exact count ───────────────────────────────────────────────────────

  it("honours itemCount exactly for edge sizes", () => {
    for (const n of [1, 2, 5, 10, 50, 100, 400]) {
      const items = generateSyntheticConversation({ seed: 99, itemCount: n });
      expect(items).toHaveLength(n);
    }
  });

  // ── First item is always a user message ───────────────────────────────

  it("always starts with a user_message", () => {
    for (const count of [1, 10, 50, 200]) {
      const items = generateSyntheticConversation({ seed: 7, itemCount: count });
      expect(items[0]).toMatchObject({ type: "user_message" });
    }
  });

  // ── Mix of types in large conversations ───────────────────────────────

  it("contains a realistic mix of item types for large conversations", () => {
    const items = generateSyntheticConversation({ seed: 123, itemCount: 400 });

    const types = new Set(items.map((i) => i.type));
    expect(types).toContain("user_message");
    expect(types).toContain("assistant_message");
    expect(types).toContain("tool_call");
    // Reasoning blocks appear occasionally but should show up in a 400-item run.
    expect(types).toContain("reasoning");
  });

  it("includes at least one assistant message with a fenced code block", () => {
    const items = generateSyntheticConversation({ seed: 55, itemCount: 200 });
    const assistantMessages = items.filter(
      (i): i is Extract<AgentTimelineItem, { type: "assistant_message" }> =>
        i.type === "assistant_message",
    );
    const hasCodeBlock = assistantMessages.some((m) => m.text.includes("```"));
    expect(hasCodeBlock).toBe(true);
  });

  // ── Distinctness (the key property for performance testing) ────────────
  // The corpus feeds a rendering benchmark where the app caches block heights
  // keyed by text. Near-identical blocks hit that cache, making results look
  // artificially fast. This test guards against pool exhaustion.

  it("produces near-unique assistant message texts in large conversations", () => {
    const items = generateSyntheticConversation({ seed: 42, itemCount: 400 });
    const assistantMessages = items.filter(
      (i): i is Extract<AgentTimelineItem, { type: "assistant_message" }> =>
        i.type === "assistant_message",
    );
    const texts = assistantMessages.map((m) => m.text);
    const distinctCount = new Set(texts).size;

    // At least 90% of assistant messages should have unique text.
    expect(distinctCount).toBeGreaterThanOrEqual(Math.ceil(assistantMessages.length * 0.9));

    // Log the ratio for visibility when this test is run with `--reporter=verbose`.
    console.log(
      `Assistant message distinctness: ${distinctCount}/${texts.length} (${Math.round((distinctCount / texts.length) * 100)}%)`,
    );
  });

  // ── Structural validity ───────────────────────────────────────────────

  it("every item is a valid AgentTimelineItem shape", () => {
    const items = generateSyntheticConversation({ seed: 77, itemCount: 100 });
    for (const item of items) {
      expect(item).toHaveProperty("type");
      switch (item.type) {
        case "user_message":
          expect(typeof item.text).toBe("string");
          break;
        case "assistant_message":
          expect(typeof item.text).toBe("string");
          break;
        case "reasoning":
          expect(typeof item.text).toBe("string");
          break;
        case "tool_call":
          expect(item.callId).toBeDefined();
          expect(item.name).toBeDefined();
          expect(item.detail.type).toBeDefined();
          expect(["completed", "running", "failed", "canceled"]).toContain(item.status);
          break;
        default:
          // We don't generate todo, error, or compaction in the synthetic corpus.
          throw new Error(`Unexpected item type: ${(item as AgentTimelineItem).type}`);
      }
    }
  });

  it("tool calls appear in consecutive runs (bursts), not isolated", () => {
    const items = generateSyntheticConversation({ seed: 42, itemCount: 300 });
    let maxBurst = 0;
    let currentBurst = 0;

    for (const item of items) {
      if (item.type === "tool_call") {
        currentBurst++;
        maxBurst = Math.max(maxBurst, currentBurst);
      } else {
        currentBurst = 0;
      }
    }

    // We configured bursts of 1–8, so the max burst should be well above 1.
    expect(maxBurst).toBeGreaterThanOrEqual(2);
  });

  it("single-item conversation is just a user message", () => {
    const items = generateSyntheticConversation({ seed: 0, itemCount: 1 });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ type: "user_message", text: expect.any(String) });
  });
});
