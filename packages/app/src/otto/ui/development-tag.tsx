import { Text, View } from "react-native";
import { GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
const label = process.env.EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL?.trim();
const Branch = withUnistyles(GitBranch, (theme) => ({ color: theme.colors.accentForeground }));
export function DevelopmentTag() {
  if (!label) return null;
  return (
    <View
      pointerEvents="none"
      style={styles.tag}
      testID="dev-build-label"
      accessibilityLabel={`Development build: ${label}`}
    >
      <Branch size={12} />
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  tag: {
    minWidth: 0,
    maxWidth: 220,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  text: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
  },
}));
