import { useCallback, useState } from "react";
import { View, Text } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { workflowArtifactSource, unwrapWorkflowResult } from "@getpaseo/plugin/otto/workflows";
import type { ArtifactRef } from "@getpaseo/plugin/otto/artifacts";
import { useHostFeature } from "@/runtime/host-features";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { openWorkflow } from "./navigation";
import { styles } from "./styles";
interface Props {
  reference: ArtifactRef;
  revision: string;
  active: boolean;
  navigation: PluginSurfaceProps["navigation"];
}
export function ArtifactWorkflowSource(props: Props) {
  // COMPAT(ottoWorkflowArtifactSource): added v0.10.0; remove after 2027-05-05 when host floor >= v0.10.0.
  const available = useHostFeature(props.reference.scope.hostId, "ottoWorkflows");
  return available ? (
    <Source {...props} />
  ) : (
    <Text style={styles.muted}>
      Update the host to inspect the source Workflow. The Artifact remains available.
    </Text>
  );
}
function Source(props: Props) {
  const [expanded, setExpanded] = useState(false),
    read = useRpc(workflowArtifactSource);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflowArtifactSource", props.reference, props.revision],
    enabled: props.active && expanded,
    retry: false,
    queryFn: async () => unwrapWorkflowResult(await read(props.reference)),
  });
  const toggle = useCallback(() => setExpanded((value) => !value), []),
    refresh = useCallback(() => {
      void query.refetch();
    }, [query]);
  const value = query.data,
    workflow = value?.kind === "workflow" ? value : null;
  const open = useCallback(() => {
    if (workflow) openWorkflow(workflow.ref);
  }, [workflow]);
  const chat = useCallback(() => {
    if (workflow?.conductorAgentId)
      props.navigation?.openAgent({
        agentId: workflow.conductorAgentId,
        serverId: workflow.ref.scope.hostId,
      });
  }, [workflow, props.navigation]);
  return (
    <View style={styles.card}>
      <Button onPress={toggle} variant="outline" size="sm">
        {expanded ? "Hide source Workflow" : "Inspect source Workflow"}
      </Button>
      {expanded ? (
        <View style={styles.content}>
          <Button onPress={refresh} variant="ghost" disabled={!props.active || query.isFetching}>
            Refresh source
          </Button>
          {query.error ? (
            <Alert
              variant="error"
              description="The source could not be read. Refresh to inspect it again; the Artifact is unchanged."
            />
          ) : null}
          {value?.kind === "unavailable" ? <Alert description={value.message} /> : null}
          {workflow ? (
            <View style={styles.card}>
              <Text style={styles.title}>{`${workflow.title} · ${workflow.status}`}</Text>
              <Text
                style={styles.muted}
              >{`Run ${workflow.ref.id} · ${workflow.ref.location}`}</Text>
              <Text selectable style={styles.text}>
                {workflow.summary ?? ""}
              </Text>
              {workflow.error ? <Alert variant="warning" description={workflow.error} /> : null}
              <View style={styles.actions}>
                <Button onPress={open} variant="outline">
                  Open Workflow
                </Button>
                {workflow.conductorAgentId && props.navigation ? (
                  <Button onPress={chat} variant="outline">
                    Open conductor chat
                  </Button>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
