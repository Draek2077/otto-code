import { describe, expect, it } from "vitest";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import type { ToolCallDetail } from "@otto-code/protocol/agent-types";
import {
  countActionGroupCategories,
  groupConsecutiveActionItems,
  isGroupableActionItem,
} from "./action-grouping";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function assistantMessage(id: string, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function toolCall(
  id: string,
  seed: number,
  options?: { detail?: ToolCallDetail; status?: "running" | "completed"; name?: string },
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: options?.name ?? "Read",
        status: options?.status ?? "completed",
        error: null,
        detail: options?.detail ?? { type: "read", filePath: `/tmp/${id}` },
      },
    },
  };
}

function thought(id: string, seed: number): Extract<StreamItem, { kind: "thought" }> {
  return {
    kind: "thought",
    id,
    text: id,
    timestamp: createTimestamp(seed),
    status: "ready",
  };
}

function speakToolCall(id: string, seed: number): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "speak",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: "hello there", output: null },
      },
    },
  };
}

function expectActionGroup(item: StreamItem): Extract<StreamItem, { kind: "action_group" }> {
  if (item.kind !== "action_group") {
    throw new Error(`expected action_group, got ${item.kind}`);
  }
  return item;
}

describe("groupConsecutiveActionItems", () => {
  it("returns the input identity when no run has two settled actions", () => {
    const items = [
      toolCall("t1", 1),
      assistantMessage("a1", 2),
      toolCall("t2", 3),
      toolCall("t3", 4, { status: "running" }),
      toolCall("t4", 5, { status: "running" }),
    ];

    expect(groupConsecutiveActionItems(items)).toBe(items);
  });

  it("folds a fully settled run entirely into one group", () => {
    const items = [toolCall("t1", 1), toolCall("t2", 2), toolCall("t3", 3)];

    const result = groupConsecutiveActionItems(items);

    expect(result).toHaveLength(1);
    const group = expectActionGroup(result[0]);
    expect(group.items.map((item) => item.id)).toEqual(["t1", "t2", "t3"]);
    expect(group.timestamp).toEqual(createTimestamp(3));
  });

  it("groups a run of exactly two settled actions", () => {
    const items = [toolCall("t1", 1), toolCall("t2", 2)];

    const result = groupConsecutiveActionItems(items);

    expect(result).toHaveLength(1);
    expect(expectActionGroup(result[0]).items.map((item) => item.id)).toEqual(["t1", "t2"]);
  });

  it("keeps live actions outside, below the settled group", () => {
    const items = [
      toolCall("t1", 1),
      toolCall("t2", 2),
      toolCall("t3", 3, { status: "running" }),
      toolCall("t4", 4, { status: "running" }),
    ];

    const result = groupConsecutiveActionItems(items);

    expect(result.map((item) => item.kind)).toEqual(["action_group", "tool_call", "tool_call"]);
    const group = expectActionGroup(result[0]);
    expect(group.items.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(result[1].id).toBe("t3");
    expect(result[2].id).toBe("t4");
  });

  it("does not group when fewer than two actions have settled", () => {
    const items = [
      toolCall("t1", 1, { status: "running" }),
      toolCall("t2", 2),
      toolCall("t3", 3, { status: "running" }),
    ];

    expect(groupConsecutiveActionItems(items)).toBe(items);
  });

  it("collapses a settled action into the group even behind a live one", () => {
    const items = [toolCall("t1", 1), toolCall("t2", 2, { status: "running" }), toolCall("t3", 3)];

    const result = groupConsecutiveActionItems(items);

    expect(result.map((item) => item.kind)).toEqual(["action_group", "tool_call"]);
    expect(expectActionGroup(result[0]).items.map((item) => item.id)).toEqual(["t1", "t3"]);
    expect(result[1].id).toBe("t2");
  });

  it("keeps the group id stable while a run grows and settles", () => {
    const whileRunning = groupConsecutiveActionItems([
      toolCall("t1", 1),
      toolCall("t2", 2),
      toolCall("t3", 3, { status: "running" }),
    ]);
    const afterSettling = groupConsecutiveActionItems([
      toolCall("t1", 1),
      toolCall("t2", 2),
      toolCall("t3", 3),
    ]);

    expect(whileRunning.map((item) => item.kind)).toEqual(["action_group", "tool_call"]);
    expect(afterSettling.map((item) => item.kind)).toEqual(["action_group"]);
    expect(whileRunning[0].id).toBe(afterSettling[0].id);
    expect(expectActionGroup(afterSettling[0]).items.map((item) => item.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("keeps the group id stable when the run's first action is still live", () => {
    const whileRunning = groupConsecutiveActionItems([
      toolCall("t1", 1, { status: "running" }),
      toolCall("t2", 2),
      toolCall("t3", 3),
    ]);
    const afterSettling = groupConsecutiveActionItems([
      toolCall("t1", 1),
      toolCall("t2", 2),
      toolCall("t3", 3),
    ]);

    expect(whileRunning.map((item) => item.kind)).toEqual(["action_group", "tool_call"]);
    expect(expectActionGroup(whileRunning[0]).items.map((item) => item.id)).toEqual(["t2", "t3"]);
    expect(whileRunning[0].id).toBe(afterSettling[0].id);
  });

  it("groups each run independently around non-action items", () => {
    const items = [
      toolCall("t1", 1),
      thought("th1", 2),
      toolCall("t2", 3),
      assistantMessage("a1", 4),
      toolCall("t3", 5),
      toolCall("t4", 6),
    ];

    const result = groupConsecutiveActionItems(items);

    expect(result.map((item) => item.kind)).toEqual([
      "action_group",
      "assistant_message",
      "action_group",
    ]);
    expect(expectActionGroup(result[0]).items.map((item) => item.id)).toEqual(["t1", "th1", "t2"]);
    expect(expectActionGroup(result[2]).items.map((item) => item.id)).toEqual(["t3", "t4"]);
  });

  it("treats speak bubbles and plans as run breakers", () => {
    const items = [
      toolCall("t1", 1),
      toolCall("t2", 2),
      speakToolCall("s1", 3),
      toolCall("t3", 4),
      toolCall("t4", 5),
      toolCall("t5", 6, { detail: { type: "plan", text: "the plan" } }),
    ];

    const result = groupConsecutiveActionItems(items);

    expect(result.map((item) => item.kind)).toEqual([
      "action_group",
      "tool_call",
      "action_group",
      "tool_call",
    ]);
    expect(expectActionGroup(result[0]).items.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(result[1].id).toBe("s1");
    expect(expectActionGroup(result[2]).items.map((item) => item.id)).toEqual(["t3", "t4"]);
    expect(result[3].id).toBe("t5");
    expect(isGroupableActionItem(items[2])).toBe(false);
    expect(isGroupableActionItem(items[5])).toBe(false);
  });
});

describe("countActionGroupCategories", () => {
  it("categorizes every typed detail distinctly", () => {
    const counts = countActionGroupCategories([
      toolCall("read", 1, { detail: { type: "read", filePath: "/tmp/a" } }),
      toolCall("edit", 2, { detail: { type: "edit", filePath: "/tmp/a" } }),
      toolCall("write", 3, { detail: { type: "write", filePath: "/tmp/a" } }),
      toolCall("grep", 4, { detail: { type: "search", query: "q", toolName: "grep" } }),
      toolCall("web", 5, { detail: { type: "search", query: "q", toolName: "web_search" } }),
      toolCall("fetch", 6, { detail: { type: "fetch", url: "https://example.com" } }),
      toolCall("shell", 7, { detail: { type: "shell", command: "ls" } }),
      toolCall("worktree", 8, {
        detail: {
          type: "worktree_setup",
          worktreePath: "/w",
          branchName: "b",
          log: "",
          commands: [],
        },
      }),
      toolCall("task", 9, { detail: { type: "sub_agent", log: "" } }),
      thought("th", 10),
    ]);

    expect(Object.fromEntries(counts)).toEqual({
      read: 1,
      edit: 1,
      write: 1,
      codeSearch: 1,
      webSearch: 1,
      fetch: 1,
      command: 1,
      worktree: 1,
      agent: 1,
      thought: 1,
    });
  });

  it("falls back to the tool name when the detail is untyped", () => {
    const unknownDetail = (name: string, id: string, seed: number): ToolCallItem =>
      toolCall(id, seed, { detail: { type: "unknown", input: null, output: null }, name });

    const counts = countActionGroupCategories([
      unknownDetail("Read", "u1", 1),
      unknownDetail("Bash", "u2", 2),
      unknownDetail("WebSearch", "u3", 3),
      unknownDetail("mcp__linear__create_issue", "u4", 4),
    ]);

    expect(Object.fromEntries(counts)).toEqual({
      read: 1,
      command: 1,
      webSearch: 1,
      other: 1,
    });
  });

  it("categorizes otto browser and preview tools across namespace forms", () => {
    const unknownDetail = (name: string, id: string, seed: number): ToolCallItem =>
      toolCall(id, seed, { detail: { type: "unknown", input: null, output: null }, name });

    const counts = countActionGroupCategories([
      unknownDetail("browser_click", "b1", 1),
      unknownDetail("mcp__otto__browser_snapshot", "b2", 2),
      unknownDetail("otto.browser_screenshot", "b3", 3),
      unknownDetail("preview_start", "p1", 4),
      unknownDetail("mcp__otto__preview_logs", "p2", 5),
    ]);

    expect(Object.fromEntries(counts)).toEqual({
      browser: 3,
      preview: 2,
    });
  });
});
