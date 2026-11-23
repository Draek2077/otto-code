import { createBrainStyles } from "../theme";
import {
  COLUMN,
  COLUMN_GAP,
  DELTA_LINE_HEIGHT,
  RUN_COLUMN,
  SINGLE_LINE_TRUNCATE,
} from "./geometry";
export const useStyles = createBrainStyles((theme) => ({
  container: {
    flex: 1,
    gap: theme.spacing[3],
    minHeight: 0,
  },
  centered: {
    paddingVertical: theme.spacing[12],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  empty: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  listPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[2],
    minHeight: 0,
    padding: theme.spacing[4],
  },
  runsPane: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  detailPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    position: "relative",
  },
  compactStack: {
    gap: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingTop: theme.spacing[1],
  },
  // Two cards, equal width, so the same section of each lands at the same height
  // and a difference between them is a horizontal glance.
  compareRow: {
    flexDirection: "row",
    // Stretch the cards as a pair. A shorter result must not end early just
    // because its counterpart has a wrapped task summary: the empty tail is a
    // useful visual signal that this run had less detail, not a broken grid.
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  compareStack: {
    gap: theme.spacing[3],
  },
  table: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2: see the same fix in models-tab.tsx's `table` -
    // surface2 and the border token are nearly identical on this theme.
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    position: "relative",
  },
  tableFill: {
    flex: 1,
    minHeight: 0,
  },
  // Two tables share the left pane now, so each gets a lower ceiling than the
  // Models table's 420: at 420 apiece the run list starts below the fold on a
  // laptop, and the run list is half the point of the layout.
  tableScroll: {
    flex: 1,
    minHeight: 0,
  },
  tableScrollRegion: {
    minHeight: 0,
    position: "relative",
  },
  tableScrollRegionCapped: {
    maxHeight: 280,
  },
  tableScrollRegionFill: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: COLUMN_GAP,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: COLUMN_GAP,
    paddingHorizontal: theme.spacing[4],
    // The medal makes the row taller than a text-only one; matching that height
    // in the padding keeps the ink centred instead of top-heavy.
    paddingVertical: theme.spacing[2],
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  // Every header carries the no-wrap treatment, not just the ones that have
  // wrapped so far: a label that breaks across two lines ("Run/s") doubles the
  // header's height and knocks the whole table's rhythm out. If one ever needs
  // more room than this, widen the column in COLUMN above.
  headerRank: {
    ...COLUMN.rank,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerName: {
    ...COLUMN.name,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerScore: {
    ...COLUMN.score,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerRuns: {
    ...COLUMN.runs,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerGrade: {
    ...COLUMN.grade,
    ...SINGLE_LINE_TRUNCATE,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  cellRank: {
    ...COLUMN.rank,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  cellName: {
    ...COLUMN.name,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  cellScore: {
    ...COLUMN.score,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  cellRuns: {
    ...COLUMN.runs,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  cellGrade: {
    ...COLUMN.grade,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1.5],
  },
  cellGradeEmpty: {
    ...COLUMN.grade,
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  gradeLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  gradeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 1,
  },
  runHeaderModel: {
    ...RUN_COLUMN.model,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderConfig: {
    ...RUN_COLUMN.config,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderRan: {
    ...RUN_COLUMN.ran,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderScore: {
    ...RUN_COLUMN.score,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderCount: {
    ...RUN_COLUMN.count,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderSpread: {
    ...RUN_COLUMN.spread,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runCellModel: {
    ...RUN_COLUMN.model,
    // Same hyphen-clamp trap as `cellName`: this cell carries model ids too.
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  runCellConfig: {
    ...RUN_COLUMN.config,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  runCellConfigText: {
    // The config string is the one cell with no fixed width, so it is the one
    // that gives way: `flexShrink` lets the badge beside it keep its size and
    // the ellipsis land where the text actually runs out of room.
    flexShrink: 1,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  runCellLatest: {
    flexShrink: 0,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  runCellRan: {
    ...RUN_COLUMN.ran,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runCellScore: {
    ...RUN_COLUMN.score,
    ...SINGLE_LINE_TRUNCATE,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  runCellAction: {
    ...RUN_COLUMN.score,
    alignItems: "flex-end",
  },
  runCellCount: {
    ...RUN_COLUMN.count,
    ...SINGLE_LINE_TRUNCATE,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  runCellSpread: {
    ...RUN_COLUMN.spread,
    ...SINGLE_LINE_TRUNCATE,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  detail: {
    gap: theme.spacing[3],
  },
  detailScroll: {
    flex: 1,
    minHeight: 0,
  },
  detailContent: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  detailTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  // `flexWrap` plus the delta's `flexGrow` below is what keeps the pair honest
  // at any width: side by side while both fit, and the delta on its own line -
  // still right-aligned, because it grows to fill that line - when they do not.
  detailSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexWrap: "wrap",
    minHeight: DELTA_LINE_HEIGHT,
  },
  detailSummary: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  detailEmpty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  runCard: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  // The same card, sharing a row. `flexBasis: 0` rather than an intrinsic width:
  // the two runs' content differs (one may have an extra setup warning, a longer
  // argv), and without it the wordier card would claim more of the row and break
  // the alignment that makes the comparison readable.
  runCardCompared: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  runLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  // A fixed one-line box, always present. `minHeight` rather than letting the
  // text size it: an empty View collapses to zero, and the cards below would
  // jump by a line every time a comparison is opened or dropped.
  deltaUp: {
    flexGrow: 1,
    fontSize: theme.fontSize.xs,
    lineHeight: DELTA_LINE_HEIGHT,
    textAlign: "right",
    color: theme.colors.statusSuccess,
  },
  deltaDown: {
    flexGrow: 1,
    fontSize: theme.fontSize.xs,
    lineHeight: DELTA_LINE_HEIGHT,
    textAlign: "right",
    color: theme.colors.statusWarning,
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  runScore: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  runDate: {
    flexGrow: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "right",
  },
  runConfig: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  runMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  issues: {
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  issueWarn: {
    fontSize: theme.fontSize.xs,
    // The semantic token, not a raw amber: it is calibrated per scheme, and
    // these lines have to stay legible on both surfaces.
    color: theme.colors.statusWarning,
  },
  issueInfo: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runArgs: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  taskTable: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  taskHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  // Compared rows reserve room for the task name and two summary lines. The
  // summaries themselves still wrap naturally, but no longer move every task
  // that follows out of horizontal alignment with the other run.
  taskRowCompared: {
    minHeight: theme.spacing[16],
  },
  taskHeaderName: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskHeaderWeight: {
    width: 48,
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskHeaderScore: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskHeaderSeconds: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskName: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[1],
  },
  taskCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  taskSummary: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskError: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.red[300],
  },
  taskWeight: {
    width: 48,
    flexShrink: 0,
    textAlign: "right",
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  taskScore: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  taskScoreExcellent: {
    color: theme.colors.statusSuccess,
  },
  taskScoreWarning: {
    color: theme.colors.statusWarning,
  },
  taskScoreCritical: {
    color: theme.colors.statusDanger,
  },
  taskSeconds: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  taskSecondsWarning: {
    color: theme.colors.statusWarning,
  },
  taskSecondsExcellent: {
    color: theme.colors.statusSuccess,
  },
  taskSecondsCritical: {
    color: theme.colors.statusDanger,
  },
}));
