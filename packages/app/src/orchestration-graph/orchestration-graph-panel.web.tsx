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
  validateOrchestrationGraph,
  type GraphInput,
  type OrchestrationGraph,
} from "@otto-code/protocol/orchestration";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { DataObject, Plus, PlayFilled, Save } from "@/components/icons/material-icons";
import {
  NewOrchestrationSheet,
  type NewOrchestrationPrefill,
} from "@/components/orchestration/new-orchestration-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import {
  useOrchestrationGraphs,
  useSaveOrchestrationGraph,
} from "@/hooks/use-orchestration-graphs";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { useIconSize, type Theme } from "@/styles/theme";
import { buildGraphCanvasTheme, type GraphCanvasTheme } from "./graph-canvas-theme";
import { createGraphCanvas, type GraphCanvasHandle } from "./graph-canvas";
import { clearGraphDraft, getGraphDraft, setGraphDraft } from "./graph-draft-store";

// The graph designer tab (web + Electron): toolbar on top, separator, and the
// Drawflow canvas ported from Draekz Forge underneath. Mobile/native gets the
// placeholder in orchestration-graph-panel.tsx — the dialog + execute flow is
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

  const graphsQuery = useOrchestrationGraphs(serverId);
  const graph = useMemo(
    () => (graphsQuery.data ?? []).find((candidate) => candidate.id === graphId) ?? null,
    [graphsQuery.data, graphId],
  );
  const saveGraph = useSaveOrchestrationGraph(serverId);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GraphCanvasHandle | null>(null);
  const themeRef = useRef(canvasTheme);
  themeRef.current = canvasTheme;

  const toast = useToast();
  const [dirty, setDirty] = useState(false);
  const [inputs, setInputs] = useState<GraphInput[] | null>(null);
  const [inputsSheetOpen, setInputsSheetOpen] = useState(false);
  const [runPrefill, setRunPrefill] = useState<NewOrchestrationPrefill | null>(null);
  const [loadedGraphId, setLoadedGraphId] = useState<string | null>(null);

  // Bumped by every edit. `dirty` alone can't drive the draft mirror below —
  // it flips true once and then stops changing, so only the first edit would
  // ever be captured.
  const [revision, setRevision] = useState(0);

  const handleCanvasChange = useCallback(() => {
    setDirty(true);
    setRevision((previous) => previous + 1);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const handle = createGraphCanvas(container, {
      theme: themeRef.current,
      onChange: handleCanvasChange,
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.destroy();
    };
  }, [handleCanvasChange]);

  useEffect(() => {
    handleRef.current?.setTheme(canvasTheme);
  }, [canvasTheme]);

  // Load the graph into the canvas exactly once per graph id — later push
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
    setLoadedGraphId(graph.id);
  }, [graph, loadedGraphId, serverId]);

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
    // Validation problems never block saving — a half-built graph is a normal
    // thing to save. They only gate Run, and they report as a warning toast
    // rather than sitting in the toolbar looking like a failure.
    const problems = validateOrchestrationGraph(saved);
    if (problems.length > 0) {
      toast.show(`Saved · ${describeProblems(problems)}`, { durationMs: 4200 });
    } else {
      toast.show("Saved", { variant: "success" });
    }
    return saved;
  }, [buildCurrentGraph, saveGraph, serverId, toast]);

  // The dialog thinks in project targets (cwd), so hand it this workspace's
  // directory to resolve the target from.
  const workspaceCwd = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces.get(workspaceId)?.workspaceDirectory ?? "",
  );

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
      toast.show(`Not ready to run · ${describeProblems(problems)}`, {
        variant: "error",
        durationMs: 4200,
      });
      return;
    }
    setRunPrefill({
      serverId,
      projectCwd: workspaceCwd,
      graphId: saved.id,
      ...(draftRunId ? { runId: draftRunId } : {}),
    });
  }, [save, serverId, workspaceCwd, draftRunId, toast]);

  const addAgent = useCallback(() => {
    handleRef.current?.addAgentNode();
  }, []);

  const openInputsSheet = useCallback(() => setInputsSheetOpen(true), []);
  const closeInputsSheet = useCallback(() => setInputsSheetOpen(false), []);
  const closeRunSheet = useCallback(() => setRunPrefill(null), []);
  const handleInputsChange = useCallback((next: GraphInput[]) => {
    setInputs(next);
    setDirty(true);
    // Node cards surface the declared inputs (prompt hint + the
    // prompt-from-input select) — keep them in sync live.
    handleRef.current?.setDeclaredInputs(next.map((input) => input.key));
  }, []);

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
        <View style={styles.toolbarActions}>
          <GraphToolbarButton
            renderIcon={renderAddIcon}
            label="Add agent node"
            onPress={addAgent}
            testID="graph-add-agent"
          />
          <GraphToolbarButton
            renderIcon={renderInputsIcon}
            label="Graph inputs"
            onPress={openInputsSheet}
            testID="graph-inputs"
          />
          <GraphToolbarButton
            renderIcon={renderSaveIcon}
            label="Save graph"
            onPress={save}
            testID="graph-save"
            disabled={saveGraph.isPending}
          />
          <GraphToolbarButton
            renderIcon={renderRunIcon}
            label="Save and set up the orchestration"
            onPress={runGraph}
            testID="graph-run"
          />
        </View>
      </View>
      <View style={styles.canvasWrap}>
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

