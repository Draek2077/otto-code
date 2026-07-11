import {
  getOttoToolLeafName,
  normalizeToolName,
} from "@otto-code/protocol/tool-name-normalization";
import type { ActionGroupItem, ActionGroupMemberItem, StreamItem } from "@/types/stream";

// Only settled actions ever group: live (running) actions stay visible
// outside, below the group, and collapse in when they complete. A group
// always holds 2+ settled actions — a lone settled action renders on its own.
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
  | "edit"
  | "write"
  | "codeSearch"
  | "webSearch"
  | "fetch"
  | "command"
  | "browser"
  | "preview"
  | "artifact"
  | "worktree"
  | "agent"
  | "thought"
  | "other";

// Fixed display order for the collapsed summary ("Read 2 files, edited
// file, searched code, ...").
export const ACTION_GROUP_CATEGORY_ORDER: readonly ActionGroupCategory[] = [
  "read",
  "edit",
  "write",
  "codeSearch",
  "webSearch",
  "fetch",
  "command",
  "browser",
  "preview",
  "artifact",
  "worktree",
  "agent",
  "thought",
  "other",
];

// Fallback for tool calls that arrive without a typed detail (MCP tools,
// orchestrator calls, providers that only send a name). Only unambiguous
// names are mapped; anything else stays "other".
const TOOL_NAME_CATEGORIES: Record<string, ActionGroupCategory> = {
  read: "read",
  read_file: "read",
  edit: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  apply_patch: "edit",
  write: "write",
  write_file: "write",
  create_file: "write",
  grep: "codeSearch",
  glob: "codeSearch",
  search: "codeSearch",
  websearch: "webSearch",
  web_search: "webSearch",
  webfetch: "fetch",
  web_fetch: "fetch",
  fetch: "fetch",
  bash: "command",
  shell: "command",
  powershell: "command",
  terminal: "command",
  exec: "command",
  task: "agent",
  agent: "agent",
  sub_agent: "agent",
  create_artifact: "artifact",
};

function categorizeByToolName(toolName: string): ActionGroupCategory {
  // Otto's daemon-hosted tools can arrive MCP-namespaced (mcp__otto__browser_click)
  // or dot-namespaced (otto.browser_click) depending on transport — strip the
  // namespace so they categorize the same everywhere.
  const leafName = getOttoToolLeafName(toolName) ?? normalizeToolName(toolName);
  if (leafName.startsWith("browser_")) {
    return "browser";
  }
  if (leafName.startsWith("preview_")) {
    return "preview";
  }
  return TOOL_NAME_CATEGORIES[leafName] ?? "other";
}

function categorizeActionGroupMember(item: ActionGroupMemberItem): ActionGroupCategory {
  if (item.kind === "thought") {
    return "thought";
  }
  if (item.payload.source !== "agent") {
    return categorizeByToolName(item.payload.data.toolName);
  }
  const data = item.payload.data;
  switch (data.detail.type) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "write":
      return "write";
    case "search":
      return data.detail.toolName === "web_search" ? "webSearch" : "codeSearch";
    case "fetch":
      return "fetch";
    case "shell":
      return "command";
    case "worktree_setup":
      return "worktree";
    case "sub_agent":
      return "agent";
    // Plans never reach a group (run breakers); unknown and plain_text carry
    // no typed shape, so fall back to the tool name.
    default:
      return categorizeByToolName(data.name);
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

function createActionGroupItem(
  members: ActionGroupMemberItem[],
  runAnchor: ActionGroupMemberItem,
): ActionGroupItem {
  const last = members[members.length - 1];
  return {
    kind: "action_group",
    // Keyed off the run's first member — which may itself still be live and
    // outside the group — so the id stays stable while members settle into
    // the group and expansion state survives.
    id: `action_group_${runAnchor.id}`,
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
  // Partition, not prefix: with parallel tool calls a settled action can sit
  // behind a still-live one, and it belongs in the group regardless. Live
  // actions render individually below the group, in their original order.
  const settled: ActionGroupMemberItem[] = [];
  const active: ActionGroupMemberItem[] = [];
  for (const member of run) {
    (isActiveActionMember(member) ? active : settled).push(member);
  }
  if (settled.length < MIN_GROUP_SIZE) {
    output.push(...run);
    return false;
  }
  output.push(createActionGroupItem(settled, run[0]));
  output.push(...active);
  return true;
}

/**
 * Fold the settled actions of each consecutive run of action items (tool
 * calls and thoughts) into a single collapsed `action_group` item. Live
 * actions never group: they stay outside (below) the group and collapse in
 * once they complete. A group forms as soon as a run has 2+ settled actions;
 * a lone settled action stays a plain row. Returns the input array identity
 * when nothing groups.
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
