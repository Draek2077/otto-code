import { useCallback } from "react";
import { Waypoints } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useAppSettings } from "@/hooks/use-settings";
import { useToast } from "@/contexts/toast-context";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { openVisualizerPanel } from "./actions";
const Icon = withUnistyles(Waypoints, (theme) => ({ color: theme.colors.foregroundMuted }));
function useOpenVisualizer(serverId: string, workspaceId: string) {
  const { settings, updateSettings } = useAppSettings();
  const toast = useToast();
  return useCallback(async () => {
    try {
      if (settings.visualizerSurface === "tab") await openVisualizerPanel(serverId, workspaceId);
      else
        await updateSettings({
          visualizerPipOpen: settings.visualizerSurface === "pip",
          visualizerBackgroundOpen: settings.visualizerSurface === "background",
        });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Visualizer could not be opened.");
    }
  }, [serverId, workspaceId, settings.visualizerSurface, updateSettings, toast]);
}
/** Compact navigation opens the same preferred surface. Placement stays inside Visualizer. */
export function VisualizerWorkspaceMenuItems({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const open = useOpenVisualizer(serverId, workspaceId);
  return <DropdownMenuItem onSelect={open}>Open Visualizer</DropdownMenuItem>;
}
export function VisualizerWorkspaceButton({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const open = useOpenVisualizer(serverId, workspaceId);
  return (
    <ToolbarButton label="Open Visualizer" onPress={open} testID="workspace-visualizer-button">
      <Icon size={16} />
    </ToolbarButton>
  );
}
