import { describe, expect, it } from "vitest";
import type { StreamItem, TodoEntry } from "@/types/stream";
import {
  isTodoListComplete,
  resolvePinnedTodoList,
  selectLatestTodoList,
  type TodoListStreamItem,
} from "./select";

function todoEntry(text: string, status: TodoEntry["status"]): TodoEntry {
  return { text, status, completed: status === "completed" };
}

function todoList(id: string, entries: TodoEntry[]): TodoListStreamItem {
  return {
    kind: "todo_list",
    id,
    timestamp: new Date("2025-01-01T00:00:00Z"),
    provider: "claude",
    items: entries,
  };
}

function assistant(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: "hi",
    timestamp: new Date("2025-01-01T00:00:00Z"),
  };
}

describe("selectLatestTodoList", () => {
  it("returns the most recent todo_list, ignoring earlier ones", () => {
    const items: StreamItem[] = [
      todoList("old", [todoEntry("a", "completed")]),
      assistant("m1"),
      todoList("new", [todoEntry("b", "in_progress")]),
      assistant("m2"),
    ];
    expect(selectLatestTodoList(items)?.id).toBe("new");
  });

  it("returns null when there is no todo_list", () => {
    expect(selectLatestTodoList([assistant("m1")])).toBeNull();
  });
});

describe("resolvePinnedTodoList", () => {
  const latest = todoList("t1", [todoEntry("a", "in_progress")]);

  it("pins the latest list when enabled and not dismissed", () => {
    expect(resolvePinnedTodoList({ latest, enabled: true, dismissedIds: [] })?.id).toBe("t1");
  });

  it("pins nothing when the feature is off", () => {
    expect(resolvePinnedTodoList({ latest, enabled: false, dismissedIds: [] })).toBeNull();
  });

  it("pins nothing once the list is dismissed", () => {
    expect(resolvePinnedTodoList({ latest, enabled: true, dismissedIds: ["t1"] })).toBeNull();
  });

  it("pins nothing for an empty list", () => {
    const empty = todoList("t2", []);
    expect(resolvePinnedTodoList({ latest: empty, enabled: true, dismissedIds: [] })).toBeNull();
  });

  it("pins nothing when there is no list", () => {
    expect(resolvePinnedTodoList({ latest: null, enabled: true, dismissedIds: [] })).toBeNull();
  });
});

describe("isTodoListComplete", () => {
  it("is true only when every task is completed", () => {
    expect(
      isTodoListComplete(todoList("t", [todoEntry("a", "completed"), todoEntry("b", "completed")])),
    ).toBe(true);
    expect(
      isTodoListComplete(todoList("t", [todoEntry("a", "completed"), todoEntry("b", "pending")])),
    ).toBe(false);
    expect(isTodoListComplete(todoList("t", []))).toBe(false);
  });
});
