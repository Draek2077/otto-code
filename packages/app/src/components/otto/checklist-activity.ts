import { resolveTodoEntryStatus, type TaskActivity, type TodoEntry } from "@/types/stream";

/** The evolving card must not describe an older task as part of its current checklist. */
export function projectChecklistActivity(
  activity: TaskActivity,
  items: readonly TodoEntry[],
): TaskActivity | null {
  if (activity.type === "created") return activity;
  const matching = items.filter((item) => item.text === activity.task);
  if (activity.type === "added") return matching.length > 0 ? activity : null;
  const status = activity.type === "started" ? "in_progress" : "completed";
  return matching.some((item) => resolveTodoEntryStatus(item) === status) ? activity : null;
}
