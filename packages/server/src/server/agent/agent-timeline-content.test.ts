import { describe, expect, test } from "vitest";

import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";

describe("agent timeline content", () => {
  test("limits terminal input to the tool-call content budget", () => {
    const oversizedInput = "x".repeat(64 * 1024 + 1);

    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "terminal-session-4242",
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        text: oversizedInput,
        icon: "square_terminal",
      },
    });

    expect(item).toEqual({
      type: "tool_call",
      callId: "terminal-session-4242",
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        text: "x".repeat(64 * 1024),
        icon: "square_terminal",
      },
    });
  });

  test("head/tail-caps streamed write content", () => {
    const content = `${"a".repeat(64 * 1024)}${"b".repeat(1000)}${"c".repeat(16 * 1024)}`;

    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "write-1",
      name: "Write",
      status: "running",
      error: null,
      detail: { type: "write", filePath: "src/big.ts", content },
    });

    const limited = item.type === "tool_call" && item.detail.type === "write" ? item.detail : null;
    expect(limited?.content).toBe(
      [
        "a".repeat(48 * 1024),
        `[... Otto truncated ${content.length - 64 * 1024} characters ...]`,
        "c".repeat(16 * 1024),
      ].join("\n"),
    );
    expect(limited?.filePath).toBe("src/big.ts");
  });

  test("caps completed edit strings the same way shell output is capped", () => {
    const oldString = "o".repeat(64 * 1024 + 1);
    const newString = "n".repeat(64 * 1024 + 1);

    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "edit-1",
      name: "Edit",
      status: "completed",
      error: null,
      detail: {
        type: "edit",
        filePath: "src/big.ts",
        oldString,
        newString,
        unifiedDiff: "@@ -1 +1 @@",
      },
    });

    const limited = item.type === "tool_call" && item.detail.type === "edit" ? item.detail : null;
    expect(limited?.oldString).toContain("[... Otto truncated 1 characters ...]");
    expect(limited?.oldString?.startsWith("o".repeat(48 * 1024))).toBe(true);
    expect(limited?.newString).toContain("[... Otto truncated 1 characters ...]");
    // Under-budget fields are left byte-identical.
    expect(limited?.unifiedDiff).toBe("@@ -1 +1 @@");
  });

  test("leaves under-budget file content untouched", () => {
    const detail = { type: "write", filePath: "src/small.ts", content: "x".repeat(64 * 1024) };
    const item = {
      type: "tool_call",
      callId: "write-2",
      name: "Write",
      status: "running",
      error: null,
      detail,
    } as const;

    expect(limitAgentTimelineItemContent(item)).toBe(item);
  });
});
