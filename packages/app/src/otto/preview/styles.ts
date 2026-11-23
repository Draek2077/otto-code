import { StyleSheet } from "react-native-unistyles";
export const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, minHeight: 0 },
  content: {
    width: "100%",
    maxWidth: 1280,
    alignSelf: "center",
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[4],
  },
  desktop: { flex: 1, minHeight: 0 },
  split: { flex: 1, minHeight: 0, flexDirection: "row", gap: theme.spacing[4] },
  sidebar: { width: 360, maxWidth: "45%", minHeight: 0 },
  detail: { flex: 1, minWidth: 0, minHeight: 0 },
  stack: { gap: theme.spacing[4], paddingBottom: theme.spacing[4] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  caption: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  code: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.terminal.background,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
}));
