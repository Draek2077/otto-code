import { useCallback, useMemo, type ComponentType } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { KeyboardActionId } from "@/keyboard/actions";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { SPACING, type Theme } from "@/styles/theme";

// Pane-toolbar glyphs follow the app-wide compact convention: doubled on mobile
// (the file editor's mode bar and the visualizer toolbar both consume this).
const TOOLBAR_ICON_SIZE = 16;
const TOOLBAR_ICON_SIZE_COMPACT = TOOLBAR_ICON_SIZE * 2;
// The inset around the glyph, as a constant rather than a theme read, because
// `useToolbarIconButtonWidth` has to arrive at the same number the style does.
const TOOLBAR_ICON_BUTTON_PADDING = SPACING[1];

/**
 * The width one of these buttons occupies in a row, for a toolbar that has to
 * decide how many of them fit. Lives here so the arithmetic cannot drift from
 * the padding the button actually renders with.
 */
export function useToolbarIconButtonWidth(): number {
  const isCompact = useIsCompactFormFactor();
  const glyphSize = isCompact ? TOOLBAR_ICON_SIZE_COMPACT : TOOLBAR_ICON_SIZE;
  return glyphSize + TOOLBAR_ICON_BUTTON_PADDING * 2;
}

// Icon-only toolbar button with a tooltip carrying its label (the
// file-view-mode-bar pattern; every icon-only button needs a Tooltip wrapper).
// `selected` shows a persistent highlight for stateful toggles - omit it for
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
// Also the disabled color - there is no dedicated "subtle" token; the disabled
// dimming comes from the button's reduced opacity (iconButtonDisabled) while
// the icon keeps the muted color.
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// The tinted glyph, for the one button in a toolbar that is the action the
// surface exists for (the rename tab's Apply). A tint, not a filled pill: a
// solid accent chip is taller than the icon buttons beside it and would break
// the pinned toolbar height it sits in.
const accentIconColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const destructiveIconColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

/**
 * `accent` marks the toolbar's primary action. At most one per toolbar - the
 * tint only means "this is the one" while nothing else is competing for it.
 * `destructive` marks an irreversible action without turning it into a filled
 * button that would disrupt the toolbar's compact geometry.
 */
export type ToolbarIconButtonTone = "default" | "accent" | "destructive";

export function ToolbarIconButton({
  label,
  Icon,
  onPress,
  disabled = false,
  selected = false,
  loading = false,
  tone = "default",
  shortcut,
  shortcutDiscoveryAction,
  testID,
}: {
  label: string;
  Icon: ToolbarIconComponent;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  loading?: boolean;
  tone?: ToolbarIconButtonTone;
  /**
   * Key hint printed after the label, in the app's tooltip idiom (see
   * header-toggle-button). Omit when the button has no binding - a tooltip that
   * names a key the button doesn't answer to is worse than no hint.
   *
   * A chord (`ShortcutKey[][]`), not a single combo: these hints are resolved
   * from the shortcut registry, where a user rebind may be a multi-step chord,
   * and printing only its first step would misname the key.
   */
  shortcut?: ShortcutKey[][];
  /** The registered action revealed directly over this toolbar trigger. */
  shortcutDiscoveryAction?: KeyboardActionId;
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
  const iconMapping = resolveIconMapping({ disabled, selected, tone });
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
        <View style={styles.shortcutDiscoveryAnchor}>
          {loading ? (
            <ThemedLoadingSpinner size={glyphSize} uniProps={iconMapping} />
          ) : (
            <Icon size={glyphSize} uniProps={iconMapping} />
          )}
          {shortcutDiscoveryAction ? (
            <ShortcutDiscoveryHint
              action={shortcutDiscoveryAction}
              enabled={!disabled && !loading}
              style={styles.shortcutDiscoveryHint}
            />
          ) : null}
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{label}</Text>
          {shortcut && shortcut.length > 0 ? (
            <Shortcut chord={shortcut} style={styles.tooltipShortcut} />
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Disabled outranks the tone: an accent glyph on a button that cannot be
 * pressed reads as the action being available, which is the one thing the
 * disabled state exists to deny.
 */
function resolveIconMapping({
  disabled,
  selected,
  tone,
}: {
  disabled: boolean;
  selected: boolean;
  tone: ToolbarIconButtonTone;
}): (theme: Theme) => { color: string } {
  if (disabled) {
    return mutedIconColorMapping;
  }
  if (tone === "accent") {
    return accentIconColorMapping;
  }
  if (tone === "destructive") {
    return destructiveIconColorMapping;
  }
  return selected ? selectedIconColorMapping : mutedIconColorMapping;
}

const styles = StyleSheet.create((theme: Theme) => ({
  iconButton: {
    padding: TOOLBAR_ICON_BUTTON_PADDING,
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
  shortcutDiscoveryAnchor: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tooltipShortcut: {},
}));
