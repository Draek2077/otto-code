import { StyleSheet } from "react-native-unistyles";
import { compactUp } from "@/styles/theme";

export const styles = StyleSheet.create((theme) => ({
  compactFrame: { minWidth: 0, alignSelf: "stretch" },
  compactButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  compactLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  compactLabelActive: { color: theme.colors.foreground },
  mobileBrowserContent: {
    paddingHorizontal: 0,
  },
  // Geometry mirrors the composer's mode/effort chips (mode-control `chip`,
  // agent-controls `modeBadge`) - all three sit in the same toolbar row and
  // must scale together on compact breakpoints.
  trigger: {
    height: compactUp(28),
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: compactUp(theme.spacing[1]),
    paddingHorizontal: compactUp(theme.spacing[2]),
    borderRadius: theme.borderRadius.full,
  },
  // Square the chip so the collapsed model control matches the other icon-only
  // badges sharing the composer row.
  triggerIconOnly: {
    width: compactUp(28),
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface0,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  // Toolbar-chip only: cap the label so a long model name ellipsizes instead of
  // stretching the composer's control row. Fill-mode form fields want the full
  // width, so this is applied only when !triggerFill. The icon + horizontal
  // padding put the whole chip in the ~200–250px range the design targets.
  triggerTextCapped: {
    maxWidth: 200,
  },
  customTriggerWrapper: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    height: "auto",
    // The only non-fill custom trigger is the composer's icon-only badge; the
    // wrapper paints its hover/pressed state, so it must be circular to match
    // the other icon badges in the toolbar (triggerFill zeroes this back out).
    borderRadius: theme.borderRadius.full,
  },
  // Stretch the wrapper (and, via column + stretch, its single child) to the
  // full width of the field, with no background or rounding of its own.
  triggerFill: {
    alignSelf: "stretch",
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "stretch",
    backgroundColor: "transparent",
    borderRadius: 0,
  },
  sheetLoadingState: {
    minHeight: 160,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sheetLoadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
