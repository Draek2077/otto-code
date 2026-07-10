import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { FileText, TriangleAlert } from "@/components/icons/material-icons";
import { ArtifactHtmlView } from "@/components/artifacts/artifact-html-view";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useArtifactContent } from "@/artifacts/use-artifact-content";
import { useArtifacts } from "@/artifacts/use-artifacts";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";

function useArtifactPanelDescriptor(
  target: { kind: "artifact"; artifactId: string },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { artifacts } = useArtifacts();
  const artifact = artifacts.find(
    (item) => item.serverId === context.serverId && item.id === target.artifactId,
  );
  return {
    label: artifact?.name?.trim() || target.artifactId,
    subtitle: artifact?.description ?? "",
    titleState: artifact?.status === "generating" ? "loading" : "ready",
    icon: FileText,
    statusBucket: artifact?.status === "generating" ? "running" : null,
  };
}

function ArtifactPanel() {
  const { serverId, target, openTab } = usePaneContext();
  invariant(target.kind === "artifact", "ArtifactPanel requires artifact target");
  const { theme } = useUnistyles();
  const { content, isLoading, error } = useArtifactContent(serverId, target.artifactId);
  const { artifacts } = useArtifacts();
  const artifact = artifacts.find(
    (item) => item.serverId === serverId && item.id === target.artifactId,
  );
  const generationAgentId = artifact?.generationAgentId ?? null;
  const handleViewGenerationLog = useCallback(() => {
    if (generationAgentId) {
      openTab({ kind: "agent", agentId: generationAgentId });
    }
  }, [generationAgentId, openTab]);

  const messageStyle = useMemo(
    () => [styles.message, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const errorStyle = useMemo(
    () => [styles.message, { color: theme.colors.palette.red[500] }],
    [theme.colors.palette.red],
  );

  // While generating, the HTML file doesn't exist yet, so the content fetch
  // legitimately 404s — key off the artifact's own status rather than the
  // content query's loading/error state so this doesn't flicker into the
  // error branch below once retries are exhausted.
  if (artifact?.status === "generating") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner color={theme.colors.foregroundMuted} />
        <Text style={messageStyle}>Generating…</Text>
        {generationAgentId ? (
          <Button variant="ghost" size="sm" onPress={handleViewGenerationLog}>
            View generation log
          </Button>
        ) : null}
      </View>
    );
  }

  if (isLoading && content === null) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner color={theme.colors.foregroundMuted} />
      </View>
    );
  }

  // A failed generation with no recoverable content (first-ever generation,
  // or a failed regeneration with nothing to fall back to) has nothing to
  // render — show the failure plainly instead of a generic fetch error.
  if (artifact?.status === "error" && !content) {
    return (
      <View style={styles.centered}>
        <TriangleAlert size={20} color={theme.colors.palette.red[500]} />
        <Text style={errorStyle}>{artifact.errorMessage ?? error ?? "Generation failed"}</Text>
        {generationAgentId ? (
          <Button variant="ghost" size="sm" onPress={handleViewGenerationLog}>
            View generation log
          </Button>
        ) : null}
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={errorStyle}>{error}</Text>
      </View>
    );
  }

  if (!content) {
    return (
      <View style={styles.centered}>
        <Text style={messageStyle}>This artifact has no content yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {artifact?.status === "error" ? (
        <View style={styles.errorBanner}>
          <TriangleAlert size={14} color={theme.colors.palette.red[300]} />
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {artifact.errorMessage ?? "Regeneration failed — showing the last successful version."}
          </Text>
          {generationAgentId ? (
            <Button variant="ghost" size="sm" onPress={handleViewGenerationLog}>
              View log
            </Button>
          ) : null}
        </View>
      ) : null}
      <ArtifactHtmlView html={content} />
    </View>
  );
}

export const artifactPanelRegistration: PanelRegistration<"artifact"> = {
  kind: "artifact",
  component: ArtifactPanel,
  useDescriptor: useArtifactPanelDescriptor,
  confirmClose() {
    return Promise.resolve(true);
  },
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    backgroundColor: theme.colors.surface0,
  },
  message: {
    fontSize: 13,
    textAlign: "center",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  errorBannerText: {
    flex: 1,
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
}));
