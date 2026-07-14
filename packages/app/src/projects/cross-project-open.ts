import { isAbsolutePath } from "@/utils/path";
import type { WorkspaceFileLocation, WorkspaceFileOrigin } from "@/workspace/file-open";
import { areProjectsLinkedInSet } from "@/projects/project-links";
import {
  resolveWorkspaceForPath,
  type WorkspaceForPathCandidate,
} from "@/projects/resolve-workspace-for-path";

export interface CrossProjectWorkspace extends WorkspaceForPathCandidate {
  projectName: string;
}

export interface CrossProjectOpenInput {
  location: WorkspaceFileLocation;
  /** The project the active workspace belongs to. */
  currentProjectId: string;
  /** Every known workspace on the host (for path→owner resolution). */
  workspaces: readonly CrossProjectWorkspace[];
  /** Canonical link keys for the host (see project-links). */
  linkSet: ReadonlySet<string>;
}

export type CrossProjectOpenDecision =
  // Same project (or a path we can't attribute to another known project): open
  // exactly as today, no origin discriminator.
  | { kind: "in-project" }
  // A linked project's file: open in place, scoped to the owning workspace.
  | { kind: "linked"; origin: WorkspaceFileOrigin; location: WorkspaceFileLocation }
  // An unlinked project's file: refuse, naming the owner.
  | { kind: "blocked"; projectName: string };

/**
 * Decides how a file reference (typically an absolute path clicked in a
 * conversation) should open under gated-multi-root:
 * - relative paths and paths inside the current project → open normally;
 * - a file inside a *linked* project → open in place, scoped to that project's
 *   workspace (origin), with the path rewritten relative to it;
 * - a file inside an *unlinked* project → blocked.
 * Pure so it can be unit-tested without the store/UI.
 */
export function resolveCrossProjectFileOpen(
  input: CrossProjectOpenInput,
): CrossProjectOpenDecision {
  const { location, currentProjectId, workspaces, linkSet } = input;
  const path = location.path.trim().replace(/\\/g, "/");

  // Relative references are anchored to the active workspace by the opener, so
  // they are in-project by construction. Only absolute paths can point elsewhere.
  if (!isAbsolutePath(path)) {
    return { kind: "in-project" };
  }

  const owner = resolveWorkspaceForPath(path, workspaces);
  if (!owner) {
    // Outside every known workspace — not a cross-project case we gate; let the
    // normal path run (the daemon's known-workspace boundary still guards it).
    return { kind: "in-project" };
  }

  if (owner.projectId === currentProjectId) {
    return { kind: "in-project" };
  }

  const ownerWorkspace = workspaces.find(
    (workspace) => workspace.workspaceId === owner.workspaceId,
  );
  const projectName = ownerWorkspace?.projectName ?? owner.projectId;

  if (!areProjectsLinkedInSet(linkSet, currentProjectId, owner.projectId)) {
    return { kind: "blocked", projectName };
  }

  return {
    kind: "linked",
    origin: {
      workspaceId: owner.workspaceId,
      cwd: owner.cwd,
      projectId: owner.projectId,
      projectName,
    },
    // Rewrite the path relative to the owning workspace so the origin-scoped
    // daemon RPCs resolve it correctly.
    location: { ...location, path: owner.relativePath },
  };
}
