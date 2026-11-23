import { StyleSheet } from "react-native-unistyles";

export const styles = StyleSheet.create((theme) => ({
  page: { flex: 1 },
  section: { minWidth: 0 },
  value: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  selectableValue: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  notices: { gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  input: { minWidth: 160, flexShrink: 1, maxWidth: "100%" },
  secret: { gap: theme.spacing[2], minWidth: 160, flexShrink: 1, maxWidth: "100%" },
}));
