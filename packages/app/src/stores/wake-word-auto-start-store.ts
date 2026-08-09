import { create } from "zustand";

export interface PendingWakeWordAutoStart {
  serverId: string;
  workspaceId: string;
  draftId: string;
  autoSend: boolean;
  preRollPcm?: string;
  speechAlreadyDetected?: boolean;
}

interface WakeWordAutoStartState {
  pendingByDraftId: Record<string, PendingWakeWordAutoStart>;
  setPending: (pending: PendingWakeWordAutoStart) => void;
  consumePending: (input: {
    serverId: string;
    workspaceId: string;
    draftId: string;
  }) => PendingWakeWordAutoStart | null;
}

function matchesPending(
  pending: PendingWakeWordAutoStart | null | undefined,
  input: { serverId: string; workspaceId: string; draftId: string },
): pending is PendingWakeWordAutoStart {
  return (
    pending?.serverId === input.serverId &&
    pending.workspaceId === input.workspaceId &&
    pending.draftId === input.draftId
  );
}

export const useWakeWordAutoStartStore = create<WakeWordAutoStartState>((set, get) => ({
  pendingByDraftId: {},
  setPending: (pending) =>
    set((state) => ({
      pendingByDraftId: {
        ...state.pendingByDraftId,
        [pending.draftId]: pending,
      },
    })),
  consumePending: (input) => {
    const pending = get().pendingByDraftId[input.draftId];
    if (!matchesPending(pending, input)) {
      return null;
    }
    set((state) => {
      if (!matchesPending(state.pendingByDraftId[input.draftId], input)) {
        return state;
      }
      const { [input.draftId]: _removed, ...rest } = state.pendingByDraftId;
      return { pendingByDraftId: rest };
    });
    return pending;
  },
}));
