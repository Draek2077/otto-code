import { StyleSheet } from "react-native-unistyles";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";

// App and host browsers share chrome geometry and theme typography.
export const browserToolbarStyles = StyleSheet.create((theme) => ({
  chromeRow: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chromeLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  chromeRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  forwardArrow: { transform: [{ rotate: "180deg" }] },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceSizeButton: {
    width: 40,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  iconButtonDisabled: {
    opacity: 0.45,
  },
  urlBarWrap: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  urlInput: {
    outlineWidth: 0,
    color: theme.colors.foreground,
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  deviceTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
