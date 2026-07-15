import { useCallback, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceFileLocation, WorkspaceFileOrigin } from "@/workspace/file-open";
import {
  resolveCrossProjectFileOpen,
  type CrossProjectWorkspace,
} from "@/projects/cross-project-open";

export interface CrossProjectResolvedOpen {
  location: WorkspaceFileLocation;
  origin?: WorkspaceFileOrigin;
}

export type CrossProjectFileOpenGate = (
  location: WorkspaceFileLocation,
) => CrossProjectResolvedOpen;

/**
 * Resolves how a file reference should open under gated-multi-root. Any file
 * opens (any file can be previewed) — a cross-project or project-less file
 * comes back with an `origin` to pass into `createWorkspaceFileTabTarget`, so
 * the tab is scoped to the owning (or synthesized) workspace. Whether *editing*
 * it warns is decided later at edit time by `resolveEditGate`; the open never
 * blocks and never prompts.
 */
export function useCrossProjectFileOpenGate(
  serverId: string,
  currentProjectId: string | null,
): CrossProjectFileOpenGate {
  const workspacesMap = useSessionStore((state) => state.sessions[serverId]?.workspaces ?? null);
  const allowOutsideWorkspace = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fileOutsideWorkspace === true,
  );

  const workspaces = useMemo<CrossProjectWorkspace[]>(() => {
    if (!workspacesMap) {
      return [];
    }
    const result: CrossProjectWorkspace[] = [];
    for (const descriptor of workspacesMap.values()) {
      if (!descriptor.workspaceDirectory) {
        continue;
      }
      result.push({
        workspaceId: descriptor.id,
        projectId: descriptor.projectId,
        cwd: descriptor.workspaceDirectory,
        projectName: descriptor.projectCustomName ?? descriptor.projectDisplayName,
      });
    }
    return result;
  }, [workspacesMap]);

  return useCallback(
    (location: WorkspaceFileLocation): CrossProjectResolvedOpen => {
      if (!currentProjectId) {
        return { location };
      }
      const decision = resolveCrossProjectFileOpen({
        location,
        currentProjectId,
        workspaces,
        allowOutsideWorkspace,
      });
      if (decision.kind === "in-project") {
        return { location };
      }
      return { location: decision.location, origin: decision.origin };
    },
    [allowOutsideWorkspace, currentProjectId, workspaces],
  );
}
