import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * Explorer is a navigation and triage surface. A request made there opens work
 * in Main unless the result is itself a compact investigative surface.
 */
export function getExplorerRequestedTargetHost(target: WorkspaceTabTarget): "main" | "explorer" {
  switch (target.kind) {
    case "working_diff":
    case "commit_diff":
    case "fileHistory":
    case "gitLog":
    case "project_search":
      return "explorer";
    default:
      return "main";
  }
}
