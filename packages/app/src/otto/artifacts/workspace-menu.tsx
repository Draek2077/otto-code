import { useCallback, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  DropdownMenuHint,
  DropdownMenuItem,
  useDropdownMenuClose,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import {
  listArtifacts,
  type ArtifactSummary,
  type ArtifactScope,
} from "@getpaseo/plugin/otto/artifacts";
import type { WorkspaceTabLaunchItem } from "@/workspace-tabs/launcher";
import { artifactWorkspaceSelection } from "./workspace-selection";
export const ARTIFACT_MENU_PAGE = "otto-workspace-artifacts";
export function isArtifactMenuItem(id: string) {
  return id === "plugin:otto-artifacts:artifacts";
}
function ArtifactItem({
  artifact,
  open,
}: {
  artifact: ArtifactSummary;
  open(artifact: ArtifactSummary): void;
}) {
  const select = useCallback(() => open(artifact), [artifact, open]);
  return (
    <DropdownMenuItem onSelect={select} testID={`workspace-artifact-${artifact.id}`}>
      {artifact.name}
    </DropdownMenuItem>
  );
}
function ArtifactPicker({
  serverId,
  launch,
  paneId,
}: {
  serverId: string;
  launch: WorkspaceTabLaunchItem["launch"];
  paneId?: string;
}) {
  const selected = useActiveWorkspaceSelection();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const close = useDropdownMenuClose();
  const [offset, setOffset] = useState(0);
  const workspaceId = selected?.serverId === serverId ? selected.workspaceId : null;
  const scope = useMemo<ArtifactScope>(
    () => ({ hostId: serverId, target: { kind: "workspace", id: workspaceId ?? "" } }),
    [serverId, workspaceId],
  );
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: ["ottoWorkspaceArtifactMenu", serverId, workspaceId, offset],
    enabled: connected && !!client && !!workspaceId,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error("Connect to the workspace host.");
      const result = listArtifacts.output.parse(
        await client.invokePluginRpc("otto-artifacts", listArtifacts.name, { scope, offset }),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const open = useCallback(
    (artifact: ArtifactSummary) => {
      if (!workspaceId) return;
      artifactWorkspaceSelection.select(serverId, workspaceId, {
        scope,
        id: artifact.id,
        location: artifact.location,
      });
      launch({ kind: "open", paneId });
      close();
    },
    [serverId, workspaceId, scope, launch, paneId, close],
  );
  const next = useCallback(() => setOffset((current) => current + 100), []);
  const previous = useCallback(() => setOffset((current) => Math.max(0, current - 100)), []);
  if (!workspaceId)
    return <DropdownMenuHint>Open a workspace to choose its Artifacts.</DropdownMenuHint>;
  if (!connected) return <DropdownMenuHint>Connect to the workspace host.</DropdownMenuHint>;
  if (query.error) return <DropdownMenuHint>{query.error.message}</DropdownMenuHint>;
  if (!query.data) return <DropdownMenuHint>Reading workspace Artifacts...</DropdownMenuHint>;
  return (
    <>
      {query.data.items.length ? (
        query.data.items.map((artifact) => (
          <ArtifactItem key={artifact.id} artifact={artifact} open={open} />
        ))
      ) : (
        <DropdownMenuHint>No Artifacts in this project yet.</DropdownMenuHint>
      )}
      {offset > 0 ? (
        <DropdownMenuItem closeOnSelect={false} onSelect={previous}>
          Previous Artifacts
        </DropdownMenuItem>
      ) : null}
      {offset + query.data.items.length < query.data.total ? (
        <DropdownMenuItem closeOnSelect={false} onSelect={next}>
          More Artifacts
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
export function useArtifactMenuPages(
  serverId: string,
  item: WorkspaceTabLaunchItem | undefined,
  paneId?: string,
): MenuPageDefinition[] {
  return useMemo(
    () =>
      item
        ? [
            {
              id: ARTIFACT_MENU_PAGE,
              title: "Artifacts",
              content: <ArtifactPicker serverId={serverId} launch={item.launch} paneId={paneId} />,
            },
          ]
        : [],
    [serverId, item, paneId],
  );
}
