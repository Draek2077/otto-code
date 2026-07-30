import { create } from "zustand";

/**
 * Which chat, if any, has the "Move to workspace" sheet open.
 *
 * A store rather than props: the menu entry is built six component layers below
 * the screen that owns the sheet, and threading a handler plus a capability flag
 * down that chain would touch every intermediate component for a feature none of
 * them care about. Ephemeral by design, so it is not persisted.
 */
export interface MoveChatTarget {
  serverId: string;
  agentId: string;
  /** Tab label, shown in the sheet so the user can confirm the right chat. */
  chatLabel: string;
  /** Current owner, excluded from the destination list. */
  workspaceId: string | null;
}

interface MoveChatState {
  target: MoveChatTarget | null;
  openMoveChat: (target: MoveChatTarget) => void;
  closeMoveChat: () => void;
}

export const useMoveChatStore = create<MoveChatState>((set) => ({
  target: null,
  openMoveChat: (target) => set({ target }),
  closeMoveChat: () => set({ target: null }),
}));

export function openMoveChat(target: MoveChatTarget): void {
  useMoveChatStore.getState().openMoveChat(target);
}
