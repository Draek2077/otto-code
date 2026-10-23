import { createBrainStyles } from "../theme";
import { createControlGeometry } from "@/components/ui/control-geometry";
export const useStyles = createBrainStyles((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    container: {
      gap: theme.spacing[3],
    },
    loading: {
      paddingVertical: theme.spacing[6],
      alignItems: "center",
    },
    grid: {
      gap: theme.spacing[2],
    },
    gridCompact: {
      gap: theme.spacing[3],
    },
    fieldRow: {
      flexDirection: "row",
      // Centered, not top-aligned: every label is one line against a one-line
      // control, so aligning to the top reads as the label sitting high.
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[3],
      paddingVertical: theme.spacing[1],
    },
    fieldLabelColumn: {
      flexShrink: 1,
    },
    fieldLabel: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    fieldUnavailable: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.foregroundMuted,
    },
    tooltipText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.foreground,
      lineHeight: Math.round(theme.fontSize.xs * 1.4),
    },
    fieldControl: {
      alignItems: "flex-end",
      gap: theme.spacing[1],
      flexShrink: 1,
    },
    controlLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    // One framed control, not three loose pieces: the minus, the value and the
    // plus share a single border and background, matching the stepper the
    // Settings panel uses. Divider borders separate the buttons from the value.
    stepper: {
      flexDirection: "row",
      alignItems: "stretch",
      minHeight: geometry.fieldControlSm.minHeight,
      borderRadius: geometry.fieldControlSm.borderRadius,
      backgroundColor: theme.colors.surface2,
      overflow: "hidden",
      ...geometry.controlRest,
    },
    stepperButton: {
      width: geometry.fieldControlSm.minHeight,
      alignItems: "center",
      justifyContent: "center",
    },
    stepperButtonLeft: {
      borderRightWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
    },
    stepperButtonRight: {
      borderLeftWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
    },
    stepperButtonActive: {
      backgroundColor: theme.colors.surfaceHover,
    },
    stepperButtonDisabled: {
      opacity: theme.opacity[50],
    },
    stepperValue: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: geometry.fieldControlSm.minHeight,
      color: theme.colors.foreground,
      minWidth: 72,
      textAlign: "center",
      paddingHorizontal: theme.spacing[2],
    },
    controlDisabled: {
      opacity: 0.5,
    },
    hintText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.foregroundMuted,
      textAlign: "right",
    },
    warnText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.palette.yellow[400],
      textAlign: "right",
    },
    // The Cached KVs estimate turns red when the parked state would use at
    // least the whole installed RAM. Matches the budget panel's "over" verdict.
    errorText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.palette.red[500],
      textAlign: "right",
    },
    budget: {
      gap: theme.spacing[2],
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      // surface1, not surface3: every other card on this page is a dark
      // surface1 fill with a visible border - surface3 stood out as a
      // conspicuously lighter box instead of matching the set.
      backgroundColor: theme.colors.surface1,
    },
    meterTrack: {
      height: theme.spacing[2],
      borderRadius: theme.borderRadius.full,
      // surface3, not surface2: needs to read as a track recessed into the
      // card now that the card itself is surface1.
      backgroundColor: theme.colors.surface3,
      overflow: "hidden",
    },
    // The track clips both ends (overflow hidden + full radius), so the fill
    // segments stay square at their seam - a rounded fill here would pinch a gap
    // where the on-GPU and spill segments meet.
    meterFill: {
      height: "100%",
      backgroundColor: theme.colors.accentBright,
    },
    // The purple tail is the estimate above the GPU admission budget.
    meterFillSpill: {
      backgroundColor: theme.colors.palette.purple[500],
    },
    budgetVerdictGood: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.palette.green[400],
    },
    budgetVerdictBad: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.palette.red[500],
    },
    budgetVerdictNeutral: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    budgetBreakdown: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
    },
    budgetSource: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.foregroundMuted,
    },
    savingHint: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.foregroundMuted,
      textAlign: "right",
    },
    profileLibrary: {
      gap: theme.spacing[3],
    },
    profileEditor: {
      gap: theme.spacing[4],
    },
    profileIntro: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      lineHeight: Math.round(theme.fontSize.sm * 1.4),
    },
    profileSectionLabel: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.medium,
      textTransform: "uppercase",
    },
    profileChoice: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      minHeight: 64,
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      borderWidth: 1,
      borderColor: theme.colors.surface2,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface0,
    },
    profileChoiceSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface2,
    },
    profileChoiceDisabled: {
      opacity: theme.opacity[50],
    },
    profileChoiceCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[1],
    },
    profileChoiceTitle: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
    },
    profileChoiceHint: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
    },
    profileChoiceStatus: {
      color: theme.colors.accent,
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.medium,
    },
    profileChoiceActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      flexWrap: "wrap",
      justifyContent: "flex-end",
    },
    profileEmpty: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      paddingVertical: theme.spacing[2],
    },
    profileFooter: {
      flex: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    profileTextArea: {
      minHeight: 120,
      textAlignVertical: "top",
      fontFamily: theme.fontFamily.mono,
    },
  };
});
