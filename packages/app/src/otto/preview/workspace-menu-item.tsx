import { useCallback, useMemo } from "react";
import { MonitorPlay } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useInstalledPlugin } from "@/plugins/registry";
import { createPluginNavigation } from "@/plugins/navigation";
import { usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
const Icon = withUnistyles(MonitorPlay);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const leading = <Icon size={14} uniProps={color} />;
/** Used by the clicked workspace row and its browser More menu; no active-workspace guessing. */
export function PreviewWorkspaceMenuItem({
  serverId,
  workspaceId,
  surface,
}: {
  serverId?: string;
  workspaceId?: string;
  surface: "context" | "dropdown";
}) {
  const plugin = useInstalledPlugin(serverId ?? "", "otto-browser");
  const compact = useIsCompactFormFactor();
  const navigation = useMemo(
    () => createPluginNavigation({ serverId: serverId ?? "", workspaceId: workspaceId ?? null }),
    [serverId, workspaceId],
  );
  const open = useCallback(() => {
    if (compact) usePanelStore.getState().showMobileAgent();
    navigation.openWorkspacePanel("otto-browser", "preview", "workspace");
  }, [compact, navigation]);
  if (
    !serverId ||
    !workspaceId ||
    !plugin?.workspacePanels.some(
      (panel) => panel.id === "preview" && panel.context === "workspace",
    )
  )
    return null;
  if (surface === "context")
    return (
      <ContextMenuItem onSelect={open} leading={leading}>
        Manage Preview servers
      </ContextMenuItem>
    );
  return (
    <DropdownMenuItem onSelect={open} leading={leading}>
      Manage Preview servers
    </DropdownMenuItem>
  );
}
