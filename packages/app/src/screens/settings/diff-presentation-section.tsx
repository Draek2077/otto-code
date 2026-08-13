import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "./settings-section";

/** Global default only. Every review surface keeps its own transient override. */
export function DiffPresentationSection() {
  const { preferences, updatePreferences } = useChangesPreferences();
  const options = useMemo(
    () => [
      { value: "line", label: "Line" },
      { value: "structural", label: "Structural" },
    ],
    [],
  );
  const handleChange = useCallback(
    (presentation: string) => {
      if (presentation === "line" || presentation === "structural") {
        void updatePreferences({ presentation });
      }
    },
    [updatePreferences],
  );

  return (
    <SettingsSection title="Diff presentation">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Default view</Text>
            <Text style={settingsStyles.rowHint}>
              Choose the default for new diffs. A local switch changes only the review you are
              looking at. Structural falls back to the complete Line diff when it cannot align the
              file safely.
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            value={preferences.presentation}
            onValueChange={handleChange}
            options={options}
            testID="settings-diff-presentation"
          />
        </View>
      </View>
    </SettingsSection>
  );
}
