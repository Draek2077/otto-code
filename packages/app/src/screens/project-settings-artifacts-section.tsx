import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useToast } from "@/contexts/toast-context";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";

type ArtifactLocationChoice = "default" | "repository" | "host";

export function ProjectArtifactsSection({
  serverId,
  projectId,
  client,
}: {
  serverId: string;
  projectId: string;
  client: DaemonClient;
}) {
  const toast = useToast();
  const supported = useHostFeature(serverId, "artifactStoreLocation");
  const override = useSessionStore(
    (state) => state.sessions[serverId]?.projects.get(projectId)?.projectArtifactLocation ?? null,
  );
  const [pending, setPending] = useState<ArtifactLocationChoice | null>(null);
  const value: ArtifactLocationChoice = pending ?? override ?? "default";
  const mutation = useMutation({
    mutationFn: (location: ArtifactLocationChoice) =>
      client.setProjectArtifactStoreLocation({
        projectId,
        location: location === "default" ? null : location,
      }),
    onSuccess: () => {
      setPending(null);
      toast.show("Artifact storage preference saved.");
    },
    onError: () => {
      setPending(null);
      toast.show("Could not save Artifact storage preference.");
    },
  });
  const change = useCallback(
    (next: ArtifactLocationChoice) => {
      if (next === value || mutation.isPending) return;
      setPending(next);
      mutation.mutate(next);
    },
    [mutation, value],
  );
  const options = mutation.isPending ? DISABLED_OPTIONS : OPTIONS;
  if (!supported) return null;
  return (
    <SettingsGroup title="Artifacts" testID="project-artifacts-group">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Artifact storage</Text>
            <Text style={settingsStyles.rowHint}>
              Choose where future Artifacts for this project are written. Existing Artifacts remain
              available in either location.
            </Text>
          </View>
          <View style={settingsStyles.rowControlGroup}>
            <SegmentedControl<ArtifactLocationChoice>
              options={options}
              value={value}
              onValueChange={change}
              size="sm"
              testID="project-artifact-location"
            />
          </View>
        </View>
      </View>
    </SettingsGroup>
  );
}

const OPTIONS: SegmentedControlOption<ArtifactLocationChoice>[] = [
  { value: "default", label: "Host default" },
  { value: "repository", label: "Repository" },
  { value: "host", label: "This host" },
];

const DISABLED_OPTIONS: SegmentedControlOption<ArtifactLocationChoice>[] = [
  { value: "default", label: "Host default", disabled: true },
  { value: "repository", label: "Repository", disabled: true },
  { value: "host", label: "This host", disabled: true },
];
