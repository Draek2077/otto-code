import { useMemo, useState } from "react";
import { DiffViewer } from "@/components/diff-viewer";
import { SettingsCard, SettingsCollapsibleRow, SettingsRow } from "@/components/settings";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { buildLineDiff } from "@/utils/tool-call-parsers";
import { getStructuralDiffDemoScenario, STRUCTURAL_DIFF_DEMO_SCENARIOS } from "./preview-scenarios";
import type { DiffPresentation } from "./structural";

const presentations: SegmentedControlOption<DiffPresentation>[] = [
  { value: "line", label: "Old diff", testID: "diff-preview-line" },
  { value: "structural", label: "New diff", testID: "diff-preview-structural" },
];

const sampleOptions = STRUCTURAL_DIFF_DEMO_SCENARIOS.map(({ id, label }) => ({
  id,
  value: id,
  label,
}));

function Preview() {
  const [presentation, setPresentation] = useState<DiffPresentation>("structural");
  const [scenario, setScenario] = useState("small-edit");
  const sample = getStructuralDiffDemoScenario(scenario);
  const lines = useMemo(() => buildLineDiff(sample.before, sample.after), [sample]);
  const source = useMemo(
    () => ({ filePath: sample.filePath, beforeSource: sample.before, afterSource: sample.after }),
    [sample],
  );
  return (
    <>
      <SettingsRow label={sample.title} hint={sample.description}>
        <SelectField
          label="Sample diff"
          placeholder="Choose a sample"
          emptyText="No samples"
          triggerTestID="diff-preview-scenario"
          selectedDisplay={sampleOptions.find(({ id }) => id === scenario) ?? null}
          options={sampleOptions}
          value={scenario}
          onChange={setScenario}
          field={false}
          size="sm"
        />
      </SettingsRow>
      <SettingsRow label="Preview renderer">
        <SegmentedControl
          options={presentations}
          value={presentation}
          onValueChange={setPresentation}
          size="sm"
        />
      </SettingsRow>
      <DiffViewer
        diffLines={lines}
        structuralSource={source}
        previewPresentation={presentation}
        maxHeight={300}
      />
    </>
  );
}

export function DiffPreviewSettings() {
  return (
    <SettingsCard>
      <SettingsCollapsibleRow label="Diff preview" testID="diff-preview">
        <Preview />
      </SettingsCollapsibleRow>
    </SettingsCard>
  );
}
