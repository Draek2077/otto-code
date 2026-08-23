import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { IsolatedBottomSheetModal } from "@/components/ui/isolated-bottom-sheet-modal";

/**
 * The frame every bottom sheet arrives in: the surface it is drawn on, the corners it turns at
 * the top, the grab handle, the indent its content sits at, and the size of its title.
 *
 * It lives in one place because it had drifted into five versions of one idea - three top radii,
 * two backgrounds, one sheet rounding its bottom corners against the screen edge where nobody can
 * see them, three content indents, and three title sizes. The grab handle was the worst of it:
 * left to the library, the indicator is **7.5% of the window width**, so the same sheet grew a
 * handle three times wider on a desktop window than on a phone, and no two sheets agreed unless
 * they happened to be open at the same width.
 *
 * A sheet still owns what goes *inside* it. This is the frame.
 */

/**
 * Pinned rather than proportional. A grab handle is a fixed affordance - it says "drag here" -
 * and nothing about that claim gets truer on a wider screen.
 */
export const SHEET_HANDLE_INDICATOR_WIDTH = 36;
export const SHEET_HANDLE_INDICATOR_HEIGHT = 4;

/**
 * Indent for a sheet's header, body, and footer, so the title, the fields under it, and the
 * actions at the bottom all sit on one vertical line. Deliberately tight: a sheet is already a
 * small framed surface, and the page-level indent reads as wasted width here.
 */
export const SHEET_HORIZONTAL_PADDING_SCALE = 3;

/**
 * The sheet, wearing the shared frame.
 *
 * `backgroundStyle` and `handleIndicatorStyle` are style-shaped props the Unistyles Babel plugin
 * does not track, so the frame rides in through `withUnistyles` rather than a stylesheet the
 * caller passes - see docs/unistyles.md. Only the top corners are rounded: the bottom two sit
 * past the screen edge, so rounding them buys nothing and costs the illusion that the sheet is
 * anchored to that edge.
 */
export const SheetSurfaceModal = withUnistyles(IsolatedBottomSheetModal, (theme) => ({
  backgroundStyle: {
    backgroundColor: theme.colors.surface0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
  },
  handleIndicatorStyle: {
    width: SHEET_HANDLE_INDICATOR_WIDTH,
    height: SHEET_HANDLE_INDICATOR_HEIGHT,
    // A fixed palette step rather than a surface token: the handle has to read against every
    // sheet surface in every theme, and the surface ladder's own greys sit too close to it.
    backgroundColor: theme.colors.palette.zinc[600],
  },
}));

export const sheetChromeStyles = StyleSheet.create((theme) => ({
  /**
   * One title, everywhere. Sheets had grown three sizes and two weights of this between them,
   * which is what makes a set of surfaces read as unrelated even when their frames match.
   *
   * The size splits on the same breakpoint every other sheet decision does: a phone gets the
   * tighter heading, because a sheet there already has the whole screen's attention and does not
   * need a bigger voice to claim it; a desktop dialog is a framed box on a busy screen and does.
   */
  title: {
    fontSize: {
      xs: theme.fontSize.base,
      md: theme.fontSize.lg,
    },
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
