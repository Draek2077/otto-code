import React, { createContext, useContext, type ReactNode } from "react";
import invariant from "tiny-invariant";
import type { JsonValue } from "@otto-code/protocol/agent-types";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import type { OpenInSidePaneSource } from "@/workspace-tabs/open-beside";
import type { PaneHost } from "@/panels/panel-manifest";

/** The visual surface owned by the workspace region containing a pane. */
export type PaneSurface = "workspace" | "explorer";

export interface PaneContextValue {
  serverId: string;
  workspaceId: string;
  paneId: string;
  host: PaneHost;
  tabId: string;
  target: WorkspaceTabTarget;
  state?: JsonValue;
  fileNavigationRevision?: number;
  openTab: (target: WorkspaceTabTarget) => void;
  openPreferredTarget: (target: WorkspaceTabTarget, source: OpenInSidePaneSource) => void;
  openTargetToSide?: (target: WorkspaceTabTarget) => void;
  closeCurrentTab: () => void;
  retargetCurrentTab: (target: WorkspaceTabTarget) => void;
  setCurrentTabState: (state: JsonValue) => void;
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
   * focus - a companion view in an unfocused split (e.g. the Visualizer next
   * to the chat you're typing in) is visible but not focused. Consumers that
   * should keep running whenever they're watchable (not just when clicked
   * into) gate on this. */
  isVisible: boolean;
  focusPane: () => void;
}

const PaneContext = createContext<PaneContextValue | null>(null);
const PaneSurfaceContext = createContext<PaneSurface>("workspace");
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
  const surface: PaneSurface = value.host === "explorer" ? "explorer" : "workspace";
  return (
    <PaneSurfaceContext.Provider value={surface}>
      <PaneContext.Provider value={value}>{children}</PaneContext.Provider>
    </PaneSurfaceContext.Provider>
  );
}

/** Supplies the host-owned surface to standalone pane compositions. */
export function PaneSurfaceProvider({
  surface,
  children,
}: {
  surface: PaneSurface;
  children: ReactNode;
}) {
  return <PaneSurfaceContext.Provider value={surface}>{children}</PaneSurfaceContext.Provider>;
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

/** The pane host owns this value; child panes never infer it from tab kind. */
export function usePaneSurface(): PaneSurface {
  return useContext(PaneSurfaceContext);
}

export function usePaneFocus(): PaneFocusContextValue {
  const value = useContext(PaneFocusContext);
  invariant(value, "PaneFocusContext is required");
  return value;
}
