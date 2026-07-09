import type { ActionGroupItem, ActionGroupMemberItem, StreamItem } from "@/types/stream";

// A run only folds once it has 3+ actions, and only settled actions ever
// group: live (running) actions stay visible outside, below the group, and
// collapse in when they complete. A group always holds 2+ actions.
const MIN_RUN_LENGTH_TO_GROUP = 3;
const MIN_GROUP_SIZE = 2;

function isSpeakMessageToolCall(item: Extract<StreamItem, { kind: "tool_call" }>): boolean {
  // Mirrors the SpeakMessage branch in agent-stream/view.tsx — those render as
  // chat bubbles, not action rows, so they must not join an action group.
  return (
    item.payload.source === "agent" &&
    item.payload.data.name === "speak" &&
    item.payload.data.detail.type === "unknown" &&
    typeof item.payload.data.detail.input === "string" &&
    item.payload.data.detail.input.trim().length > 0
  );
}

export function isGroupableActionItem(item: StreamItem): item is ActionGroupMemberItem {
  if (item.kind === "thought") {
    return true;
  }
  if (item.kind !== "tool_call") {
    return false;
  }
  if (isSpeakMessageToolCall(item)) {
    return false;
  }
  // Plans render as a full PlanCard, which reads as content rather than an
  // action row — keep them out of groups so they stay prominent.
  if (item.payload.source === "agent" && item.payload.data.detail.type === "plan") {
    return false;
  }
  return true;
}

export type ActionGroupCategory =
  | "read"
  | "write"
  | "search"
  | "command"
  | "agent"
  | "thought"
  | "other";

// Fixed display order for the collapsed summary ("2 files read, 1 file
// written, 1 search completed, ...").
export const ACTION_GROUP_CATEGORY_ORDER: readonly ActionGroupCategory[] = [
  "read",
  "write",
  "search",
  "command",
  "agent",
  "thought",
  "other",
];

function categorizeActionGroupMember(item: ActionGroupMemberItem): ActionGroupCategory {
  if (item.kind === "thought") {
    return "thought";
  }
  if (item.payload.source !== "agent") {
    return "other";
  }
  switch (item.payload.data.detail.type) {
    case "read":
      return "read";
    case "edit":
    case "write":
      return "write";
    case "search":
    case "fetch":
      return "search";
    case "shell":
    case "worktree_setup":
      return "command";
    case "sub_agent":
      return "agent";
    default:
      return "other";
  }
}

export function countActionGroupCategories(
  items: ActionGroupMemberItem[],
): Map<ActionGroupCategory, number> {
  const counts = new Map<ActionGroupCategory, number>();
  for (const item of items) {
    const category = categorizeActionGroupMember(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

function createActionGroupItem(members: ActionGroupMemberItem[]): ActionGroupItem {
  const first = members[0];
  const last = members[members.length - 1];
  return {
    kind: "action_group",
    // Keyed off the first member: runs only ever grow at their end, so the id
    // stays stable while a live run accumulates and expansion state survives.
    id: `action_group_${first.id}`,
    timestamp: last.timestamp,
    items: members,
  };
}

export function isActiveActionMember(member: ActionGroupMemberItem): boolean {
  if (member.kind === "thought") {
    return member.status !== "ready";
  }
  const status = member.payload.data.status;
  return status === "running" || status === "executing";
}

/** @returns whether the run was folded into a group */
function flushRun(output: StreamItem[], run: ActionGroupMemberItem[]): boolean {
  if (run.length < MIN_RUN_LENGTH_TO_GROUP) {
    output.push(...run);
    return false;
  }
  // Only the settled prefix of the run folds; everything from the first
  // still-live action onward stays visible outside (below) the group and
  // collapses in once it completes.
  let settledCount = 0;
  while (settledCount < run.length && !isActiveActionMember(run[settledCount])) {
    settledCount += 1;
  }
  if (settledCount < MIN_GROUP_SIZE) {
    output.push(...run);
    return false;
  }
  output.push(createActionGroupItem(run.slice(0, settledCount)));
  output.push(...run.slice(settledCount));
  return true;
}

/**
 * Fold runs of 3+ consecutive action items (tool calls and thoughts) in a
 * chronological stream into a single collapsed `action_group` item. Only
 * settled actions group: live actions stay outside (below) the group and
 * collapse in once they complete. Runs of 1–2 actions are left untouched.
 * Returns the input array identity when nothing groups.
 */
export function groupConsecutiveActionItems(items: StreamItem[]): StreamItem[] {
  const output: StreamItem[] = [];
  let run: ActionGroupMemberItem[] = [];
  let grouped = false;

  for (const item of items) {
    if (isGroupableActionItem(item)) {
      run.push(item);
      continue;
    }
    if (run.length > 0) {
      grouped = flushRun(output, run) || grouped;
      run = [];
    }
    output.push(item);
  }
  if (run.length > 0) {
    grouped = flushRun(output, run) || grouped;
  }

  return grouped ? output : items;
}
