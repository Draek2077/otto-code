import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { DiffPresentationPreview } from "./diff-presentation-preview";
import { SettingsSection } from "./settings-section";

/**
 * Every diff option in one section, review view first: the renderer choice
 * decides what the rows under it mean. The live preview is its own section so
 * a sample diff never reads as another setting.
 */
export function DiffPresentationSection() {
  const { preferences, updatePreferences } = useChangesPreferences();
  const { settings, updateSettings } = useAppSettings();
  const presentationOptions = useMemo(
    () => [
      { value: "line", label: "Line" },
      { value: "structural", label: "Structural" },
    ],
    [],
  );
  const replacementOptions = useMemo<
    SegmentedControlOption<AppSettings["structuralReplacementPresentation"]>[]
  >(
    () => [
      { value: "new-token", label: "New token" },
      { value: "before-after", label: "Old → new" },
    ],
    [],
  );
  const handlePresentationChange = useCallback(
    (presentation: string) => {
      if (presentation === "line" || presentation === "structural") {
        void updatePreferences({ presentation });
      }
    },
    [updatePreferences],
  );
  const handleFormattingDiffHighlightsChange = useCallback(
    (formattingDiffHighlights: boolean) => void updateSettings({ formattingDiffHighlights }),
    [updateSettings],
  );
  const handleReplacementPresentationChange = useCallback(
    (structuralReplacementPresentation: AppSettings["structuralReplacementPresentation"]) =>
      void updateSettings({ structuralReplacementPresentation }),
    [updateSettings],
  );

  return (
    <SettingsSection title="Diff">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Review view</Text>
            <Text style={settingsStyles.rowHint}>
              Used by Changes, History, Refine, and agent edits. Structural falls back to Line when
              a file cannot be aligned safely.
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            value={preferences.presentation}
            onValueChange={handlePresentationChange}
            options={presentationOptions}
            testID="settings-diff-presentation"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Formatting-only changes</Text>
            <Text style={settingsStyles.rowHint}>
              Show whitespace-only changes in a neutral color. Off hides them.
            </Text>
          </View>
          <Switch
            value={settings.formattingDiffHighlights}
            onValueChange={handleFormattingDiffHighlightsChange}
            accessibilityLabel="Formatting-only changes"
            testID="settings-formatting-diff-highlights-switch"
          />
        </View>
        <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Compact replacements</Text>
            <Text style={settingsStyles.rowHint}>
              Show a small Structural replacement as the new token, or as old and new side by side.
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            value={settings.structuralReplacementPresentation}
            onValueChange={handleReplacementPresentationChange}
            options={replacementOptions}
            testID="settings-structural-replacement-presentation"
          />
        </View>
      </View>
    </SettingsSection>
  );
}

/** The sample-diff sandbox. Nothing here changes a setting. */
export function DiffPreviewSection() {
  const { settings } = useAppSettings();
  return (
    <SettingsSection title="Diff preview">
      <View style={settingsStyles.card}>
        <DiffPresentationPreview showFormattingChanges={settings.formattingDiffHighlights} />
      </View>
    </SettingsSection>
  );
}
