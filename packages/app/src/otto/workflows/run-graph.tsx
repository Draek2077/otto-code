import { useMemo } from "react";
import { ScrollView, View, Text } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { OrchestrationGraph, WorkflowRunRecord } from "@getpaseo/plugin/otto/workflows";
import { styles } from "./styles";
const Wire = withUnistyles(Path);
const wireColor = (theme: import("@/styles/theme").Theme) => ({ stroke: theme.colors.accent });
function layout(graph: OrchestrationGraph) {
  const rows = graph.nodes.map((node, index) => ({
    node,
    x: Math.max(-10000, Math.min(10000, node.position?.x ?? (index % 4) * 300)),
    y: Math.max(-10000, Math.min(10000, node.position?.y ?? Math.floor(index / 4) * 160)),
  }));
  const minX = Math.min(0, ...rows.map((row) => row.x)),
    minY = Math.min(0, ...rows.map((row) => row.y));
  const positions = new Map(
    rows.map((row) => [row.node.id, { ...row, x: row.x - minX + 30, y: row.y - minY + 30 }]),
  );
  return {
    positions,
    width: Math.max(900, ...rows.map((row) => row.x - minX + 300)),
    height: Math.max(320, ...rows.map((row) => row.y - minY + 150)),
  };
}
/** Read-only topology from the immutable launch snapshot and actual engine phases. No designer, socket or animation owns run state. */
export function WorkflowRunGraph({
  graph,
  run,
}: {
  graph: OrchestrationGraph;
  run: WorkflowRunRecord;
}) {
  const geometry = useMemo(() => layout(graph), [graph]);
  const stageStyle = useMemo(
    () => ({ width: geometry.width, height: geometry.height }),
    [geometry.width, geometry.height],
  );
  const phases = useMemo(() => new Map(run.phases.map((phase) => [phase.id, phase])), [run.phases]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Graph execution</Text>
      <ScrollView horizontal>
        <ScrollView style={styles.runGraph}>
          <View style={stageStyle}>
            <Svg width={geometry.width} height={geometry.height}>
              {(graph.edges ?? []).map((edge, index) => {
                const from = geometry.positions.get(edge.from),
                  to = geometry.positions.get(edge.to);
                if (!from || !to) return null;
                return (
                  <Wire
                    key={edge.id ?? `${edge.from}/${edge.to}/${index}`}
                    d={`M ${from.x + 210} ${from.y + 38} L ${to.x} ${to.y + 38}`}
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray={edge.when ? "6 4" : undefined}
                    uniProps={wireColor}
                  />
                );
              })}
            </Svg>
            {[...geometry.positions.values()].map(({ node, x, y }) => (
              <View key={node.id} style={[styles.graphNode, { left: x, top: y }]}>
                <Text style={styles.title}>{node.title}</Text>
                <Text style={styles.text}>
                  {phases.get(node.id)?.status ??
                    (node.kind === "orchestrator" ? "conductor" : "not dispatched")}
                </Text>
                <Text style={styles.muted}>{node.id}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
      <Text style={styles.muted}>
        Wires show declared dependencies. Dashed wires are conditional. Phase results below report
        actual execution and skipped work.
      </Text>
    </View>
  );
}
