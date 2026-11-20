import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { SelectField } from "@/components/ui/select-field";
import { useHostFeature } from "@/runtime/host-features";
import type { DiffPresentation } from "./structural";

const options = [
  { id: "line", value: "line" as const, label: "Line" },
  { id: "structural", value: "structural" as const, label: "Structural" },
];

export function useDiffPresentation() {
  const { preferences } = useChangesPreferences();
  const [local, setLocal] = useState<DiffPresentation | null>(null);
  return { presentation: local ?? preferences.presentation, select: setLocal };
}

export function useHostDiffReview(serverId: string, surface?: string) {
  // COMPAT(ottoStructuralDiff): added v0.10.0; remove after 2027-05-20.
  const supported = useHostFeature(serverId, "ottoStructuralDiff");
  const reviewPresentation = useDiffPresentation();
  return {
    reviewPresentation,
    includeStructuralSource:
      supported && surface !== "tree" && reviewPresentation.presentation === "structural",
  };
}

function PresentationSelect({
  value,
  onChange,
  disabled,
}: {
  value: DiffPresentation;
  onChange(value: DiffPresentation): void;
  disabled?: boolean;
}) {
  const choose = useCallback(
    (next: string) => {
      if (next === "line" || next === "structural") onChange(next);
    },
    [onChange],
  );
  return (
    <SelectField
      label="Diff presentation"
      triggerTestID="otto-diff-presentation"
      placeholder="Line"
      emptyText="No presentations"
      selectedDisplay={value === "line" ? options[0] : options[1]}
      options={options}
      value={value}
      onChange={choose}
      disabled={disabled}
      field={false}
      size="sm"
    />
  );
}

export function DiffPresentationControl({
  value,
  onChange,
}: {
  value: DiffPresentation;
  onChange(value: DiffPresentation): void;
}) {
  return (
    <View style={styles.control}>
      <PresentationSelect value={value} onChange={onChange} />
    </View>
  );
}

export function DiffPresentationSettings() {
  const { preferences, updatePreferences, isLoading } = useChangesPreferences();
  const set = useCallback(
    (presentation: DiffPresentation) => void updatePreferences({ presentation }),
    [updatePreferences],
  );
  return (
    <SettingsSection title="Diffs">
      <SettingsCard>
        <SettingsRow label="Default diff presentation">
          <PresentationSelect
            value={preferences.presentation}
            onChange={set}
            disabled={isLoading}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  control: {
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
}));
