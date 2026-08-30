import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useToast } from "@/contexts/toast-context";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { settingsStyles } from "@/styles/settings";
import { useSessionStore } from "@/stores/session-store";
import { supportsWorkflowStorage } from "@/workflows/storage-presentation";

type WorkflowLocationChoice = "default" | "repository" | "host";

export function ProjectWorkflowsSection({
  serverId,
  projectId,
  client,
}: {
  serverId: string;
  projectId: string;
  client: DaemonClient;
}) {
  const toast = useToast();
  const supported = useSessionStore((state) =>
    supportsWorkflowStorage({
      categoryStorageResolver:
        state.sessions[serverId]?.serverInfo?.features?.categoryStorageResolver,
    }),
  );
  const override = useSessionStore(
    (state) => state.sessions[serverId]?.projects.get(projectId)?.projectWorkflowLocation ?? null,
  );
  const [pending, setPending] = useState<WorkflowLocationChoice | null>(null);
  const value: WorkflowLocationChoice = pending ?? override ?? "default";
  const mutation = useMutation({
    mutationFn: (location: WorkflowLocationChoice) =>
      client.setProjectWorkflowStoreLocation({
        projectId,
        location: location === "default" ? null : location,
      }),
    onSuccess: () => {
      setPending(null);
      toast.show("Workflow storage preference saved.");
    },
    onError: () => {
      setPending(null);
      toast.show("Could not save Workflow storage preference.");
    },
  });
  const change = useCallback(
    (next: WorkflowLocationChoice) => {
      if (next === value || mutation.isPending) return;
      setPending(next);
      mutation.mutate(next);
    },
    [mutation, value],
  );
  if (!supported) return null;
  return (
    <SettingsGroup title="Workflows" testID="project-workflows-group">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Workflow storage</Text>
            <Text style={settingsStyles.rowHint}>
              Choose where future Workflow definitions, templates, and runs are written. Existing
              records remain available in their original source and are never moved automatically.
            </Text>
          </View>
          <View style={settingsStyles.rowControlGroup}>
            <SegmentedControl<WorkflowLocationChoice>
              options={mutation.isPending ? DISABLED_OPTIONS : OPTIONS}
              value={value}
              onValueChange={change}
              size="sm"
              testID="project-workflow-location"
            />
          </View>
        </View>
      </View>
    </SettingsGroup>
  );
}

const OPTIONS: SegmentedControlOption<WorkflowLocationChoice>[] = [
  { value: "default", label: "Host default" },
  { value: "repository", label: "Repository" },
  { value: "host", label: "This host" },
];

const DISABLED_OPTIONS: SegmentedControlOption<WorkflowLocationChoice>[] = [
  { value: "default", label: "Host default", disabled: true },
  { value: "repository", label: "Repository", disabled: true },
  { value: "host", label: "This host", disabled: true },
];
