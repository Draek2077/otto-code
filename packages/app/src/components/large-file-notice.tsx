import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

/**
 * Sits above a file preview that skipped syntax highlighting because the file
 * is too big for it (see `exceedsHighlightBudget`), so the plain-text fallback
 * reads as a deliberate choice rather than a broken highlighter. Renders
 * nothing when highlighting is on, which keeps the callers branch-free.
 */
export function LargeFileNotice({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }
  return <Text style={styles.notice}>{t("panels.file.largeFileHighlightDisabled")}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
}));
