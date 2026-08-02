import { useCallback, useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useSessionStore } from "@/stores/session-store";
import { useSettings } from "@/hooks/use-settings";
import { usePinnedTaskListStore } from "./store";
import { resolvePinnedTodoList, selectLatestTodoList, type TodoListStreamItem } from "./select";

const EMPTY_DISMISSED: readonly string[] = [];

export interface PinnedTaskList {
  // The checklist to float pinned, or null when nothing should pin (feature off,
  // no list, or the latest was dismissed — callers fall back to inline).
  item: TodoListStreamItem | null;
  autoDismiss: boolean;
  dismiss: () => void;
}

/**
 * Shared source of truth for the pinned checklist. Both the floating overlay and
 * the stream section call this so they agree on exactly which list is pinned —
 * the overlay renders it, the section hides its inline copy while it's up.
 */
export function usePinnedTaskList({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId?: string;
}): PinnedTaskList {
  const enabled = useSettings((settings) => settings.pinnedTaskListEnabled);
  const autoDismiss = useSettings((settings) => settings.pinnedTaskListAutoDismiss);

  // Returns the latest todo_list item reference, stable until it actually
  // changes — so this only re-renders when the checklist moves, not on every
  // unrelated stream flush.
  //
  // While the panel slot is hidden the selector returns the frozen reference
  // instead of the live one, the same contract the transcript keeps (see
  // AgentStreamSection). Without it a background chat re-rendered the whole
  // panel body on every checklist update and ran the check-off animations
  // against a `display: none` surface — work nobody can see, and it broke the
  // agreement with the transcript, which had already frozen the id it hides.
  // The selector closure reads live again on the render that reactivates the
  // panel, so this can't strand a stale list.
  const isPanelActive = useRetainedPanelActive();
  const frozenLatestRef = useRef<TodoListStreamItem | null>(null);
  const latest = useSessionStore((state) => {
    if (!isPanelActive) {
      return frozenLatestRef.current;
    }
    const tail = agentId ? state.sessions[serverId]?.agentStreamTail?.get(agentId) : undefined;
    return tail ? selectLatestTodoList(tail) : null;
  });
  if (isPanelActive) {
    frozenLatestRef.current = latest;
  }

  const agentKey = agentId ? `${serverId}:${agentId}` : "";
  const dismissedIds = usePinnedTaskListStore(
    (state) => state.dismissedByAgent[agentKey] ?? EMPTY_DISMISSED,
  );
  const dismissAction = usePinnedTaskListStore((state) => state.dismiss);

  const item = enabled ? resolvePinnedTodoList({ latest, enabled, dismissedIds }) : null;

  const dismiss = useCallback(() => {
    if (latest && agentKey) {
      dismissAction(agentKey, latest.id);
    }
  }, [latest, agentKey, dismissAction]);

  return { item, autoDismiss, dismiss };
}
