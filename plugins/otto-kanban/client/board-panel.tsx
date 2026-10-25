import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsButton, SettingsCard, SettingsRow } from "@getpaseo/plugin/client/ui";
import { getEditableBoard, mutateBoard, getJiraCreateOptions } from "../shared/rpc.js";
import type { ReadJiraCreation } from "./jira-creation-draft.js";
import type { ActionMode, BoardActionModel } from "./action-form.js";
import { newBoardOperationId } from "./action-form.js";
import type { BoardActionDrafts } from "./action-drafts.js";
import { ActionEditor, OpenCardEditor } from "./action-editor.js";
import { BoardView } from "./board-view.js";
import type { ProjectChoice } from "./project-selection.js";
import { useRead } from "./use-read.js";

const actionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
const panelStyle = { flex: 1, gap: 12 } as const;
function ReadBoundary({
  loading,
  error,
  unconfigured,
  projectName,
  children,
}: {
  loading: boolean;
  error: string;
  unconfigured: boolean;
  projectName: string;
  children: ReactNode;
}) {
  if (loading) return <SettingsRow label="Loading board..." />;
  if (error)
    return (
      <SettingsCard>
        <SettingsRow label="Board unavailable" error={error} />
      </SettingsCard>
    );
  if (unconfigured)
    return (
      <SettingsCard>
        <SettingsRow label={`No board is configured for ${projectName}.`} />
      </SettingsCard>
    );
  return children;
}

export function BoardPanel({
  project,
  host,
  layout,
  theme,
  navigation,
  actionDrafts,
}: {
  project: ProjectChoice;
  host: PluginScreenProps["host"];
  layout: PluginScreenProps["layout"];
  theme: PluginScreenProps["theme"];
  navigation: PluginScreenProps["navigation"];
  actionDrafts: BoardActionDrafts;
}) {
  const read = useRpc(getEditableBoard);
  const mutate = useRpc(mutateBoard);
  const readCreationOptions = useRpc(getJiraCreateOptions);
  const [cardId, setCardId] = useState<string | undefined>();
  const [columnId, setColumnId] = useState("");
  const [editor, setEditor] = useState<BoardActionModel | null>(() =>
    actionDrafts.get({ hostId: host.id, projectId: project.projectId }),
  );
  const [saved, setSaved] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const refreshBoard = useCallback(() => setRefresh((value) => value + 1), []);
  const load = useCallback(
    () => read({ binding: { hostId: host.id, projectId: project.projectId }, cardId }),
    [read, host.id, project.projectId, cardId],
  );
  const state = useRead({
    key: JSON.stringify([host.id, project.projectId, cardId, refresh]),
    enabled: true,
    load,
    errorMessage: "The board could not be read from the selected host.",
  });
  const openProjectSettings = navigation?.openProjectSettings;
  const openSettings = useCallback(() => {
    openProjectSettings?.({ serverId: host.id, projectId: project.projectId });
  }, [openProjectSettings, host.id, project.projectId]);
  const board = state.status === "ready" ? state.value : null;
  const readCreation = useCallback<ReadJiraCreation>(
    async (selection) => {
      if (board?.status !== "ready")
        return {
          ok: false,
          error: { code: "unavailable", message: "Refresh the board before creating an issue." },
        };
      return readCreationOptions({
        binding: board.binding,
        expectedSettingsRevision: board.settingsRevision,
        expectedBoardRevision: board.snapshot.board.revision,
        ...selection,
      });
    },
    [board, readCreationOptions],
  );
  const open = useCallback(
    (mode: ActionMode) => {
      if (board?.status !== "ready") return;
      const model = actionDrafts.open({
        origin: {
          binding: board.binding,
          settingsRevision: board.settingsRevision,
          snapshot: board.snapshot,
          cardId,
        },
        mode,
        operationId: newBoardOperationId,
        submit: mutate,
        readCreation,
      });
      setSaved(false);
      setEditor(model);
    },
    [board, actionDrafts, cardId, mutate, readCreation],
  );
  const create = useCallback(() => open("create"), [open]);
  const link = useCallback(() => open("link"), [open]);
  const closeEditor = useCallback(() => {
    if (editor && !actionDrafts.discard(editor)) return;
    setEditor(null);
    setCardId(undefined);
    refreshBoard();
  }, [editor, actionDrafts, refreshBoard]);
  const applied = useCallback(() => {
    setSaved(true);
    closeEditor();
  }, [closeEditor]);
  const back = useCallback(() => setCardId(undefined), []);
  const cardApplied = useCallback(() => {
    setSaved(true);
    back();
    refreshBoard();
  }, [back, refreshBoard]);
  const cardOrigin = useMemo(
    () =>
      board?.status === "ready" && cardId
        ? {
            binding: board.binding,
            settingsRevision: board.settingsRevision,
            snapshot: board.snapshot,
            cardId,
          }
        : null,
    [board, cardId],
  );
  let error = "";
  if (state.status === "error") error = state.message;
  else if (board?.status === "error") error = board.error.message;
  if (editor) return <ActionEditor model={editor} onClose={closeEditor} onApplied={applied} />;
  if (cardOrigin)
    return (
      <OpenCardEditor
        origin={cardOrigin}
        drafts={actionDrafts}
        submit={mutate}
        onClose={back}
        onApplied={cardApplied}
      />
    );
  return (
    <View style={panelStyle}>
      <View style={actionsStyle}>
        {cardId ? (
          <SettingsButton onPress={back} variant="outline">
            Back to board
          </SettingsButton>
        ) : null}
        <SettingsButton onPress={refreshBoard} disabled={state.status === "loading"}>
          {state.status === "loading" ? "Refreshing..." : "Refresh"}
        </SettingsButton>
        {openProjectSettings ? (
          <SettingsButton variant="outline" onPress={openSettings}>
            Project Settings
          </SettingsButton>
        ) : null}
      </View>
      {saved ? <SettingsRow label="Board action applied" /> : null}
      <ReadBoundary
        loading={state.status === "loading"}
        error={error}
        unconfigured={board?.status === "unconfigured"}
        projectName={project.projectDisplayName}
      >
        {board?.status === "ready" ? (
          <>
            <View style={actionsStyle}>
              {board.snapshot.board.capabilities.create ? (
                <SettingsButton onPress={create}>Create card</SettingsButton>
              ) : null}
              {board.snapshot.board.capabilities.link ? (
                <SettingsButton onPress={link}>
                  {board.snapshot.board.provider === "jira"
                    ? "Link backlog issue"
                    : "Link issue or pull request"}
                </SettingsButton>
              ) : null}
            </View>
            <BoardView
              board={board.snapshot.board}
              layout={layout}
              theme={theme}
              onSelectCard={setCardId}
              columnId={columnId}
              onColumnChange={setColumnId}
            />
          </>
        ) : null}
      </ReadBoundary>
    </View>
  );
}
