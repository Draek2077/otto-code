import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  reviewOrchestrationGraph,
  validateOrchestrationGraph,
  type GraphInput,
  type OrchestrationGraph,
} from "@otto-code/protocol/workflow";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  CheckCircle,
  DataObject,
  PanelRight,
  PanelRightClose,
  Plus,
  PlayFilled,
  Save,
} from "@/components/icons/material-icons";
import {
  NewOrchestrationSheet,
  type NewOrchestrationPrefill,
} from "@/components/workflows/new-workflow-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import {
  useGraphCheckOutputPortsFeature,
  useProjectWorkflowGraphs,
  usePromptTemplates,
  useSaveProjectWorkflowGraph,
} from "@/hooks/use-workflow-graphs";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { useIconSize, type Theme } from "@/styles/theme";
import { buildGraphCanvasTheme, type GraphCanvasTheme } from "./graph-canvas-theme";
import { createGraphCanvas, type GraphCanvasHandle } from "./graph-canvas";
import { clearGraphDraft, getGraphDraft, setGraphDraft } from "./graph-draft-store";

// The graph designer tab (web + Electron): toolbar on top, separator, and the
// Drawflow canvas ported from Draekz Forge underneath. Mobile/native gets the
// placeholder in orchestration-graph-panel.tsx - the dialog + execute flow is
// cross-platform; designing wants a desktop-sized screen.

interface OrchestrationGraphPanelInnerProps {
  canvasTheme: GraphCanvasTheme;
}

const CANVAS_HOST_STYLE: { width: "100%"; height: "100%" } = {
  width: "100%",
  height: "100%",
};

