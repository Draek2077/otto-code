import { useCallback, useState } from "react";
import { View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsButton, SettingsCard, SettingsRow } from "@getpaseo/plugin/client/ui";
import { getBoard } from "../shared/rpc.js";
import { BoardView } from "./board-view.js";
import type { ProjectChoice } from "./project-selection.js";
import { useRead } from "./use-read.js";

const actionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
const panelStyle = { flex: 1, gap: 12 } as const;

export function BoardPanel({
  project,
  host,
  layout,
  theme,
  navigation,
}: {
  project: ProjectChoice;
  host: PluginScreenProps["host"];
  layout: PluginScreenProps["layout"];
  theme: PluginScreenProps["theme"];
  navigation: PluginScreenProps["navigation"];
}) {
  const read = useRpc(getBoard);
  const [refresh, setRefresh] = useState(0);
  const refreshBoard = useCallback(() => setRefresh((value) => value + 1), []);
  const load = useCallback(
    () => read({ hostId: host.id, projectId: project.projectId }),
    [read, host.id, project.projectId],
  );
  const state = useRead({
    key: JSON.stringify([host.id, project.projectId, refresh]),
    enabled: true,
    load,
    errorMessage: "The board could not be read from the selected host.",
  });
  const openProjectSettings = navigation?.openProjectSettings;
  const openSettings = useCallback(() => {
    openProjectSettings?.({ serverId: host.id, projectId: project.projectId });
  }, [openProjectSettings, host.id, project.projectId]);
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
        {openProjectSettings ? (
          <SettingsButton variant="outline" onPress={openSettings}>
            Project Settings
          </SettingsButton>
        ) : null}
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
          {openProjectSettings ? (
            <SettingsButton onPress={openSettings}>Open Project Settings</SettingsButton>
          ) : null}
        </SettingsCard>
      ) : null}
      {board?.status === "ready" ? (
        <BoardView board={board.board} layout={layout} theme={theme} />
      ) : null}
    </View>
  );
}
