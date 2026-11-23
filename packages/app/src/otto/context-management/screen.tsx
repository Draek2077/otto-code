import {
  ContextSummary,
  ContextReadStatus,
  ContextWriteFeedback,
  ContextControls,
} from "./report-view";
import { ProfileMemoryPane, ProfileMemorySelector } from "../agent-profiles/memory-pane";
import { useHostFeature } from "@/runtime/host-features";
import { Button } from "@/components/ui/button";
import { ContextLayout } from "./layout";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ScrollView, View } from "react-native";
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
import { SettingsRow } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ContextTree } from "./tree";
import { styles } from "./styles";
import { FeatureScopeSelect, featureBrowserStyles } from "../ui/feature-browser";
import { ContextEdgeEdit } from "./edge-edit";
import type { ContextSourceSelection } from "./selection";
import { ContextSourceDrafts } from "./source-model";
import { ContextSelectedDetail } from "./source-detail";
import { ContextCompactionGate } from "./compaction";
import { ContextStarterGate } from "./starter";
import { needsContextStarter } from "./starter-model";

const windows = [16384, 32768, 65536, 131072, 200000, 1000000].map((value) => ({
  value: String(value),
  label: value.toLocaleString() + " tokens",
}));
function ContextReportBody({
  hostId,
  workspaceId,
  active,
  profileId,
  profileSelector,
}: {
  hostId: string;
  workspaceId: string;
  active: boolean;
  profileId?: string;
  profileSelector?: React.ReactNode;
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
    () => ({
      hostId,
      workspaceId,
      agentId: agentId || null,
      windowTokens: Number(windowTokens),
      ...(!agentId && profileId ? { profileId } : {}),
    }),
    [hostId, workspaceId, agentId, windowTokens, profileId],
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
        active={active}
        agentId={agentId}
        windowTokens={windowTokens}
        options={options}
        profileSelector={agentId ? undefined : profileSelector}
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
    <ContextStarterGate
      selected={selection !== null}
      ready={contentVisible}
      report={report.data}
      scope={scope}
      active={active}
      writeModel={writeModel}
      writeState={writeState}
      onChanged={changed}
    >
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
    </ContextStarterGate>
  ) : null;
  const layout = (
    <ContextLayout
      compact={compact}
      header={controls}
      tree={!compact || !selection ? tree : null}
      detail={!compact || selection || needsContextStarter(report.data) ? detail : null}
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
function ContextBody(props: { hostId: string; workspaceId: string; active: boolean }) {
  const supported = useHostFeature(props.hostId, "ottoProfileMemory");
  const [profileId, select] = useState("");
  const selector = useMemo(
    () => <ProfileMemorySelector hostId={props.hostId} profileId={profileId} select={select} />,
    [props.hostId, profileId],
  );
  const [memory, setMemory] = useState(false);
  const showMemory = useCallback(() => setMemory(true), []);
  const showReport = useCallback(() => setMemory(false), []);
  if (!supported) return <ContextReportBody {...props} />;
  return (
    <View style={styles.page}>
      <View style={styles.actions}>
        <Button size="sm" variant={memory ? "ghost" : "outline"} onPress={showReport}>
          Context
        </Button>
        <Button size="sm" variant={memory ? "outline" : "ghost"} onPress={showMemory}>
          Memory
        </Button>
      </View>
      <View style={memory ? styles.hidden : styles.page}>
        <ContextReportBody
          {...props}
          active={props.active && !memory}
          profileId={profileId}
          profileSelector={selector}
        />
      </View>
      {memory && props.active ? (
        <ScrollView contentContainerStyle={styles.content}>
          {selector}
          <ProfileMemoryPane
            hostId={props.hostId}
            workspaceId={props.workspaceId}
            profileId={profileId}
          />
        </ScrollView>
      ) : null}
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
      <View style={featureBrowserStyles.toolbar}>
        <FeatureScopeSelect
          label="Workspace"
          value={selected}
          options={options}
          onChange={setSelected}
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
