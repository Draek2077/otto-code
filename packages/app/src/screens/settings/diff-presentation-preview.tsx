import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { DiffViewer } from "@/components/diff-viewer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { settingsStyles } from "@/styles/settings";
import { buildLineDiff } from "@/utils/tool-call-parsers";
import { selectDiffRenderer } from "@/utils/diff-renderer-selection";
import {
  getStructuralDiffDemoScenario,
  STRUCTURAL_DIFF_DEMO_SCENARIOS,
} from "@/utils/structural-diff-demo-scenarios";

type PreviewRenderer = "old" | "new";
export function DiffPresentationPreview({
  showFormattingChanges,
}: {
  showFormattingChanges: boolean;
}) {
  const [renderer, setRenderer] = useState<PreviewRenderer>("new");
  const [scenario, setScenario] = useState("small-edit");

  const selectedScenario = getStructuralDiffDemoScenario(scenario);
  const diffLines = useMemo(
    () => buildLineDiff(selectedScenario.before, selectedScenario.after),
    [selectedScenario],
  );
  const selectedRenderer = selectDiffRenderer({
    isNewDiffEnabled: renderer === "new",
    isNewDiffCapable: true,
  });
  const useNewDiff = selectedRenderer === "new";
  const scenarioOptions = useMemo(
    () => STRUCTURAL_DIFF_DEMO_SCENARIOS.map(({ id, label }) => ({ value: id, label })),
    [],
  );
  const rendererOptions = useMemo(
    () => [
      { value: "old" as const, label: "Old diff" },
      { value: "new" as const, label: "New diff" },
    ],
    [],
  );
  const handleScenarioChange = useCallback((next: string) => setScenario(next), []);
  const handleRendererChange = useCallback((next: PreviewRenderer) => setRenderer(next), []);

  return (
    <View style={styles.preview} testID="diff-presentation-preview">
      <View style={styles.previewHeader}>
        <Text style={settingsStyles.rowHint}>
          Runs the legacy review body and the new shared renderer against the same sample diff.
          Nothing here changes a setting.
        </Text>
      </View>
      <View style={styles.controls}>
        <SegmentedControl
          size="sm"
          value={scenario}
          onValueChange={handleScenarioChange}
          options={scenarioOptions}
          wrap
          testID="diff-preview-scenarios"
        />
        <SegmentedControl
          size="sm"
          value={renderer}
          onValueChange={handleRendererChange}
          options={rendererOptions}
          stretch
          testID="diff-preview-renderer"
        />
      </View>
      <View style={styles.sampleHeader}>
        <Text style={styles.sampleTitle}>{selectedScenario.title}</Text>
        <Text style={styles.sampleDescription}>{selectedScenario.description}</Text>
      </View>
      <AppearanceStyleBoundary>
        {/* One renderer, two presentations. The preview pins the presentation
            rather than inheriting the user's default, which governs live review
            surfaces only - the point here is to show both so they can choose. */}
        <DiffViewer
          diffLines={diffLines}
          filePath={selectedScenario.filePath}
          source="before-after"
          beforeSource={selectedScenario.before}
          afterSource={selectedScenario.after}
          presentation={useNewDiff ? "structural" : "line"}
          wrap
        />
      </AppearanceStyleBoundary>
      {useNewDiff && !showFormattingChanges && scenario === "formatting" ? (
        <Text style={styles.formattingHidden}>Formatting-only changes are hidden.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    paddingBottom: theme.spacing[4],
  },
  previewHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
  },
  controls: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
  },
  sampleHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
  },
  sampleTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sampleDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  formattingHidden: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
}));
