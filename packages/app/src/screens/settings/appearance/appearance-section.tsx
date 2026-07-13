import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Monitor, Moon, Sun } from "@/components/icons/material-icons";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
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

function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}

// Responsive rows whose trailing control is wide (segmented control, text
// input, slider). They stack the control below the label on compact widths.
const ROW_RESPONSIVE_WITH_BORDER = [settingsStyles.rowResponsive, settingsStyles.rowBorder];

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
    <View style={settingsStyles.rowResponsive}>
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
    <View style={withBorder ? ROW_RESPONSIVE_WITH_BORDER : settingsStyles.rowResponsive}>
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
  min: number;
  max: number;
  draft: number;
  withBorder?: boolean;
  onChangeDraft: (value: number) => void;
  onCommit: (value: number) => void;
}

function FontSizeRow({
  title,
  accessibilityLabel,
  min,
  max,
  draft,
  withBorder = true,
  onChangeDraft,
  onCommit,
}: FontSizeRowProps) {
  return (
    <View style={withBorder ? ROW_RESPONSIVE_WITH_BORDER : settingsStyles.rowResponsive}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <View style={styles.sizeField}>
        <Slider
          min={min}
          max={max}
          value={draft}
          onValueChange={onChangeDraft}
          onSlidingComplete={onCommit}
          accessibilityLabel={accessibilityLabel}
        />
        <Text style={styles.sizeValue}>{draft}px</Text>
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
    <View style={ROW_RESPONSIVE_WITH_BORDER}>
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
// Message timestamp display (Clock time / Time ago)
// ---------------------------------------------------------------------------

interface MessageTimestampRowProps {
  value: AppSettings["chatTimestampDisplay"];
  onChange: (value: AppSettings["chatTimestampDisplay"]) => void;
}

function MessageTimestampRow({ value, onChange }: MessageTimestampRowProps) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<AppSettings["chatTimestampDisplay"]>[]>(
    () => [
      {
        value: "absolute",
        label: t("settings.appearance.agents.messageTimestamp.options.absolute"),
      },
      {
        value: "relative",
        label: t("settings.appearance.agents.messageTimestamp.options.relative"),
      },
    ],
    [t],
  );
  return (
    <View style={ROW_RESPONSIVE_WITH_BORDER}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.appearance.agents.messageTimestamp.title")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.appearance.agents.messageTimestamp.hint")}
        </Text>
      </View>
      <SegmentedControl
        size="sm"
        value={value}
        onValueChange={onChange}
        options={options}
        testID="settings-chat-timestamp-display"
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
  const [uiSizeDraft, setUiSizeDraft] = useState(settings.uiFontSize);
  const [codeSizeDraft, setCodeSizeDraft] = useState(settings.codeFontSize);

  // Resync numeric drafts when the committed value changes elsewhere.
  useEffect(() => {
    setUiSizeDraft(settings.uiFontSize);
  }, [settings.uiFontSize]);
  useEffect(() => {
    setCodeSizeDraft(settings.codeFontSize);
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

  const handleAutoExpandReasoningChange = useCallback(
    (autoExpandReasoning: boolean) => {
      void updateSettings({ autoExpandReasoning });
    },
    [updateSettings],
  );

  const handleGroupConsecutiveActionsChange = useCallback(
    (groupConsecutiveActions: boolean) => {
      void updateSettings({ groupConsecutiveActions });
    },
    [updateSettings],
  );

  const handleHideChatMessageDetailsChange = useCallback(
    (hideChatMessageDetails: boolean) => {
      void updateSettings({ hideChatMessageDetails });
    },
    [updateSettings],
  );

  const handleChatTimestampDisplayChange = useCallback(
    (chatTimestampDisplay: AppSettings["chatTimestampDisplay"]) => {
      void updateSettings({ chatTimestampDisplay });
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

  const handleTeamSwitcherPlacementChange = useCallback(
    (showInTitlebar: boolean) => {
      void updateSettings({
        teamSwitcherPlacement: showInTitlebar ? "titlebar" : "sidebar",
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

  const handleHidePinnedToolbarOptionsChange = useCallback(
    (hidePinnedToolbarOptions: boolean) => {
      void updateSettings({ hidePinnedToolbarOptions });
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

  const commitUiSize = useCallback(
    (value: number) => {
      const next = parseClampedFontSize(value, {
        min: MIN_UI_FONT_SIZE,
        max: MAX_UI_FONT_SIZE,
      });
      if (next !== null && next !== settings.uiFontSize) {
        void updateSettings({ uiFontSize: next });
      }
    },
    [settings.uiFontSize, updateSettings],
  );

  const commitCodeSize = useCallback(
    (value: number) => {
      const next = parseClampedFontSize(value, {
        min: MIN_CODE_FONT_SIZE,
        max: MAX_CODE_FONT_SIZE,
      });
      if (next !== null && next !== settings.codeFontSize) {
        void updateSettings({ codeFontSize: next });
      }
    },
    [settings.codeFontSize, updateSettings],
  );

  // Live-while-dragging: the in-progress draft drives the preview without
  // committing to the global theme until the slider is released.
  const previewOverrides = useMemo(
    () => ({
      monoFontFamily: monoFontDraft,
      codeFontSize: codeSizeDraft,
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
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.agents.title")}>
        <View style={settingsStyles.card}>
          <LayoutToggleRow
            title={t("settings.appearance.agents.blackChatBackground.title")}
            hint={t("settings.appearance.agents.blackChatBackground.hint")}
            accessibilityLabel={t(
              "settings.appearance.agents.blackChatBackground.accessibilityLabel",
            )}
            value={settings.blackTabBackground}
            withBorder={false}
            onValueChange={handleBlackTabBackgroundChange}
            testID="settings-black-tab-background-switch"
          />
          <LayoutToggleRow
            title={t("settings.appearance.agents.groupConsecutiveActions.title")}
            hint={t("settings.appearance.agents.groupConsecutiveActions.hint")}
            accessibilityLabel={t(
              "settings.appearance.agents.groupConsecutiveActions.accessibilityLabel",
            )}
            value={settings.groupConsecutiveActions}
            withBorder
            onValueChange={handleGroupConsecutiveActionsChange}
            testID="settings-group-consecutive-actions-switch"
          />
          <LayoutToggleRow
            title={t("settings.appearance.agents.autoExpandReasoning.title")}
            hint={t("settings.appearance.agents.autoExpandReasoning.hint")}
            accessibilityLabel={t(
              "settings.appearance.agents.autoExpandReasoning.accessibilityLabel",
            )}
            value={settings.autoExpandReasoning}
            withBorder
            onValueChange={handleAutoExpandReasoningChange}
            testID="settings-auto-expand-reasoning-switch"
          />
          <LayoutToggleRow
            title={t("settings.appearance.agents.hideMessageDetails.title")}
            hint={t("settings.appearance.agents.hideMessageDetails.hint")}
            accessibilityLabel={t(
              "settings.appearance.agents.hideMessageDetails.accessibilityLabel",
            )}
            value={settings.hideChatMessageDetails}
            withBorder
            onValueChange={handleHideChatMessageDetailsChange}
            testID="settings-hide-message-details-switch"
          />
          <MessageTimestampRow
            value={settings.chatTimestampDisplay}
            onChange={handleChatTimestampDisplayChange}
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
            {/* i18n: English-only pending a translation pass (Agent Teams). */}
            <LayoutToggleRow
              title="Team switcher in title bar"
              hint="Move the Active Team switcher from the sidebar menu into the workspace title bar, ahead of the other tools."
              accessibilityLabel="Team switcher in title bar"
              value={settings.teamSwitcherPlacement === "titlebar"}
              withBorder
              onValueChange={handleTeamSwitcherPlacementChange}
              testID="settings-team-switcher-placement-switch"
            />
            <ChatWidthRow value={settings.chatWidth} onChange={handleChatWidthChange} />
            <LayoutToggleRow
              title={t("settings.appearance.layout.hidePinnedToolbarOptions.title")}
              hint={t("settings.appearance.layout.hidePinnedToolbarOptions.hint")}
              accessibilityLabel={t(
                "settings.appearance.layout.hidePinnedToolbarOptions.accessibilityLabel",
              )}
              value={settings.hidePinnedToolbarOptions}
              withBorder
              onValueChange={handleHidePinnedToolbarOptionsChange}
              testID="settings-hide-pinned-toolbar-options-switch"
            />
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
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            draft={uiSizeDraft}
            withBorder={showFontFamilyRows}
            onChangeDraft={setUiSizeDraft}
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
            min={MIN_CODE_FONT_SIZE}
            max={MAX_CODE_FONT_SIZE}
            draft={codeSizeDraft}
            onChangeDraft={setCodeSizeDraft}
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
    // When stacked the row centers the input; give it a definite width so it
    // fills up to its cap (rather than shrinking to content) before centering.
    width: { xs: "100%", sm: "auto" },
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
    gap: theme.spacing[3],
    // `flexBasis: "auto"` (not `flex: 1`) so the field keeps its height when the
    // row stacks in a column; a 0 basis would collapse it and overlap the label.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    // Definite width so the centered slider fills up to its cap when stacked.
    width: { xs: "100%", sm: "auto" },
    maxWidth: 220,
    // No left inset when the slider drops below its label when stacked.
    marginLeft: { xs: 0, sm: theme.spacing[4] },
  },
  sizeValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 36,
    textAlign: "right",
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
