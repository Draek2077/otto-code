import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { requestClearCompletedBackgroundTasks } from "./clear-completed-background-tasks";
import type { BackgroundShellTaskRow } from "./select";
import {
  BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS,
  resolveBackgroundTaskRowGroup,
  selectBackgroundTasksToAutoClear,
  type TerminalBackgroundTaskGroup,
} from "./track-presentation";

export interface UseAutoClearCompletedBackgroundTasksInput {
  serverId: string;
  parentAgentId: string;
  rows: readonly BackgroundShellTaskRow[];
  /** Which terminal group this driver sweeps. Mount one per group. */
  group: TerminalBackgroundTaskGroup;
  /**
   * The setting, and the track's open state. Callers pass false while the track
   * is open so a row cannot vanish from under the reader.
   */
  enabled: boolean;
}

/**
 * Device-local "auto-clear background tasks" behavior for one terminal group of
 * one chat's background tasks track. When enabled, rows in `group` clear
 * themselves once settled, so no manual "Clear all" is needed.
 *
 * Mount it once per group: completed and failed clear on separate settings
 * because they carry different weight. A finished shell is throwaway (its output
 * is already in the chat), while a failed one is a result you may not have read
 * yet, so wanting the first swept away says nothing about wanting the second.
 * Each instance keeps its own attempted set, so one group can never sweep the
 * other's rows.
 *
 * Deliberately a separate driver from the sub-agents auto-clear too: a cleared
 * sub-agent is an archived chat, which is a heavier thing to discard.
 *
 * Scope is a chat's background tasks track only, and it only runs while the
 * panel is mounted: decluttering matters where the track is visible. Settled
 * rows that fail to clear are not retried automatically (the manual clear stays
 * available), so a persistent failure can't spin.
 */
export function useAutoClearCompletedBackgroundTasks(
  input: UseAutoClearCompletedBackgroundTasksInput,
): void {
  const { serverId, parentAgentId, rows, group, enabled } = input;
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const { t } = useTranslation();

  // Ids we've already issued an auto-clear for, never retried, so a stuck
  // clear can't loop the effect. Reset when auto-clear is turned off.
  const attemptedRef = useRef<Set<string>>(new Set());
  // Bumped by the settle timer to re-evaluate rows that weren't settled yet.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      attemptedRef.current = new Set();
      return;
    }

    const excludeIds = attemptedRef.current;
    const now = Date.now();
    const due = selectBackgroundTasksToAutoClear(rows, {
      group,
      settleMs: BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS,
      now,
      excludeIds,
    });

    if (due.length > 0) {
      for (const row of due) {
        attemptedRef.current.add(row.id);
      }
      void requestClearCompletedBackgroundTasks(
        { parentAgentId, taskIds: due.map((row) => row.id) },
        {
          clearBackgroundShellTasks: (parent, ids) =>
            client
              ? client.clearBackgroundShellTasks(parent, ids)
              : Promise.reject(new Error(t("backgroundTasks.daemonUnavailable"))),
          reportError: (error) => toast.error(toErrorMessage(error)),
        },
      );
    }

    // Schedule a re-check for the soonest row in this group that isn't settled yet.
    let earliestRemaining = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (resolveBackgroundTaskRowGroup(row) !== group || excludeIds.has(row.id)) {
        continue;
      }
      const remaining =
        BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS - (now - new Date(row.updatedAt).getTime());
      if (remaining > 0 && remaining < earliestRemaining) {
        earliestRemaining = remaining;
      }
    }
    if (earliestRemaining === Number.POSITIVE_INFINITY) {
      return;
    }
    const timer = setTimeout(() => setTick((value) => value + 1), earliestRemaining + 50);
    return () => clearTimeout(timer);
  }, [enabled, rows, group, tick, parentAgentId, client, toast, t]);
}
