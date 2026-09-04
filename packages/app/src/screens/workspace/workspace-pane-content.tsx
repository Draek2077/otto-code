import React, { useMemo, type ComponentType } from "react";
import invariant from "tiny-invariant";
import { View } from "react-native";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useBottomSafeAreaPadding } from "@/hooks/use-bottom-safe-area-padding";
import { getPanelRegistration } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { RenderProfile } from "@/utils/render-profiler";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import type { OpenInSidePaneSource } from "@/workspace-tabs/open-beside";
import type { PaneHost } from "@/panels/panel-manifest";

export interface WorkspacePaneContentModel {
  key: string;
  Component: ComponentType;
  paneContextValue: PaneContextValue;
}

export interface BuildWorkspacePaneContentModelInput {
  tab: WorkspaceTabDescriptor;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  paneId: string;
  host: PaneHost;
  fileNavigationRevision?: number;
  onOpenTab: (target: WorkspaceTabDescriptor["target"]) => void;
  onOpenPreferredTarget: (
    target: WorkspaceTabDescriptor["target"],
    source: OpenInSidePaneSource,
  ) => void;
  onOpenTargetToSide?: (target: WorkspaceTabDescriptor["target"]) => void;
  onCloseCurrentTab: () => void;
  onRetargetCurrentTab: (target: WorkspaceTabDescriptor["target"]) => void;
  onSetCurrentTabState: (state: WorkspaceTabDescriptor["state"]) => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet: () => void;
}

export function buildWorkspacePaneContentModel({
  tab,
  normalizedServerId,
  normalizedWorkspaceId,
  paneId,
  host,
  fileNavigationRevision,
  onOpenTab,
  onOpenPreferredTarget,
  onOpenTargetToSide,
  onCloseCurrentTab,
  onRetargetCurrentTab,
  onSetCurrentTabState,
  onOpenWorkspaceFile,
  onOpenImportSheet,
}: BuildWorkspacePaneContentModelInput): WorkspacePaneContentModel {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(tab.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);
  return {
    key: `${normalizedServerId}:${normalizedWorkspaceId}:${tab.tabId}`,
    Component: registration.component,
    paneContextValue: {
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      paneId,
      host,
      tabId: tab.tabId,
      target: tab.target,
      state: tab.state,
      fileNavigationRevision,
      openTab: onOpenTab,
      openPreferredTarget: onOpenPreferredTarget,
      openTargetToSide: onOpenTargetToSide,
      closeCurrentTab: onCloseCurrentTab,
      retargetCurrentTab: onRetargetCurrentTab,
      setCurrentTabState: onSetCurrentTabState,
      openFileInWorkspace: onOpenWorkspaceFile,
      openImportSheet: onOpenImportSheet,
    },
  };
}

export interface WorkspacePaneContentProps {
  content: WorkspacePaneContentModel;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  /** The content is on screen (workspace focused AND this tab is frontmost in
   * its pane) - see `isVisible` on PaneFocusContextValue. Optional; defaults
   * to the focused value inside createPaneFocusContextValue. */
  isVisible?: boolean;
  onFocusPane?: () => void;
}

function paneOwnsBottomSafeArea(target: WorkspaceTabDescriptor["target"]): boolean {
  // Agent composer and terminal keyboard stacks already reserve the system
  // obstruction themselves. A second reservation here creates a visibly empty
  // gesture band below their controls.
  return target.kind === "agent" || target.kind === "draft" || target.kind === "terminal";
}

export function WorkspacePaneContent({
  content,
  isWorkspaceFocused,
  isPaneFocused,
  isVisible,
  onFocusPane,
}: WorkspacePaneContentProps) {
  const { Component, key, paneContextValue } = content;
  const bottomSafeAreaPadding = useBottomSafeAreaPadding();
  const openTab = useStableEvent(paneContextValue.openTab);
  const openPreferredTarget = useStableEvent(paneContextValue.openPreferredTarget);
  const openTargetToSide = useStableEvent(paneContextValue.openTargetToSide ?? (() => undefined));
  const closeCurrentTab = useStableEvent(paneContextValue.closeCurrentTab);
  const retargetCurrentTab = useStableEvent(paneContextValue.retargetCurrentTab);
  const setCurrentTabState = useStableEvent(paneContextValue.setCurrentTabState);
  const openFileInWorkspace = useStableEvent(paneContextValue.openFileInWorkspace);
  const openImportSheet = useStableEvent(paneContextValue.openImportSheet);
  const stablePaneContextValue = useMemo(
    () => ({
      serverId: paneContextValue.serverId,
      workspaceId: paneContextValue.workspaceId,
      paneId: paneContextValue.paneId,
      host: paneContextValue.host,
      tabId: paneContextValue.tabId,
      target: paneContextValue.target,
      state: paneContextValue.state,
      fileNavigationRevision: paneContextValue.fileNavigationRevision,
      openTab,
      openPreferredTarget,
      openTargetToSide: paneContextValue.openTargetToSide ? openTargetToSide : undefined,
      closeCurrentTab,
      retargetCurrentTab,
      setCurrentTabState,
      openFileInWorkspace,
      openImportSheet,
    }),
    [
      closeCurrentTab,
      openFileInWorkspace,
      openImportSheet,
      openTab,
      openPreferredTarget,
      openTargetToSide,
      paneContextValue.serverId,
      paneContextValue.fileNavigationRevision,
      paneContextValue.tabId,
      paneContextValue.target,
      paneContextValue.state,
      paneContextValue.workspaceId,
      paneContextValue.paneId,
      paneContextValue.host,
      paneContextValue.openTargetToSide,
      retargetCurrentTab,
      setCurrentTabState,
    ],
  );
  const paneFocusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused,
        isPaneFocused,
        isVisible,
        onFocusPane,
      }),
    [isPaneFocused, isVisible, isWorkspaceFocused, onFocusPane],
  );
  const paneContentStyle = useMemo(
    () => [
      paneContainerStyle,
      paneOwnsBottomSafeArea(paneContextValue.target) ? null : bottomSafeAreaPadding,
    ],
    [bottomSafeAreaPadding, paneContextValue.target],
  );

  return (
    <RenderProfile
      id={`WorkspacePaneContent:${paneContextValue.target.kind}:${paneContextValue.tabId}`}
    >
      <PaneProvider value={stablePaneContextValue}>
        <PaneFocusProvider value={paneFocusValue}>
          <View style={paneContentStyle}>
            <Component key={key} />
          </View>
        </PaneFocusProvider>
      </PaneProvider>
    </RenderProfile>
  );
}

const paneContainerStyle = { flex: 1, minHeight: 0 } as const;
