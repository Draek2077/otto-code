import { useCallback, type ReactElement, type ReactNode, type Ref } from "react";
import { Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import type { KeyboardActionId } from "@/keyboard/actions";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { isWeb } from "@/constants/platform";

interface HeaderToggleButtonState {
  hovered: boolean;
  pressed: boolean;
}

interface HeaderToggleButtonProps extends Omit<PressableProps, "style" | "onPress" | "children"> {
  onPress: NonNullable<PressableProps["onPress"]>;
  tooltipLabel: string;
  // Chord sequence as resolved by `useShortcutKeys`, so the tooltip reflects the
  // user's remapping rather than a hardcoded default. Null when the action has
  // no binding on this platform.
  tooltipKeys: ShortcutKey[][] | null;
  tooltipSide: "left" | "right" | "top" | "bottom";
  tooltipDelayDuration?: number;
  style?: StyleProp<ViewStyle>;
  // Persistent on-state - holds the slot chrome while the toggle is enabled, the
  // same way the sidebar's Settings button marks the surface you are already on.
  // An enabled feature should read as enabled without needing a hover to prove it.
  active?: boolean;
  /** The registered shortcut action revealed directly over this header trigger. */
  shortcutDiscoveryAction?: KeyboardActionId;
  // Composed onto the underlying trigger Pressable (e.g. a tutorial anchor).
  anchorRef?: Ref<View>;
  children: ReactNode | ((state: HeaderToggleButtonState) => ReactNode);
}

export function HeaderToggleButton({
  onPress,
  tooltipLabel,
  tooltipKeys,
  tooltipSide,
  tooltipDelayDuration = 0,
  style,
  disabled,
  active = false,
  shortcutDiscoveryAction,
  anchorRef,
  children,
  ...props
}: HeaderToggleButtonProps): ReactElement {
  const tooltipTestID =
    typeof props.testID === "string" && props.testID.length > 0
      ? `${props.testID}-tooltip`
      : undefined;
  const expandedState = (props.accessibilityState as { expanded?: boolean } | undefined)?.expanded;
  const ariaExpandedProps =
    isWeb && typeof expandedState === "boolean"
      ? ({ "aria-expanded": expandedState } as Record<string, boolean>)
      : null;

  const combinedStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      headerIconSlotStyle.slot,
      !disabled && active && headerIconSlotStyle.slotActive,
      !disabled && Boolean(hovered) && !pressed && headerIconSlotStyle.slotHovered,
      !disabled && Boolean(pressed) && headerIconSlotStyle.slotPressed,
      style,
    ],
    [active, disabled, style],
  );

  return (
    <Tooltip delayDuration={tooltipDelayDuration} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        {...props}
        {...ariaExpandedProps}
        anchorRef={anchorRef}
        disabled={disabled}
        onPress={onPress}
        style={combinedStyle}
      >
        {typeof children === "function" ? (
          (state: { pressed: boolean; hovered?: boolean }) => (
            <>
              {children({ hovered: Boolean(state.hovered), pressed: state.pressed })}
              {shortcutDiscoveryAction ? (
                <ShortcutDiscoveryHint
                  action={shortcutDiscoveryAction}
                  enabled={!disabled}
                  style={styles.shortcutDiscoveryHint}
                />
              ) : null}
            </>
          )
        ) : (
          <>
            {children}
            {shortcutDiscoveryAction ? (
              <ShortcutDiscoveryHint
                action={shortcutDiscoveryAction}
                enabled={!disabled}
                style={styles.shortcutDiscoveryHint}
              />
            ) : null}
          </>
        )}
      </TooltipTrigger>
      <TooltipContent testID={tooltipTestID} side={tooltipSide} align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{tooltipLabel}</Text>
          {tooltipKeys ? <Shortcut chord={tooltipKeys} style={styles.shortcut} /> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

export const headerIconSlotStyle = StyleSheet.create((theme) => ({
  slot: {
    position: "relative",
    // The focus ring is reserved in the resting geometry: a transparent 1px
    // border, paid for out of the padding, so focusing a control paints the
    // ring without moving its glyph or changing the slot's outer size. Every
    // title-bar control shares this chrome, so any of them can carry the ring.
    padding: {
      xs: theme.spacing[3] - 1,
      md: theme.spacing[2] - 1,
    },
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    borderRadius: theme.borderRadius.lg,
  },
  // Compact workspace-header actions sit in a flush icon strip. Their normal
  // touch-target padding is intentionally generous, but using it here would
  // make the adjacent slots look twice as far apart. Keep the target centered
  // while trimming only 2px from each compact edge.
  compactSlot: {
    padding: {
      xs: theme.spacing[3] - 3,
      md: theme.spacing[2] - 1,
    },
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  // Keyboard focus, for the slots that can take it (the popup triggers). Rings
  // hug the control's own border because the border space is already reserved
  // above.
  slotFocused: {
    borderColor: theme.colors.accent,
  },
  // Selected is the quiet persistent state shared with explorer tabs. Hover is
  // stronger and is applied AFTER selected in `combinedStyle`, so pointing at
  // a toggled-on button remains visible. The palette builders derive every
  // rung from the active theme accent.
  slotHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  slotActive: {
    backgroundColor: theme.colors.surfaceInteractiveSelected,
  },
  slotPressed: {
    backgroundColor: theme.colors.surfaceInteractivePressed,
  },
}));

const styles = StyleSheet.create((theme) => ({
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  shortcut: {},
  shortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
    zIndex: 1,
  },
}));
