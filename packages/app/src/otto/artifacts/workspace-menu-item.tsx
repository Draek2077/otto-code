import React, { useCallback, useMemo } from "react";
import { PanelsTopLeft } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useInstalledPlugin } from "@/plugins/registry";
import { createPluginNavigation } from "@/plugins/navigation";
import { usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
const Icon = withUnistyles(PanelsTopLeft);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const leading = <Icon size={14} uniProps={color} />;
/** Bind the clicked row's host/workspace, including when a different chat is active. */
export function ArtifactWorkspaceMenuItem({
  serverId,
  workspaceId,
  surface,
}: {
  serverId?: string;
  workspaceId?: string;
  surface: "context" | "dropdown";
}) {
  const plugin = useInstalledPlugin(serverId ?? "", "otto-artifacts"),
    compact = useIsCompactFormFactor();
  const navigation = useMemo(
    () => createPluginNavigation({ serverId: serverId ?? "", workspaceId: workspaceId ?? null }),
    [serverId, workspaceId],
  );
  const open = useCallback(() => {
    if (compact) usePanelStore.getState().showMobileAgent();
    navigation.openWorkspacePanel("otto-artifacts", "artifacts", "workspace");
  }, [navigation, compact]);
  if (
    !serverId ||
    !workspaceId ||
    !plugin?.workspacePanels.some(
      (panel) => panel.id === "artifacts" && panel.context === "workspace",
    )
  )
    return null;
  if (surface === "context")
    return (
      <ContextMenuItem onSelect={open} leading={leading}>
        Open Artifacts
      </ContextMenuItem>
    );
  return (
    <DropdownMenuItem onSelect={open} leading={leading}>
      Open Artifacts
    </DropdownMenuItem>
  );
}
