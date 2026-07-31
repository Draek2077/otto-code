import { describe, expect, test } from "vitest";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  appendTodoNudgeToPrompt,
  buildTodoReconcileMessage,
  findLatestTodoItem,
  isStaleTodoList,
  stripTrailingTodoNudge,
  todoListSignature,
  unfinishedTodoItems,
} from "./todo-reminders.js";

function todo(items: { text: string; completed: boolean }[]): AgentTimelineItem {
  return { type: "todo", items };
}

const STALE = { type: "todo", items: [{ text: "ship it", completed: false }] } as const;

describe("findLatestTodoItem", () => {
  test("returns the most recent todo item, ignoring later non-todo items", () => {
    const timeline: AgentTimelineItem[] = [
      todo([{ text: "old", completed: true }]),
      { type: "assistant_message", text: "working" },
      todo([{ text: "new", completed: false }]),
      { type: "reasoning", text: "hmm" },
    ];
    expect(findLatestTodoItem(timeline)).toEqual(todo([{ text: "new", completed: false }]));
  });

  test("returns null when the timeline has no todo item", () => {
    expect(findLatestTodoItem([{ type: "assistant_message", text: "hi" }])).toBeNull();
    expect(findLatestTodoItem([])).toBeNull();
  });
});

describe("isStaleTodoList", () => {
  test("true only when a list has at least one open item", () => {
    expect(isStaleTodoList(todo([{ text: "a", completed: false }]) as never)).toBe(true);
    expect(
      isStaleTodoList(
        todo([
          { text: "a", completed: true },
          { text: "b", completed: false },
        ]) as never,
      ),
    ).toBe(true);
  });

  test("false for null, empty, or fully completed lists", () => {
    expect(isStaleTodoList(null)).toBe(false);
    expect(isStaleTodoList(todo([]) as never)).toBe(false);
    expect(isStaleTodoList(todo([{ text: "a", completed: true }]) as never)).toBe(false);
  });
});

describe("unfinishedTodoItems", () => {
  test("returns only the open rows", () => {
    const item = todo([
      { text: "done", completed: true },
      { text: "open", completed: false },
    ]) as Extract<AgentTimelineItem, { type: "todo" }>;
    expect(unfinishedTodoItems(item)).toEqual([{ text: "open" }]);
  });
});

describe("todoListSignature", () => {
  test("is stable for the same state and changes when completion flips", () => {
    const a = todo([{ text: "x", completed: false }]) as Extract<
      AgentTimelineItem,
      { type: "todo" }
    >;
    const same = todo([{ text: "x", completed: false }]) as Extract<
      AgentTimelineItem,
      { type: "todo" }
    >;
    const flipped = todo([{ text: "x", completed: true }]) as Extract<
      AgentTimelineItem,
      { type: "todo" }
    >;
    expect(todoListSignature(a)).toBe(todoListSignature(same));
    expect(todoListSignature(a)).not.toBe(todoListSignature(flipped));
  });
});

describe("append + strip round-trip", () => {
  test("a string prompt gains the nudge, and stripping restores the original", () => {
    const original = "Please refactor the parser.";
    const withNudge = appendTodoNudgeToPrompt(original, STALE as never);
    expect(typeof withNudge).toBe("string");
    expect(withNudge as string).toContain("<system-reminder>");
    expect(withNudge as string).toContain("unfinished item");
    expect(stripTrailingTodoNudge(withNudge as string)).toBe(original);
  });

  test("a block prompt gains a trailing text block carrying the nudge", () => {
    const original = [{ type: "text" as const, text: "look at this" }];
    const withNudge = appendTodoNudgeToPrompt(original, STALE as never);
    expect(Array.isArray(withNudge)).toBe(true);
    const blocks = withNudge as { type: string; text: string }[];
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.text).toContain("<system-reminder>");
    // The block text, once recorded and normalized, strips clean.
    expect(stripTrailingTodoNudge(blocks[1]!.text)).toBe("");
  });

  test("strip is a no-op on a message with no nudge", () => {
    expect(stripTrailingTodoNudge("just a normal message")).toBe("just a normal message");
  });

  test("strip removes the nudge appended to a real message with trailing text", () => {
    const recorded = `Do the thing.\n\n<system-reminder>\nYou have 2 unfinished item(s) on your task list. Keep it current.\n</system-reminder>`;
    expect(stripTrailingTodoNudge(recorded)).toBe("Do the thing.");
  });
});

describe("buildTodoReconcileMessage", () => {
  test("lists the open items and asks the agent to reconcile", () => {
    const item = todo([
      { text: "write docs", completed: false },
      { text: "already done", completed: true },
      { text: "run tests", completed: false },
    ]) as Extract<AgentTimelineItem, { type: "todo" }>;
    const message = buildTodoReconcileMessage(item);
    expect(message).toContain("2 unfinished item(s)");
    expect(message).toContain("- write docs");
    expect(message).toContain("- run tests");
    expect(message).not.toContain("already done");
    expect(message.toLowerCase()).toContain("reconcile");
  });
});
