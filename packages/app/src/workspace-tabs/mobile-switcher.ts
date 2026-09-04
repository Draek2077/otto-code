import type { WorkspaceTabTarget } from "./model";

// Compact workspace navigation has one main view and a dedicated Explorer.
// These targets belong exclusively to the Explorer on phones, even where a
// desktop layout can place one in a main pane.
const COMPACT_EXPLORER_TARGET_KINDS = new Set<WorkspaceTabTarget["kind"]>([
  "changes_tree",
  "files",
  "project_search",
  "working_diff",
]);

export function isMobileWorkspaceSwitcherTarget(target: WorkspaceTabTarget): boolean {
  return !COMPACT_EXPLORER_TARGET_KINDS.has(target.kind);
}
