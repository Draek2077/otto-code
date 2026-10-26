import { ContextSummary, ContextPreviewPane, ContextReadStatus } from "./report-view";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ContextTree } from "./tree";
import { styles } from "./styles";

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
  const [selection, setSelection] = useState<{
    nodeId: string | null;
    category: import("@getpaseo/plugin/otto/context-management").ContextCategory | null;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [reviewEpoch, setReviewEpoch] = useState(0);
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
    queryKey: ["ottoContextPreview", scope, report.data?.revision, selection],
    enabled: active && Boolean(selection) && Boolean(report.data) && !report.error,
    retry: false,
    queryFn: async () => {
      if (!selection || !report.data) throw new Error("Select a context source first.");
      const result = await readPreview({ ...scope, ...selection, revision: report.data.revision });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const { refetch: refetchReport } = report;
  const refresh = useCallback(async () => {
    const result = await refetchReport();
    if (result.isSuccess) setReviewEpoch((value) => value + 1);
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
  return (
    <>
      <SettingsSection
        title="Context Management"
        info="Fixed occupancy is different from conversation usage or spend. Exact text still uses an estimated token count; provider-hidden inputs are unknown, never zero."
      >
        <SettingsCard>
          <SettingsSelect
            label="Inspect"
            value={agentId}
            options={options}
            onValueChange={chooseAgent}
          />
          <SettingsSelect
            label="Window for budget estimate"
            value={windowTokens}
            options={windows}
            onValueChange={chooseWindow}
          />
        </SettingsCard>
        <View style={styles.actions}>
          <Button variant="outline" size="sm" onPress={refresh} disabled={report.isFetching}>
            {report.isFetching ? "Refreshing..." : "Refresh context"}
          </Button>
        </View>
      </SettingsSection>
      <ContextReadStatus
        notice={notice}
        agentError={agents.error}
        error={report.error}
        loading={report.isLoading}
      />
      {contentVisible && report.data ? (
        <>
          <ContextSummary report={report.data} />
          <View style={compact ? styles.compact : styles.split}>
            {!compact || !selection ? (
              <View style={styles.tree}>
                <ContextTree
                  key={reviewEpoch}
                  report={report.data}
                  scope={scope}
                  active={active}
                  onSelect={chooseSource}
                  onChanged={changed}
                />
              </View>
            ) : null}
            {!compact || selection ? (
              <View style={styles.detail}>
                {compact && selection ? (
                  <Button variant="outline" size="sm" onPress={back}>
                    Back to context
                  </Button>
                ) : null}
                <ContextPreviewPane
                  preview={preview.data}
                  error={preview.error}
                  fetching={preview.isFetching}
                  selected={Boolean(selection)}
                />
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </>
  );
}
function ContextFrame({ hostId, workspaceId }: { hostId: string; workspaceId: string }) {
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      testID="otto-context-management"
    >
      <ContextBody
        key={`${hostId}/${workspaceId}`}
        hostId={hostId}
        workspaceId={workspaceId}
        active={retained && visible}
      />
    </ScrollView>
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
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      testID="otto-context-management-screen"
    >
      <SettingsSelect
        label="Workspace"
        value={selected}
        options={options}
        onValueChange={setSelected}
      />
      {workspaces.error ? (
        <Alert variant="error" description="Workspaces could not be read from this host." />
      ) : null}
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
    </ScrollView>
  );
}