function OrchestrationGraphPanelInner({
  canvasTheme,
}: OrchestrationGraphPanelInnerProps): ReactElement {
  const { serverId, workspaceId, target } = usePaneContext();
  const graphTarget = target.kind === "orchestrationGraph" ? target : null;
  const graphId = graphTarget?.graphId ?? "";
  const draftRunId = graphTarget?.runId;
  const workspaceCwd = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces.get(workspaceId)?.workspaceDirectory ?? "",
  );

  const graphsQuery = useProjectWorkflowGraphs({
    serverId,
    cwd: workspaceCwd,
    supported: Boolean(serverId && workspaceCwd),
  });
  const graph = useMemo(
    () => (graphsQuery.data ?? []).find((candidate) => candidate.id === graphId) ?? null,
    [graphsQuery.data, graphId],
  );
  const saveGraph = useSaveProjectWorkflowGraph({ serverId, cwd: workspaceCwd });
  const supportsCheckOutputPorts = useGraphCheckOutputPortsFeature(serverId);
  const templatesQuery = usePromptTemplates(serverId);
  const templates = templatesQuery.data;
  const graphRequiresCheckOutputPorts = useMemo(
    () => (graph ? graphUsesExplicitCheckPorts(graph) : false),
    [graph],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GraphCanvasHandle | null>(null);
  const themeRef = useRef(canvasTheme);
  themeRef.current = canvasTheme;
  // The toggle's source of truth, mirrored into state only to redraw the
  // button. The canvas is rebuilt when its options change, and a rebuilt canvas
  // has to come back with the panel the user left it with, not the default.
  const edgeInspectorVisibleRef = useRef(true);

  const toast = useToast();
  const [dirty, setDirty] = useState(false);
  const [inputs, setInputs] = useState<GraphInput[] | null>(null);
  const [inputsSheetOpen, setInputsSheetOpen] = useState(false);
  const [runPrefill, setRunPrefill] = useState<NewOrchestrationPrefill | null>(null);
  const [loadedGraphId, setLoadedGraphId] = useState<string | null>(null);
  const [validationProblems, setValidationProblems] = useState<string[]>([]);
  const [edgeInspectorVisible, setEdgeInspectorVisible] = useState(true);

  // Bumped by every edit. `dirty` alone can't drive the draft mirror below -
  // it flips true once and then stops changing, so only the first edit would
  // ever be captured.
  const [revision, setRevision] = useState(0);

  const graphRef = useRef<OrchestrationGraph | null>(null);
  const inputsRef = useRef<GraphInput[]>([]);
  graphRef.current = graph;
  inputsRef.current = inputs ?? graph?.inputs ?? [];

  const refreshValidation = useCallback(() => {
    const source = graphRef.current;
    const handle = handleRef.current;
    if (!source || !handle) {
      return;
    }
    setValidationProblems(
      validateOrchestrationGraph(handle.exportGraph({ ...source, inputs: inputsRef.current })),
    );
  }, []);

  const handleCanvasChange = useCallback(() => {
    setDirty(true);
    setRevision((previous) => previous + 1);
    refreshValidation();
  }, [refreshValidation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const handle = createGraphCanvas(container, {
      theme: themeRef.current,
      onChange: handleCanvasChange,
      checkOutputPorts: supportsCheckOutputPorts,
    });
    handle.setEdgeInspectorVisible(edgeInspectorVisibleRef.current);
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.destroy();
    };
  }, [handleCanvasChange, supportsCheckOutputPorts]);

  useEffect(() => {
    handleRef.current?.setTheme(canvasTheme);
  }, [canvasTheme]);

  // Load the graph into the canvas exactly once per graph id - later push
  // updates must never clobber in-progress edits. An unsaved working copy from
  // earlier in this session wins over the host's version: navigating away and
  // back is not a discard.
  useEffect(() => {
    if (!graph || !handleRef.current || loadedGraphId === graph.id) {
      return;
    }
    const draft = getGraphDraft(serverId, graph.id);
    const source = draft?.graph ?? graph;
    handleRef.current.loadGraph(source);
    setInputs(source.inputs ?? []);
    setDirty(draft?.dirty === true);
    setValidationProblems(validateOrchestrationGraph(source));
    setLoadedGraphId(graph.id);
  }, [graph, loadedGraphId, serverId]);

  // The node cards' "Prompt template" select is populated from the host's
  // stored templates, which can arrive before or after the graph loads -
  // re-push on either, since the canvas repopulates in place.
  useEffect(() => {
    if (templates) {
      handleRef.current?.setPromptTemplates(templates);
    }
  }, [templates, loadedGraphId]);

  const buildCurrentGraph = useCallback((): OrchestrationGraph | null => {
    if (!graph || !handleRef.current) {
      return null;
    }
    return handleRef.current.exportGraph({
      ...graph,
      inputs: inputs ?? graph.inputs ?? [],
    });
  }, [graph, inputs]);

  // Mirror every edit into the session-scoped draft so an unmount (workspace
  // switch, pane close) can't take the work with it.
  useEffect(() => {
    if (!dirty || loadedGraphId === null) {
      return;
    }
    const current = buildCurrentGraph();
    if (current) {
      setGraphDraft(serverId, current, true);
    }
  }, [dirty, revision, inputs, buildCurrentGraph, loadedGraphId, serverId]);

  const save = useCallback(async (): Promise<OrchestrationGraph | null> => {
    const current = buildCurrentGraph();
    if (!current) {
      return null;
    }
    let saved: OrchestrationGraph;
    try {
      saved = await saveGraph.mutateAsync(current);
    } catch (error) {
      toast.error(
        `Couldn't save the graph: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    setDirty(false);
    clearGraphDraft(serverId, saved.id);
    // Validation problems never block saving - a half-built graph is a normal
    // thing to save. They only gate Run. The toast stays a one-word verdict;
    // the detail of what's wrong belongs in the toolbar warnings, not here.
    const problems = validateOrchestrationGraph(saved);
    setValidationProblems(problems);
    const warnings = reviewOrchestrationGraph(saved);
    if (problems.length > 0 || warnings.length > 0) {
      toast.show("Saved - With Issues");
    } else {
      toast.show("Saved", { variant: "success" });
    }
    return saved;
  }, [buildCurrentGraph, saveGraph, serverId, toast]);

  // Run never executes from here: it saves, then hands you back to the New
  // Orchestration dialog with this graph selected, to fill in its answers and
  // finalize. A graph with open problems can't get that far.
  const runGraph = useCallback(async () => {
    const saved = await save();
    if (!saved) {
      return;
    }
    const problems = validateOrchestrationGraph(saved);
    if (problems.length > 0) {
      setValidationProblems(problems);
      toast.show(`Not ready to run · ${describeProblems(problems)}`, {
        variant: "error",
        durationMs: 4200,
      });
      return;
    }
    if (!supportsCheckOutputPorts && graphUsesExplicitCheckPorts(saved)) {
      toast.error("Update the host to run this graph's Check pass and fail branches.");
      return;
    }
    setRunPrefill({
      serverId,
      projectCwd: workspaceCwd,
      graphId: saved.id,
      ...(draftRunId ? { runId: draftRunId } : {}),
    });
  }, [save, serverId, workspaceCwd, draftRunId, supportsCheckOutputPorts, toast]);

  const addAgent = useCallback(() => {
    handleRef.current?.addAgentNode();
  }, []);
  const addGate = useCallback(() => {
    handleRef.current?.addGateNode();
  }, []);
  const addCheck = useCallback(() => {
    handleRef.current?.addCheckNode();
  }, []);

  const toggleEdgeInspector = useCallback(() => {
    const next = !edgeInspectorVisibleRef.current;
    edgeInspectorVisibleRef.current = next;
    handleRef.current?.setEdgeInspectorVisible(next);
    setEdgeInspectorVisible(next);
  }, []);

  const openInputsSheet = useCallback(() => setInputsSheetOpen(true), []);
  const closeInputsSheet = useCallback(() => setInputsSheetOpen(false), []);
  const closeRunSheet = useCallback(() => setRunPrefill(null), []);
  const handleInputsChange = useCallback(
    (next: GraphInput[]) => {
      setInputs(next);
      setDirty(true);
      // Node cards surface the declared inputs (prompt hint + the
      // prompt-from-input select) - keep them in sync live.
      handleRef.current?.setDeclaredInputs(next.map((input) => input.key));
      refreshValidation();
    },
    [refreshValidation],
  );

  if (!graphTarget) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={styles.title}>
          {graph?.name ?? "Graph designer"}
        </Text>
        {dirty ? <Text style={styles.status}>Unsaved changes</Text> : null}
        {/* Three clusters, in the order you build a graph: drop nodes onto the
            canvas, edit what the graph and its wires carry, then commit it. */}
        <View style={styles.toolbarActions}>
          <GraphToolbarButton
            renderIcon={renderAddIcon}
            label="Add agent node"
            onPress={addAgent}
            testID="graph-add-agent"
          />
          <GraphToolbarButton
            renderIcon={renderGateIcon}
            label="Add approval gate"
            onPress={addGate}
            testID="graph-add-gate"
          />
          <GraphToolbarButton
            renderIcon={renderCheckIcon}
            label="Add deterministic check"
            onPress={addCheck}
            testID="graph-add-check"
          />
          <ToolbarSeparator />
          <GraphToolbarButton
            renderIcon={renderInputsIcon}
            label="Graph inputs"
            onPress={openInputsSheet}
            testID="graph-inputs"
          />
          <EdgeInspectorToggle visible={edgeInspectorVisible} onPress={toggleEdgeInspector} />
          <ToolbarSeparator />
          <GraphToolbarButton
            renderIcon={renderSaveIcon}
            label="Save graph"
            onPress={save}
            testID="graph-save"
            disabled={
              !dirty ||
              saveGraph.isPending ||
              (!supportsCheckOutputPorts && graphRequiresCheckOutputPorts)
            }
          />
          <GraphToolbarButton
            renderIcon={renderRunIcon}
            label="Save and start new workflow"
            onPress={runGraph}
            testID="graph-run"
            disabled={!supportsCheckOutputPorts && graphRequiresCheckOutputPorts}
          />
        </View>
      </View>
      <View style={styles.canvasWrap}>
        <GraphValidationSummary
          problems={validationProblems}
          supportsCheckOutputPorts={supportsCheckOutputPorts}
          requiresCheckOutputPorts={graphRequiresCheckOutputPorts}
        />
        <CanvasEmptyState isLoading={graphsQuery.isLoading} hasGraph={graph !== null} />
        <div ref={containerRef} style={CANVAS_HOST_STYLE} />
      </View>
      {inputsSheetOpen && inputs !== null ? (
        <GraphInputsSheet
          inputs={inputs}
          onClose={closeInputsSheet}
          onChange={handleInputsChange}
        />
      ) : null}
      {runPrefill ? (
        <NewOrchestrationSheet visible onClose={closeRunSheet} prefill={runPrefill} />
      ) : null}
    </View>
  );
}

function GraphValidationSummary({
  problems,
  supportsCheckOutputPorts,
  requiresCheckOutputPorts,
}: {
  problems: readonly string[];
  supportsCheckOutputPorts: boolean;
  requiresCheckOutputPorts: boolean;
}): ReactElement | null {
  if (problems.length === 0 && (supportsCheckOutputPorts || !requiresCheckOutputPorts)) {
    return null;
  }
  return (
    <View
      style={problems.length > 0 ? styles.validationError : styles.validationNotice}
      testID="graph-validation"
    >
      <Text style={styles.validationTitle}>
        {problems.length > 0
          ? `${problems.length} issue${problems.length === 1 ? "" : "s"} to fix before running`
          : "This graph's Check pass/fail routing requires a host update"}
      </Text>
      {problems.map((problem) => (
        <Text key={problem} style={styles.validationProblem}>
          {problem}
        </Text>
      ))}
      {!supportsCheckOutputPorts ? (
        <Text style={styles.validationProblem}>
          Update the host before saving or running this graph.
        </Text>
      ) : null}
    </View>
  );
}

/** A persisted explicit Check port is a new-host contract, never a legacy edge. */
function graphUsesExplicitCheckPorts(graph: OrchestrationGraph): boolean {
  const nodeKinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  return (graph.edges ?? []).some(
    (edge) => nodeKinds.get(edge.from) === "check" && edge.fromPort !== undefined,
  );
}

/** "2 issues before it can run - <the first one>". */
function describeProblems(problems: readonly string[]): string {
  const count = `${problems.length} issue${problems.length === 1 ? "" : "s"} before it can run`;
  return problems[0] ? `${count} - ${problems[0]}` : count;
}

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentIconColor = (theme: Theme) => ({ color: theme.colors.primary });

const ThemedPlus = withUnistyles(Plus);
const ThemedCheckCircle = withUnistyles(CheckCircle);
const ThemedDataObject = withUnistyles(DataObject);
const ThemedSave = withUnistyles(Save);
const ThemedPlay = withUnistyles(PlayFilled);
const ThemedPanelRight = withUnistyles(PanelRight);
const ThemedPanelRightClose = withUnistyles(PanelRightClose);

const renderAddIcon = (size: number) => <ThemedPlus size={size} uniProps={mutedIconColor} />;
const renderGateIcon = (size: number) => (
  <ThemedCheckCircle size={size} uniProps={mutedIconColor} />
);
const renderCheckIcon = (size: number) => (
  <ThemedCheckCircle size={size} uniProps={accentIconColor} />
);
const renderInputsIcon = (size: number) => (
  <ThemedDataObject size={size} uniProps={mutedIconColor} />
);
const renderSaveIcon = (size: number) => <ThemedSave size={size} uniProps={mutedIconColor} />;
const renderRunIcon = (size: number) => <ThemedPlay size={size} uniProps={accentIconColor} />;
// Arrow direction reads as the action, not the state: pointing right tucks the
// panel back into the side of the canvas, pointing left pulls it out again.
const renderInspectorOpenIcon = (size: number) => (
  <ThemedPanelRightClose size={size} uniProps={accentIconColor} />
);
const renderInspectorClosedIcon = (size: number) => (
  <ThemedPanelRight size={size} uniProps={mutedIconColor} />
);

const toolbarButtonStyle = (
  state: PressableStateCallbackType & { hovered?: boolean },
): StyleProp<ViewStyle> => [
  styles.toolbarButton,
  (Boolean(state.hovered) || state.pressed) && styles.toolbarButtonHovered,
];

const disabledToolbarButtonStyle = (
  state: PressableStateCallbackType & { hovered?: boolean },
): StyleProp<ViewStyle> => [toolbarButtonStyle(state), styles.toolbarButtonDisabled];

/** One toolbar action: glyph only, with the label carried by a tooltip. */
function GraphToolbarButton({
  renderIcon,
  label,
  onPress,
  testID,
  disabled,
}: {
  renderIcon: (size: number) => ReactElement;
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}): ReactElement {
  const size = useIconSize().md;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        disabled={disabled}
        onPress={onPress}
        style={disabled === true ? disabledToolbarButtonStyle : toolbarButtonStyle}
      >
        {renderIcon(size)}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** Shows or hides the Edge inspector, the panel floating at the canvas's top right. */
function EdgeInspectorToggle({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <GraphToolbarButton
      renderIcon={visible ? renderInspectorOpenIcon : renderInspectorClosedIcon}
      label={visible ? "Hide edge inspector" : "Show edge inspector"}
      onPress={onPress}
      testID="graph-toggle-edge-inspector"
    />
  );
}

function CanvasEmptyState({
  isLoading,
  hasGraph,
}: {
  isLoading: boolean;
  hasGraph: boolean;
}): ReactElement | null {
  if (hasGraph) {
    return null;
  }
  return (
    <View style={styles.loading}>
      {isLoading ? <LoadingSpinner size="large" /> : null}
      <Text style={styles.loadingText}>
        {isLoading ? "Loading graph..." : "This graph no longer exists on the host."}
      </Text>
    </View>
  );
}

// Declared inputs editor - the graph's fill-in parameters, rendered as a form
// by the New Orchestration dialog when this graph is picked. Rows get local
// synthetic uids so React keys survive key-field edits and reorders.
interface GraphInputRowState {
  uid: string;
  input: GraphInput;
}

let nextInputRowUid = 0;

function toRowStates(inputs: GraphInput[]): GraphInputRowState[] {
  return inputs.map((input) => ({ uid: `row-${++nextInputRowUid}`, input }));
}

function GraphInputsSheet({
  inputs,
  onClose,
  onChange,
}: {
  inputs: GraphInput[];
  onClose: () => void;
  onChange: (inputs: GraphInput[]) => void;
}): ReactElement {
  const [rows, setRows] = useState<GraphInputRowState[]>(() => toRowStates(inputs));

  // A setState updater runs in React's render phase, so onChange (which writes
  // the panel's own state) must never be called from inside one. Rows only ever
  // change through applyRows, so this ref stays the authoritative latest value
  // and keeps the row callbacks stable across renders.
  const rowsRef = useRef(rows);

  const applyRows = useCallback(
    (compute: (previous: GraphInputRowState[]) => GraphInputRowState[]) => {
      const next = compute(rowsRef.current);
      rowsRef.current = next;
      setRows(next);
      onChange(next.map((row) => row.input));
    },
    [onChange],
  );

  const handlePatch = useCallback(
    (uid: string, patch: Partial<GraphInput>) => {
      applyRows((previous) =>
        previous.map((row) =>
          row.uid === uid ? { ...row, input: { ...row.input, ...patch } } : row,
        ),
      );
    },
    [applyRows],
  );

  const handleRemove = useCallback(
    (uid: string) => {
      applyRows((previous) => previous.filter((row) => row.uid !== uid));
    },
    [applyRows],
  );

  const handleAdd = useCallback(() => {
    applyRows((previous) => [
      ...previous,
      {
        uid: `row-${++nextInputRowUid}`,
        input: { key: `input${previous.length + 1}`, label: "New input" },
      },
    ]);
  }, [applyRows]);

  const header = useMemo(() => ({ title: "Graph inputs" }), []);

  const footer = useMemo(
    () => (
      <View style={styles.inputsFooter}>
        <Button variant="outline" style={styles.inputsFooterButton} onPress={handleAdd}>
          Add input
        </Button>
        <Button variant="default" style={styles.inputsFooterButton} onPress={onClose}>
          Done
        </Button>
      </View>
    ),
    [handleAdd, onClose],
  );

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} footer={footer}>
      <View style={styles.inputsBody}>
        {rows.length === 0 ? (
          <Text style={styles.inputsEmpty}>
            No inputs yet. Nodes reference inputs as {"{{inputs.key}}"} in their prompts, or bind
            one via prompt-from-input on the node.
          </Text>
        ) : null}
        {rows.map((row) => (
          <GraphInputRow key={row.uid} row={row} onPatch={handlePatch} onRemove={handleRemove} />
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

function GraphInputRow({
  row,
  onPatch,
  onRemove,
}: {
  row: GraphInputRowState;
  onPatch: (uid: string, patch: Partial<GraphInput>) => void;
  onRemove: (uid: string) => void;
}): ReactElement {
  const handleKeyChange = useCallback(
    (value: string) => onPatch(row.uid, { key: value.trim() }),
    [onPatch, row.uid],
  );
  const handleLabelChange = useCallback(
    (value: string) => onPatch(row.uid, { label: value }),
    [onPatch, row.uid],
  );
  const handleMultilineChange = useCallback(
    (value: boolean) => onPatch(row.uid, { multiline: value }),
    [onPatch, row.uid],
  );
  const handleRequiredChange = useCallback(
    (value: boolean) => onPatch(row.uid, { required: value }),
    [onPatch, row.uid],
  );
  const handleRemovePress = useCallback(() => onRemove(row.uid), [onRemove, row.uid]);

  return (
    <View style={styles.inputRow}>
      <View style={styles.inputRowFields}>
        <View style={styles.inputRowField}>
          <Field label="Key">
            {/* AdaptiveTextInput renders uncontrolled from initialValue (RN
                flicker workaround) - omitting it shows an EMPTY field even
                when data exists. Rows are uid-keyed, so the one-shot seed is
                correct per mount. */}
            <FormTextInput
              initialValue={row.input.key}
              onChangeText={handleKeyChange}
              autoCapitalize="none"
              size="sm"
            />
          </Field>
        </View>
        <View style={styles.inputRowField}>
          <Field label="Label">
            <FormTextInput
              initialValue={row.input.label}
              onChangeText={handleLabelChange}
              size="sm"
            />
          </Field>
        </View>
      </View>
      <View style={styles.inputRowMeta}>
        <View style={styles.inputToggle}>
          <Text style={styles.inputToggleLabel}>Multiline</Text>
          <Switch value={row.input.multiline === true} onValueChange={handleMultilineChange} />
        </View>
        <View style={styles.inputToggle}>
          <Text style={styles.inputToggleLabel}>Required</Text>
          <Switch value={row.input.required === true} onValueChange={handleRequiredChange} />
        </View>
        <Button size="sm" variant="ghost" onPress={handleRemovePress}>
          Remove
        </Button>
      </View>
    </View>
  );
}

export const OrchestrationGraphPanel = withUnistyles(OrchestrationGraphPanelInner, (theme) => ({
  canvasTheme: buildGraphCanvasTheme(theme),
}));

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // Icon-only actions keep this to a single compact row - the canvas is the
  // point of this tab, not its chrome.
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    // Border-box, so this is the whole row including its rule. Left to its
    // content this came to 35px (a 26px button plus 4px of padding either
    // side); pin it to the shared pane-toolbar geometry instead.
    minHeight: PANE_TOOLBAR_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: { xs: 32, sm: 32, md: 26 },
    height: { xs: 32, sm: 32, md: 26 },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  toolbarButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  toolbarButtonDisabled: {
    opacity: 0.4,
    backgroundColor: "transparent",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    flexShrink: 1,
  },
  status: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  toolbarActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
  canvasWrap: {
    flex: 1,
    overflow: "hidden",
  },
  validationError: {
    position: "absolute",
    top: theme.spacing[3],
    left: theme.spacing[3],
    zIndex: 2,
    maxWidth: 460,
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.statusDanger,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.statusDangerSurface,
  },
  validationNotice: {
    position: "absolute",
    top: theme.spacing[3],
    left: theme.spacing[3],
    zIndex: 2,
    maxWidth: 460,
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.statusWarning,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.statusWarningSurface,
  },
  validationTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  validationProblem: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    zIndex: 1,
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  inputsBody: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  inputsEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.5),
  },
  inputRow: {
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  inputRowFields: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  inputRowField: {
    flex: 1,
  },
  inputRowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  inputToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputToggleLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  inputsFooter: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  inputsFooterButton: {
    flex: 1,
  },
}));
