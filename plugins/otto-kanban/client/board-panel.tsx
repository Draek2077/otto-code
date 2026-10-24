import { useCallback, useState } from "react";
import { View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsButton, SettingsCard, SettingsRow } from "@getpaseo/plugin/client/ui";
import type { ProjectConfiguration } from "../shared/model.js";
import { getBoard, getProjectConfiguration } from "../shared/rpc.js";
import { BoardView } from "./board-view.js";
import type { ProjectChoice } from "./project-selection.js";
import { TargetForm } from "./target-form-view.js";
import { useRead } from "./use-read.js";

const actionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
const panelStyle = { flex: 1, gap: 12 } as const;

function SettingsEditor({
  hostId,
  projectId,
  onSaved,
  onCancel,
}: {
  hostId: string;
  projectId: string;
  onSaved(configuration: ProjectConfiguration): void;
  onCancel(): void;
}) {
  const read = useRpc(getProjectConfiguration);
  const [retry, setRetry] = useState(0);
  const retrySettings = useCallback(() => setRetry((value) => value + 1), []);
  const load = useCallback(() => read({ hostId, projectId }), [read, hostId, projectId]);
  const state = useRead({
    key: `${hostId}/${projectId}/${retry}`,
    enabled: true,
    load,
    errorMessage: "Project Settings could not be loaded from the selected host.",
  });
  if (state.status === "ready" && state.value.ok)
    return (
      <TargetForm
        key={`${hostId}/${projectId}/${state.value.value.settingsRevision}`}
        snapshot={state.value.value}
        onSaved={onSaved}
        onCancel={onCancel}
        onReload={retrySettings}
      />
    );
  let error = "";
  if (state.status === "error") error = state.message;
  else if (state.status === "ready" && !state.value.ok) error = state.value.error.message;
  return (
    <SettingsCard>
      <SettingsRow
        label={error ? "Project Settings unavailable" : "Loading Project Settings..."}
        error={error || null}
      />
      <View style={actionsStyle}>
        {error ? <SettingsButton onPress={retrySettings}>Retry</SettingsButton> : null}
        <SettingsButton variant="outline" onPress={onCancel}>
          Back to board
        </SettingsButton>
      </View>
    </SettingsCard>
  );
}

export function BoardPanel({
  project,
  host,
  layout,
  theme,
  onEditingChange,
}: {
  project: ProjectChoice;
  host: PluginScreenProps["host"];
  layout: PluginScreenProps["layout"];
  theme: PluginScreenProps["theme"];
  onEditingChange(editing: boolean): void;
}) {
  const read = useRpc(getBoard);
  const [refresh, setRefresh] = useState(0);
  const refreshBoard = useCallback(() => setRefresh((value) => value + 1), []);
  const [editing, setEditing] = useState(false);
  const load = useCallback(
    () => read({ hostId: host.id, projectId: project.projectId }),
    [read, host.id, project.projectId],
  );
  const state = useRead({
    key: `${host.id}/${project.projectId}/${refresh}`,
    enabled: !editing,
    load,
    errorMessage: "The board could not be read from the selected host.",
  });
  const openSettings = useCallback(() => {
    setEditing(true);
    onEditingChange(true);
  }, [onEditingChange]);
  const closeSettings = useCallback(() => {
    setEditing(false);
    onEditingChange(false);
  }, [onEditingChange]);
  const saved = useCallback(() => {
    setEditing(false);
    onEditingChange(false);
    setRefresh((value) => value + 1);
  }, [onEditingChange]);
  if (editing)
    return (
      <SettingsEditor
        hostId={host.id}
        projectId={project.projectId}
        onSaved={saved}
        onCancel={closeSettings}
      />
    );
  const board = state.status === "ready" ? state.value : null;
  let error = "";
  if (state.status === "error") error = state.message;
  else if (board?.status === "error") error = board.error.message;
  return (
    <View style={panelStyle}>
      <View style={actionsStyle}>
        <SettingsButton onPress={refreshBoard} disabled={state.status === "loading"}>
          {state.status === "loading" ? "Refreshing..." : "Refresh"}
        </SettingsButton>
        <SettingsButton variant="outline" onPress={openSettings}>
          Project Settings
        </SettingsButton>
      </View>
      {state.status === "loading" ? <SettingsRow label="Loading board..." /> : null}
      {error ? (
        <SettingsCard>
          <SettingsRow label="Board unavailable" error={error} />
        </SettingsCard>
      ) : null}
      {board?.status === "unconfigured" ? (
        <SettingsCard>
          <SettingsRow label={`No board is configured for ${project.projectDisplayName}.`} />
          <SettingsButton onPress={openSettings}>Open Project Settings</SettingsButton>
        </SettingsCard>
      ) : null}
      {board?.status === "ready" ? (
        <BoardView board={board.board} layout={layout} theme={theme} />
      ) : null}
    </View>
  );
}
