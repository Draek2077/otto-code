import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const checkProps = (theme: Theme) => ({ color: theme.colors.accentForeground });

export function ImportSessionCheckmark({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.mark, checked && styles.checked]}>
      {checked ? <ThemedCheck size="sm" uniProps={checkProps} /> : null}
    </View>
  );
}

export function ImportSessionCheckbox({
  checked,
  disabled,
  label,
  onPress,
  testID,
  row = false,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
  row?: boolean;
}) {
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const pressStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.control,
      row && styles.row,
      hovered && !disabled && styles.hovered,
      pressed && styles.pressed,
      disabled && styles.disabled,
    ],
    [hovered, disabled, row],
  );
  return (
    <View style={styles.container} onPointerEnter={enter} onPointerLeave={leave}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={accessibilityState}
        aria-checked={checked}
        disabled={disabled}
        onPress={onPress}
        style={pressStyle}
        testID={testID}
      >
        <ImportSessionCheckmark checked={checked} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flexShrink: 1 },
  control: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 32,
    gap: theme.spacing[2],
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  row: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: -theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  mark: {
    flexShrink: 0,
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  label: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  hovered: { backgroundColor: theme.colors.surfaceInteractiveHover },
  pressed: { backgroundColor: theme.colors.surfaceInteractivePressed },
  disabled: { opacity: 0.5 },
}));
