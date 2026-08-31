import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import { create } from "zustand";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export type WorkspaceCreationMethod = "open_project" | "create_worktree";

export interface PendingWorkspaceSetup {
  serverId: string;
  sourceDirectory: string;
  sourceWorkspaceId?: string;
  displayName?: string;
  creationMethod: WorkspaceCreationMethod;
}

export type WorkspaceSetupProgressPayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_progress" }
>["payload"];

export type WorkspaceSetupStatusResult = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_status_response" }
>["payload"];

export interface WorkspaceSetupStatusClient {
  fetchWorkspaceSetupStatus: (workspaceId: string) => Promise<WorkspaceSetupStatusResult>;
}

export interface WorkspaceSetupSnapshot extends WorkspaceSetupProgressPayload {
  updatedAt: number;
}

export function shouldShowWorkspaceSetup(snapshot: WorkspaceSetupSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.error !== null || snapshot.detail.commands.length > 0;
}

export function shouldSeedWorkspaceSetupTab(snapshot: WorkspaceSetupSnapshot | null): boolean {
  return snapshot?.status === "failed";
}

interface WorkspaceSetupStoreState {
  pendingWorkspaceSetup: PendingWorkspaceSetup | null;
  snapshots: Record<string, WorkspaceSetupSnapshot>;
  requestedKeys: Set<string>;
  emptyKeys: Set<string>;
  /** Failed setups already announced, so each is surfaced exactly once. */
  surfacedFailedSetupKeys: Set<string>;
  beginWorkspaceSetup: (value: PendingWorkspaceSetup) => void;
  clearWorkspaceSetup: () => void;
  upsertProgress: (input: { serverId: string; payload: WorkspaceSetupProgressPayload }) => void;
  /**
   * Take the right to surface a failed setup once. Returns true to the first
   * caller only, so a failure that is already on screen is not re-announced
   * every time the workspace re-renders.
   */
  claimFailedSetupSurface: (input: { serverId: string; workspaceId: string }) => boolean;
  ensureSetupStatus: (input: {
    serverId: string;
    workspaceId: string;
    client: WorkspaceSetupStatusClient;
  }) => void;
  /**
   * Drop the "this workspace has no setup" answers so the next visit asks
   * again. Setup progress is push-driven, so a push emitted while the socket
   * was down is gone for good - a reconnect is the one event that can make a
   * cached negative stale.
   */
  clearResolvedEmpty: (serverId: string) => void;
  removeWorkspace: (input: { serverId: string; workspaceId: string }) => void;
  clearServer: (serverId: string) => void;
}

function withoutServerKeys(keys: Set<string>, serverId: string): Set<string> | null {
  const next = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(`${serverId}:`)) {
      next.add(key);
    }
  }
  return next.size === keys.size ? null : next;
}

function buildWorkspaceSetupKey(input: { serverId: string; workspaceId: string }): string | null {
  return buildWorkspaceTabPersistenceKey(input);
}

