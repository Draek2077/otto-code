import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TriangleAlert, X } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";

const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedX = withUnistyles(X);

// The glyph carries the banner's own tone: a muted triangle on an amber bar
// reads as decoration rather than a warning.
const warningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarningStrong });
const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function dismissButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.dismiss, (Boolean(hovered) || pressed) && styles.dismissActive];
}

/**
 * A dismissible warning pinned above a File Editor surface: the same recipe as
 * the editor's disk-change and save-conflict banners, so every "something about
 * this file needs your attention" notice looks and closes the same way. It
 * never renders inside the document, where it would read as the file's content.
 */
export function FileEditorWarningBanner({
  message,
  dismissLabel,
  onDismiss,
  testID,
}: {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.banner} testID={testID} accessibilityRole="alert">
      <ThemedTriangleAlert size="md" uniProps={warningIconColorMapping} />
      <Text style={styles.text}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        testID={testID ? `${testID}-dismiss` : undefined}
        onPress={onDismiss}
        style={dismissButtonStyle}
      >
        <ThemedX size="sm" uniProps={foregroundMutedIconColorMapping} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // `statusWarningSurface` is alpha, so it tints whichever surface the theme
  // provides and is calibrated per scheme. See docs/design.md.
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.statusWarningMuted,
    backgroundColor: theme.colors.statusWarningSurface,
  },
  text: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  dismiss: {
    padding: theme.spacing[1],
    borderRadius: 6,
  },
  dismissActive: {
    backgroundColor: theme.colors.surfaceHover,
  },
}));
