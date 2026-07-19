import { useSyncExternalStore } from "react";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

/**
 * Tracks which workspaces have their pane content actually mounted (a layout
 * exists, so the tab strip + panes render), as opposed to just the workspace
 * shell being on screen. The route-fade veil reads this to HOLD its reveal until
 * the incoming workspace's panes are up — on a cold/unseeded workspace the shell
 * paints a frame or two before `layoutByWorkspace[key]` is populated, and without
 * this gate the veil would lift on the empty shell and the panes would pop in
 * after (see RouteFadeContainer / PAGE_TRANSITION_MAX_HOLD_MS).
 *
 * This is transient runtime state (never persisted): a plain module-level set
 * with useSyncExternalStore, so a boolean read stays referentially stable.
 */
const readyKeys = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getWorkspaceContentReadyKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

export function markWorkspaceContentReady(key: string): void {
  if (!readyKeys.has(key)) {
    readyKeys.add(key);
    emit();
  }
}

export function clearWorkspaceContentReady(key: string): void {
  if (readyKeys.delete(key)) {
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the given workspace key has pane content mounted. A `null` key (not on
 * a workspace route) is always "ready", so non-workspace transitions reveal
 * immediately and only workspace targets are gated.
 */
export function useWorkspaceContentReady(key: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (key === null ? true : readyKeys.has(key)),
    () => (key === null ? true : readyKeys.has(key)),
  );
}

/** Readiness of the workspace the route currently points at — what the app-wide
 * route fade gates its reveal on. */
export function useActiveWorkspaceContentReady(): boolean {
  const selection = useActiveWorkspaceSelection();
  const key = selection
    ? getWorkspaceContentReadyKey(selection.serverId, selection.workspaceId)
    : null;
  return useWorkspaceContentReady(key);
}
