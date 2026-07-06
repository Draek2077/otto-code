import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Monitor, Moon, Sun } from "@/components/icons/material-icons";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  SYNTAX_THEME_OPTIONS,
  type SyntaxThemeId,
  type SyntaxThemeOption,
} from "@otto-code/highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  MAX_CODE_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  parseClampedFontSize,
  sanitizeFontFamily,
  useAppSettings,
  type AppSettings,
} from "@/hooks/use-settings";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  DEFAULT_MONO_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  THEME_SWATCHES,
  type DarkThemeName,
  type LightThemeName,
  type Theme,
  type ThemeVariantName,
} from "@/styles/theme";
import { isNative } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";
import { AppearancePreview } from "./appearance-preview";

// ---------------------------------------------------------------------------
// Theme-reactive leaf icons (withUnistyles + uniProps color mapping — no
// useUnistyles). `size` is folded into the mapping (not a static prop) so it
// repaints from the live, compact-doubled `theme.iconSize` the same way `color`
// already does.
// ---------------------------------------------------------------------------

const ThemedChevronDown = withUnistyles(ChevronDown);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

function getThemeLabel(t: TFunction, value: ThemeVariantName): string {
  const labelKeys: Record<ThemeVariantName, string> = {
    dark: "settings.appearance.theme.options.dark",
    daylight: "settings.appearance.theme.options.daylight",
    evergreen: "settings.appearance.theme.options.evergreen",
    zinc: "settings.appearance.theme.options.zinc",
    midnight: "settings.appearance.theme.options.midnight",
    claude: "settings.appearance.theme.options.claude",
    ghostty: "settings.appearance.theme.options.ghostty",
    cyberpunk: "settings.appearance.theme.options.cyberpunk",
    pastel: "settings.appearance.theme.options.pastel",
    meadow: "settings.appearance.theme.options.meadow",
    terracotta: "settings.appearance.theme.options.terracotta",
    horizon: "settings.appearance.theme.options.horizon",
    powder: "settings.appearance.theme.options.powder",
  };
  return t(labelKeys[value]);
}

// Each list leads with the spectrum's neutral default (Daylight/Twilight),
// followed by its tinted variants. Only one list is ever shown at a time,
// scoped to the current mode (see `AppearanceSection`'s `effectiveSpectrum`).
const LIGHT_THEMES: readonly LightThemeName[] = [
  "daylight",
  "meadow",
  "terracotta",
  "horizon",
  "powder",
  "pastel",
];
const DARK_THEMES: readonly DarkThemeName[] = [
  "dark",
  "evergreen",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "cyberpunk",
];

// Platform default stacks can be the bare native tokens ("normal"/"monospace");
// those read as a bug, so show a human label in the placeholder instead.
const BARE_DEFAULT_STACKS: ReadonlySet<string> = new Set(["normal", "monospace"]);

function resolveDefaultStackPlaceholder(t: TFunction, stack: string): string {
  return BARE_DEFAULT_STACKS.has(stack) ? t("settings.appearance.fonts.systemDefault") : stack;
}

