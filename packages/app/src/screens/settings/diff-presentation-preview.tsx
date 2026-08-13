import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { DiffViewer } from "@/components/diff-viewer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LegacyDiffFileBody } from "@/git/diff-pane";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { useAppSettings } from "@/hooks/use-settings";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { settingsStyles } from "@/styles/settings";
import { buildLineDiff, type DiffLine } from "@/utils/tool-call-parsers";
import { selectDiffRenderer } from "@/utils/diff-renderer-selection";
import {
  getStructuralDiffDemoScenario,
  STRUCTURAL_DIFF_DEMO_SCENARIOS,
  type StructuralDiffDemoScenario,
} from "@/utils/structural-diff-demo-scenarios";

type PreviewRenderer = "old" | "new";
function buildLegacyPreviewFile(
  scenario: StructuralDiffDemoScenario,
  diffLines: readonly DiffLine[],
): ParsedDiffFile {
  const contentLines = diffLines.filter((line) => line.type !== "header");
  const oldCount = contentLines.filter((line) => line.type !== "add").length;
  const newCount = contentLines.filter((line) => line.type !== "remove").length;
  const additions = contentLines.filter((line) => line.type === "add").length;
  const deletions = contentLines.filter((line) => line.type === "remove").length;
  const oldStart =
    contentLines.find((line) => line.oldLineNumber !== undefined)?.oldLineNumber ?? 1;
  const newStart =
    contentLines.find((line) => line.newLineNumber !== undefined)?.newLineNumber ?? 1;
  const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

  return {
    path: scenario.filePath,
    isNew: false,
    isDeleted: false,
    additions,
    deletions,
    hunks: [
      {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [
          { type: "header", content: hunkHeader },
          ...contentLines.map((line) =>
            line.tokens
              ? { type: line.type, content: line.content, tokens: line.tokens }
              : { type: line.type, content: line.content },
          ),
        ],
      },
    ],
  };
}

export function DiffPresentationPreview({
  showFormattingChanges,
}: {
  showFormattingChanges: boolean;
}) {
  const [renderer, setRenderer] = useState<PreviewRenderer>("new");
  const [scenario, setScenario] = useState("small-edit");
  const { settings } = useAppSettings();
  const { preferences } = useChangesPreferences();
  const selectedScenario = getStructuralDiffDemoScenario(scenario);
  const diffLines = useMemo(
    () => buildLineDiff(selectedScenario.before, selectedScenario.after),
    [selectedScenario],
  );
  const legacyFile = useMemo(
    () => buildLegacyPreviewFile(selectedScenario, diffLines),
    [diffLines, selectedScenario],
  );
  const selectedRenderer = selectDiffRenderer({
    isNewDiffEnabled: renderer === "new",
    isNewDiffCapable: true,
  });
  const useNewDiff = selectedRenderer === "new";
  const legacyLineHeight = Math.round(settings.codeFontSize * 1.5);
  const legacyTextMetrics = useMemo(() => {
    const monoFontFamily = settings.monoFontFamily.trim();
    return {
      fontSize: settings.codeFontSize,
      lineHeight: legacyLineHeight,
      ...(monoFontFamily ? { fontFamily: monoFontFamily } : null),
    };
  }, [legacyLineHeight, settings.codeFontSize, settings.monoFontFamily]);
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
        <Text style={settingsStyles.rowTitle}>Diff viewer</Text>
        <Text style={settingsStyles.rowHint}>
          Exercise the actual legacy review body and the new shared renderer against the same diff.
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
        {useNewDiff ? (
          <DiffViewer
            diffLines={diffLines}
            filePath={selectedScenario.filePath}
            source="before-after"
            beforeSource={selectedScenario.before}
            afterSource={selectedScenario.after}
            presentation={preferences.presentation}
            wrap
          />
        ) : (
          <LegacyDiffFileBody
            file={legacyFile}
            layout="unified"
            presentation="line"
            wrapLines
            codeFontSize={settings.codeFontSize}
            textMetricsStyle={legacyTextMetrics}
            testID="legacy-diff-preview"
          />
        )}
      </AppearanceStyleBoundary>
      {useNewDiff &&
      preferences.presentation === "structural" &&
      !showFormattingChanges &&
      scenario === "formatting" ? (
        <Text style={styles.formattingHidden}>Formatting-only changes are hidden.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    borderTopColor: theme.colors.border,
    borderTopWidth: theme.borderWidth[1],
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
