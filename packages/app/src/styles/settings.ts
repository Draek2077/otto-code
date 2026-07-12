import { StyleSheet } from "react-native-unistyles";

export const settingsStyles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[6],
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    fontWeight: theme.fontWeight.normal,
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    fontWeight: theme.fontWeight.normal,
  },
  sectionHeaderLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  sectionHeaderLinkText: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  // Responsive variant of `row`: only on the narrowest (`xs`, below the `sm`
  // 576px breakpoint) does the control stack below the label so wide controls
  // (segmented controls, text inputs, sliders, buttons, button bars) never
  // squeeze the label into a vertical sliver. When stacked, the control is
  // centered in the panel (the label block, `rowContent`, overrides back to full
  // width). At `sm` and up it is identical to `row`. Use for rows whose trailing
  // control is wide; narrow always-inline controls (switches) keep plain `row`.
  rowResponsive: {
    flexDirection: { xs: "column", sm: "row" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: { xs: theme.spacing[3], sm: 0 },
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  // A trailing group of controls (buttons, status pills, value labels) inside a
  // `rowResponsive`. When the row stacks on the narrowest widths the group fills
  // the row and centers its contents (wrapping as needed); at `sm`+ it hugs the
  // right edge inline. Compose after a local group style that sets
  // `flexDirection: "row"` and the group's `gap`.
  rowControlGroup: {
    flexWrap: "wrap",
    alignItems: "center",
    width: { xs: "100%", sm: "auto" },
    justifyContent: { xs: "center", sm: "flex-end" },
  },
  rowContent: {
    // `flexBasis: "auto"` (not `flex: 1`'s implicit basis of 0) is load-bearing:
    // a 0 basis collapses this block's HEIGHT to zero when `rowResponsive` stacks
    // it in a column, which makes the control below overlap the label text. With
    // an auto basis it sizes to content vertically; in a row it still fills the
    // available width (it's the only growing child), so inline layout is unchanged.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    marginRight: theme.spacing[3],
    // In a stacked `rowResponsive` the row centers its children; the label block
    // must stay full-width (left-aligned text), so it opts out of centering.
    alignSelf: { xs: "stretch", sm: "auto" },
  },
  rowTitle: {
    color: theme.colors.foreground,
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: {
      xs: theme.fontSize.base + 2,
      md: theme.fontSize.base,
    },
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    marginTop: theme.spacing[1],
  },
  rowError: {
    color: theme.colors.statusDanger,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    marginTop: theme.spacing[1],
  },
}));
