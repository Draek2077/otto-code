import { useMemo } from "react";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  resolvePreferredWorkspaceProjectScope,
  type WorkspaceProjectScope,
} from "./preferred-workspace-project-scope-state";

export { resolveInitialAggregateProjectScope } from "./preferred-workspace-project-scope-state";
export type { WorkspaceProjectScope } from "./preferred-workspace-project-scope-state";

export function usePreferredWorkspaceProjectScope(): WorkspaceProjectScope | null {
  const activeWorkspace = useActiveWorkspaceSelection();
  const lastWorkspace = useLastWorkspaceSelection();
  // Select only the resolved root path (a primitive) so unrelated session writes, such as agent
  // streaming, do not re-render every aggregate screen.
  const projectRootPath = useSessionStore(
    (state) =>
      resolvePreferredWorkspaceProjectScope({
        activeWorkspace,
        lastWorkspace,
        sessions: state.sessions,
      })?.projectRootPath ?? null,
  );
  const serverId = (activeWorkspace ?? lastWorkspace)?.serverId ?? null;

  return useMemo(
    () => (serverId && projectRootPath ? { serverId, projectRootPath } : null),
    [serverId, projectRootPath],
  );
}
