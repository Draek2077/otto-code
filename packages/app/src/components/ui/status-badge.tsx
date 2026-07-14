import { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

type StatusBadgeVariant = "success" | "warning" | "error" | "muted";

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
}

// One shared pill for every status across Artifacts, Schedules, and
// Orchestrations: same shape, same three-color scheme (green/yellow/red),
// title case applied uniformly here so callers can pass raw status strings.
export function StatusBadge({ label, variant = "muted" }: StatusBadgeProps) {
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
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  pillSuccess: {
    backgroundColor: theme.colors.palette.green[900],
    borderColor: theme.colors.palette.green[800],
  },
  pillWarning: {
    backgroundColor: theme.colors.palette.yellow[900],
    borderColor: theme.colors.palette.yellow[800],
  },
  pillError: {
    backgroundColor: theme.colors.palette.red[900],
    borderColor: theme.colors.palette.red[800],
  },
  pillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    textTransform: "capitalize",
  },
  pillTextSuccess: {
    color: theme.colors.palette.green[400],
  },
  pillTextWarning: {
    color: theme.colors.palette.yellow[400],
  },
  pillTextError: {
    color: theme.colors.palette.red[500],
  },
}));
