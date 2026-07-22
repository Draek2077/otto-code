import type { StreamItem } from "@/types/stream";

export type TodoListStreamItem = Extract<StreamItem, { kind: "todo_list" }>;

/**
 * The checklist to pin is always the most recent one in the transcript — older
 * lists are settled history. Scans from the end and stops at the first hit.
 */
export function selectLatestTodoList(items: StreamItem[]): TodoListStreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "todo_list") {
      return item;
    }
  }
  return null;
}

export function isTodoListComplete(item: TodoListStreamItem): boolean {
  return item.items.length > 0 && item.items.every((task) => task.status === "completed");
}

export interface ResolvePinnedInput {
  latest: TodoListStreamItem | null;
  enabled: boolean;
  dismissedIds: readonly string[];
}

/**
 * Decide whether the latest checklist should float pinned: only when the feature
 * is on, the list has tasks, and the user hasn't dismissed that specific list.
 * Returns the item to render, or null to show nothing (and fall back to inline).
 */
export function resolvePinnedTodoList({
  latest,
  enabled,
  dismissedIds,
}: ResolvePinnedInput): TodoListStreamItem | null {
  if (!enabled || !latest || latest.items.length === 0) {
    return null;
  }
  if (dismissedIds.includes(latest.id)) {
    return null;
  }
  return latest;
}
