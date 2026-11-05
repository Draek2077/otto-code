import { useMemo, useCallback, type ReactNode } from "react";
import { View, Text } from "react-native";
import {
  workflowChatContext,
  workflowHostStatus,
  workflowRefKey,
  unwrapWorkflowResult,
  type WorkflowRef,
} from "@getpaseo/plugin/otto/workflows";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { openWorkflow } from "./navigation";
import { styles } from "./styles";
/** Ordinary chats return their exact Paseo subtree. Only explicitly owned members mount Workflow reads. */
export function WorkflowComposerBoundary({
  serverId,
  agentId,
  children,
}: {
  serverId: string;
  agentId?: string;
  children: ReactNode;
}) {
  const labels = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agents.get(agentId)?.labels : undefined,
  );
  const context = useMemo(() => workflowChatContext(labels, serverId), [labels, serverId]);
  if (!context) return children;
  if (context.worker)
    return (
      <Callout
        reference={context.ref}
        message="This chat is owned by a Workflow. Review its result or make decisions in the Workflow; worker chats cannot accept independent messages."
      />
    );
  return <Conductor reference={context.ref}>{children}</Conductor>;
}
function Callout({
  reference,
  message,
  refresh,
}: {
  reference: WorkflowRef;
  message: string;
  refresh?: () => void;
}) {
  const open = useCallback(() => openWorkflow(reference), [reference]);
  return (
    <View style={styles.card}>
      <Text style={styles.muted}>{message}</Text>
      <View style={styles.actions}>
        <Button variant="outline" onPress={open}>
          Open Workflow
        </Button>
        {refresh ? (
          <Button variant="ghost" onPress={refresh}>
            Refresh run status
          </Button>
        ) : null}
      </View>
    </View>
  );
}
function Conductor({ reference, children }: { reference: WorkflowRef; children: ReactNode }) {
  const client = useHostRuntimeClient(reference.scope.hostId),
    retained = useRetainedPanelActive(),
    visible = useAppVisible(),
    active = retained && visible;
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflowHostStatus", reference.scope.hostId],
    enabled: active && !!client,
    retry: false,
    refetchInterval: active ? 2500 : false,
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      return unwrapWorkflowResult(
        workflowHostStatus.output.parse(
          await client.invokePluginRpc("otto-workflows", workflowHostStatus.name, {
            hostId: reference.scope.hostId,
          }),
        ),
      );
    },
  });
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);
  const run = query.data?.active.find(
    (item) => workflowRefKey(item.ref) === workflowRefKey(reference),
  );
  if (query.data?.ready && (!run || run.status === "planning")) return children;
  return (
    <Callout
      reference={reference}
      refresh={refresh}
      message={
        query.error
          ? "Workflow status could not be read. Refresh it before sending an independent message."
          : "The Workflow owns this conductor while its plan is pending or executing. Use the Workflow's decisions and cancellation controls."
      }
    />
  );
}
