import { useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Waypoints } from "@/components/icons/material-icons";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIconSize, type Theme } from "@/styles/theme";
import { useVisualizerSurface } from "@/visualizer/use-visualizer-surface";

const ThemedWaypoints = withUnistyles(Waypoints);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// `accentBright` - the same accent the Sidebar and Explorer toggles use for their
// on-state, so every enabled header toggle reads as one family.
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

// Accent while the Visualizer is on screen - either surface - so the button
// reads as the state toggle it now is.
function resolveGlyphColor(input: { showing: boolean; hovered: boolean }) {
  if (input.showing) {
    return accentColorMapping;
  }
  return input.hovered ? foregroundColorMapping : mutedColorMapping;
}

// Same slot chrome as the neighboring "..." menu trigger and explorer toggle,
// held while a Visualizer surface is open so the on-state needs no hover.
function resolveTriggerStyle(showing: boolean) {
  return ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
    headerIconSlotStyle.slot,
    showing && headerIconSlotStyle.slotActive,
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
 * between surfaces is done from inside the Visualizer itself - the tab toolbar's
 * PIP button and the PIP's expand control - which is why there is no second
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
  const isShowing = showing !== null;
  const triggerStyle = useMemo(() => resolveTriggerStyle(isShowing), [isShowing]);

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
            uniProps={resolveGlyphColor({ showing: isShowing, hovered: Boolean(hovered) })}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

// Matches the workspace "..." menu's leading-icon convention (muted, md).
const mutedMenuMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
const MENU_VISUALIZER_ICON = <ThemedWaypoints uniProps={mutedMenuMapping} />;

/** "..." menu fallback for when the compact header fit drops the button (see
 * `resolveCompactHeaderActions`): the same surface toggle, one tap deeper. */
export function WorkspaceVisualizerMenuItem({
  serverId,
  workspaceId,
}: WorkspaceVisualizerButtonProps) {
  const { t } = useTranslation();
  const { showing, toggle } = useVisualizerSurface(serverId, workspaceId);

  if (!workspaceId) {
    return null;
  }

  return (
    <DropdownMenuItem
      testID="workspace-header-visualizer"
      leading={MENU_VISUALIZER_ICON}
      onSelect={toggle}
    >
      {showing ? t("workspace.visualizer.closeAction") : t("workspace.visualizer.openAction")}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
