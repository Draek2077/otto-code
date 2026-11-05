import { useEffect, useRef, useCallback } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type { OrchestrationGraph, PromptTemplate } from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import { createGraphCanvas, type GraphCanvasHandle } from "./graph-canvas.web";
import { buildGraphCanvasTheme, type GraphCanvasTheme } from "./graph-canvas-theme";
import { styles } from "../styles";
interface Props {
  graph: OrchestrationGraph;
  templates: PromptTemplate[];
  active: boolean;
  onChange(graph: OrchestrationGraph): void;
}
const hostStyle = { width: "100%", height: "100%" } as const;
function Canvas({
  graph,
  templates,
  active,
  onChange,
  canvasTheme,
}: Props & { canvasTheme: GraphCanvasTheme }) {
  const element = useRef<HTMLDivElement | null>(null),
    handle = useRef<GraphCanvasHandle | null>(null),
    base = useRef(graph),
    changed = useRef(onChange),
    theme = useRef(canvasTheme),
    loaded = useRef("");
  changed.current = onChange;
  base.current = graph;
  theme.current = canvasTheme;
  useEffect(() => {
    if (!active || !element.current) return;
    const canvas = createGraphCanvas(element.current, {
      theme: theme.current,
      checkOutputPorts: true,
      onChange() {
        const value = canvas.exportGraph(base.current);
        loaded.current = JSON.stringify(value);
        changed.current(value);
      },
    });
    handle.current = canvas;
    canvas.loadGraph(base.current);
    loaded.current = JSON.stringify(base.current);
    return () => {
      handle.current = null;
      canvas.destroy();
    };
  }, [active]);
  useEffect(() => {
    const signature = JSON.stringify(graph);
    if (signature !== loaded.current) {
      loaded.current = signature;
      handle.current?.loadGraph(graph);
    }
  }, [graph, active]);
  useEffect(() => {
    handle.current?.setPromptTemplates(templates);
  }, [templates, active]);
  useEffect(() => {
    handle.current?.setDeclaredInputs((graph.inputs ?? []).map((input) => input.key));
  }, [graph.inputs, active]);
  useEffect(() => {
    handle.current?.setTheme(canvasTheme);
  }, [canvasTheme, active]);
  const agent = useCallback(() => handle.current?.addAgentNode(), []),
    gate = useCallback(() => handle.current?.addGateNode(), []),
    check = useCallback(() => handle.current?.addCheckNode(), []);
  return (
    <View>
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={agent}>
          Add agent
        </Button>
        <Button variant="outline" size="sm" onPress={gate}>
          Add gate
        </Button>
        <Button variant="outline" size="sm" onPress={check}>
          Add check
        </Button>
      </View>
      <View style={styles.canvas}>
        <div ref={element} style={hostStyle} />
      </View>
    </View>
  );
}
export const GraphCanvas = withUnistyles(Canvas, (theme) => ({
  canvasTheme: buildGraphCanvasTheme(theme),
}));
