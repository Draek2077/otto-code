import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore } from "@/stores/session-store";
import type { SuggestedTaskInfo } from "@otto-code/protocol/messages";

export interface SuggestedTaskRow {
  taskId: SuggestedTaskInfo["taskId"];
  title: SuggestedTaskInfo["title"];
  tldr: SuggestedTaskInfo["tldr"];
  cwd?: SuggestedTaskInfo["cwd"];
  createdAt: SuggestedTaskInfo["createdAt"];
}

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

interface SelectSuggestedTasksParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_SUGGESTED_TASK_ROWS: SuggestedTaskRow[] = [];

function toSuggestedTaskRow(task: SuggestedTaskInfo): SuggestedTaskRow {
  return {
    taskId: task.taskId,
    title: task.title,
    tldr: task.tldr,
    cwd: task.cwd,
    createdAt: task.createdAt,
  };
}

export function selectSuggestedTasksForParent(
  state: SessionStoreSnapshot,
  params: SelectSuggestedTasksParams,
): SuggestedTaskRow[] {
  const tasks = state.sessions[params.serverId]?.suggestedTasks;
  if (!tasks || tasks.size === 0) {
    return EMPTY_SUGGESTED_TASK_ROWS;
  }

  const rows: SuggestedTaskRow[] = [];
  for (const task of tasks.values()) {
    if (task.parentAgentId !== params.parentAgentId || task.state !== "pending") {
      continue;
    }
    rows.push(toSuggestedTaskRow(task));
  }

  if (rows.length === 0) {
    return EMPTY_SUGGESTED_TASK_ROWS;
  }

  rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return rows;
}

export function useSuggestedTasksForParent(params: SelectSuggestedTasksParams): SuggestedTaskRow[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSuggestedTasksForParent(state, params),
    equal,
  );
}
