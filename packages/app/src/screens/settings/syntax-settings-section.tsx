import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "@/components/icons/material-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { type Theme } from "@/styles/theme";
import {
  SYNTAX_THEME_OPTIONS,
  type SyntaxThemeId,
  type SyntaxThemeOption,
} from "@otto-code/highlight";
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

/**
 * Code colors only. Ruler options belong to the File editor section, and diff
 * options to the Diff section - neither is a syntax choice.
 */
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
  return (
    <SettingsSection title={t("settings.appearance.syntax.title")}>
      <View style={settingsStyles.card}>
        <SyntaxRow value={settings.syntaxTheme} onChange={handleSyntaxThemeChange} />
      </View>
      <View style={styles.preview}>
        <AppearancePreview overrides={previewOverrides} />
      </View>
    </SettingsSection>
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
}));
