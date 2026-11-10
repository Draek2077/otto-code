import { create } from "zustand";
import type { VisualizerSession } from "@getpaseo/visualizer/contracts";
export interface VisualizerSelection {
  selectedId: string | null;
  follow: boolean;
}
export const defaultVisualizerSelection: VisualizerSelection = { selectedId: null, follow: true };
export function selectedVisualizerSession(
  selection: VisualizerSelection,
  sessions: readonly VisualizerSession[],
  focusedAgentId: string | null,
) {
  const current =
    selection.selectedId === "otto:all-active-chats" ||
    sessions.some((session) => session.id === selection.selectedId)
      ? selection.selectedId
      : null;
  if (!selection.follow) return current ?? sessions[0]?.id ?? null;
  return (
    sessions.find((session) => session.id === focusedAgentId)?.id ??
    current ??
    sessions[0]?.id ??
    null
  );
}
/** Presentation choice survives guest/PIP handoff; no chat or stream data. */
export const useVisualizerSelection = create<{
  targets: Record<string, VisualizerSelection>;
  select(key: string, value: VisualizerSelection): void;
}>((set) => ({
  targets: {},
  select(key, value) {
    set((state) => ({ targets: Object.assign({}, state.targets, { [key]: value }) }));
  },
}));
