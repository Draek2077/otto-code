import { createStreamPresentation } from "@/agent-stream/presentation";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";

export type ActionMember = ToolCallItem | ThoughtItem;
export type ActionCategory = "read" | "edit" | "write" | "search" | "command" | "thought" | "tool";
export interface ActionGroup {
  id: string;
  members: ActionMember[];
  counts: Partial<Record<ActionCategory, number>>;
  failedCount: number;
}

function isAction(item: StreamItem): item is ActionMember {
  if (item.kind === "thought") return true;
  if (item.kind !== "tool_call") return false;
  if (item.payload.source !== "agent") return true;
  const data = item.payload.data;
  // Content and approval cards keep their own place in the transcript. Plugin
  // transforms run before this projection, so contributed content stays visible too.
  return data.detail.type !== "plan" && data.name.trim().toLowerCase() !== "speak";
}

function isSettled(item: ActionMember): boolean {
  if (item.kind === "thought") return item.status === "ready";
  const status = item.payload.data.status;
  return status !== "running" && status !== "executing";
}

function category(item: ActionMember): ActionCategory {
  if (item.kind === "thought") return "thought";
  if (item.payload.source === "agent") {
    switch (item.payload.data.detail.type) {
      case "read":
        return "read";
      case "edit":
        return "edit";
      case "write":
        return "write";
      case "search":
      case "fetch":
        return "search";
      case "shell":
        return "command";
    }
  }
  const name =
    (item.payload.source === "agent" ? item.payload.data.name : item.payload.data.toolName)
      .trim()
      .toLowerCase()
      .split(/__|\./)
      .at(-1) ?? "";
  if (["read", "read_file"].includes(name)) return "read";
  if (["edit", "multiedit", "apply_patch"].includes(name)) return "edit";
  if (["write", "write_file", "create_file"].includes(name)) return "write";
  if (["grep", "glob", "search", "web_search", "websearch", "web_fetch"].includes(name))
    return "search";
  if (["bash", "shell", "powershell", "exec", "exec_command"].includes(name)) return "command";
  if (name === "thinking") return "thought";
  return "tool";
}

interface CachedGroup {
  group: ActionGroup;
  host: ActionMember;
}
const EMPTY_GROUPS = new Map<string, ActionGroup>();

export function getGroupedHistoryStartId(
  tail: StreamItem[],
  groups: ReadonlyMap<string, ActionGroup>,
  hasLocalHistory: boolean,
  remoteHasOlder: boolean,
): string | null {
  if (hasLocalHistory || !remoteHasOlder) return null;
  const firstId = tail[0]?.id;
  return firstId && groups.has(firstId) ? firstId : null;
}

/** Presentation only: source rows, timeline cursors, transport and persistence stay upstream-owned. */
export function createGroupedStreamPresentation() {
  const present = createStreamPresentation();
  // Keep only the current groups, rather than accumulating snapshots as older
  // pages extend a run. Reusing unchanged hosts preserves the row memo boundary.
  let runs = new Map<string, CachedGroup>();
  const memberGroupIds = new WeakMap<ActionMember, string>();
  let source: StreamItem[] | undefined;
  let tail: StreamItem[] = [];
  let groups = EMPTY_GROUPS;

  function groupTail(items: StreamItem[]) {
    if (source === items) return;
    const output: StreamItem[] = [];
    const nextGroups = new Map<string, ActionGroup>();
    const nextRuns = new Map<string, CachedGroup>();
    let run: ActionMember[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const members = run.filter(isSettled);
      if (members.length < 2) {
        output.push(...run);
      } else {
        // Backward pagination can extend a run at its start. Keep the existing
        // host key as well as when actions append, so expansion/reading anchors survive.
        const retainedId = members
          .map((member) => memberGroupIds.get(member))
          .find((id) => id && !nextGroups.has(id));
        const id = retainedId ?? `otto-action-group:${run[0].id}`;
        let cached = runs.get(id);
        if (
          cached?.group.id !== id ||
          cached.group.members.length !== members.length ||
          !members.every((member, index) => cached?.group.members[index] === member)
        ) {
          const counts: ActionGroup["counts"] = {};
          let failedCount = 0;
          for (const member of members) {
            const key = category(member);
            counts[key] = (counts[key] ?? 0) + 1;
            if (member.kind === "tool_call" && member.payload.data.status === "failed")
              failedCount++;
          }
          cached = {
            group: { id, members, counts, failedCount },
            host: { ...members[0], id, timestamp: members.at(-1)!.timestamp },
          };
        }
        nextRuns.set(id, cached);
        for (const member of members) memberGroupIds.set(member, id);
        nextGroups.set(id, cached.group);
        output.push(cached.host);
        // Parallel calls can finish out of order. Running actions remain visible
        // below the summary, including when the first member of the run is live.
        for (const member of run) if (!isSettled(member)) output.push(member);
      }
      run = [];
    };
    for (const item of items) {
      if (isAction(item)) {
        const previous = run.at(-1);
        if (previous?.turnId && item.turnId && previous.turnId !== item.turnId) flush();
        run.push(item);
      } else {
        flush();
        output.push(item);
      }
    }
    flush();
    source = items;
    tail = nextGroups.size ? output : items;
    groups = nextGroups;
    runs = nextRuns;
  }

  return (input: Parameters<typeof present>[0] & { groupConsecutiveActions: boolean }) => {
    const projected = present(input);
    if (input.level !== "detailed" || !input.groupConsecutiveActions) {
      source = undefined;
      tail = [];
      groups = EMPTY_GROUPS;
      runs = new Map();
      return { ...projected, actionGroupsByHostId: EMPTY_GROUPS };
    }
    // Like 0.9, only retained actions group. The streaming head is left alone
    // until it settles into history. A text delta never walks/regroups the tail.
    groupTail(projected.tail);
    return { ...projected, tail, actionGroupsByHostId: groups };
  };
}
