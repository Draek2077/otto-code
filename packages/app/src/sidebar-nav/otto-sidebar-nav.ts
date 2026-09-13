/** Otto keeps navigation rows separate from the compact Workspaces actions. */
export const OTTO_SIDEBAR_NAV_BUILTINS = [
  { id: "artifacts", visible: true },
  { id: "kanban", visible: true },
  { id: "schedules", visible: true },
  { id: "runs", visible: true },
  // The frozen Otto sidebar creates workspaces from project actions. The new
  // optional global shortcut must not replace those actions or change its grid.
  { id: "new-workspace", visible: false },
  { id: "history", visible: true },
  { id: "search", visible: true },
] as const;

export const OTTO_SIDEBAR_NAV_LABELS = {
  artifacts: { key: "sidebar.sections.artifacts", fallback: "Artifacts" },
  kanban: { key: "sidebar.sections.kanban", fallback: "Kanban" },
  runs: { key: "sidebar.sections.runs", fallback: "Workflows" },
} as const;

export type OttoSidebarNavId = keyof typeof OTTO_SIDEBAR_NAV_LABELS;
export type SidebarNavPlacement = "navigation" | "workspace-header";

export function sidebarNavFallbackLabel(id: string): string | undefined {
  return id === "artifacts" || id === "kanban" || id === "runs"
    ? OTTO_SIDEBAR_NAV_LABELS[id].fallback
    : undefined;
}

export function sidebarNavPlacement(item: { kind: string; id?: string }): SidebarNavPlacement {
  return item.kind === "builtin" && (item.id === "history" || item.id === "search")
    ? "workspace-header"
    : "navigation";
}

/** Pairs of builtin shortcuts keep Otto's two-column geometry; plugins keep full rows. */
export function groupSidebarNavigationRows<T extends { kind: string }>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (const item of items) {
    const previous = rows[rows.length - 1];
    if (item.kind === "builtin" && previous?.length === 1 && previous[0].kind === "builtin") {
      previous.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows;
}