export const useWorkspaceSetupStore = create<WorkspaceSetupStoreState>()((set, get) => ({
  pendingWorkspaceSetup: null,
  snapshots: {},
  requestedKeys: new Set(),
  emptyKeys: new Set(),
  surfacedFailedSetupKeys: new Set(),
  beginWorkspaceSetup: (value) => {
    set({ pendingWorkspaceSetup: value });
  },
  clearWorkspaceSetup: () => {
    set({ pendingWorkspaceSetup: null });
  },
  upsertProgress: ({ serverId, payload }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId: payload.workspaceId });
    if (!key) {
      return;
    }

    set((state) => {
      const emptyKeys = state.emptyKeys.has(key)
        ? new Set([...state.emptyKeys].filter((candidate) => candidate !== key))
        : state.emptyKeys;
      // A non-failed push means setup has started over, so the claim on the
      // previous failure is released and the next one can be surfaced. Without
      // this the set only ever grows and a workspace announces its first
      // failure and never another.
      const surfacedFailedSetupKeys =
        payload.status !== "failed" && state.surfacedFailedSetupKeys.has(key)
          ? new Set([...state.surfacedFailedSetupKeys].filter((candidate) => candidate !== key))
          : state.surfacedFailedSetupKeys;
      return {
        emptyKeys,
        surfacedFailedSetupKeys,
        snapshots: {
          ...state.snapshots,
          [key]: {
            ...payload,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },
  ensureSetupStatus: async ({ serverId, workspaceId, client }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId });
    if (!key) {
      return;
    }
    const state = get();
    if (state.snapshots[key] || state.requestedKeys.has(key) || state.emptyKeys.has(key)) {
      return;
    }

    // requestedKeys is a pure in-flight marker: it dedupes concurrent fetches and is
    // released once the request settles. A settle with no answer at all (mismatched
    // workspace, or an error) leaves no marker, so a later call can retry; once a
    // snapshot lands, the snapshots[key] guard above prevents redundant refetches.
    //
    // emptyKeys is the other half of that guard, and the reason this is called once
    // per workspace instead of once per navigation: a *successful* response for the
    // right workspace carrying no snapshot is a real answer - "this workspace has no
    // setup" - not a failure to retry. Without it, every workspace with no setup
    // commands re-asked on every route focus forever (38-47 responses across 12
    // workspace round-trips). It stays correct because the only thing that can change
    // the answer is a `workspace_setup_progress` push, which lands in upsertProgress
    // and clears the key; a reconnect (where a push could have been missed) clears it
    // via clearResolvedEmpty.
    set((current) => ({ requestedKeys: new Set(current.requestedKeys).add(key) }));

    try {
      const response = await client.fetchWorkspaceSetupStatus(workspaceId);
      if (response.workspaceId !== workspaceId) {
        return;
      }
      if (response.snapshot) {
        get().upsertProgress({
          serverId,
          payload: { workspaceId: response.workspaceId, ...response.snapshot },
        });
        return;
      }
      set((current) => ({ emptyKeys: new Set(current.emptyKeys).add(key) }));
    } catch {
      // Swallowed: the finally clears the in-flight marker so a later call retries.
    } finally {
      set((current) => {
        const next = new Set(current.requestedKeys);
        next.delete(key);
        return { requestedKeys: next };
      });
    }
  },
  clearResolvedEmpty: (serverId) => {
    set((state) => {
      const emptyKeys = withoutServerKeys(state.emptyKeys, serverId);
      return emptyKeys ? { emptyKeys } : state;
    });
  },
  claimFailedSetupSurface: ({ serverId, workspaceId }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId });
    if (!key) {
      return false;
    }

    let claimed = false;
    set((state) => {
      if (state.snapshots[key]?.status !== "failed" || state.surfacedFailedSetupKeys.has(key)) {
        return state;
      }
      claimed = true;
      return { surfacedFailedSetupKeys: new Set(state.surfacedFailedSetupKeys).add(key) };
    });
    return claimed;
  },
  removeWorkspace: ({ serverId, workspaceId }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId });
    if (!key) {
      return;
    }

    set((state) => {
      const hasSnapshot = key in state.snapshots;
      const hasEmptyKey = state.emptyKeys.has(key);
      if (!hasSnapshot && !hasEmptyKey) {
        return state;
      }
      const nextSnapshots = { ...state.snapshots };
      delete nextSnapshots[key];
      const nextEmptyKeys = new Set(state.emptyKeys);
      nextEmptyKeys.delete(key);
      return { snapshots: nextSnapshots, emptyKeys: nextEmptyKeys };
    });
  },
  clearServer: (serverId) => {
    set((state) => {
      const nextEntries = Object.entries(state.snapshots).filter(
        ([key]) => !key.startsWith(`${serverId}:`),
      );
      const emptyKeys = withoutServerKeys(state.emptyKeys, serverId);
      if (nextEntries.length === Object.keys(state.snapshots).length && !emptyKeys) {
        return state;
      }
      return {
        snapshots: Object.fromEntries(nextEntries),
        ...(emptyKeys ? { emptyKeys } : {}),
      };
    });
  },
}));
