import { useMemo, type ReactElement } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

/**
 * The shared on-screen shortcut treatment, based on the workspace-row badge.
 * Keep discovery hints visually distinct from tooltip shortcut keycaps.
 */
export function ShortcutDiscoveryBadge({
  keys,
  label,
  style,
}: {
  keys?: ShortcutKey[];
  label?: string;
  style?: StyleProp<ViewStyle>;
}): ReactElement | null {
  const text = useMemo(
    () => label ?? (keys && keys.length > 0 ? formatShortcut(keys, getShortcutOs()) : null),
    [keys, label],
  );

  if (!text) return null;

  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
}));
