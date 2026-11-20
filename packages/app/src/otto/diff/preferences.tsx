import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { SelectField } from "@/components/ui/select-field";
import { useHostFeature } from "@/runtime/host-features";
import AsyncStorage from "@/otto/async-storage";
import type { DiffPresentation } from "./structural";

interface State {
  presentation: DiffPresentation;
  setPresentation(value: DiffPresentation): void;
}

const useDiffPreferences = create<State>()(
  persist(
    (set) => ({
      presentation: "line",
      setPresentation: (presentation) => set({ presentation }),
    }),
    {
      name: "diff-presentation",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ presentation }) => ({ presentation }),
      merge: (saved, current) => ({
        ...current,
        presentation:
          (saved as Partial<State> | undefined)?.presentation === "structural"
            ? "structural"
            : "line",
      }),
    },
  ),
);

const options = [
  { id: "line", value: "line" as const, label: "Line" },
  { id: "structural", value: "structural" as const, label: "Structural" },
];

export function useDiffPresentation() {
  const preferred = useDiffPreferences((state) => state.presentation);
  const [local, setLocal] = useState<DiffPresentation | null>(null);
  return { presentation: local ?? preferred, select: setLocal };
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
}: {
  value: DiffPresentation;
  onChange(value: DiffPresentation): void;
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
  const value = useDiffPreferences((state) => state.presentation);
  const set = useDiffPreferences((state) => state.setPresentation);
  return (
    <SettingsSection title="Diffs">
      <SettingsCard>
        <SettingsRow label="Default diff presentation">
          <PresentationSelect value={value} onChange={set} />
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
