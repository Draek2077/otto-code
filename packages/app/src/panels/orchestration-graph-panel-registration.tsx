import { lazy, Suspense } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Schema } from "@/components/icons/material-icons";
import { useOrchestrationGraphs } from "@/hooks/use-orchestration-graphs";
import type {
  PanelDescriptor,
  PanelDescriptorContext,
  PanelRegistration,
} from "@/panels/panel-registry";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";

// The graph designer panel (projects/orchestration-graphs) behind a React.lazy
// boundary, like the Visualizer: register-panels imports this thin module, so
// the vendored Drawflow bundle + canvas wrapper stay out of the startup graph
// and load only when a designer tab actually renders. Metro resolves the
// heavy web implementation (.web.tsx) or the native placeholder (.tsx).
const LazyOrchestrationGraphPanel = lazy(() =>
  import("@/orchestration-graph/orchestration-graph-panel").then((mod) => ({
    default: mod.OrchestrationGraphPanel,
  })),
);

function useOrchestrationGraphPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "orchestrationGraph" }>,
  context: PanelDescriptorContext,
): PanelDescriptor {
  const graphsQuery = useOrchestrationGraphs(context.serverId);
  const graph = (graphsQuery.data ?? []).find((candidate) => candidate.id === target.graphId);
  return {
    label: graph?.name ?? "Graph",
    subtitle: "Orchestration graph",
    titleState: "ready",
    icon: Schema,
    statusBucket: null,
  };
}

function OrchestrationGraphFallback() {
  return <View style={styles.fallback} />;
}
const ORCHESTRATION_GRAPH_FALLBACK = <OrchestrationGraphFallback />;

function OrchestrationGraphPanelHost() {
  return (
    <Suspense fallback={ORCHESTRATION_GRAPH_FALLBACK}>
      <LazyOrchestrationGraphPanel />
    </Suspense>
  );
}

export const orchestrationGraphPanelRegistration: PanelRegistration<"orchestrationGraph"> = {
  kind: "orchestrationGraph",
  component: OrchestrationGraphPanelHost,
  useDescriptor: useOrchestrationGraphPanelDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  fallback: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
}));