/** "2 issues before it can run — <the first one>". */
function describeProblems(problems: readonly string[]): string {
  const count = `${problems.length} issue${problems.length === 1 ? "" : "s"} before it can run`;
  return problems[0] ? `${count} — ${problems[0]}` : count;
}

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentIconColor = (theme: Theme) => ({ color: theme.colors.primary });

const ThemedPlus = withUnistyles(Plus);
const ThemedDataObject = withUnistyles(DataObject);
const ThemedSave = withUnistyles(Save);
const ThemedPlay = withUnistyles(PlayFilled);

const renderAddIcon = (size: number) => <ThemedPlus size={size} uniProps={mutedIconColor} />;
const renderInputsIcon = (size: number) => (
  <ThemedDataObject size={size} uniProps={mutedIconColor} />
);
const renderSaveIcon = (size: number) => <ThemedSave size={size} uniProps={mutedIconColor} />;
const renderRunIcon = (size: number) => <ThemedPlay size={size} uniProps={accentIconColor} />;

const toolbarButtonStyle = (
  state: PressableStateCallbackType & { hovered?: boolean },
): StyleProp<ViewStyle> => [
  styles.toolbarButton,
  (Boolean(state.hovered) || state.pressed) && styles.toolbarButtonHovered,
];

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
        style={toolbarButtonStyle}
      >
        {renderIcon(size)}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
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
      <Text style={styles.loadingText}>
        {isLoading ? "Loading graph…" : "This graph no longer exists on the host."}
      </Text>
    </View>
  );
}

// Declared inputs editor — the graph's fill-in parameters, rendered as a form
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

  const handlePatch = useCallback(
    (uid: string, patch: Partial<GraphInput>) => {
      setRows((previous) => {
        const next = previous.map((row) =>
          row.uid === uid ? { ...row, input: { ...row.input, ...patch } } : row,
        );
        onChange(next.map((row) => row.input));
        return next;
      });
    },
    [onChange],
  );

  const handleRemove = useCallback(
    (uid: string) => {
      setRows((previous) => {
        const next = previous.filter((row) => row.uid !== uid);
        onChange(next.map((row) => row.input));
        return next;
      });
    },
    [onChange],
  );

  const handleAdd = useCallback(() => {
    setRows((previous) => {
      const next = [
        ...previous,
        {
          uid: `row-${++nextInputRowUid}`,
          input: { key: `input${previous.length + 1}`, label: "New input" },
        },
      ];
      onChange(next.map((row) => row.input));
      return next;
    });
  }, [onChange]);

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
                flicker workaround) — omitting it shows an EMPTY field even
                when data exists. Rows are uid-keyed, so the one-shot seed is
                correct per mount. */}
            <FormTextInput
              initialValue={row.input.key}
              value={row.input.key}
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
              value={row.input.label}
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
  // Icon-only actions keep this to a single compact row — the canvas is the
  // point of this tab, not its chrome.
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
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
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
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
