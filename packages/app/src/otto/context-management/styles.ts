import { StyleSheet } from "react-native-unistyles";
export const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, minHeight: 0 },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[4],
    width: "100%",
    maxWidth: 1280,
    alignSelf: "center",
  },
  split: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[4] },
  compact: { gap: theme.spacing[4] },
  tree: { flexBasis: 360, flexGrow: 1, flexShrink: 1, minWidth: 0, gap: theme.spacing[3] },
  detail: { flexGrow: 2, flexShrink: 1, flexBasis: 420, minWidth: 0, gap: theme.spacing[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  caption: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  code: {
    backgroundColor: theme.colors.terminal.background,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
  },
}));
