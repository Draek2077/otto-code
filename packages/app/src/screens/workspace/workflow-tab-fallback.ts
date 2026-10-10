import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

/**
 * The tab-switcher fallback description for the Workflow kinds: a Graph being
 * designed and a run being inspected. Null for every other kind. Lives beside
 * `workspace-screen.tsx` rather than in it, which is a size-capped registry.
 */
export function workflowTabFallbackDescription(
  target: WorkspaceTabDescriptor["target"],
): string | null {
  if (target.kind === "orchestrationGraph") {
    return "Graph";
  }
  if (target.kind === "workflowRun") {
    return "Workflow";
  }
  return null;
}
