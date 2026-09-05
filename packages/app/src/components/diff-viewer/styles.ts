import { StyleSheet } from "react-native-unistyles";

export const styles = StyleSheet.create((theme) => {
  return {
    verticalScroll: {},
    fillHeight: {
      flex: 1,
      minHeight: 0,
    },
    verticalContent: {
      flexGrow: 1,
    },
    horizontalContent: {
      flexDirection: "column" as const,
    },
    linesContainer: {
      alignSelf: "flex-start",
    },
    linesContainerWrap: {
      alignSelf: "stretch",
    },
    emptyState: {
      padding: theme.spacing[4],
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emptyText: {
      fontSize: theme.fontSize.base,
      color: theme.colors.foregroundMuted,
    },
    diffSurface: {
      borderTopColor: theme.colors.border,
      borderTopWidth: theme.borderWidth[1],
      borderBottomColor: theme.colors.border,
      borderBottomWidth: theme.borderWidth[1],
      backgroundColor: theme.colors.surface1,
    },
    diffSurfaceTopOnly: {
      borderBottomWidth: 0,
    },
    diffSurfaceBottomOnly: {
      borderTopWidth: 0,
    },
    diffSurfaceFrameless: {
      borderTopWidth: 0,
      borderBottomWidth: 0,
    },
  };
});
