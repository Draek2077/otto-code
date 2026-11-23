import { useEffect, useMemo } from "react";
import { waitViewOpenIntent, releaseViewChanges } from "@getpaseo/plugin/otto/architectural-views";
import { useHostFeature } from "@/runtime/host-features";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useViewClient, unwrapView } from "./data";
import { createViewOpenFeed } from "./open-feed";
import { openArchitecturalViews } from "./navigation";
export function WorkspaceViewOpenListener({
  serverId,
  workspaceId,
  active,
}: {
  serverId: string;
  workspaceId: string;
  active: boolean;
}) {
  const available = useHostFeature(serverId, "ottoArchitecturalViews");
  return available ? (
    <AvailableListener serverId={serverId} workspaceId={workspaceId} active={active} />
  ) : null;
}
function AvailableListener({
  serverId,
  workspaceId,
  active,
}: {
  serverId: string;
  workspaceId: string;
  active: boolean;
}) {
  const client = useViewClient(serverId),
    visible = useAppVisible();
  const scope = useMemo(
    () => ({ hostId: serverId, target: { kind: "workspace" as const, id: workspaceId } }),
    [serverId, workspaceId],
  );
  useEffect(() => {
    if (!active || !visible) return;
    const feed = createViewOpenFeed({
      wait: async (leaseId, cursor) =>
        unwrapView(await client.call(waitViewOpenIntent, { scope, workspaceId, leaseId, cursor })),
      release: async (leaseId) => {
        await client.call(releaseViewChanges, { leaseId });
      },
      open: (identity) =>
        openArchitecturalViews(scope, { identity, selection: { kind: "published" } }),
    });
    return feed.retain();
  }, [client, scope, workspaceId, active, visible]);
  return null;
}
