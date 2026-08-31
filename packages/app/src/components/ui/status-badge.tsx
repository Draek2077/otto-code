import React, { useMemo, type ReactNode } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type StatusBadgeVariant = "success" | "warning" | "error" | "muted";

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  leading?: ReactNode;
}

// One shared pill for every status across Artifacts, Schedules, and
// Orchestrations: same shape, same three-color scheme (green/yellow/red),
// title case applied uniformly here so callers can pass raw status strings.
export function StatusBadge({ label, variant = "muted", leading }: StatusBadgeProps) {
  const pillStyle = useMemo(
    () => [
      styles.pill,
      variant === "success" && styles.pillSuccess,
      variant === "warning" && styles.pillWarning,
      variant === "error" && styles.pillError,
    ],
    [variant],
  );
  const textStyle = useMemo(
    () => [
      styles.pillText,
      variant === "success" && styles.pillTextSuccess,
      variant === "warning" && styles.pillTextWarning,
      variant === "error" && styles.pillTextError,
    ],
    [variant],
  );

  return (
    <View style={pillStyle}>
      {leading}
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  // Pass calibrated theme surface tokens straight through. Unistyles cannot
  // resolve colors computed from a theme value inside StyleSheet.create.
  pillSuccess: {
    backgroundColor: theme.colors.statusSuccessSurface,
    borderColor: theme.colors.statusSuccess,
  },
  pillWarning: {
    backgroundColor: theme.colors.statusWarningSurface,
    borderColor: theme.colors.statusWarning,
  },
  pillError: {
    backgroundColor: theme.colors.statusDangerSurface,
    borderColor: theme.colors.statusDanger,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    textTransform: "capitalize",
  },
  pillTextSuccess: {
    color: theme.colors.statusSuccess,
  },
  pillTextWarning: {
    color: theme.colors.statusWarning,
  },
  pillTextError: {
    color: theme.colors.statusDanger,
  },
}));
