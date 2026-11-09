import { lazy, Suspense, useMemo, type ReactNode } from "react";
import {
  VIEW_AUTHORING_LABEL,
  viewAuthoringContext,
} from "@getpaseo/plugin/otto/architectural-views";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
const Authoring = lazy(async () => ({
  default: (await import("./chat")).ArchitecturalAuthoringChat,
}));
/** Ordinary chats return the exact original subtree; only an explicit owned
 * authoring binding mounts the compound presentation. */
export function ArchitecturalChatBoundary({
  serverId,
  workspaceId,
  agentId,
  children,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  children: ReactNode;
}) {
  const available = useHostFeature(serverId, "ottoArchitecturalViews");
  const authoring = useSessionStore((state) => {
    const agent =
      state.sessions[serverId]?.agents.get(agentId) ??
      state.sessions[serverId]?.agentDetails.get(agentId);
    return agent?.labels?.[VIEW_AUTHORING_LABEL];
  });
  const context = useMemo(
    () => viewAuthoringContext({ [VIEW_AUTHORING_LABEL]: authoring }, serverId),
    [authoring, serverId],
  );
  if (!available || !context || context.workspaceId !== workspaceId) return children;
  return (
    <Suspense fallback={children}>
      <Authoring context={context} agentId={agentId}>
        {children}
      </Authoring>
    </Suspense>
  );
}
