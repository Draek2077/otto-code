import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { WorkspaceChangeIndicator } from "@/hooks/use-settings/otto-settings";
import { selectVisibleWorkspaceChangeStat } from "@/stores/session-store-hooks/selectors";

type DiffStat = NonNullable<WorkspaceDescriptor["diffStat"]>;

export function useVisibleWorkspaceDiffStat(
  serverId: string,
  workspaceId: string,
  indicator: WorkspaceChangeIndicator,
): DiffStat | null {
  return useWorkspaceFields(serverId, workspaceId, (workspace) =>
    selectVisibleWorkspaceChangeStat(workspace, indicator),
  );
}

export function useWorkspaceHasDiffStat(
  serverId: string,
  workspaceId: string,
  indicator: WorkspaceChangeIndicator,
): boolean {
  return (
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      Boolean(selectVisibleWorkspaceChangeStat(workspace, indicator)),
    ) ?? false
  );
}
