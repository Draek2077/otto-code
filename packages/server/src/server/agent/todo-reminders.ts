import type { AgentPromptInput, AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * Provider-agnostic stale-todo detection.
 *
 * Otto renders every provider's native todo tool (Claude's TodoWrite, opencode's
 * todowrite, …) into one `type: "todo"` timeline item. The item collapses status
 * to a boolean per row (`completed`), so "stale" here means: a list exists and at
 * least one row is still `completed: false`. When an agent goes idle in that
 * state it has left a half-checked list the user would otherwise have to dismiss
 * themselves - see docs and the `agentBehaviors.{todoNudge,todoReconcileOnIdle}`
 * toggles. These helpers are pure so both the turn-end reconcile pass and the
 * next-turn nudge read the same notion of "stale".
 */

export type TodoTimelineItem = Extract<AgentTimelineItem, { type: "todo" }>;

/** The most recent `type: "todo"` item in a timeline, or null if none exists. */
export function findLatestTodoItem(
  timeline: readonly AgentTimelineItem[],
): TodoTimelineItem | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item?.type === "todo") {
      return item;
    }
  }
  return null;
}

/** Rows still open (not completed) in a todo item. */
export function unfinishedTodoItems(todo: TodoTimelineItem): { text: string }[] {
  return todo.items.filter((item) => !item.completed).map((item) => ({ text: item.text }));
}

/**
 * A list is stale when it has rows AND at least one is still open. An empty list
 * is not stale (nothing to finish); an all-completed list is not stale.
 */
export function isStaleTodoList(todo: TodoTimelineItem | null): todo is TodoTimelineItem {
  return todo !== null && todo.items.length > 0 && todo.items.some((item) => !item.completed);
}

/**
 * A stable signature of a list's current state (row text + completion). Used to
 * fire the idle reconcile pass at most once per unique state: an unchanged list
 * (the agent explained why rows stay open) never re-fires, so there is no nag
 * loop; a genuinely changed list may nudge again.
 */
export function todoListSignature(todo: TodoTimelineItem): string {
  return JSON.stringify(todo.items.map((item) => [item.text, item.completed]));
}

/**
 * The reconcile ask injected when an agent goes idle with a stale list. Kept
 * short (token economy) and framed so the honest outcomes are both fine: mark
 * the finished rows done, or say plainly what is genuinely still open.
 */
export function buildTodoReconcileMessage(todo: TodoTimelineItem): string {
  const open = unfinishedTodoItems(todo);
  const lines = open.map((item) => `- ${item.text}`).join("\n");
  return [
    `You went idle with ${open.length} unfinished item(s) still on your task list:`,
    lines,
    "",
    "Reconcile the list before finishing: mark completed items as completed, and delete or update any that no longer apply. If some are genuinely still open (blocked, or waiting on the user), leave them and say so in one line. Do not leave a stale checklist for the user to dismiss.",
  ].join("\n");
}

/**
 * The passive reminder that rides along on an agent's next turn while a stale
 * list is open. Wrapped as a `<system-reminder>` so it reads as harness context,
 * not user text. Sent to the model but stripped from Otto's own timeline
 * projection by stripTrailingTodoNudge, so it never shows in the chat bubble.
 */
export function buildTodoNudgeReminder(todo: TodoTimelineItem): string {
  const openCount = unfinishedTodoItems(todo).length;
  return `<system-reminder>\nYou have ${openCount} unfinished item(s) on your task list. As you work, keep it current: mark items completed the moment you finish them rather than in a batch at the end.\n</system-reminder>`;
}

const SYSTEM_REMINDER_START = "<system-reminder>";
const SYSTEM_REMINDER_END = "</system-reminder>";
const TODO_NUDGE_HEADER = "You have ";
const TODO_NUDGE_COUNT_SUFFIX = " unfinished item(s) on your task list.";

function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/**
 * Append the passive nudge to an outgoing prompt (string or content blocks).
 * Kept structural - a trailing text block for the block form, a joined string
 * otherwise - so every provider's `startTurn` receives it identically.
 */
export function appendTodoNudgeToPrompt(
  prompt: AgentPromptInput,
  todo: TodoTimelineItem,
): AgentPromptInput {
  const reminder = buildTodoNudgeReminder(todo);
  if (typeof prompt === "string") {
    return `${prompt}\n\n${reminder}`;
  }
  return [...prompt, { type: "text", text: reminder }];
}

/**
 * Strip a trailing passive-nudge block from a recorded user message so the chat
 * shows what the user typed, not the reminder Otto appended for the model. The
 * wrapped prompt already reached the provider for the live turn; this only shapes
 * Otto's timeline projection. Idempotent and a no-op when no nudge is present.
 */
export function stripTrailingTodoNudge(text: string): string {
  // Use bounded marker parsing instead of a broad multiline regex. This text
  // originates with a user message after it has passed through a provider, so
  // the cleanup path must stay linear even when the message is adversarial.
  const withoutTrailingWhitespace = text.trimEnd();
  if (!withoutTrailingWhitespace.endsWith(SYSTEM_REMINDER_END)) return text;

  const endStart = withoutTrailingWhitespace.length - SYSTEM_REMINDER_END.length;
  const start = withoutTrailingWhitespace.lastIndexOf(SYSTEM_REMINDER_START, endStart);
  if (start < 0) return text;

  const body = withoutTrailingWhitespace
    .slice(start + SYSTEM_REMINDER_START.length, endStart)
    .trimStart();
  if (!body.startsWith(TODO_NUDGE_HEADER)) return text;

  const suffixIndex = body.indexOf(TODO_NUDGE_COUNT_SUFFIX, TODO_NUDGE_HEADER.length);
  if (suffixIndex < TODO_NUDGE_HEADER.length) return text;
  const count = body.slice(TODO_NUDGE_HEADER.length, suffixIndex);
  if (!isAsciiDigits(count)) return text;

  return text.slice(0, start).trimEnd();
}
