import type { SidebarNavItem } from "@/sidebar-nav/model";

// The frozen Otto sidebar's minimum width for two complete compact shortcuts.
export const SIDEBAR_TWO_COLUMN_MIN_WIDTH = 272;
const workspaceActions = new Set(["new-workspace", "history", "search"]);

export function isWorkspaceHeaderAction(item: SidebarNavItem<"header">): boolean {
  return item.kind === "builtin" && workspaceActions.has(item.id);
}

export function workspaceHeaderActions(items: readonly SidebarNavItem<"header">[]) {
  const visible = items.filter((item) => item.visible && isWorkspaceHeaderAction(item));
  // Creation stays immediately before Display preferences; the other actions retain their order.
  return [
    ...visible.filter((item) => item.key !== "new-workspace"),
    ...visible.filter((item) => item.key === "new-workspace"),
  ];
}

export function sidebarShortcutColumns(width: number): 1 | 2 {
  return Number.isFinite(width) && width >= SIDEBAR_TWO_COLUMN_MIN_WIDTH ? 2 : 1;
}
