import { forwardRef, useCallback, type ComponentProps } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { COMPOSER_ICON_SIZE } from "@/composer/composer-icon-size";
import { compactUp } from "@/styles/theme";
import type { IconSizeProp } from "@/components/icons/icon-size";
import type { AgentControlIcon } from "@/agent-controls/icons";

type AgentControlTriggerProps = Omit<
  ComponentProps<typeof ComboboxTrigger>,
  "accessibilityLabel" | "block" | "children" | "chevron" | "onPress" | "style"
> & {
  icon: AgentControlIcon;
  iconColor?: string;
  surface: "toolbar" | "sheet";
  label: string;
  value?: string;
  showToolbarLabel?: boolean;
  showCaret?: boolean;
  open?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

export const AgentControlTrigger = forwardRef<View, AgentControlTriggerProps>(
  function AgentControlTrigger(
    {
      icon: Icon,
      iconColor,
      surface,
      label,
      value,
      showToolbarLabel = true,
      showCaret = false,
      open = false,
      disabled = false,
      onPress,
      accessibilityLabel,
      testID,
      ...triggerProps
    },
    ref,
  ) {
    const isSheet = surface === "sheet";
    // The overflow sheet is a dense list of rows, not a toolbar with room to grow, so
    // its glyphs ride the `chrome*` ladder (up by half on compact) rather than the
    // ordinary one (double). `sheetGlyph` grows by the same half so the box still fits.
    const sheetGlyphSize: IconSizeProp = "chromeMd";
    const resolvedIconColor = iconColor ?? styles.iconColor.color;
    const showValue = isSheet || showToolbarLabel;
    const triggerStyle = useCallback(
      ({ pressed, hovered }: PressableStateCallbackType) => [
        isSheet ? styles.sheetRow : styles.toolbarControl,
        !isSheet && !showToolbarLabel && styles.toolbarIconOnly,
        hovered && (isSheet ? styles.sheetRowInteractive : styles.hovered),
        (pressed || open) && (isSheet ? styles.sheetRowInteractive : styles.pressed),
        disabled && styles.disabled,
      ],
      [disabled, isSheet, open, showToolbarLabel],
    );

    return (
      <ComboboxTrigger
        {...triggerProps}
        ref={ref}
        collapsable={false}
        disabled={disabled}
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        chevron={showCaret ? undefined : null}
      >
        {isSheet ? (
          <View style={styles.sheetGlyph}>
            <Icon size={sheetGlyphSize} color={resolvedIconColor} />
          </View>
        ) : (
          <ComposerToolbarGlyph>
            <Icon size={COMPOSER_ICON_SIZE} color={resolvedIconColor} />
          </ComposerToolbarGlyph>
        )}
        {isSheet ? (
          <Text style={styles.sheetLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {showValue ? (
          <Text style={isSheet ? styles.sheetValue : styles.toolbarValue} numberOfLines={1}>
            {value ?? label}
          </Text>
        ) : null}
      </ComboboxTrigger>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  toolbarControl: {
    height: compactUp(28),
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: compactUp(theme.spacing[1]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.full,
    backgroundColor: "transparent",
  },
  toolbarIconOnly: {
    width: compactUp(28),
    height: compactUp(28),
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  toolbarValue: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  sheetRow: {
    minHeight: 44,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  sheetRowInteractive: {
    backgroundColor: theme.colors.surface2,
  },
  sheetGlyph: {
    width: compactUp(20, 1.5),
    height: compactUp(20, 1.5),
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  sheetValue: {
    maxWidth: "45%",
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabled: {
    opacity: 0.5,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
}));
