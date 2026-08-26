import { StyleSheet } from "react-native-unistyles";

/**
 * What a find hit looks like in Otto's read-only views.
 *
 * One definition, because there is one search. The code preview and the
 * rendered-document preview run the same query with the same semantics, and a
 * reader switching between them - or between either of them and the editor -
 * should not have to learn a second visual language for "this is a hit".
 *
 * The tones are the editor's `searchMatchBackground` /
 * `activeSearchMatchBackground` (see `editor/editor-theme.ts`), and the reason
 * they are amber rather than another neutral wash is recorded there: matches
 * used to reuse `terminal.selectionBackground`, the *same* value as the text
 * selection, which left a hit indistinguishable from selected text.
 */
export const findHighlightStyles = StyleSheet.create((theme) => ({
  match: {
    backgroundColor: theme.colors.statusWarningSurface,
  },
  active: {
    backgroundColor: theme.colors.statusWarningSurfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.statusWarningStrong,
    borderRadius: theme.borderRadius.sm,
  },
}));
