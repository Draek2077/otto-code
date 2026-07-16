// The Changes toolbar catalog: every option lives in the ▾ menu and can be
// pinned into the toolbar strip. Mirrors the workspace tab bar's pin model
// (see @/workspace-pins) — pins are global (device-local), not per-workspace.

export type ChangesToolbarItemId =
  | "split"
  | "tree"
  | "expand"
  | "whitespace"
  | "wrap"
  | "removeComments"
  | "refresh";

// Fixed catalog order — both the ▾ menu and the pinned toolbar strip render in
// this order regardless of the order items were pinned, so the layout is stable.
// removeComments is only offered while the current diff has draft review comments.
export const CHANGES_TOOLBAR_ITEM_IDS = [
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

export function isChangesToolbarItemPinned(
  pinned: readonly ChangesToolbarItemId[],
  id: ChangesToolbarItemId,
): boolean {
  return pinned.includes(id);
}

export function toggleChangesToolbarItem(
  pinned: readonly ChangesToolbarItemId[],
  id: ChangesToolbarItemId,
): ChangesToolbarItemId[] {
  const next = pinned.filter((entry) => entry !== id);
  if (next.length === pinned.length) {
    next.push(id);
  }
  return next;
}