// Local size string (digits only) -> preview override number. Empty/invalid
// yields undefined so the preview falls back to the committed theme value.
function sizeDraftToOverride(value: string): number | undefined {
  if (value.length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}

// ---------------------------------------------------------------------------
// Mode picker (Light / Dark / System)
// ---------------------------------------------------------------------------

interface ModeRowProps {
  value: AppSettings["colorSchemeMode"];
  onChange: (mode: AppSettings["colorSchemeMode"]) => void;
}

function ModeRow({ value, onChange }: ModeRowProps) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<AppSettings["colorSchemeMode"]>[]>(
    () => [
      {
        value: "light",
        label: t("settings.appearance.theme.modes.light"),
        icon: ({ color, size }) => <Sun color={color} size={size} />,
      },
      {
        value: "dark",
        label: t("settings.appearance.theme.modes.dark"),
        icon: ({ color, size }) => <Moon color={color} size={size} />,
      },
      {
        value: "system",
        label: t("settings.appearance.theme.modes.system"),
        icon: ({ color, size }) => <Monitor color={color} size={size} />,
      },
    ],
    [t],
  );
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.appearance.theme.mode")}</Text>
      </View>
      <SegmentedControl
        size="sm"
        value={value}
        onValueChange={onChange}
        options={options}
        testID="settings-color-scheme-mode"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Theme variant picker — scoped to whichever spectrum is currently effective
// (see `AppearanceSection`'s `effectiveSpectrum`); never shows both lists.
// ---------------------------------------------------------------------------

interface ThemeSwatchProps {
  color: string;
}

function ThemeSwatch({ color }: ThemeSwatchProps) {
  const swatchStyle = useMemo(() => [styles.swatch, { backgroundColor: color }], [color]);
  return <View style={swatchStyle} />;
}

interface ThemeMenuItemProps {
  themeValue: ThemeVariantName;
  selected: boolean;
  onChange: (theme: ThemeVariantName) => void;
}

function ThemeMenuItem({ themeValue, selected, onChange }: ThemeMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(() => <ThemeSwatch color={THEME_SWATCHES[themeValue]} />, [themeValue]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {getThemeLabel(t, themeValue)}
    </DropdownMenuItem>
  );
}

interface ThemeRowProps {
  list: readonly ThemeVariantName[];
  value: ThemeVariantName;
  onChange: (theme: ThemeVariantName) => void;
}

function ThemeRow({ list, value, onChange }: ThemeRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getThemeLabel(t, value);
  return (
    <View style={styles.rowWithBorder}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.appearance.theme.title")}</Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.theme.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <ThemeSwatch color={THEME_SWATCHES[value]} />
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {list.map((themeValue) => (
            <ThemeMenuItem
              key={themeValue}
              themeValue={themeValue}
              selected={value === themeValue}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fonts: family text fields + numeric size fields (commit on blur/submit)
// ---------------------------------------------------------------------------

interface FontFamilyRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  placeholder: string;
  value: string;
  draft: string;
  withBorder: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: (value: string) => void;
}

function FontFamilyRow({
  title,
  hint,
  accessibilityLabel,
  placeholder,
  value,
  draft,
  withBorder,
  onChangeDraft,
  onCommit,
}: FontFamilyRowProps) {
  const handleCommit = useCallback(() => {
    onCommit(draft);
  }, [draft, onCommit]);

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    onChangeDraft(value);
    // Only resync on external value changes, not on local keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <TextInput
        value={draft}
        onChangeText={onChangeDraft}
        onBlur={handleCommit}
        onSubmitEditing={handleCommit}
        placeholder={placeholder}
        placeholderTextColor={styles.placeholderColor.color}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fontFamilyInput}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

interface FontSizeRowProps {
  title: string;
  accessibilityLabel: string;
  draft: string;
  withBorder?: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
}

function FontSizeRow({
  title,
  accessibilityLabel,
  draft,
  withBorder = true,
  onChangeDraft,
  onCommit,
}: FontSizeRowProps) {
  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <View style={styles.sizeField}>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          onBlur={onCommit}
          onSubmitEditing={onCommit}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={styles.sizeInput}
          accessibilityLabel={accessibilityLabel}
        />
        <Text style={styles.unit}>px</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Syntax highlight theme picker (commits immediately)
// ---------------------------------------------------------------------------

function syntaxLabelForId(id: SyntaxThemeId): string {
  const option = SYNTAX_THEME_OPTIONS.find((entry) => entry.id === id);
  return option ? option.label : id;
}

interface SyntaxMenuItemProps {
  option: SyntaxThemeOption;
  selected: boolean;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxMenuItem({ option, selected, onChange }: SyntaxMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(option.id);
  }, [onChange, option.id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

interface SyntaxRowProps {
  value: SyntaxThemeId;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxRow({ value, onChange }: SyntaxRowProps) {
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
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.syntax.highlightThemeAccessibility", {
            value: selectedLabel,
          })}
        >
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {SYNTAX_THEME_OPTIONS.map((option) => (
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

// ---------------------------------------------------------------------------
// Chat width picker (Default / Wide / Full)
// ---------------------------------------------------------------------------

interface ChatWidthRowProps {
  value: AppSettings["chatWidth"];
  onChange: (chatWidth: AppSettings["chatWidth"]) => void;
}

function ChatWidthRow({ value, onChange }: ChatWidthRowProps) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<AppSettings["chatWidth"]>[]>(
    () => [
      { value: "default", label: t("settings.appearance.layout.chatWidth.options.default") },
      { value: "wide", label: t("settings.appearance.layout.chatWidth.options.wide") },
      { value: "full", label: t("settings.appearance.layout.chatWidth.options.full") },
    ],
    [t],
  );
  return (
    <View style={styles.rowWithBorder}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.appearance.layout.chatWidth.title")}
        </Text>
        <Text style={settingsStyles.rowHint}>{t("settings.appearance.layout.chatWidth.hint")}</Text>
      </View>
      <SegmentedControl
        size="sm"
        value={value}
        onValueChange={onChange}
        options={options}
        testID="settings-chat-width"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout: compact sidebar top spacing + workspace tools placement (booleans)
// ---------------------------------------------------------------------------

interface LayoutToggleRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  value: boolean;
  withBorder: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
}

function LayoutToggleRow({
  title,
  hint,
  accessibilityLabel,
  value,
  withBorder,
  onValueChange,
  testID,
}: LayoutToggleRowProps) {
  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const showFontFamilyRows = !isNative;
  const showLayoutSection = !isNative;
  const uiFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_UI_FONT_STACK);
  const monoFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_MONO_FONT_STACK);

  const [uiFontDraft, setUiFontDraft] = useState(settings.uiFontFamily);
  const [monoFontDraft, setMonoFontDraft] = useState(settings.monoFontFamily);
  const [uiSizeDraft, setUiSizeDraft] = useState(String(settings.uiFontSize));
  const [codeSizeDraft, setCodeSizeDraft] = useState(String(settings.codeFontSize));

  // Resync numeric drafts when the committed value changes elsewhere.
  useEffect(() => {
    setUiSizeDraft(String(settings.uiFontSize));
  }, [settings.uiFontSize]);
  useEffect(() => {
    setCodeSizeDraft(String(settings.codeFontSize));
  }, [settings.codeFontSize]);

  // When mode is System, the variant list is scoped to whichever spectrum the
  // OS is CURRENTLY reporting (not a fixed neutral pair) — this re-renders
  // live if the OS scheme flips while the settings screen is open.
  const osColorScheme = useColorScheme();
  let effectiveSpectrum: "light" | "dark";
  if (settings.colorSchemeMode === "system") {
    effectiveSpectrum = osColorScheme === "dark" ? "dark" : "light";
  } else {
    effectiveSpectrum = settings.colorSchemeMode;
  }
  const scopedThemeList = effectiveSpectrum === "light" ? LIGHT_THEMES : DARK_THEMES;
  const scopedThemeValue = effectiveSpectrum === "light" ? settings.lightTheme : settings.darkTheme;

  const handleModeChange = useCallback(
    (colorSchemeMode: AppSettings["colorSchemeMode"]) => {
      void updateSettings({ colorSchemeMode });
    },
    [updateSettings],
  );

  // Only ever updates the spectrum currently shown — never colorSchemeMode —
  // so switching modes back and forth never resets a per-spectrum pick.
  const handleThemeVariantChange = useCallback(
    (variant: ThemeVariantName) => {
      if (effectiveSpectrum === "light") {
        void updateSettings({ lightTheme: variant as LightThemeName });
      } else {
        void updateSettings({ darkTheme: variant as DarkThemeName });
      }
    },
    [effectiveSpectrum, updateSettings],
  );

  const handleBlackTabBackgroundChange = useCallback(
    (blackTabBackground: boolean) => {
      void updateSettings({ blackTabBackground });
    },
    [updateSettings],
  );

  const handleSyntaxThemeChange = useCallback(
    (syntaxTheme: SyntaxThemeId) => {
      void updateSettings({ syntaxTheme });
    },
    [updateSettings],
  );

  const handleCompactSidebarTopSpacingChange = useCallback(
    (compactSidebarTopSpacing: boolean) => {
      void updateSettings({ compactSidebarTopSpacing });
    },
    [updateSettings],
  );

  const handleWorkspaceToolsPlacementChange = useCallback(
    (showInWorkspaceList: boolean) => {
      void updateSettings({
        workspaceToolsPlacement: showInWorkspaceList ? "workspaceList" : "header",
      });
    },
    [updateSettings],
  );

  const handleChatWidthChange = useCallback(
    (chatWidth: AppSettings["chatWidth"]) => {
      void updateSettings({ chatWidth });
    },
    [updateSettings],
  );

  const commitUiFontFamily = useCallback(
    (value: string) => {
      const sanitized = sanitizeFontFamily(value);
      if (sanitized === null) {
        setUiFontDraft(settings.uiFontFamily);
        return;
      }
      setUiFontDraft(sanitized);
      if (sanitized !== settings.uiFontFamily) {
        void updateSettings({ uiFontFamily: sanitized });
      }
    },
    [settings.uiFontFamily, updateSettings],
  );

  const commitMonoFontFamily = useCallback(
    (value: string) => {
      const sanitized = sanitizeFontFamily(value);
      if (sanitized === null) {
        setMonoFontDraft(settings.monoFontFamily);
        return;
      }
      setMonoFontDraft(sanitized);
      if (sanitized !== settings.monoFontFamily) {
        void updateSettings({ monoFontFamily: sanitized });
      }
    },
    [settings.monoFontFamily, updateSettings],
  );

  const handleUiSizeChange = useCallback((value: string) => {
    setUiSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const handleCodeSizeChange = useCallback((value: string) => {
    setCodeSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const commitUiSize = useCallback(() => {
    const parsed = parseClampedFontSize(uiSizeDraft, {
      min: MIN_UI_FONT_SIZE,
      max: MAX_UI_FONT_SIZE,
    });
    const next = parsed ?? settings.uiFontSize;
    setUiSizeDraft(String(next));
    if (next !== settings.uiFontSize) {
      void updateSettings({ uiFontSize: next });
    }
  }, [settings.uiFontSize, uiSizeDraft, updateSettings]);

  const commitCodeSize = useCallback(() => {
    const parsed = parseClampedFontSize(codeSizeDraft, {
      min: MIN_CODE_FONT_SIZE,
      max: MAX_CODE_FONT_SIZE,
    });
    const next = parsed ?? settings.codeFontSize;
    setCodeSizeDraft(String(next));
    if (next !== settings.codeFontSize) {
      void updateSettings({ codeFontSize: next });
    }
  }, [codeSizeDraft, settings.codeFontSize, updateSettings]);

  // Live-while-typing: the in-progress drafts drive the preview without
  // committing to the global theme. Empty/invalid fields fall back to the
  // theme value inside the preview.
  const previewOverrides = useMemo(
    () => ({
      monoFontFamily: monoFontDraft,
      codeFontSize: sizeDraftToOverride(codeSizeDraft),
    }),
    [codeSizeDraft, monoFontDraft],
  );

  return (
    <View>
      <SettingsSection title={t("settings.appearance.theme.title")}>
        <View style={settingsStyles.card}>
          <ModeRow value={settings.colorSchemeMode} onChange={handleModeChange} />
          <ThemeRow
            list={scopedThemeList}
            value={scopedThemeValue}
            onChange={handleThemeVariantChange}
          />
          <LayoutToggleRow
            title={t("settings.appearance.theme.blackTabBackground.title")}
            hint={t("settings.appearance.theme.blackTabBackground.hint")}
            accessibilityLabel={t(
              "settings.appearance.theme.blackTabBackground.accessibilityLabel",
            )}
            value={settings.blackTabBackground}
            withBorder
            onValueChange={handleBlackTabBackgroundChange}
            testID="settings-black-tab-background-switch"
          />
        </View>
      </SettingsSection>
      {showLayoutSection ? (
        <SettingsSection title={t("settings.appearance.layout.title")}>
          <View style={settingsStyles.card}>
            <LayoutToggleRow
              title={t("settings.appearance.layout.compactSidebarTopSpacing.title")}
              hint={t("settings.appearance.layout.compactSidebarTopSpacing.hint")}
              accessibilityLabel={t(
                "settings.appearance.layout.compactSidebarTopSpacing.accessibilityLabel",
              )}
              value={settings.compactSidebarTopSpacing}
              withBorder={false}
              onValueChange={handleCompactSidebarTopSpacingChange}
              testID="settings-compact-sidebar-top-spacing-switch"
            />
            <LayoutToggleRow
              title={t("settings.appearance.layout.workspaceToolsInList.title")}
              hint={t("settings.appearance.layout.workspaceToolsInList.hint")}
              accessibilityLabel={t(
                "settings.appearance.layout.workspaceToolsInList.accessibilityLabel",
              )}
              value={settings.workspaceToolsPlacement === "workspaceList"}
              withBorder
              onValueChange={handleWorkspaceToolsPlacementChange}
              testID="settings-workspace-tools-placement-switch"
            />
            <ChatWidthRow value={settings.chatWidth} onChange={handleChatWidthChange} />
          </View>
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("settings.appearance.fonts.title")}>
        <View style={settingsStyles.card}>
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.interfaceFont")}
              hint={t("settings.appearance.fonts.interfaceFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.interfaceFontAccessibility")}
              placeholder={uiFontPlaceholder}
              value={settings.uiFontFamily}
              draft={uiFontDraft}
              withBorder={false}
              onChangeDraft={setUiFontDraft}
              onCommit={commitUiFontFamily}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.interfaceSize")}
            accessibilityLabel={t("settings.appearance.fonts.interfaceSizeAccessibility")}
            draft={uiSizeDraft}
            withBorder={showFontFamilyRows}
            onChangeDraft={handleUiSizeChange}
            onCommit={commitUiSize}
          />
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.codeFont")}
              hint={t("settings.appearance.fonts.codeFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.codeFontAccessibility")}
              placeholder={monoFontPlaceholder}
              value={settings.monoFontFamily}
              draft={monoFontDraft}
              withBorder
              onChangeDraft={setMonoFontDraft}
              onCommit={commitMonoFontFamily}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.codeSize")}
            accessibilityLabel={t("settings.appearance.fonts.codeSizeAccessibility")}
            draft={codeSizeDraft}
            onChangeDraft={handleCodeSizeChange}
            onCommit={commitCodeSize}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.syntax.title")}>
        <View style={settingsStyles.card}>
          <SyntaxRow value={settings.syntaxTheme} onChange={handleSyntaxThemeChange} />
        </View>
        <View style={styles.preview}>
          <AppearancePreview overrides={previewOverrides} />
        </View>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    marginTop: theme.spacing[4],
  },
  rowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  swatch: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    borderRadius: theme.iconSize.md / 2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fontFamilyInput: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "left",
  },
  sizeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sizeInput: {
    width: 64,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
