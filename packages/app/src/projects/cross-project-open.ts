import { isAbsolutePath } from "@/utils/path";
import type { WorkspaceFileLocation, WorkspaceFileOrigin } from "@/workspace/file-open";
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
  /**
   * Whether the daemon serves single-file access outside every known workspace
   * (`features.fileOutsideWorkspace`). When false, a project-less path is left
   * as in-project rather than synthesizing a root the daemon would refuse.
   */
  allowOutsideWorkspace: boolean;
}

export type CrossProjectOpenDecision =
  // Same project (or a relative reference anchored to the active workspace):
  // open exactly as today, no origin discriminator.
  | { kind: "in-project" }
  // A file that belongs to another project OR to no project at all: open in
  // place, scoped to the owning (or synthesized) workspace.
  | { kind: "out-of-project"; origin: WorkspaceFileOrigin; location: WorkspaceFileLocation };

/**
 * Decides how a file reference (typically an absolute path clicked in a
 * conversation) should open:
 * - relative paths and paths inside the current project → open normally;
 * - a file inside *another* project → open in place, scoped to that project's
 *   workspace (origin), with the path rewritten relative to it;
 * - a file outside *every* known project → open in place under a synthesized
 *   origin rooted at the file's own directory (so any scratch/plan file can be
 *   previewed; the daemon serves single-file reads regardless of workspace).
 * Never blocks or changes editability.
 * Pure so it can be unit-tested without the store/UI.
 */
export function resolveCrossProjectFileOpen(
  input: CrossProjectOpenInput,
): CrossProjectOpenDecision {
  const { location, currentProjectId, workspaces, allowOutsideWorkspace } = input;
  const path = location.path.trim().replace(/\\/g, "/");

  // Relative references are anchored to the active workspace by the opener, so
  // they are in-project by construction. Only absolute paths can point elsewhere.
  if (!isAbsolutePath(path)) {
    return { kind: "in-project" };
  }

  const owner = resolveWorkspaceForPath(path, workspaces);
  if (!owner) {
    // Outside every known workspace - a scratch/plan file. Synthesize an origin
    // rooted at the file's own directory so it opens in place. Requires the
    // daemon to serve out-of-workspace files; without it, leave the path as in-project.
    const split = allowOutsideWorkspace ? splitAbsolutePath(path) : null;
    if (!split) {
      return { kind: "in-project" };
    }
    return {
      kind: "out-of-project",
      origin: {
        workspaceId: `outside:${split.dir}`,
        cwd: split.dir,
        projectId: `outside:${split.dir}`,
        outsideAnyProject: true,
      },
      location: { ...location, path: split.base },
    };
  }

  if (owner.projectId === currentProjectId) {
    return { kind: "in-project" };
  }

  const ownerWorkspace = workspaces.find(
    (workspace) => workspace.workspaceId === owner.workspaceId,
  );
  const projectName = ownerWorkspace?.projectName ?? owner.projectId;

  return {
    kind: "out-of-project",
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

/**
 * Splits a normalized absolute POSIX/Windows path into its directory and
 * basename, keeping the directory a valid daemon root (drive/root slash
 * preserved). Returns null when there is no basename to open.
 */
function splitAbsolutePath(path: string): { dir: string; base: string } | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 0) {
    return null;
  }
  const base = path.slice(lastSlash + 1);
  if (!base) {
    return null;
  }
  let dir = path.slice(0, lastSlash);
  if (dir === "") {
    // POSIX root: "/foo.md" → dir "/".
    dir = "/";
  } else if (/^[A-Za-z]:$/.test(dir)) {
    // Windows drive root: "C:/foo.md" → dir "C:/".
    dir = `${dir}/`;
  }
  return { dir, base };
}
