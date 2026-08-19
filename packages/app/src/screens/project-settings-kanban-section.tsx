/**
 * The Kanban board-target section of Project Settings (phase 4).
 *
 * The target is a pointer, never a credential: `{ adapter: "github" | "jira",
 * boardId: string | null }`. An empty GitHub board means "derive from this
 * project's git remote"; a Jira board id is required. Provider sign-in lives in
 * host settings, not here.
 */
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native-unistyles";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { ProjectKanbanTarget } from "@otto-code/protocol/messages";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { settingsStyles } from "@/styles/settings";
import { useKanbanBoardFeature } from "@/kanban/kanban-hooks";
import { useSessionStore } from "@/stores/session-store";

export type KanbanAdapterChoice = "none" | "github" | "jira";

/**
 * Pure draft resolution for the section, isolated from React so it is
 * unit-testable without mounting the component tree (same shape as
 * kanban-screen-state.ts).
 */
export function resolveKanbanTargetDraft(input: {
  adapter: KanbanAdapterChoice;
  boardId: string;
}):
  | { kind: "save"; target: ProjectKanbanTarget | null }
  | { kind: "blocked"; reason: "jiraBoardRequired" } {
  const boardId = input.boardId.trim();
  switch (input.adapter) {
    case "none":
      return { kind: "save", target: null };
    case "github":
      // Empty is valid and is the recommended default: derive the boards from
      // the project's git remote.
      return {
        kind: "save",
        target: { adapter: "github", boardId: boardId.length > 0 ? boardId : null },
      };
    case "jira":
      if (boardId.length === 0) {
        return { kind: "blocked", reason: "jiraBoardRequired" };
      }
      return { kind: "save", target: { adapter: "jira", boardId } };
  }
}

interface ProjectKanbanSectionProps {
  serverId: string;
  projectId: string;
  client: DaemonClient;
}

/**
 * Picks the tracking board this project shows on the Kanban screen, per
 * (host, project). Commits on blur and on submit, skipping the mutation when
 * the trimmed value is unchanged (same pattern as the Atlassian card).
 */
export function ProjectKanbanSection({ serverId, projectId, client }: ProjectKanbanSectionProps) {
  const { t } = useTranslation();
  const supported = useKanbanBoardFeature(serverId);
  const storedTarget = useSessionStore(
    (state) => state.sessions[serverId]?.projects.get(projectId)?.projectKanban ?? null,
  );
  const [adapter, setAdapter] = useState<KanbanAdapterChoice>(
    () => storedTarget?.adapter ?? "none",
  );
  const [boardDraft, setBoardDraft] = useState(() => storedTarget?.boardId ?? "");

  // Resync from the stored target when it changes elsewhere (a second window
  // saving, or the daemon's project.updated notification replaying the new
  // descriptor).
  useEffect(() => {
    setAdapter(storedTarget?.adapter ?? "none");
    setBoardDraft(storedTarget?.boardId ?? "");
  }, [storedTarget]);

  const mutation = useMutation({
    mutationFn: async (target: ProjectKanbanTarget | null) => {
      await client.setKanbanProjectTarget({ projectId, target });
    },
  });

  const commit = useCallback(
    (nextAdapter: KanbanAdapterChoice, board: string) => {
      const draft = resolveKanbanTargetDraft({ adapter: nextAdapter, boardId: board });
      if (draft.kind === "blocked") return;
      if (targetEquals(draft.target, storedTarget)) return;
      mutation.mutate(draft.target);
    },
    [mutation, storedTarget],
  );

  const handleAdapterChange = useCallback(
    (value: KanbanAdapterChoice) => {
      setAdapter(value);
      commit(value, boardDraft);
    },
    [boardDraft, commit],
  );

  const handleCommitBoard = useCallback(() => {
    commit(adapter, boardDraft);
  }, [adapter, boardDraft, commit]);

  if (!supported) {
    return null;
  }

  const draft = resolveKanbanTargetDraft({ adapter, boardId: boardDraft });
  const boardLabel =
    adapter === "jira"
      ? t("settings.project.kanban.jiraBoard")
      : t("settings.project.kanban.githubBoard");
  const boardHint =
    adapter === "jira"
      ? t("settings.project.kanban.jiraBoardHint")
      : t("settings.project.kanban.githubBoardHint");
  const boardPlaceholder =
    adapter === "jira"
      ? t("settings.project.kanban.jiraBoardPlaceholder")
      : t("settings.project.kanban.githubBoardPlaceholder");

  return (
    <SettingsGroup
      title={t("settings.project.kanban.sectionTitle")}
      info={t("settings.project.kanban.description")}
      testID="project-kanban-group"
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.project.kanban.adapter")}</Text>
          </View>
          <View style={settingsStyles.rowControlGroup}>
            <SegmentedControl<KanbanAdapterChoice>
              options={adapterOptions(t)}
              value={adapter}
              onValueChange={handleAdapterChange}
              size="sm"
              testID="project-kanban-adapter"
            />
          </View>
        </View>
        {adapter !== "none" ? (
          <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{boardLabel}</Text>
              <Text style={settingsStyles.rowHint}>{boardHint}</Text>
              {draft.kind === "blocked" ? (
                <Text style={settingsStyles.rowError} testID="project-kanban-board-error">
                  {t("settings.project.kanban.jiraBoardRequired")}
                </Text>
              ) : null}
              {mutation.isError ? (
                <Text style={settingsStyles.rowError} testID="project-kanban-save-error">
                  {t("settings.project.kanban.saveError")}
                </Text>
              ) : null}
            </View>
            <TextInput
              value={boardDraft}
              onChangeText={setBoardDraft}
              onBlur={handleCommitBoard}
              onSubmitEditing={handleCommitBoard}
              placeholder={boardPlaceholder}
              placeholderTextColor={styles.placeholderColor.color}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.boardInput}
              testID="project-kanban-board-input"
            />
          </View>
        ) : null}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowHint}>{t("settings.project.kanban.credentialsHint")}</Text>
        </View>
      </View>
    </SettingsGroup>
  );
}

function targetEquals(a: ProjectKanbanTarget | null, b: ProjectKanbanTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.adapter === b.adapter && (a.boardId ?? null) === (b.boardId ?? null);
}

function adapterOptions(t: (key: string) => string): SegmentedControlOption<KanbanAdapterChoice>[] {
  return [
    { value: "none", label: t("settings.project.kanban.adapterNone") },
    { value: "github", label: t("settings.project.kanban.adapterGithub") },
    { value: "jira", label: t("settings.project.kanban.adapterJira") },
  ];
}

const styles = StyleSheet.create((theme) => ({
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  boardInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    minWidth: { xs: "100%", sm: 220 },
  },
}));
