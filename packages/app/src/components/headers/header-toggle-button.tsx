import { useCallback, type ReactElement, type ReactNode, type Ref } from "react";
import { Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
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
      !disabled && (Boolean(hovered) || Boolean(pressed)) && headerIconSlotStyle.slotHovered,
      style,
    ],
    [disabled, style],
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
        {typeof children === "function"
          ? (state: { pressed: boolean; hovered?: boolean }) =>
              children({ hovered: Boolean(state.hovered), pressed: state.pressed })
          : children}
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
    padding: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    borderRadius: theme.borderRadius.lg,
  },
  slotHovered: {
    backgroundColor: theme.colors.surfaceHover,
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
}));
