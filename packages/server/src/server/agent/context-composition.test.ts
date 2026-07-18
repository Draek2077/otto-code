import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { estimateContextComposition } from "./context-composition.js";

describe("estimateContextComposition", () => {
  it("returns undefined for an empty or uncategorizable timeline", () => {
    expect(estimateContextComposition([])).toBeUndefined();
    expect(
      estimateContextComposition([
        { type: "todo", items: [{ text: "x", completed: false }] },
        { type: "error", message: "boom" },
      ]),
    ).toBeUndefined();
  });

  it("folds user + assistant dialogue into userMessages (~4 chars/token)", () => {
    const composition = estimateContextComposition([
      { type: "user_message", text: "a".repeat(40) },
      { type: "assistant_message", text: "b".repeat(40) },
    ]);
    expect(composition).toEqual({ userMessages: 20 });
  });

  it("routes reasoning and tool results to their own categories", () => {
    const composition = estimateContextComposition([
      { type: "reasoning", text: "r".repeat(80) },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "/a.ts", content: "x".repeat(200) },
      },
    ]);
    expect(composition?.reasoning).toBe(20);
    // toolResults estimated from the whole serialized detail, so > 0 and present.
    expect(composition?.toolResults).toBeGreaterThan(0);
    expect(composition?.userMessages).toBeUndefined();
  });

  it("routes sub_agent tool calls to subagentResults, not toolResults", () => {
    const composition = estimateContextComposition([
      {
        type: "tool_call",
        callId: "c2",
        name: "Task",
        status: "completed",
        error: null,
        detail: { type: "sub_agent", log: "y".repeat(120), description: "explore" },
      },
    ]);
    expect(composition?.subagentResults).toBeGreaterThan(0);
    expect(composition?.toolResults).toBeUndefined();
  });

  it("never populates systemPrompt (Otto does not track it)", () => {
    const composition = estimateContextComposition([
      { type: "user_message", text: "hello there friend" },
    ] satisfies AgentTimelineItem[]);
    expect(composition?.systemPrompt).toBeUndefined();
  });
});
