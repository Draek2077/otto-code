import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  readArtifactSource,
  type ArtifactRef,
  type ArtifactSummary,
} from "@getpaseo/plugin/otto/artifacts";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { styles } from "./styles";
interface SourceProps {
  reference: ArtifactRef;
  revision: string;
  active: boolean;
  navigation: PluginSurfaceProps["navigation"];
}
export function ArtifactSourceDisclosure(
  props: SourceProps & { source: ArtifactSummary["source"] },
) {
  const { source } = props;
  const openChat = useCallback(() => {
    if (source?.kind === "chat")
      props.navigation?.openAgent({
        agentId: source.agentId,
        serverId: props.reference.scope.hostId,
      });
  }, [source, props.navigation, props.reference.scope.hostId]);
  if (!source) return null;
  if (source.kind === "schedule") return <ArtifactScheduleSource {...props} />;
  if (source.kind === "chat")
    return props.navigation ? (
      <Button variant="outline" size="sm" onPress={openChat}>
        Open source chat
      </Button>
    ) : null;
  return (
    <Text style={styles.muted}>
      Workflow source identifiers are retained. The owning Workflow is unavailable on this host.
    </Text>
  );
}

/** Exact source inspection stays beside the deliverable, including on compact layouts. */
function ArtifactScheduleSource(props: SourceProps) {
  const [expanded, setExpanded] = useState(false);
  const read = useRpc(readArtifactSource);
  const query = useFetchQuery({
    queryKey: [
      "ottoArtifacts",
      "source",
      props.reference.scope,
      props.reference.id,
      props.reference.location,
      props.revision,
    ],
    enabled: expanded && props.active,
    retry: false,
    dataShape: "value",
    staleTimeMs: 2000,
    queryFn: async () => {
      const result = await read(props.reference);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const refetch = query.refetch;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const details = query.data;
  const runAgentId = details?.kind === "schedule" ? details.run.agentId : null;
  const openChat = useCallback(() => {
    if (runAgentId)
      props.navigation?.openAgent({ agentId: runAgentId, serverId: props.reference.scope.hostId });
  }, [runAgentId, props.navigation, props.reference.scope.hostId]);
  return (
    <View style={styles.card} testID="artifact-schedule-source">
      <Button variant="outline" size="sm" onPress={toggle}>
        {expanded ? "Hide source Schedule" : "Inspect source Schedule"}
      </Button>
      {expanded ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching || !props.active}
            onPress={refresh}
          >
            Refresh source
          </Button>
          {query.isFetching ? <Text style={styles.muted}>Loading source Schedule...</Text> : null}
          {query.isError ? (
            <Alert
              variant="error"
              description="The source could not be read. Refresh source to try again; the Artifact is unchanged."
            />
          ) : null}
          {details?.kind === "unavailable" ? <Alert description={details.message} /> : null}
          {details?.kind === "schedule" ? (
            <>
              <Text style={styles.title}>{details.name ?? "Schedule"}</Text>
              <Text
                selectable
                style={styles.muted}
              >{`Schedule ${details.scheduleId} · Run ${details.run.id}`}</Text>
              <Text
                style={styles.muted}
              >{`Run ${details.run.status} · Started ${details.run.startedAt}`}</Text>
              {details.run.endedAt ? (
                <Text style={styles.muted}>{`Ended ${details.run.endedAt}`}</Text>
              ) : null}
              {details.run.error ? (
                <Alert variant="warning" description={details.run.error} />
              ) : null}
              {details.run.output ? (
                <Text selectable style={styles.muted}>
                  {details.run.output}
                </Text>
              ) : null}
              {runAgentId && props.navigation ? (
                <Button variant="outline" size="sm" onPress={openChat}>
                  Open Schedule run chat
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
