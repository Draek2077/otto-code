import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore } from "@/stores/session-store";
import type { BackgroundShellTaskInfo } from "@otto-code/protocol/messages";

export interface BackgroundShellTaskRow {
  id: BackgroundShellTaskInfo["id"];
  provider: BackgroundShellTaskInfo["provider"];
  command?: BackgroundShellTaskInfo["command"];
  description?: BackgroundShellTaskInfo["description"];
  status: BackgroundShellTaskInfo["status"];
  requiresAttention?: BackgroundShellTaskInfo["requiresAttention"];
  createdAt: BackgroundShellTaskInfo["createdAt"];
  updatedAt: BackgroundShellTaskInfo["updatedAt"];
}

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

interface SelectBackgroundShellTasksParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_BACKGROUND_SHELL_TASK_ROWS: BackgroundShellTaskRow[] = [];

function toBackgroundShellTaskRow(task: BackgroundShellTaskInfo): BackgroundShellTaskRow {
  return {
    id: task.id,
    provider: task.provider,
    command: task.command,
    description: task.description,
    status: task.status,
    requiresAttention: task.requiresAttention,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function selectBackgroundShellTasksForParent(
  state: SessionStoreSnapshot,
  params: SelectBackgroundShellTasksParams,
): BackgroundShellTaskRow[] {
  const tasks = state.sessions[params.serverId]?.backgroundShellTasks;
  if (!tasks || tasks.size === 0) {
    return EMPTY_BACKGROUND_SHELL_TASK_ROWS;
  }

  const rows: BackgroundShellTaskRow[] = [];
  for (const task of tasks.values()) {
    if (task.parentAgentId !== params.parentAgentId) {
      continue;
    }
    rows.push(toBackgroundShellTaskRow(task));
  }

  if (rows.length === 0) {
    return EMPTY_BACKGROUND_SHELL_TASK_ROWS;
  }

  rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return rows;
}

export function useBackgroundShellTasksForParent(
  params: SelectBackgroundShellTasksParams,
): BackgroundShellTaskRow[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectBackgroundShellTasksForParent(state, params),
    equal,
  );
}
