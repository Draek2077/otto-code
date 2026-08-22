import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "@/components/icons/material-icons";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MAX_RULER_COLUMN,
  MIN_RULER_COLUMN,
  parseClampedFontSize,
  useAppSettings,
  type AppSettings,
} from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { type Theme } from "@/styles/theme";
import {
  SYNTAX_THEME_OPTIONS,
  type SyntaxThemeId,
  type SyntaxThemeOption,
} from "@otto-code/highlight";
import { DiffPresentationPreview } from "./diff-presentation-preview";
import { SettingsSection } from "./settings-section";
import { AppearancePreview } from "./appearance/appearance-preview";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

function syntaxLabelForId(id: SyntaxThemeId): string {
  return SYNTAX_THEME_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

function SyntaxMenuItem({
  option,
  selected,
  onChange,
}: {
  option: SyntaxThemeOption;
  selected: boolean;
  onChange: (id: SyntaxThemeId) => void;
}) {
  const handleSelect = useCallback(() => onChange(option.id), [onChange, option.id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

function SyntaxRow({
  value,
  onChange,
}: {
  value: SyntaxThemeId;
  onChange: (id: SyntaxThemeId) => void;
}) {
  const { t } = useTranslation();
  const selectedLabel = syntaxLabelForId(value);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.appearance.syntax.highlightTheme")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.appearance.syntax.highlightThemeHint")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={styles.dropdownTrigger}
          accessibilityLabel={t("settings.appearance.syntax.highlightThemeAccessibility", {
            value: selectedLabel,
          })}
        >
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {SYNTAX_THEME_OPTIONS.map((option: SyntaxThemeOption) => (
            <SyntaxMenuItem
              key={option.id}
              option={option}
              selected={value === option.id}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function ReplacementPresentationRow({
  value,
  onChange,
}: {
  value: AppSettings["structuralReplacementPresentation"];
  onChange: (value: AppSettings["structuralReplacementPresentation"]) => void;
}) {
  const options = useMemo<
    SegmentedControlOption<AppSettings["structuralReplacementPresentation"]>[]
  >(
    () => [
      { value: "new-token", label: "New token" },
      { value: "before-after", label: "Old → new" },
    ],
    [],
  );
  return (
    <View style={settingsStyles.rowResponsive}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Compact replacements</Text>
        <Text style={settingsStyles.rowHint}>
          Show a small Structural replacement as the new token only, or as adjacent old and new
          tokens.
        </Text>
      </View>
      <SegmentedControl
        size="sm"
        value={value}
        onValueChange={onChange}
        options={options}
        testID="settings-structural-replacement-presentation"
      />
    </View>
  );
}

function RulerColumnRow({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const handleChangeText = useCallback((text: string) => setDraft(text.replace(/[^0-9]/g, "")), []);
  const commit = useCallback(() => {
    const parsed = parseClampedFontSize(draft, { min: MIN_RULER_COLUMN, max: MAX_RULER_COLUMN });
    if (parsed === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(parsed));
    onCommit(parsed);
  }, [draft, onCommit, value]);
  return (
    <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Ruler column</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`Where the marker sits, in characters. Between ${MIN_RULER_COLUMN} and ${MAX_RULER_COLUMN}.`}</Text>
      </View>
      <TextInput
        value={draft}
        onChangeText={handleChangeText}
        onBlur={commit}
        onSubmitEditing={commit}
        editable={!disabled}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
        style={styles.rulerColumnInput}
        accessibilityLabel="Ruler column"
        testID="settings-ruler-column-input"
      />
    </View>
  );
}

export function SyntaxSettingsSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const previewOverrides = useMemo(
    () => ({
      monoFontFamily: settings.monoFontFamily,
      codeFontSize: settings.codeFontSize,
    }),
    [settings.codeFontSize, settings.monoFontFamily],
  );
  const handleSyntaxThemeChange = useCallback(
    (syntaxTheme: SyntaxThemeId) => void updateSettings({ syntaxTheme }),
    [updateSettings],
  );
  const handleFormattingDiffHighlightsChange = useCallback(
    (formattingDiffHighlights: boolean) => void updateSettings({ formattingDiffHighlights }),
    [updateSettings],
  );
  const handleStructuralReplacementPresentationChange = useCallback(
    (structuralReplacementPresentation: AppSettings["structuralReplacementPresentation"]) =>
      void updateSettings({ structuralReplacementPresentation }),
    [updateSettings],
  );
  const handleRulerEnabledChange = useCallback(
    (rulerEnabled: boolean) => void updateSettings({ rulerEnabled }),
    [updateSettings],
  );
  const handleRulerColumnCommit = useCallback(
    (rulerColumn: number) => void updateSettings({ rulerColumn }),
    [updateSettings],
  );
  return (
    <SettingsSection title={t("settings.appearance.syntax.title")}>
      <View style={settingsStyles.card}>
        <SyntaxRow value={settings.syntaxTheme} onChange={handleSyntaxThemeChange} />
        <LayoutToggleRow
          title="Formatting-only changes"
          hint="Show whitespace-only changes with a neutral theme color in diff review. Turn off to hide them entirely."
          accessibilityLabel="Formatting-only changes"
          value={settings.formattingDiffHighlights}
          onValueChange={handleFormattingDiffHighlightsChange}
          testID="settings-formatting-diff-highlights-switch"
        />
        <ReplacementPresentationRow
          value={settings.structuralReplacementPresentation}
          onChange={handleStructuralReplacementPresentationChange}
        />
        <DiffPresentationPreview showFormattingChanges={settings.formattingDiffHighlights} />
        <LayoutToggleRow
          title="Line-length ruler"
          hint="Draw a faint vertical line behind the code in the editor, marking a maximum line length."
          accessibilityLabel="Line-length ruler"
          value={settings.rulerEnabled}
          onValueChange={handleRulerEnabledChange}
          testID="settings-ruler-enabled-switch"
        />
        <RulerColumnRow
          value={settings.rulerColumn}
          disabled={!settings.rulerEnabled}
          onCommit={handleRulerColumnCommit}
        />
      </View>
      <View style={styles.preview}>
        <AppearancePreview overrides={previewOverrides} />
      </View>
    </SettingsSection>
  );
}

function LayoutToggleRow({
  title,
  hint,
  accessibilityLabel,
  value,
  onValueChange,
  testID,
}: {
  title: string;
  hint: string;
  accessibilityLabel: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID: string;
}) {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    marginTop: theme.spacing[4],
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  rulerColumnInput: {
    width: 80,
    color: theme.colors.foreground,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    textAlign: "right",
  },
}));
