// The project Search toolbar catalog: every option lives in the ▾ menu and can
// be pinned into the toolbar strip, the same model the Changes toolbar uses
// (see @/git/changes-toolbar/items). The strip itself is
// @/components/ui/pinnable-toolbar; this file is only Search's own option set.

export type ProjectSearchToolbarItemId = "wrap" | "expand" | "refresh";

// Fixed catalog order - both the ▾ menu and the pinned toolbar strip render in
// this order regardless of the order items were pinned, so the layout is stable.
export const PROJECT_SEARCH_TOOLBAR_ITEM_IDS = ["wrap", "expand", "refresh"] as const;

// The two reading controls start pinned; refresh lives in the menu until
// pinned, because the query row's own search button already re-runs the search.
export const DEFAULT_PINNED_PROJECT_SEARCH_TOOLBAR_ITEMS: ProjectSearchToolbarItemId[] = [
  "wrap",
  "expand",
];
