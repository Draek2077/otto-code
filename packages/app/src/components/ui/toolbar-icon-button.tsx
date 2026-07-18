import { useCallback, useMemo, type ComponentType } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

// Pane-toolbar glyphs follow the app-wide compact convention: doubled on mobile
// (the file editor's mode bar and the visualizer toolbar both consume this).
const TOOLBAR_ICON_SIZE = 16;
const TOOLBAR_ICON_SIZE_COMPACT = TOOLBAR_ICON_SIZE * 2;

// Icon-only toolbar button with a tooltip carrying its label (the
// file-view-mode-bar pattern; every icon-only button needs a Tooltip wrapper).
// `selected` shows a persistent highlight for stateful toggles — omit it for
// momentary action buttons. `disabled` dims the button and blocks presses;
// `loading` swaps the glyph for a spinner. Used by the file tab's editor
// toolbar and the visualizer toolbar.

/**
 * Any `withUnistyles(icon)` wrapper: renders a fixed-size glyph whose color is
 * theme-reactive through a `uniProps` mapping.
 */
export type ToolbarIconComponent = ComponentType<{
  size?: number;
  uniProps?: (theme: Theme) => { color: string };
}>;

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const selectedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
// Also the disabled color — there is no dedicated "subtle" token; the disabled
// dimming comes from the button's reduced opacity (iconButtonDisabled) while
// the icon keeps the muted color.
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ToolbarIconButton({
  label,
  Icon,
  onPress,
  disabled = false,
  selected = false,
  loading = false,
  testID,
}: {
  label: string;
  Icon: ToolbarIconComponent;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      !disabled && (Boolean(hovered) || pressed) && styles.iconButtonActive,
      selected && styles.iconButtonSelected,
      disabled && styles.iconButtonDisabled,
    ],
    [disabled, selected],
  );
  const accessibilityState = useMemo(() => ({ disabled, selected }), [disabled, selected]);
  const iconMapping = !disabled && selected ? selectedIconColorMapping : mutedIconColorMapping;
  const isCompact = useIsCompactFormFactor();
  const glyphSize = isCompact ? TOOLBAR_ICON_SIZE_COMPACT : TOOLBAR_ICON_SIZE;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        testID={testID}
        onPress={onPress}
        disabled={disabled || loading}
        style={buttonStyle}
      >
        {loading ? (
          <ThemedLoadingSpinner size={glyphSize} uniProps={mutedIconColorMapping} />
        ) : (
          <Icon size={glyphSize} uniProps={iconMapping} />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  iconButton: {
    padding: theme.spacing[1],
    borderRadius: 6,
  },
  iconButtonActive: {
    backgroundColor: theme.colors.surfaceHover,
  },
  iconButtonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  // Dimmed, non-interactive look for actions with nothing to act on. No hover
  // response; the reduced opacity reads the icon as unavailable without
  // needing a separate color token.
  iconButtonDisabled: {
    opacity: 0.4,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
