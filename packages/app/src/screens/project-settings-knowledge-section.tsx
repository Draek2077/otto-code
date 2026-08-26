/**
 * The Knowledge-location section of Project Settings.
 *
 * A project keeps its Knowledge either in the repository, at `.otto/`, or
 * host-local under the daemon's `$OTTO_HOME`. Host-local leaves nothing in the
 * working tree, so a repository never has to gitignore anything to use
 * Knowledge. "Host default" is a third, distinct state: the project follows
 * whatever the host setting says rather than pinning a choice of its own.
 *
 * Unlike the sibling Kanban section this saves immediately rather than joining
 * the page-level draft. Switching can move files on disk, so it asks first, and
 * a confirmed file move does not belong behind a later "Save" the user might
 * never press.
 */
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ProjectKnowledgeStoreLocationValue } from "@otto-code/protocol/messages";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { settingsStyles } from "@/styles/settings";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";

export type KnowledgeLocationChoice = "default" | "repository" | "host";

interface ProjectKnowledgeSectionProps {
  serverId: string;
  projectId: string;
  client: DaemonClient;
}

/**
 * What a switch should do about the pages already stored at the old location.
 * Split out from the component so the decision is testable without mounting:
 * the wrong answer here either strands a user's Knowledge or deletes files in
 * their working tree unasked.
 *
 * Nothing is asked when the switch does not actually change where pages land,
 * or when there are no pages to carry. A choice between "default" and the
 * location it already resolves to is exactly that first case.
 */
export function resolveKnowledgeSwitchPrompt(input: {
  from: ProjectKnowledgeStoreLocationValue;
  to: ProjectKnowledgeStoreLocationValue;
  hasPages: boolean;
}): { kind: "switch" } | { kind: "confirm"; movePrompt: "toHost" | "toRepository" } {
  if (input.from === input.to) return { kind: "switch" };
  if (!input.hasPages) return { kind: "switch" };
  return { kind: "confirm", movePrompt: input.to === "host" ? "toHost" : "toRepository" };
}

export function ProjectKnowledgeSection({
  serverId,
  projectId,
  client,
}: ProjectKnowledgeSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useHostFeature(serverId, "projectKnowledgeStoreLocation");
  const override = useSessionStore(
    (state) => state.sessions[serverId]?.projects.get(projectId)?.projectKnowledgeLocation ?? null,
  );
  const [pending, setPending] = useState<KnowledgeLocationChoice | null>(null);

  const choice: KnowledgeLocationChoice = pending ?? override ?? "default";

  const mutation = useMutation({
    mutationFn: async (input: {
      location: ProjectKnowledgeStoreLocationValue | null;
      movePages: boolean;
    }) => client.setProjectKnowledgeStoreLocation({ projectId, ...input }),
    onSuccess: ({ movedPageCount }) => {
      setPending(null);
      toast.show(
        movedPageCount > 0
          ? t("settings.project.knowledge.movedToast", { count: movedPageCount })
          : t("settings.project.knowledge.savedToast"),
      );
    },
    onError: () => {
      setPending(null);
      toast.show(t("settings.project.knowledge.saveError"));
    },
  });

  const handleChange = useCallback(
    async (value: KnowledgeLocationChoice) => {
      // The primitive has no disabled state, so an in-flight save is guarded
      // here. A second switch mid-move would race the file copy.
      if (value === choice || mutation.isPending) return;
      const location = value === "default" ? null : value;

      // Ask the daemon where things stand first. The daemon owns precedence, so
      // the client cannot work out where "default" lands, nor whether the
      // current store holds anything, without it.
      const current = await client.getProjectKnowledgeStore({ projectId }).catch(() => null);
      const prompt = resolveKnowledgeSwitchPrompt({
        from: current?.location ?? "repository",
        to: location ?? current?.hostDefault ?? "repository",
        hasPages: current?.hasPages ?? false,
      });
      if (prompt.kind === "switch") {
        setPending(value);
        mutation.mutate({ location, movePages: false });
        return;
      }

      const move = await confirmDialog({
        title: t("settings.project.knowledge.moveTitle"),
        message:
          prompt.movePrompt === "toHost"
            ? t("settings.project.knowledge.moveToHostMessage")
            : t("settings.project.knowledge.moveToRepositoryMessage"),
        confirmLabel: t("settings.project.knowledge.moveConfirm"),
        cancelLabel: t("settings.project.knowledge.moveLeave"),
      });
      setPending(value);
      mutation.mutate({ location, movePages: move });
    },
    [choice, client, mutation, projectId, t],
  );

  const options = useMemo(() => locationOptions(t), [t]);

  if (!supported) return null;

  return (
    <SettingsGroup
      title={t("settings.project.knowledge.sectionTitle")}
      info={t("settings.project.knowledge.description")}
      testID="project-knowledge-group"
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.project.knowledge.locationTitle")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.project.knowledge.locationHint")}
            </Text>
          </View>
          <View style={settingsStyles.rowControlGroup}>
            <SegmentedControl<KnowledgeLocationChoice>
              options={options}
              value={choice}
              onValueChange={handleChange}
              size="sm"
              testID="project-knowledge-location"
            />
          </View>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowHint}>
            {t("settings.project.knowledge.gitignoreHint")}
          </Text>
        </View>
      </View>
    </SettingsGroup>
  );
}

function locationOptions(
  t: (key: string) => string,
): SegmentedControlOption<KnowledgeLocationChoice>[] {
  return [
    { value: "default", label: t("settings.project.knowledge.locationDefault") },
    { value: "repository", label: t("settings.project.knowledge.locationRepository") },
    { value: "host", label: t("settings.project.knowledge.locationHost") },
  ];
}
