import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ArtifactHtmlView } from "@/components/artifacts/artifact-html-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useArtifactContent } from "@/artifacts/use-artifact-content";
import type { AggregatedArtifact } from "@/artifacts/use-artifacts";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface ArtifactViewDialogProps {
  /** The artifact to preview; the dialog is hidden while this is null. */
  artifact: AggregatedArtifact | null;
  onClose: () => void;
}

/**
 * Read-only preview of an artifact's rendered HTML in a mid-size dialog,
 * reachable from the artifacts grid's kebab menu without opening a full
 * workspace tab.
 */
export function ArtifactViewDialog({ artifact, onClose }: ArtifactViewDialogProps): ReactElement {
  const header = useMemo<SheetHeader>(
    () => ({ title: artifact?.name?.trim() || artifact?.id || "Artifact" }),
    [artifact],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={artifact !== null}
      onClose={onClose}
      scrollable={false}
      desktopMaxWidth={720}
      desktopHeight={640}
      testID="artifact-view-dialog"
    >
      {artifact ? <ArtifactViewDialogContent artifact={artifact} /> : null}
    </AdaptiveModalSheet>
  );
}

function ArtifactViewDialogContent({ artifact }: { artifact: AggregatedArtifact }): ReactElement {
  const { content, isLoading, error } = useArtifactContent(artifact.serverId, artifact.id);

  if (artifact.status === "generating") {
    return (
      <View style={styles.centered}>
        <ThemedLoadingSpinner uniProps={mutedColorMapping} />
        <Text style={styles.message}>Generating…</Text>
      </View>
    );
  }

  if (isLoading && content === null) {
    return (
      <View style={styles.centered}>
        <ThemedLoadingSpinner uniProps={mutedColorMapping} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!content) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>This artifact has no content yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ArtifactHtmlView html={content} />
    </View>
  );
}

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
  },
  message: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.palette.red[500],
  },
}));
