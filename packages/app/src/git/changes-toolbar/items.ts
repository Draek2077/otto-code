// The Changes toolbar catalog: every option lives in the ▾ menu and can be
// pinned into the toolbar strip. The strip itself is @/components/ui/pinnable-toolbar,
// shared with the project Search pane; this file is only Changes' own option set.

export type ChangesToolbarItemId =
  | "presentation"
  | "split"
  | "tree"
  | "expand"
  | "whitespace"
  | "wrap"
  | "removeComments"
  | "refresh";

// Fixed catalog order - both the ▾ menu and the pinned toolbar strip render in
// this order regardless of the order items were pinned, so the layout is stable.
// removeComments (UI label "Delete all review comments") is only offered while the
// branch holds draft review comments.
export const CHANGES_TOOLBAR_ITEM_IDS = [
  "presentation",
  "split",
  "tree",
  "expand",
  "whitespace",
  "wrap",
  "removeComments",
  "refresh",
] as const;

// Split (side-by-side), tree (folder view), and expand (expand/collapse all)
// start pinned; whitespace, wrap, and refresh live in the menu until pinned.
export const DEFAULT_PINNED_CHANGES_TOOLBAR_ITEMS: ChangesToolbarItemId[] = [
  "split",
  "tree",
  "expand",
];
