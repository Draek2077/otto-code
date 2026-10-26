import { useCallback, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/diff-viewer";
import { useIsCompactFormFactor } from "@/constants/layout";
import { keptContextText, type ContextCompactionModel } from "./compaction-model";
import type { ReviewHunk } from "@/otto/knowledge/review-hunks";
import { styles } from "./styles";

function Hunk({
  model,
  nodeId,
  label,
  hunk,
  kept,
  disabled,
}: {
  model: ContextCompactionModel;
  nodeId: string;
  label: string;
  hunk: ReviewHunk;
  kept: boolean;
  disabled: boolean;
}) {
  const toggle = useCallback(() => model.toggle(nodeId, hunk.id), [model, nodeId, hunk.id]);
  return (
    <SettingsCard testID={`context-compaction-hunk-${nodeId}-${hunk.id}`}>
      <SettingsRow label={`${label} · change ${hunk.id}`}>
        <Button
          size="sm"
          variant={kept ? "secondary" : "outline"}
          onPress={toggle}
          disabled={disabled}
          accessibilityLabel={`${kept ? "Drop" : "Keep"} ${label} change ${hunk.id}`}
        >
          {kept ? "Kept" : "Dropped"}
        </Button>
      </SettingsRow>
      <DiffViewer diffLines={hunk.lines} />
    </SettingsCard>
  );
}
export function ContextCompactionReview({ model }: { model: ContextCompactionModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const compact = useIsCompactFormFactor();
  return (
    <SettingsSection
      title="Review kept changes"
      info="Every hunk starts dropped. Keep only the changes you approve; no file changes until Apply kept changes is confirmed."
    >
      {state.documents.map((document) => (
        <View key={document.file.nodeId} style={reviewStyles.document}>
          <SettingsRow
            label={document.file.label}
            hint={`${document.file.text.length.toLocaleString()} original characters → ${keptContextText(document).length.toLocaleString()} in the kept result`}
          />
          <View style={compact ? reviewStyles.stack : reviewStyles.columns}>
            <View style={reviewStyles.pane}>
              <Text style={styles.caption}>Current file at review origin</Text>
              <ScrollView style={reviewStyles.scroll}>
                <Text selectable style={styles.code}>
                  {document.file.text}
                </Text>
              </ScrollView>
            </View>
            <View style={reviewStyles.pane}>
              <Text style={styles.caption}>Kept result</Text>
              <ScrollView style={reviewStyles.scroll}>
                <Text
                  selectable
                  style={styles.code}
                  testID={`context-compaction-kept-${document.file.nodeId}`}
                >
                  {keptContextText(document)}
                </Text>
              </ScrollView>
            </View>
          </View>
          {document.diff?.hunks.map((hunk) => (
            <Hunk
              key={hunk.id}
              model={model}
              nodeId={document.file.nodeId}
              label={document.file.label}
              hunk={hunk}
              kept={document.kept.has(hunk.id)}
              disabled={state.busy || state.blocked || state.setChanged}
            />
          ))}
          {document.diff && !document.diff.hunks.length ? (
            <SettingsRow label="The model proposed no change to this working document." />
          ) : null}
        </View>
      ))}
    </SettingsSection>
  );
}
const reviewStyles = StyleSheet.create((theme) => ({
  document: { gap: theme.spacing[3] },
  columns: { flexDirection: "row", gap: theme.spacing[4] },
  stack: { gap: theme.spacing[4] },
  pane: { flex: 1, minWidth: 0, gap: theme.spacing[2] },
  scroll: { maxHeight: 320 },
}));
