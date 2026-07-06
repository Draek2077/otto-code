import { useMemo } from "react";
import { View, Text, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { compactUp } from "@/styles/theme";

interface DiffStatProps {
  additions: number;
  deletions: number;
  style?: StyleProp<ViewStyle>;
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatDiffCount(value: number): string {
  return compactFormatter.format(value).toLowerCase();
}

export function DiffStat({ additions, deletions, style }: DiffStatProps) {
  const rowStyle = useMemo(() => (style ? [styles.row, style] : styles.row), [style]);
  return (
    <View style={rowStyle}>
      <Text style={styles.additions}>+{formatDiffCount(additions)}</Text>
      <Text style={styles.deletions}>-{formatDiffCount(deletions)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: compactUp(20),
    gap: compactUp(4),
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
}));
