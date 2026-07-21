import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Waypoints } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIconSize, type Theme } from "@/styles/theme";
import { useVisualizerSurface } from "@/visualizer/use-visualizer-surface";

const ThemedWaypoints = withUnistyles(Waypoints);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.primary });

// Accent while the Visualizer is on screen — either surface — so the button
// reads as the state toggle it now is.
function resolveGlyphColor(input: { showing: boolean; hovered: boolean }) {
  if (input.showing) {
    return accentColorMapping;
  }
  return input.hovered ? foregroundColorMapping : mutedColorMapping;
}

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

/** The Visualizer's single entry point. Sits in the workspace header's title
 * cluster, immediately right of the "..." workspace menu (developer mode).
 *
 * One button, two surfaces: it opens whichever surface you last used (the tab,
 * or the picture-in-picture viewport) and closes whatever is showing. Switching
 * between surfaces is done from inside the Visualizer itself — the tab toolbar's
 * PIP button and the PIP's expand control — which is why there is no second
 * header button here any more. */
export function WorkspaceVisualizerButton({
  serverId,
  workspaceId,
}: WorkspaceVisualizerButtonProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const iconSize = useIconSize(1.5);
  // Compact matches the Play/Explorer glyphs beside it (lg), desktop stays at the
  // smaller md glyph shared with the "..." trigger.
  const glyphSize = isCompact ? iconSize.lg : iconSize.md;
  const { showing, toggle } = useVisualizerSurface(serverId, workspaceId);

  if (!workspaceId) {
    return null;
  }

  const label = showing
    ? t("workspace.visualizer.closeAction")
    : t("workspace.visualizer.openAction");

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-visualizer-button"
        onPress={toggle}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {({ hovered }: { hovered?: boolean }) => (
          <ThemedWaypoints
            size={glyphSize}
            uniProps={resolveGlyphColor({ showing: showing !== null, hovered: Boolean(hovered) })}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
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
