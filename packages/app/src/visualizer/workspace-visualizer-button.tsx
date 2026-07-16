import { useCallback } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Waypoints } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIconSize, type Theme } from "@/styles/theme";
import { openVisualizerTab } from "@/visualizer/open-visualizer-tab";

const ThemedWaypoints = withUnistyles(Waypoints);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Same slot chrome as the neighboring "..." menu trigger and explorer toggle.
function triggerStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [
    headerIconSlotStyle.slot,
    (Boolean(hovered) || Boolean(pressed)) && headerIconSlotStyle.slotHovered,
  ];
}

interface WorkspaceVisualizerButtonProps {
  serverId: string;
  workspaceId: string | null | undefined;
}

/** Opens the Visualizer tab. Sits in the workspace header's title cluster,
 * immediately left of the "..." workspace menu (developer mode, desktop only). */
export function WorkspaceVisualizerButton({
  serverId,
  workspaceId,
}: WorkspaceVisualizerButtonProps) {
  const { t } = useTranslation();
  const iconSize = useIconSize(1.5);
  const handlePress = useCallback(() => {
    if (workspaceId) {
      openVisualizerTab({ serverId, workspaceId });
    }
  }, [serverId, workspaceId]);

  if (!workspaceId) {
    return null;
  }

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-visualizer-button"
        onPress={handlePress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.visualizer.openAction")}
      >
        {({ hovered }: { hovered?: boolean }) => (
          <ThemedWaypoints
            size={iconSize.md}
            uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("workspace.visualizer.openAction")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
