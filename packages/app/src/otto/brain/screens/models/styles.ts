import { createBrainStyles } from "../theme";
import { COLUMN } from "./geometry";
export const useStyles = createBrainStyles((theme) => ({
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
  listPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[2],
    minHeight: 0,
    padding: theme.spacing[4],
  },
  detailPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
  },
  compactDetail: {
    flex: 1,
    gap: theme.spacing[2],
    minHeight: 0,
  },
  table: {
    flex: 1,
    minHeight: 0,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2: on this theme the border token sits right next
    // to surface2, so a surface2 fill swallows the border and the table reads
    // as a borderless slab. surface1 gives the border something to contrast
    // against.
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    position: "relative",
  },
  tableScroll: {
    flex: 1,
    minHeight: 0,
  },
  tableScrollRegion: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    // Same fixed gap as `row` below - a column's header and its cells must
    // share one gap value, or the two rulers drift apart column by column.
    gap: 10,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
  },
  headerName: {
    ...COLUMN.name,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerScore: {
    ...COLUMN.score,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerQuant: {
    ...COLUMN.quant,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerSize: {
    ...COLUMN.size,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerTags: {
    ...COLUMN.tags,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  capsColumnCompact: {
    width: COLUMN.tags.width * 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  cellName: {
    ...COLUMN.name,
    gap: theme.spacing[1],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  nameText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  // A running calibrate/sweep/benchmark job for this row, right under its
  // name - the same live message the detail pane shows, so the table alone
  // tells the whole story without opening the row. It carries no spinner of
  // its own; the row's state marker is the single indicator.
  rowJobStatusText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  cellScore: {
    ...COLUMN.score,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  scoreGood: {
    color: theme.colors.terminal.brightGreen,
  },
  scoreFair: {
    color: theme.colors.terminal.brightYellow,
  },
  scorePoor: {
    color: theme.colors.terminal.yellow,
  },
  scoreBad: {
    color: theme.colors.terminal.red,
  },
  cellQuant: {
    ...COLUMN.quant,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  cellSize: {
    ...COLUMN.size,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  cellTags: COLUMN.tags,
  capsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  disk: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    paddingVertical: theme.spacing[1],
  },
  detail: {
    flex: 1,
  },
  detailContent: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  detailTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  detailTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  nameActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  metadata: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  actionsColumn: {
    gap: theme.spacing[2],
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  jobStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  jobStatusText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  jobStatusRunning: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  jobStatusFailed: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.palette.red[300],
    fontWeight: theme.fontWeight.medium,
  },
  jobStatusDetail: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  compactList: {
    flex: 1,
    gap: theme.spacing[2],
    minHeight: 0,
  },
  alertInset: {
    padding: theme.spacing[4],
  },
}));
