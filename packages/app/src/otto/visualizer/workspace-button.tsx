import { useCallback } from "react";
import { Orbit } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useAppSettings } from "@/hooks/use-settings";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { openVisualizerPanel } from "./actions";
import type { Theme } from "@/styles/theme";
const Icon = withUnistyles(Orbit);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export function VisualizerWorkspaceMenuItems({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { settings, updateSettings } = useAppSettings();
  const save = useCallback(
    async (placement: "tab" | "pip" | "background") => {
      await updateSettings({
        visualizerSurface: placement,
        visualizerPipOpen: placement === "pip",
        visualizerBackgroundOpen: placement === "background",
      });
    },
    [updateSettings],
  );
  const tab = useCallback(async () => {
    await openVisualizerPanel(serverId, workspaceId);
  }, [serverId, workspaceId]);
  const pip = useCallback(() => save("pip"), [save]);
  const background = useCallback(() => save("background"), [save]);
  const close = useCallback(
    () => updateSettings({ visualizerPipOpen: false, visualizerBackgroundOpen: false }),
    [updateSettings],
  );
  const preferred = useCallback(async () => {
    if (settings.visualizerSurface === "tab") await openVisualizerPanel(serverId, workspaceId);
    else await save(settings.visualizerSurface);
  }, [save, settings.visualizerSurface, serverId, workspaceId]);
  return (
    <>
      <DropdownMenuItem onSelect={preferred}>Open preferred Visualizer</DropdownMenuItem>
      <DropdownMenuItem onSelect={tab}>Open Visualizer tab</DropdownMenuItem>
      <DropdownMenuItem onSelect={pip}>Picture in picture</DropdownMenuItem>
      <DropdownMenuItem onSelect={background}>Chat background</DropdownMenuItem>
      <DropdownMenuItem onSelect={close}>Close ambient Visualizer</DropdownMenuItem>
    </>
  );
}
export function VisualizerWorkspaceButton(props: { serverId: string; workspaceId: string }) {
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" label="Visualizer">
        <Icon size={16} uniProps={iconColor} />
      </ToolbarButton>
      <DropdownMenuContent>
        <VisualizerWorkspaceMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
