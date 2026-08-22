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
  const sessions = useSessionStore((state) => state.sessions);

  return useMemo(
    () =>
      resolvePreferredWorkspaceProjectScope({
        activeWorkspace,
        lastWorkspace,
        sessions,
      }),
    [activeWorkspace, lastWorkspace, sessions],
  );
}
