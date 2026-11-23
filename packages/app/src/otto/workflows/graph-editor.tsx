import { useCallback, useSyncExternalStore, useState } from "react";
import { View, Text } from "react-native";
import type {
  PromptTemplate,
  GraphNode,
  GraphInput,
  GraphEdge,
} from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import type { WorkflowDraft } from "./draft";
import { DraftField, DraftToggle, DraftSelect, DraftJson } from "./draft-fields";
import { GraphCanvas } from "./canvas/panel";
import { styles } from "./styles";
const kinds = ["agent", "gate", "check"].map((value) => ({ value, label: value }));
const access = [
  { value: "", label: "Write (inherited)" },
  { value: "write", label: "Write" },
  { value: "read", label: "Read only" },
  { value: "none", label: "No workspace" },
];
function Node({ model, node, index }: { model: WorkflowDraft; node: GraphNode; index: number }) {
  const prefix = `value.nodes.${index}`;
  const remove = useCallback(() => {
    const doc = model.getSnapshot().document;
    if (doc.kind !== "graph" || node.kind === "orchestrator") return;
    model.graph({
      ...doc.value,
      nodes: doc.value.nodes.filter((item) => item.id !== node.id),
      edges: (doc.value.edges ?? []).filter((edge) => edge.from !== node.id && edge.to !== node.id),
    });
  }, [model, node.id, node.kind]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{node.title}</Text>
      <Text style={styles.muted}>{`Node ${node.id}`}</Text>
      <DraftJson model={model} path={`${prefix}.position`} label="Canvas position {x,y}" />
      <DraftField model={model} path={`${prefix}.title`} label="Node title" />
      {node.kind !== "orchestrator" ? (
        <DraftSelect model={model} path={`${prefix}.kind`} label="Node type" options={kinds} />
      ) : null}
      <DraftField model={model} path={`${prefix}.prompt`} label="Prompt" multiline />
      <DraftField model={model} path={`${prefix}.promptFromInput`} label="Prompt from input key" />
      <DraftSelect
        model={model}
        path={`${prefix}.access`}
        label="Workspace access"
        options={access}
      />
      <DraftField model={model} path={`${prefix}.model`} label="Model override (provider/model)" />
      <DraftToggle
        model={model}
        path={`${prefix}.autonomous`}
        label="Allow managed read-only delegation"
      />
      <DraftField
        model={model}
        path={`${prefix}.check.expression`}
        label="Check expression (JSONata)"
        multiline
      />
      <DraftField model={model} path={`${prefix}.check.message`} label="Check failure message" />
      <DraftField
        model={model}
        path={`${prefix}.timeoutMs`}
        label="Attempt timeout (milliseconds)"
        number
      />
      <DraftJson
        model={model}
        path={`${prefix}.loop`}
        label="Loop: times or until {criteria,max}"
      />
      <DraftJson
        model={model}
        path={`${prefix}.retry`}
        label="Retry: maxAttempts, backoffMs, multiplier"
      />
      <DraftJson model={model} path={`${prefix}.output`} label="Output fields" />
      <DraftJson
        model={model}
        path={`${prefix}.tools`}
        label="Allowed tool groups (null inherits, [] denies)"
      />
      <DraftJson model={model} path={`${prefix}.queryTools`} label="Declared query tools" />
      <DraftJson
        model={model}
        path={`${prefix}.promptTemplate`}
        label="Template binding: templateId, variables"
      />
      {node.kind !== "orchestrator" ? (
        <Button variant="outline" onPress={remove}>
          Remove node
        </Button>
      ) : null}
    </View>
  );
}
function Input({
  model,
  input,
  index,
}: {
  model: WorkflowDraft;
  input: GraphInput;
  index: number;
}) {
  const remove = useCallback(() => {
    const doc = model.getSnapshot().document;
    if (doc.kind === "graph")
      model.graph({ ...doc.value, inputs: (doc.value.inputs ?? []).filter((_, i) => i !== index) });
  }, [model, index]);
  const path = `value.inputs.${index}`;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{input.label}</Text>
      <DraftField model={model} path={`${path}.key`} label="Input key" />
      <DraftField model={model} path={`${path}.label`} label="Label" />
      <DraftField model={model} path={`${path}.description`} label="Description" />
      <DraftField model={model} path={`${path}.defaultValue`} label="Default value" multiline />
      <DraftToggle model={model} path={`${path}.required`} label="Required" />
      <DraftToggle model={model} path={`${path}.multiline`} label="Multiline" />
      <Button variant="outline" onPress={remove}>
        Remove input
      </Button>
    </View>
  );
}
function Edge({ model, edge, index }: { model: WorkflowDraft; edge: GraphEdge; index: number }) {
  const path = `value.edges.${index}`;
  const remove = useCallback(() => {
    const doc = model.getSnapshot().document;
    if (doc.kind === "graph")
      model.graph({ ...doc.value, edges: (doc.value.edges ?? []).filter((_, i) => i !== index) });
  }, [model, index]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{`${edge.from} → ${edge.to}`}</Text>
      <DraftField model={model} path={`${path}.from`} label="From node ID" />
      <DraftField model={model} path={`${path}.to`} label="To node ID" />
      <DraftField
        model={model}
        path={`${path}.fromPort`}
        label="Output port (output, pass, fail)"
      />
      <DraftField model={model} path={`${path}.toPort`} label="Input port" />
      <DraftField model={model} path={`${path}.label`} label="Wire label" />
      <DraftField model={model} path={`${path}.when.expression`} label="Edge condition (JSONata)" />
      <DraftJson model={model} path={`${path}.fields`} label="Selected output field keys" />
      <Button variant="outline" onPress={remove}>
        Remove edge
      </Button>
    </View>
  );
}
/** The frozen visual editor and cross-platform forms share one lossless local draft. */
export function GraphEditor({
  model,
  active,
  templates,
}: {
  model: WorkflowDraft;
  active: boolean;
  templates: PromptTemplate[];
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    [details, setDetails] = useState(false);
  const change = useCallback(
    (graph: import("@getpaseo/plugin/otto/workflows").OrchestrationGraph) => model.graph(graph),
    [model],
  );
  const input = useCallback(() => {
    const doc = model.getSnapshot().document;
    if (doc.kind === "graph")
      model.graph({
        ...doc.value,
        inputs: [
          ...(doc.value.inputs ?? []),
          { key: `input${(doc.value.inputs?.length ?? 0) + 1}`, label: "Input", required: true },
        ],
      });
  }, [model]);
  const edge = useCallback(() => {
    const doc = model.getSnapshot().document;
    if (doc.kind === "graph")
      model.graph({
        ...doc.value,
        edges: [
          ...(doc.value.edges ?? []),
          {
            id: `edge-${Date.now()}`,
            from: doc.value.nodes[0]?.id ?? "root",
            to: doc.value.nodes[1]?.id ?? "root",
          },
        ],
      });
  }, [model]);
  const toggle = useCallback(() => setDetails((value) => !value), []);
  if (state.document.kind !== "graph") return null;
  const graph = state.document.value;
  return (
    <View style={styles.content}>
      <GraphCanvas
        graph={graph}
        templates={templates}
        active={active && !state.busy}
        onChange={change}
      />
      <View style={styles.actions}>
        <Button onPress={input} variant="outline">
          Add input
        </Button>
        <Button onPress={edge} variant="outline">
          Add edge
        </Button>
        <Button onPress={toggle} variant="ghost">
          {details ? "Hide node and edge forms" : "Node and edge forms"}
        </Button>
      </View>
      {(graph.inputs ?? []).map((item, index) => (
        <Input key={item.key || index} model={model} input={item} index={index} />
      ))}
      {details ? <GraphDetails model={model} /> : null}
    </View>
  );
}
function GraphDetails({ model }: { model: WorkflowDraft }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  if (state.document.kind !== "graph") return null;
  return (
    <View style={styles.content}>
      {state.document.value.nodes.map((node, index) => (
        <Node key={node.id} model={model} node={node} index={index} />
      ))}
      {(state.document.value.edges ?? []).map((edge, index) => (
        <Edge
          key={edge.id ?? `${edge.from}/${edge.to}/${index}`}
          model={model}
          edge={edge}
          index={index}
        />
      ))}
    </View>
  );
}
