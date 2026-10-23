import { createBrainStyles } from "../theme";
import { useMemo } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIsExtraCompactFormFactor } from "../ui/layout";
const useBaseStyles = createBrainStyles((theme) => ({
  section: {
    paddingVertical: theme.spacing[3],
  },
  subheading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: theme.spacing[1],
    // Align the subheading text with the row content below it, which sits at
    // `spacing[4]` of horizontal padding (rowResponsive). Without this the
    // heading hangs off the card's left edge while the rows are indented.
    paddingHorizontal: theme.spacing[4],
  },
  installedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  searchInput: {
    flex: 1,
    // The compact font scale needs enough vertical room for Android's input
    // metrics; a desktop-height field clips its placeholder at the top.
    height: 36,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlignVertical: "center",
  },
  searchLoading: {
    paddingVertical: theme.spacing[3],
    alignItems: "center",
  },
  catalogLoading: {
    paddingVertical: theme.spacing[3],
    alignItems: "center",
  },
  // Shared by the catalog row's "Installed" badge + QuantPicker pairing and
  // the search row's "Installed" badge + QuantPicker pairing.
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quantPicker: {
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  quantPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quantPickerTrigger: {
    minWidth: 160,
  },
  installedTagText: {
    color: theme.colors.palette.green[400],
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  // Catalog and search rows: same shape as `settingsStyles.rowResponsive` but
  // with a tighter vertical rhythm - these lists are read a row at a time,
  // scanning for a name, not a settings form.
  tightRow: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  modelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  modelTitle: {
    flex: 1,
    minWidth: 0,
  },
  catalogModelName: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  modelDetails: {
    gap: theme.spacing[1],
  },
  // A trailing button with its own progress bar directly beneath it, once a
  // job is running for that specific row - never a separate panel elsewhere
  // on the page.
  rowTrailing: {
    alignItems: "center",
    gap: theme.spacing[1],
  },
  runtimeBuildInput: {
    flex: 1,
    minWidth: 156,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
  },
  managerSection: {
    gap: theme.spacing[2],
  },
  managerLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  managerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  jobError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  specificBuildRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  stackedControls: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  rowResponsive: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 0,
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  stackedRow: {
    flexDirection: "column",
    gap: theme.spacing[3],
  },
  rowContent: {
    // Auto basis preserves the text block's height when its row becomes a column.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    marginRight: theme.spacing[3],
    alignSelf: "auto",
  },
  stackedRowContent: {
    alignSelf: "stretch",
  },
  inlineProgress: {
    width: 96,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  progressIndeterminate: {
    width: "40%",
  },
}));

export function useStyles() {
  const styles = useBaseStyles();
  const compact = useIsCompactFormFactor();
  const extraCompact = useIsExtraCompactFormFactor();
  return useMemo(
    () => ({
      ...styles,
      searchInput: { ...styles.searchInput, height: compact ? 48 : 36 },
      modelHeader: extraCompact
        ? { ...styles.modelHeader, ...styles.stackedControls }
        : styles.modelHeader,
      specificBuildRow: extraCompact
        ? { ...styles.specificBuildRow, ...styles.stackedControls }
        : styles.specificBuildRow,
      rowResponsive: extraCompact
        ? { ...styles.rowResponsive, ...styles.stackedRow }
        : styles.rowResponsive,
      rowContent: extraCompact
        ? { ...styles.rowContent, ...styles.stackedRowContent }
        : styles.rowContent,
    }),
    [styles, compact, extraCompact],
  );
}
