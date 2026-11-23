import { createBrainStyles } from "../theme";
export const useStyles = createBrainStyles((theme) => ({
  container: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  centered: {
    paddingVertical: theme.spacing[12],
    alignItems: "center",
    justifyContent: "center",
  },
  topSections: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[4],
  },
  topSectionsStacked: {
    gap: theme.spacing[4],
  },
  topSection: {
    minWidth: 0,
  },
  topSectionWide: {
    flex: 1,
  },
  fillHeight: {
    flex: 1,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2 - see the note on `tile` below: surface2 and
    // border are nearly identical on this theme, so a surface2 fill swallows
    // the border and the card reads as borderless.
    backgroundColor: theme.colors.surface1,
    flexWrap: "wrap",
  },
  heroText: {
    flexShrink: 1,
    gap: theme.spacing[1],
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  heroTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  heroSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  remoteNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionsStacked: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  iconButton: {
    width: 40,
    paddingHorizontal: 0,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  lifecycle: {
    gap: theme.spacing[2],
  },
  modelOverrideTrigger: {
    minWidth: 200,
  },
  panel: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  // Same card, no padding: for a settings row (`settingsStyles.rowResponsive`)
  // that already carries its own `spacing[4]` inset. Nesting one inside `panel`
  // pads it twice.
  panelFlush: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  panelTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  panelCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  panelCaptionMuted: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  activityList: {
    gap: theme.spacing[2],
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  activitySlot: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  activityPhase: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexGrow: 1,
  },
  activityRate: {
    color: theme.colors.accentBright,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  activityTokens: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  meterTrack: {
    height: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accentBright,
  },
  meterFillDanger: {
    backgroundColor: theme.colors.palette.red[500],
  },
  tileGrid: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  tileGridCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 96,
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2: the border token sits right next to surface2 on
    // this theme (#33333a vs #323238), so a surface2 fill swallows the border
    // and the tile reads as a borderless blob. surface1 gives the border
    // something to contrast against, same as the Metrics page's tiles.
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Saturation warning: the whole tile turns amber (icon, value, label, hint),
  // not just a caption, so a full slot pool reads as a warning at a glance.
  tileWarning: {
    borderColor: theme.colors.statusWarning,
  },
  tileValueWarning: {
    color: theme.colors.statusWarningMuted,
  },
  tileTextWarning: {
    color: theme.colors.statusWarningMuted,
  },
  tileLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  tileValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  tileHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  // Traffic | Host, side by side like the Metrics page's two-column layout -
  // each gets a titled tile grid instead of one wide list panel.
  detailColumns: {
    flexDirection: "row",
    gap: theme.spacing[4],
  },
  detailColumnsStacked: {
    flexDirection: "column",
    gap: theme.spacing[4],
  },
  detailColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
}));
