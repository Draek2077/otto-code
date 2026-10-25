import { StyleSheet } from "react-native-unistyles";
export const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, minHeight: 0 },
  contentGap: { gap: theme.spacing[3] },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[8],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
