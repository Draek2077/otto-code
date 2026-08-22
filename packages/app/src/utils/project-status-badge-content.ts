import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type ProjectStatusBadgeDotBucket = "needs_input" | "failed" | "attention" | "running";

export interface ProjectStatusBadgeContent {
  kind: "dot";
  bucket: ProjectStatusBadgeDotBucket;
}

/**
 * What the project status badge should render for a project's aggregate bucket, or null when
 * no badge should show at all. Kept as plain data (no React) so it's testable without JSDOM
 * or component mounting — see docs/testing.md's two test categories.
 *
 * Each actionable state is a dot. The badge is 14pt; anything with internal detail at that size
 * loses to a solid disc, so the buckets separate by color while active work adds a spinner.
 */
export function getProjectStatusBadgeContent(
  statusBucket: SidebarStateBucket | null,
): ProjectStatusBadgeContent | null {
  if (
    statusBucket === "needs_input" ||
    statusBucket === "failed" ||
    statusBucket === "attention" ||
    statusBucket === "running"
  ) {
    return { kind: "dot", bucket: statusBucket };
  }
  return null;
}
