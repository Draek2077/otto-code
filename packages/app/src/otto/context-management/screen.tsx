import {
  ContextSummary,
  ContextReadStatus,
  ContextWriteFeedback,
  ContextControls,
} from "./report-view";
import { ContextLayout } from "./layout";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { View } from "react-native";
import {
  usePaseo,
  useRpc,
  type PluginWorkspacePanelProps,
  type PluginScreenProps,
} from "@getpaseo/plugin/client";
import {
  readContextAgents,
  readContextReport,
  readContextPreview,
  type ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import { useFetchQuery } from "@/data/query";
import { SettingsRow, SettingsSelect } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ContextTree } from "./tree";
import { styles } from "./styles";
import { ContextEdgeEdit } from "./edge-edit";
import type { ContextSourceSelection } from "./selection";
import { ContextSourceDrafts } from "./source-model";
import { ContextSelectedDetail } from "./source-detail";
import { ContextCompactionGate } from "./compaction";

const windows = [16384, 32768, 65536, 131072, 200000, 1000000].map((value) => ({
  value: String(value),
  label: value.toLocaleString() + " tokens",
}));
function ContextBody({
  hostId,
  workspaceId,
  active,
}: {
  hostId: string;
  workspaceId: string;
  active: boolean;
}) {
  const readAgents = useRpc(readContextAgents);
  const readReport = useRpc(readContextReport);
  const readPreview = useRpc(readContextPreview);
  const [agentId, setAgentId] = useState("");
  const [windowTokens, setWindowTokens] = useState("200000");
  const [selection, setSelection] = useState<ContextSourceSelection | null>(null);
  const [notice, setNotice] = useState("");
  const [reviewEpoch, setReviewEpoch] = useState(0);
  const [writeModel, setWriteModel] = useState(() => new ContextEdgeEdit());
  const [sourceDrafts] = useState(() => new ContextSourceDrafts());
  const [compactionTarget, setCompactionTarget] = useState<string | null>(null);
  const closeCompaction = useCallback(() => setCompactionTarget(null), []);
  const writeState = useSyncExternalStore(
    writeModel.subscribe,
    writeModel.getSnapshot,
    writeModel.getSnapshot,
  );
  const compaction = useMemo(
    () => ({
      disabled: !active || writeState.busy || writeState.blocked || !selection?.nodeId,
      open() {
        if (selection?.nodeId) setCompactionTarget(selection.nodeId);
      },
    }),
    [active, selection, writeState.busy, writeState.blocked],
  );
  useLayoutEffect(() => (active ? writeModel.activate() : undefined), [active, writeModel]);
  const compact = useIsCompactFormFactor();
  const scope = useMemo<ContextSelection>(
    () => ({ hostId, workspaceId, agentId: agentId || null, windowTokens: Number(windowTokens) }),
    [hostId, workspaceId, agentId, windowTokens],
  );
  const agents = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 1000,
    queryKey: ["ottoContextAgents", hostId, workspaceId],
    enabled: active,
    retry: false,
    refetchInterval: active ? 10000 : false,
    queryFn: async () => {
      const result = await readAgents({ hostId, workspaceId });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const report = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoContextReport", scope],
    enabled: active,
    retry: false,
    refetchInterval: active ? 10000 : false,
    queryFn: async () => {
      const result = await readReport(scope);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  useEffect(() => {
    if (
      selection?.nodeId &&
      report.data &&
      !report.error &&
      !report.data.nodes.some((node) => node.id === selection.nodeId)
    ) {
      setSelection(null);
      setNotice("The selected source is no longer available. Choose another context source.");
    }
  }, [report.data, report.error, selection]);
  const chooseSource = useCallback((value: typeof selection) => {
    setNotice("");
    setSelection(value);
  }, []);
  const options = useMemo(
    () => [
      { value: "", label: "Current Otto instructions (not sent)" },
      ...(agents.data ?? []).map((agent) => ({
        value: agent.id,
        label: `${agent.label} (${agent.provider})`,
      })),
    ],
    [agents.data],
  );
  const preview = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: [
      "ottoContextPreview",
      scope,
      report.data?.revision,
      selection?.nodeId,
      selection?.category,
    ],
    enabled: active && Boolean(selection) && Boolean(report.data) && !report.error,
    retry: false,
    queryFn: async () => {
      if (!selection || !report.data) throw new Error("Select a context source first.");
      const result = await readPreview({
        ...scope,
        nodeId: selection.nodeId,
        category: selection.category,
        revision: report.data.revision,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch: refetchReport } = report;
  const refresh = useCallback(async () => {
    const result = await refetchReport();
    if (result.isSuccess) {
      setWriteModel(new ContextEdgeEdit());
      setReviewEpoch((value) => value + 1);
    }
  }, [refetchReport]);
  const changed = useCallback(() => {
    void refetchReport();
  }, [refetchReport]);
  const chooseAgent = useCallback((value: string) => {
    setSelection(null);
    setAgentId(value);
  }, []);
  const chooseWindow = useCallback((value: string) => {
    setSelection(null);
    setWindowTokens(value);
  }, []);
  const back = useCallback(() => setSelection(null), []);
  const contentVisible = report.status === "success";
  const controls = (
    <>
      <ContextControls
        agentId={agentId}
        windowTokens={windowTokens}
        options={options}
        windows={windows}
        chooseAgent={chooseAgent}
        chooseWindow={chooseWindow}
        refresh={refresh}
        fetching={report.isFetching}
        busy={writeState.busy}
        compaction={compaction}
      />
      <ContextReadStatus
        notice={notice}
        agentError={agents.error}
        error={report.error}
        loading={report.isLoading}
      />
      {contentVisible && report.data ? <ContextSummary report={report.data} /> : null}
    </>
  );
  const tree =
    contentVisible && report.data ? (
      <ContextTree
        key={reviewEpoch}
        report={report.data}
        scope={scope}
        active={active}
        onSelect={chooseSource}
        onChanged={changed}
        writeModel={writeModel}
        writeState={writeState}
      />
    ) : null;
  const detail = contentVisible ? (
    <ContextSelectedDetail
      compact={compact}
      selection={selection}
      onBack={back}
      preview={preview.data}
      error={preview.error}
      fetching={preview.isFetching}
      scope={scope}
      drafts={sourceDrafts}
      active={active}
      writeModel={writeModel}
      writeState={writeState}
      onChanged={changed}
    />
  ) : null;
  const layout = (
    <ContextLayout
      compact={compact}
      header={controls}
      tree={!compact || !selection ? tree : null}
      detail={!compact || selection ? detail : null}
    />
  );
  return (
    <View style={styles.page}>
      <ContextWriteFeedback state={writeState} />
      <ContextCompactionGate
        scope={scope}
        selectedId={compactionTarget}
        report={report.data}
        active={active}
        writeModel={writeModel}
        writeState={writeState}
        onClose={closeCompaction}
        onChanged={changed}
        onReviewed={refresh}
      >
        {layout}
      </ContextCompactionGate>
    </View>
  );
}
function ContextFrame({ hostId, workspaceId }: { hostId: string; workspaceId: string }) {
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  return (
    <View style={styles.page} testID="otto-context-management">
      <ContextBody
        key={`${hostId}/${workspaceId}`}
        hostId={hostId}
        workspaceId={workspaceId}
        active={retained && visible}
      />
    </View>
  );
}
export function ContextManagementWorkspace(props: PluginWorkspacePanelProps) {
  return <ContextFrame hostId={props.host.id} workspaceId={props.workspaceId} />;
}
export function ContextManagementScreen(props: PluginScreenProps) {
  const paseo = usePaseo();
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const active = retained && visible;
  const [selected, setSelected] = useState(props.params.workspaceId ?? "");
  const workspaces = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 1000,
    queryKey: ["ottoContextWorkspaces", props.host.id],
    enabled: active,
    retry: false,
    queryFn: async () => (await paseo.workspaces.list()).entries,
  });
  const options = useMemo(
    () => [
      { value: "", label: "Choose a workspace" },
      ...(workspaces.data ?? []).map((workspace) => ({
        value: workspace.id,
        label: workspace.name ?? workspace.id,
      })),
    ],
    [workspaces.data],
  );
  return (
    <View style={styles.page} testID="otto-context-management-screen">
      <View style={styles.chooser}>
        <SettingsSelect
          label="Workspace"
          value={selected}
          options={options}
          onValueChange={setSelected}
        />
        {workspaces.error ? (
          <Alert variant="error" description="Workspaces could not be read from this host." />
        ) : null}
      </View>
      {selected ? (
        <ContextBody
          key={`${props.host.id}/${selected}`}
          hostId={props.host.id}
          workspaceId={selected}
          active={active}
        />
      ) : (
        <SettingsRow label="Select the workspace whose context you want to inspect." />
      )}
    </View>
  );
}
