import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "./settings-section";

/** The one persisted presentation choice used by every code-review surface. */
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
            <Text style={settingsStyles.rowTitle}>Review view</Text>
            <Text style={settingsStyles.rowHint}>
              Applies to Changes, History, Refine, and agent edits. Structural uses Line only when
              the file cannot be aligned safely.
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
