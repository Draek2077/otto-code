/**
 * The Brain status light, in the workspace title bar.
 *
 * The sidebar footer is the Brain's home, but the sidebar is collapsible and on
 * compact it is an overlay that is closed almost all the time - which meant the
 * one surface reporting what the local AI host is doing disappeared exactly when
 * you were working. This button is the same live glyph in the header strip, and
 * it renders only when the sidebar is not showing its own (see
 * `shouldShowHeaderBrainButton`), so the two are never on screen together.
 *
 * It is never dropped into the "..." overflow menu the way Voice cues,
 * Visualizer, Play and Explorer are (see `compact-header-actions.ts`). A status
 * light inside a closed menu reports nothing, and the menu's leading-icon slot
 * draws a flat glyph anyway - the animation, which is the whole signal, would
 * not survive the trip.
 */
import { useCallback } from "react";
import { router } from "expo-router";
import { withUnistyles } from "react-native-unistyles";
import { resolveBrainActivityLabel } from "@/components/brain/brain-state";
import { BrainStateIcon } from "@/components/brain/brain-state-icon";
import { resolveBrainRailRoute, useBrainRail } from "@/components/brain/use-brain-rail-state";
import { HeaderToggleButton, headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIconSize, type Theme } from "@/styles/theme";

// `BrainStateIcon` takes the theme as a value, not as a style, so it arrives
// through `uniProps` rather than a StyleSheet factory - the sanctioned route for
// a theme-reactive non-style prop, and the reason this file does not call the
// banned `useUnistyles()` (see docs/unistyles.md).
const ThemedBrainStateIcon = withUnistyles(BrainStateIcon);
const brainThemeMapping = (theme: Theme) => ({ theme });

/**
 * Whether the header carries the Brain button. It does whenever the sidebar's
 * own Brain button is not visible: compact keeps the sidebar as a closed
 * overlay, and on desktop the sidebar can be collapsed away.
 */
export function shouldShowHeaderBrainButton(input: {
  isCompact: boolean;
  isSidebarOpen: boolean;
}): boolean {
  return input.isCompact || !input.isSidebarOpen;
}

export function WorkspaceBrainButton() {
  const isCompact = useIsCompactFormFactor();
  const iconSize = useIconSize();
  // Compact matches the Play / Explorer / Visualizer glyphs beside it (lg);
  // desktop stays on the smaller md glyph shared with the "..." trigger.
  const glyphSize = iconSize.chromeMd;
  const rail = useBrainRail();
  // Same wording rule as the sidebar footer: the sentence is the state's own.
  // Two active slots name each half; three or more just count themselves.
  // The presentation label wins when set: it carries the disabled wording,
  // which no activity state can express.
  const label = rail.label ?? resolveBrainActivityLabel(rail.activity);
  const { disabled, serverId } = rail;

  const handlePress = useCallback(() => {
    router.push(resolveBrainRailRoute({ disabled, serverId }));
  }, [disabled, serverId]);

  if (!rail.visible) {
    return null;
  }

  return (
    <HeaderToggleButton
      testID="workspace-brain-button"
      onPress={handlePress}
      tooltipLabel={label}
      tooltipKeys={null}
      tooltipSide="bottom"
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={isCompact ? headerIconSlotStyle.compactSlot : undefined}
    >
      {/* Not a function child: the button's hover and pressed tints are
          deliberately not applied to the glyph. A status light that changes
          colour when you point at it is no longer reporting status, and the
          slot's own background already marks the hover. */}
      <ThemedBrainStateIcon
        state={rail.state}
        size={glyphSize}
        compact={isCompact}
        activity={rail.activity}
        uniProps={brainThemeMapping}
      />
    </HeaderToggleButton>
  );
}
