import { useCallback, useMemo } from "react";
import { ScrollView, View, Text } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type {
  OrchestrationGraph,
  PromptTemplate,
  GraphNode,
} from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import { styles } from "../styles";
const ThemedPath = withUnistyles(Path);
const pathProps = (theme: import("@/styles/theme").Theme) => ({ stroke: theme.colors.accent });
function position(node: GraphNode, index: number) {
  return node.position ?? { x: 40 + (index % 4) * 330, y: 60 + Math.floor(index / 4) * 250 };
}
/** Native keeps an actual node/wire overview; the accessible node forms below own editing. */
export function GraphCanvas({
  graph,
  onChange,
}: {
  graph: OrchestrationGraph;
  templates: PromptTemplate[];
  active: boolean;
  onChange(graph: OrchestrationGraph): void;
}) {
  const nodes = useMemo(
    () => graph.nodes.map((node, index) => ({ node, point: position(node, index) })),
    [graph.nodes],
  );
  const add = useCallback(
    () =>
      onChange({
        ...graph,
        nodes: [
          ...graph.nodes,
          { id: `node-${Date.now()}`, kind: "agent", title: "Agent", prompt: "" },
        ],
      }),
    [graph, onChange],
  );
  return (
    <View>
      <Button variant="outline" onPress={add}>
        Add agent
      </Button>
      <ScrollView horizontal>
        <ScrollView style={styles.canvas}>
          <View style={styles.graphStage}>
            <Svg width={1600} height={1000}>
              {(graph.edges ?? []).map((edge, index) => {
                const from = nodes.find((row) => row.node.id === edge.from),
                  to = nodes.find((row) => row.node.id === edge.to);
                if (!from || !to) return null;
                return (
                  <ThemedPath
                    key={edge.id ?? `${edge.from}/${edge.to}/${index}`}
                    d={`M ${from.point.x + 210} ${from.point.y + 40} L ${to.point.x} ${to.point.y + 40}`}
                    fill="none"
                    strokeWidth={2}
                    uniProps={pathProps}
                  />
                );
              })}
            </Svg>
            {nodes.map(({ node, point }) => (
              <View key={node.id} style={[styles.graphNode, { left: point.x, top: point.y }]}>
                <Text style={styles.title}>{node.title}</Text>
                <Text style={styles.muted}>{node.kind}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}
