import { StyleSheet } from "react-native-unistyles";
export const speechStyles = StyleSheet.create((theme) => ({
  feedback: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    maxWidth: 360,
    gap: theme.spacing[2],
  },
  tooltip: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
