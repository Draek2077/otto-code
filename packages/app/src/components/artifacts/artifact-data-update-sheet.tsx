import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/text-area";
import { useArtifactData } from "@/artifacts/use-artifact-data";
import { useArtifactMutations } from "@/artifacts/use-artifact-mutations";
import { toErrorMessage } from "@/utils/error-messages";
import type { AggregatedArtifact } from "@/artifacts/use-artifacts";

export interface ArtifactDataUpdateSheetProps {
  artifact: AggregatedArtifact | null;
  onClose: () => void;
}

export function ArtifactDataUpdateSheet({
  artifact,
  onClose,
}: ArtifactDataUpdateSheetProps): ReactElement {
  const dataQuery = useArtifactData(
    artifact?.serverId ?? "",
    artifact?.id ?? "",
    artifact !== null,
  );
  const { updateArtifactData, isUpdatingData } = useArtifactMutations();
  const [draft, setDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Which artifact the draft was seeded for. The seed must happen once per
  // opened artifact: the query refetches on focus and after every
  // artifact.updated notification, and re-seeding from a fresh response would
  // silently discard whatever the user has typed since the sheet opened.
  const [seededArtifactId, setSeededArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact) {
      setSeededArtifactId(null);
      return;
    }
    if (dataQuery.data === undefined || seededArtifactId === artifact.id) return;
    setDraft(dataQuery.data === null ? "" : JSON.stringify(dataQuery.data, null, 2));
    setSubmitError(null);
    setSeededArtifactId(artifact.id);
  }, [artifact, dataQuery.data, seededArtifactId]);

  const header = useMemo<SheetHeader>(
    () => ({ title: `Update data: ${artifact?.name ?? "Artifact"}` }),
    [artifact?.name],
  );
  const hasContract = dataQuery.data !== null && dataQuery.data !== undefined;

  const handleSave = useCallback(async () => {
    if (!artifact || !hasContract) return;
    let data: unknown;
    try {
      data = JSON.parse(draft) as unknown;
    } catch (error) {
      setSubmitError(`Invalid JSON: ${toErrorMessage(error)}`);
      return;
    }
    setSubmitError(null);
    try {
      await updateArtifactData({ serverId: artifact.serverId, artifactId: artifact.id, data });
      onClose();
    } catch (error) {
      setSubmitError(toErrorMessage(error));
    }
  }, [artifact, draft, hasContract, onClose, updateArtifactData]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button style={styles.footerButton} variant="secondary" onPress={onClose}>
          Cancel
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSavePress}
          disabled={!hasContract || dataQuery.isLoading || isUpdatingData}
          loading={isUpdatingData}
        >
          Update data
        </Button>
      </View>
    ),
    [dataQuery.isLoading, handleSavePress, hasContract, isUpdatingData, onClose],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={artifact !== null}
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={680}
      testID="artifact-data-update-sheet"
    >
      <View style={styles.content}>
        <Text style={styles.description}>
          This changes only the artifact&apos;s data. Its HTML, layout, styles, and scripts stay the
          same.
        </Text>
        {dataQuery.isLoading ? <Text style={styles.message}>Loading data…</Text> : null}
        {dataQuery.error ? (
          <Text style={styles.error}>{toErrorMessage(dataQuery.error)}</Text>
        ) : null}
        {!dataQuery.isLoading && !dataQuery.error && !hasContract ? (
          <Text style={styles.message}>
            This artifact has no data contract. Regenerate it to add a data-only update path.
          </Text>
        ) : null}
        {hasContract ? (
          <TextArea
            value={draft}
            onChangeText={setDraft}
            accessibilityLabel="Artifact data JSON"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.editor}
            testID="artifact-data-update-input"
          />
        ) : null}
        {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[3], padding: theme.spacing[4] },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  message: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.palette.red[500], fontSize: theme.fontSize.sm },
  editor: {
    minHeight: 280,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  footer: { flexDirection: "row", gap: theme.spacing[2], padding: theme.spacing[4] },
  footerButton: { flex: 1 },
}));
