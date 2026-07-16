import React, { createContext, useContext, type ReactNode } from "react";
import invariant from "tiny-invariant";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

export interface PaneContextValue {
  serverId: string;
  workspaceId: string;
  tabId: string;
  target: WorkspaceTabTarget;
  openTab: (target: WorkspaceTabTarget) => void;
  closeCurrentTab: () => void;
  retargetCurrentTab: (target: WorkspaceTabTarget) => void;
  openFileInWorkspace: (request: WorkspaceFileOpenRequest) => void;
  openImportSheet: () => void;
}

export interface PaneFocusContextValue {
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  isInteractive: boolean;
  /** The pane's content is actually on screen and rendering: the workspace
   * route is focused AND this tab is the frontmost tab in its pane. Unlike
   * `isInteractive`/`isPaneFocused`, this does NOT require the pane to hold
   * focus — a companion view in an unfocused split (e.g. the Visualizer next
   * to the chat you're typing in) is visible but not focused. Consumers that
   * should keep running whenever they're watchable (not just when clicked
   * into) gate on this. */
  isVisible: boolean;
  focusPane: () => void;
}

const PaneContext = createContext<PaneContextValue | null>(null);
const PaneFocusContext = createContext<PaneFocusContextValue | null>(null);
const noopFocusPane = () => {};

export function createPaneFocusContextValue(input: {
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  /** Whether the pane's content is on screen (see `isVisible` on
   * PaneFocusContextValue). Optional: callers that don't distinguish
   * visibility from focus fall back to the focused-and-on-workspace value. */
  isVisible?: boolean;
  onFocusPane?: () => void;
}): PaneFocusContextValue {
  return {
    isWorkspaceFocused: input.isWorkspaceFocused,
    isPaneFocused: input.isPaneFocused,
    isInteractive: input.isWorkspaceFocused && input.isPaneFocused,
    isVisible: input.isVisible ?? (input.isWorkspaceFocused && input.isPaneFocused),
    focusPane: input.onFocusPane ?? noopFocusPane,
  };
}

export function PaneProvider({
  value,
  children,
}: {
  value: PaneContextValue;
  children: ReactNode;
}) {
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export function PaneFocusProvider({
  value,
  children,
}: {
  value: PaneFocusContextValue;
  children: ReactNode;
}) {
  return <PaneFocusContext.Provider value={value}>{children}</PaneFocusContext.Provider>;
}

export function usePaneContext(): PaneContextValue {
  const value = useContext(PaneContext);
  invariant(value, "PaneContext is required");
  return value;
}

export function usePaneFocus(): PaneFocusContextValue {
  const value = useContext(PaneFocusContext);
  invariant(value, "PaneFocusContext is required");
  return value;
}
