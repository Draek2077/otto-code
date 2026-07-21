import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Buffer } from "buffer";
import {
  ArrowLeft,
  Settings,
  Palette,
  Server,
  Network,
  Bot,
  Boxes,
  Gauge,
  Groups,
  Keyboard,
  Stethoscope,
  Info,
  Shield,
  Puzzle,
  Plus,
  FolderGit2,
  SquareTerminal,
  Waypoints,
  Workspaces,
  Wrench,
} from "@/components/icons/material-icons";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { AppDiagnosticSheet } from "@/components/app-diagnostic-sheet";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarFooterNavRow } from "@/components/sidebar/sidebar-footer-nav";
import { KeyedFadeContainer } from "@/components/route-fade-container";
import { SidebarSeamShadow } from "@/components/sidebar-seam-shadow";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { HostPicker as SharedHostPicker } from "@/components/hosts/host-picker";
import { HostStatusDot } from "@/components/host-status-dot";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { AppearanceSection } from "@/screens/settings/appearance/appearance-section";
import { VisualizerSection } from "@/screens/settings/visualizer-section";
import {
  useAppSettings,
  useSettings,
  parseTerminalScrollbackLines,
  type AppSettings,
  type InterfaceMode,
  type AppStartScreen,
  type SuggestedTasksDefaultMode,
  type LinkOpenBehavior,
  type PreviewServerCloseBehavior,
  type SendBehavior,
  type ServiceUrlBehavior,
  type Settings as EffectiveSettings,
} from "@/hooks/use-settings";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, usePanelStore } from "@/stores/panel-store";
import { orderHostsLocalFirst, type HostProfile } from "@/types/host-connection";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { SIDEBAR_TOP_SPACER_TRIM } from "@/components/left-sidebar";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { SettingsContentErrorBoundary } from "@/components/settings-content-error-boundary";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { KeyboardShortcutsSection } from "@/screens/settings/keyboard-shortcuts-section";
import { Button } from "@/components/ui/button";
import { CommunityLinks } from "@/components/community-links";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DesktopPermissionsSection } from "@/desktop/components/desktop-permissions-section";
import { IntegrationsSection } from "@/desktop/components/integrations-section";
import {
  type EnableBuiltInDaemonOption,
  useEnableBuiltInDaemonOption,
} from "@/desktop/hooks/use-enable-built-in-daemon-option";
import { DesktopWindowBehaviorSection } from "@/desktop/components/desktop-window-behavior-section";
import { isElectronRuntime } from "@/desktop/host";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { UPSTREAM_BASE_NAME, UPSTREAM_BASE_VERSION } from "@/utils/upstream-base-version";
import {
  VISUALIZER_UPSTREAM_AUTHOR,
  VISUALIZER_UPSTREAM_LICENSE,
  VISUALIZER_UPSTREAM_NAME,
  VISUALIZER_UPSTREAM_URL,
} from "@/utils/visualizer-attribution";
import { openLink } from "@/utils/open-link";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import {
  LANGUAGE_OPTIONS,
  formatLanguageOptionLabel,
  parseAppLanguage,
  type AppLanguage,
  type SupportedLocale,
} from "@/i18n/locales";
import {
  HostConnectionsPage,
  HostAgentsPage,
  HostTeamsPage,
  HostToolsPage,
  HostSettingsPage,
  HostProvidersPage,
  HostUsagePage,
  HostWorkspacesPage,
  HostTerminalsPage,
} from "@/screens/settings/host-page";
import ProjectsScreen from "@/screens/projects-screen";
import ProjectSettingsScreen, {
  confirmDiscardProjectSettingsChanges,
} from "@/screens/project-settings-screen";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  buildOpenProjectRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
  buildSetupRoute,
  buildStatsRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";
import { rememberLastSettingsView } from "@/stores/last-settings-view";

// Matches MIN_CHAT_WIDTH in left-sidebar.tsx so both sidebars clamp the shared
// panel-store width identically.
const MIN_SETTINGS_CONTENT_WIDTH = 400;

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type SettingsView =
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; serverId: string; section: HostSectionSlug }
  | { kind: "projects" }
  | { kind: "project"; projectKey: string };

// Counts mounted SettingsScreen instances. Navigating between settings route
// groups (app section ↔ host section ↔ projects) replaces one SettingsScreen
// with another; the incoming screen's first render happens while the outgoing
// one is still mounted, so a nonzero count at first render means "arrived from
// inside settings" — the desktop content pane should run its fade even though
// it just mounted. A fresh entry from outside settings sees zero and skips it
// (the app-wide route fade already covers that transition).
let mountedSettingsScreens = 0;

// Stable string identity for a settings view, used as the content error
// boundary's reset key (navigating to a different view clears a caught error).
function settingsViewKey(view: SettingsView): string {
  switch (view.kind) {
    case "section":
      return `section:${view.section}`;
    case "host":
      return `host:${view.serverId}:${view.section}`;
    case "project":
      return `project:${view.projectKey}`;
    default:
      return view.kind;
  }
}

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
  desktopOnly?: boolean;
  // Hidden from the sidebar (and content gated to null) in User mode.
  developerOnly?: boolean;
}

const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", labelKey: "settings.sections.general", icon: Settings },
  { id: "appearance", labelKey: "settings.sections.appearance", icon: Palette },
  // Reuses the (pre-move) Appearance-subsection title key so every locale
  // already has it — the rows themselves moved to visualizer-section.tsx.
  {
    id: "visualizer",
    labelKey: "settings.appearance.visualizer.title",
    icon: Waypoints,
    developerOnly: true,
  },
  { id: "shortcuts", labelKey: "settings.sections.shortcuts", icon: Keyboard, desktopOnly: true },
  {
    id: "integrations",
    labelKey: "settings.sections.integrations",
    icon: Puzzle,
    desktopOnly: true,
  },
  {
    id: "permissions",
    labelKey: "settings.sections.permissions",
    icon: Shield,
    desktopOnly: true,
  },
  { id: "diagnostics", labelKey: "settings.sections.diagnostics", icon: Stethoscope },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
];

interface HostSectionItem {
  id: HostSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
  // Developer-only host sections — hidden from the sidebar and their content
  // gated to null in User mode (see renderHostSettingsContent).
  developerOnly?: boolean;
}

const HOST_SECTION_ITEMS: HostSectionItem[] = [
  { id: "host", labelKey: "settings.hostSections.host", icon: Server },
  { id: "connections", labelKey: "settings.hostSections.connections", icon: Network },
  { id: "agents", labelKey: "settings.hostSections.agents", icon: Bot },
  { id: "teams", labelKey: "settings.hostSections.teams", icon: Groups },
  { id: "tools", labelKey: "settings.hostSections.tools", icon: Wrench },
  // Git-provider settings are collapsed into "Workspaces" as a "Git" panel — too
  // few options to warrant its own sidebar category. See HostWorkspacesPage.
  // Everything in that page (PR auto-archive, Git providers) is developer-only,
  // so the whole category is developer-only too.
  {
    id: "workspaces",
    labelKey: "settings.hostSections.workspaces",
    icon: Workspaces,
    developerOnly: true,
  },
  { id: "providers", labelKey: "settings.hostSections.providers", icon: Boxes },
  { id: "usage", labelKey: "settings.hostSections.usage", icon: Gauge },
  {
    id: "terminals",
    labelKey: "settings.hostSections.terminals",
    icon: SquareTerminal,
    developerOnly: true,
  },
];

function renderHostSettingsContent(
  view: Extract<SettingsView, { kind: "host" }>,
  onHostRemoved: () => void,
  isDeveloperMode: boolean,
): ReactNode {
  switch (view.section) {
    case "connections":
      return <HostConnectionsPage serverId={view.serverId} />;
    case "agents":
      return <HostAgentsPage serverId={view.serverId} />;
    case "teams":
      return <HostTeamsPage serverId={view.serverId} />;
    case "tools":
      return <HostToolsPage serverId={view.serverId} />;
    case "workspaces":
      return isDeveloperMode ? <HostWorkspacesPage serverId={view.serverId} /> : null;
    case "providers":
      return <HostProvidersPage serverId={view.serverId} />;
    case "usage":
      return <HostUsagePage serverId={view.serverId} />;
    case "terminals":
      return isDeveloperMode ? <HostTerminalsPage serverId={view.serverId} /> : null;
    case "host":
      return <HostSettingsPage serverId={view.serverId} onHostRemoved={onHostRemoved} />;
  }
}

// ---------------------------------------------------------------------------
// Trigger + sidebar style helpers
// ---------------------------------------------------------------------------

function themeTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.themeTrigger, pressed && { opacity: 0.85 }];
}

function sidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [sidebarStyles.item, Boolean(hovered) && sidebarStyles.itemHovered];
}

function selectedSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];
// Responsive bordered row: stacks + centers a wide trailing control below the
// label on compact widths (see `settingsStyles.rowResponsive`).
const ROW_RESPONSIVE_WITH_BORDER_STYLE = [settingsStyles.rowResponsive, settingsStyles.rowBorder];

function getSendBehaviorOptions(t: TFunction) {
  return [
    { value: "interrupt" as const, label: t("settings.general.defaultSend.options.interrupt") },
    { value: "queue" as const, label: t("settings.general.defaultSend.options.queue") },
  ];
}

function getInterfaceModeOptions(t: TFunction) {
  return [
    { value: "user" as const, label: t("settings.general.interfaceMode.options.user") },
    { value: "developer" as const, label: t("settings.general.interfaceMode.options.developer") },
  ];
}

function getAppStartScreenOptions(t: TFunction) {
  return [
    {
      value: "workspaces" as const,
      label: t("settings.general.appStartScreen.options.workspaces"),
    },
    { value: "home" as const, label: t("settings.general.appStartScreen.options.home") },
    {
      value: "dashboard" as const,
      label: t("settings.general.appStartScreen.options.dashboard"),
    },
  ];
}

const APP_START_SCREEN_DESCRIPTION_KEYS = {
  workspaces: "settings.general.appStartScreen.descriptions.workspaces",
  home: "settings.general.appStartScreen.descriptions.home",
  dashboard: "settings.general.appStartScreen.descriptions.dashboard",
} as const satisfies Record<AppStartScreen, string>;

// Suggested-task default action. English-only for now — the whole suggested-task
// feature is unlocalized pending verification (see build-first-translate-last).
const SUGGESTED_TASKS_DEFAULT_MODE_OPTIONS: {
  value: SuggestedTasksDefaultMode;
  label: string;
}[] = [
  { value: "new_chat", label: "New chat" },
  { value: "subagent", label: "Sub-agent" },
  { value: "worktree", label: "Worktree" },
  { value: "in_session", label: "In session" },
];

const SUGGESTED_TASKS_DEFAULT_MODE_DESCRIPTIONS = {
  new_chat: "Starts in a separate chat in its own tab, with no link to this chat.",
  subagent: "Starts as a linked sub-agent shown under this chat and archived with it.",
  worktree: "Starts in an isolated new git worktree (its own branch) in a new tab.",
  in_session: "Sends the task straight to this chat's agent.",
} as const satisfies Record<SuggestedTasksDefaultMode, string>;

function getPreviewServerCloseBehaviorOptions(t: TFunction) {
  return [
    {
      value: "keep-running" as const,
      label: t("settings.general.previewServerCloseBehavior.options.keepRunning"),
    },
    {
      value: "stop-on-close" as const,
      label: t("settings.general.previewServerCloseBehavior.options.stopOnClose"),
    },
  ];
}

function getServiceUrlBehaviorLabel(t: TFunction, value: ServiceUrlBehavior): string {
  const labels: Record<ServiceUrlBehavior, string> = {
    ask: t("settings.general.serviceUrls.options.ask"),
    "in-app": t("settings.general.serviceUrls.options.inApp"),
    external: t("settings.general.serviceUrls.options.external"),
  };
  return labels[value];
}

function getLinkOpenBehaviorLabel(t: TFunction, value: LinkOpenBehavior): string {
  const labels: Record<LinkOpenBehavior, string> = {
    "in-app": t("settings.general.openLinks.options.inApp"),
    external: t("settings.general.openLinks.options.external"),
  };
  return labels[value];
}

function getActiveLocale(language: string | undefined): SupportedLocale {
  const parsed = parseAppLanguage(language);
  return parsed && parsed !== "system" ? parsed : "en";
}

const SERVICE_URL_BEHAVIOR_VALUES: ServiceUrlBehavior[] = ["ask", "in-app", "external"];
const LINK_OPEN_BEHAVIOR_VALUES: LinkOpenBehavior[] = ["external", "in-app"];

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  isDesktopApp: boolean;
  handleInterfaceModeChange: (mode: InterfaceMode) => void;
  handleAppStartScreenChange: (screen: AppStartScreen) => void;
  handleSuggestedTasksEnabledChange: (enabled: boolean) => void;
  handleSuggestedTasksDefaultModeChange: (mode: SuggestedTasksDefaultMode) => void;
  handlePromptSuggestionsEnabledChange: (enabled: boolean) => void;
  handleRateLimitWarningsEnabledChange: (enabled: boolean) => void;
  handleContextWarningsEnabledChange: (enabled: boolean) => void;
  handleSendBehaviorChange: (behavior: SendBehavior) => void;
  handleServiceUrlBehaviorChange: (behavior: ServiceUrlBehavior) => void;
  handleLinkOpenBehaviorChange: (behavior: LinkOpenBehavior) => void;
  handleLanguageChange: (language: AppLanguage) => void;
  handleTerminalScrollbackLinesChange: (lines: number) => void;
  handlePreviewServerCloseBehaviorChange: (behavior: PreviewServerCloseBehavior) => void;
  handlePreviewAutoStartOnRestoreChange: (enabled: boolean) => void;
}

interface ServiceUrlBehaviorMenuItemProps {
  value: ServiceUrlBehavior;
  label: string;
  selected: boolean;
  onChange: (value: ServiceUrlBehavior) => void;
}

function ServiceUrlBehaviorMenuItem({
  value,
  label,
  selected,
  onChange,
}: ServiceUrlBehaviorMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface LinkOpenBehaviorMenuItemProps {
  value: LinkOpenBehavior;
  label: string;
  selected: boolean;
  onChange: (value: LinkOpenBehavior) => void;
}

function LinkOpenBehaviorMenuItem({
  value,
  label,
  selected,
  onChange,
}: LinkOpenBehaviorMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface LanguageMenuItemProps {
  value: AppLanguage;
  activeLocale: SupportedLocale;
  selected: boolean;
  onChange: (value: AppLanguage) => void;
}

function LanguageMenuItem({ value, activeLocale, selected, onChange }: LanguageMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
  const label = option
    ? formatLanguageOptionLabel(option, activeLocale, t(option.labelKey))
    : value;

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function GeneralSection({
  settings,
  isDesktopApp,
  handleInterfaceModeChange,
  handleAppStartScreenChange,
  handleSuggestedTasksEnabledChange,
  handleSuggestedTasksDefaultModeChange,
  handlePromptSuggestionsEnabledChange,
  handleRateLimitWarningsEnabledChange,
  handleContextWarningsEnabledChange,
  handleSendBehaviorChange,
  handleServiceUrlBehaviorChange,
  handleLinkOpenBehaviorChange,
  handleLanguageChange,
  handleTerminalScrollbackLinesChange,
  handlePreviewServerCloseBehaviorChange,
  handlePreviewAutoStartOnRestoreChange,
}: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const activeLocale = getActiveLocale(i18n.language);
  const sendBehaviorOptions = useMemo(() => getSendBehaviorOptions(t), [t]);
  const interfaceModeOptions = useMemo(() => getInterfaceModeOptions(t), [t]);
  // `null` (unchosen / legacy device) resolves to Developer, matching useInterfaceMode.
  const interfaceModeValue: InterfaceMode = settings.interfaceMode ?? "developer";
  const interfaceModeDescriptionKey =
    interfaceModeValue === "user"
      ? "settings.general.interfaceMode.descriptions.user"
      : "settings.general.interfaceMode.descriptions.developer";
  const appStartScreenOptions = useMemo(() => getAppStartScreenOptions(t), [t]);
  const appStartScreenDescriptionKey = APP_START_SCREEN_DESCRIPTION_KEYS[settings.appStartScreen];
  const suggestedTasksDefaultModeDescription =
    SUGGESTED_TASKS_DEFAULT_MODE_DESCRIPTIONS[settings.suggestedTasksDefaultMode];
  const previewServerCloseBehaviorOptions = useMemo(
    () => getPreviewServerCloseBehaviorOptions(t),
    [t],
  );
  const sendBehaviorDescriptionKey =
    settings.sendBehavior === "interrupt"
      ? "settings.general.defaultSend.descriptions.interrupt"
      : "settings.general.defaultSend.descriptions.queue";
  const selectedLanguageOption = LANGUAGE_OPTIONS.find(
    (option) => option.value === settings.language,
  );
  const selectedLanguageLabel = selectedLanguageOption
    ? formatLanguageOptionLabel(
        selectedLanguageOption,
        activeLocale,
        t(selectedLanguageOption.labelKey),
      )
    : settings.language;
  const [terminalScrollbackValue, setTerminalScrollbackValue] = useState(
    String(settings.terminalScrollbackLines),
  );

  const handleTerminalScrollbackChangeText = useCallback((value: string) => {
    setTerminalScrollbackValue(value.replace(/[^\d]/g, ""));
  }, []);

  const commitTerminalScrollback = useCallback(() => {
    const parsed = parseTerminalScrollbackLines(terminalScrollbackValue);
    const nextValue = parsed ?? settings.terminalScrollbackLines;
    setTerminalScrollbackValue(String(nextValue));
    if (nextValue !== settings.terminalScrollbackLines) {
      handleTerminalScrollbackLinesChange(nextValue);
    }
  }, [
    handleTerminalScrollbackLinesChange,
    settings.terminalScrollbackLines,
    terminalScrollbackValue,
  ]);

  useEffect(() => {
    setTerminalScrollbackValue(String(settings.terminalScrollbackLines));
  }, [settings.terminalScrollbackLines]);

  return (
    <Fragment>
      <SettingsSection title={t("settings.general.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.rowResponsive}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.general.interfaceMode.label")}
              </Text>
              <Text style={settingsStyles.rowHint}>{t(interfaceModeDescriptionKey)}</Text>
            </View>
            <SegmentedControl
              size="sm"
              value={interfaceModeValue}
              onValueChange={handleInterfaceModeChange}
              options={interfaceModeOptions}
            />
          </View>
          <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.general.appStartScreen.label")}
              </Text>
              <Text style={settingsStyles.rowHint}>{t(appStartScreenDescriptionKey)}</Text>
            </View>
            <SegmentedControl
              size="sm"
              value={settings.appStartScreen}
              onValueChange={handleAppStartScreenChange}
              options={appStartScreenOptions}
              testID="settings-app-start-screen"
            />
          </View>
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.general.language.label")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.general.language.description")}
              </Text>
            </View>
            <DropdownMenu>
              <DropdownTrigger
                accessibilityRole="button"
                accessibilityLabel={selectedLanguageLabel}
                style={themeTriggerStyle}
              >
                <Text style={styles.themeTriggerText}>{selectedLanguageLabel}</Text>
              </DropdownTrigger>
              <DropdownMenuContent side="bottom" align="end" width={300}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <LanguageMenuItem
                    key={option.value}
                    value={option.value}
                    activeLocale={activeLocale}
                    selected={settings.language === option.value}
                    onChange={handleLanguageChange}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
          {isDesktopApp ? (
            <View style={ROW_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.general.serviceUrls.label")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.general.serviceUrls.description")}
                </Text>
              </View>
              <DropdownMenu>
                <DropdownTrigger style={themeTriggerStyle}>
                  <Text style={styles.themeTriggerText}>
                    {getServiceUrlBehaviorLabel(t, settings.serviceUrlBehavior)}
                  </Text>
                </DropdownTrigger>
                <DropdownMenuContent side="bottom" align="end" width={200}>
                  {SERVICE_URL_BEHAVIOR_VALUES.map((value) => (
                    <ServiceUrlBehaviorMenuItem
                      key={value}
                      value={value}
                      label={getServiceUrlBehaviorLabel(t, value)}
                      selected={settings.serviceUrlBehavior === value}
                      onChange={handleServiceUrlBehaviorChange}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </View>
          ) : null}
          {isDesktopApp ? (
            <View style={ROW_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>{t("settings.general.openLinks.label")}</Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.general.openLinks.description")}
                </Text>
              </View>
              <DropdownMenu>
                <DropdownTrigger style={themeTriggerStyle}>
                  <Text style={styles.themeTriggerText}>
                    {getLinkOpenBehaviorLabel(t, settings.linkOpenBehavior)}
                  </Text>
                </DropdownTrigger>
                <DropdownMenuContent side="bottom" align="end" width={200}>
                  {LINK_OPEN_BEHAVIOR_VALUES.map((value) => (
                    <LinkOpenBehaviorMenuItem
                      key={value}
                      value={value}
                      label={getLinkOpenBehaviorLabel(t, value)}
                      selected={settings.linkOpenBehavior === value}
                      onChange={handleLinkOpenBehaviorChange}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </View>
          ) : null}
          {interfaceModeValue === "developer" ? (
            <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.general.terminalScrollback.label")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.general.terminalScrollback.description")}
                </Text>
              </View>
              <TextInput
                value={terminalScrollbackValue}
                onChangeText={handleTerminalScrollbackChangeText}
                onBlur={commitTerminalScrollback}
                onSubmitEditing={commitTerminalScrollback}
                keyboardType="number-pad"
                inputMode="numeric"
                selectTextOnFocus
                style={styles.terminalScrollbackInput}
                accessibilityLabel={t("settings.general.terminalScrollback.accessibilityLabel")}
              />
            </View>
          ) : null}
        </View>
      </SettingsSection>
      <SettingsSection title="Agents">
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Suggested tasks</Text>
              <Text style={settingsStyles.rowHint}>
                Show a card when an agent proposes follow-up work you can start later. Turn off to
                suppress these entirely.
              </Text>
            </View>
            <Switch
              value={settings.suggestedTasksEnabled}
              onValueChange={handleSuggestedTasksEnabledChange}
              accessibilityLabel="Suggested tasks"
              testID="settings-suggested-tasks-enabled-switch"
            />
          </View>
          {settings.suggestedTasksEnabled ? (
            <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Suggested tasks default</Text>
                <Text style={settingsStyles.rowHint}>{suggestedTasksDefaultModeDescription}</Text>
              </View>
              <SegmentedControl
                size="sm"
                value={settings.suggestedTasksDefaultMode}
                onValueChange={handleSuggestedTasksDefaultModeChange}
                options={SUGGESTED_TASKS_DEFAULT_MODE_OPTIONS}
                testID="settings-suggested-tasks-default-mode"
              />
            </View>
          ) : null}
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.general.defaultSend.label")}</Text>
              <Text style={settingsStyles.rowHint}>{t(sendBehaviorDescriptionKey)}</Text>
            </View>
            <SegmentedControl
              size="sm"
              value={settings.sendBehavior}
              onValueChange={handleSendBehaviorChange}
              options={sendBehaviorOptions}
            />
          </View>
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>AI prompt suggestions</Text>
              <Text style={settingsStyles.rowHint}>
                After a turn, show the agent&apos;s predicted next prompt as ghost text in the
                message box; press Tab to accept it.
              </Text>
            </View>
            <Switch
              value={settings.promptSuggestionsEnabled}
              onValueChange={handlePromptSuggestionsEnabledChange}
              accessibilityLabel="AI prompt suggestions"
              testID="settings-prompt-suggestions-switch"
            />
          </View>
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Plan rate-limit warnings</Text>
              <Text style={settingsStyles.rowHint}>
                Show a warning above the message box when your Claude plan usage nears or hits a
                rate limit.
              </Text>
            </View>
            <Switch
              value={settings.rateLimitWarningsEnabled}
              onValueChange={handleRateLimitWarningsEnabledChange}
              accessibilityLabel="Plan rate-limit warnings"
              testID="settings-rate-limit-warnings-switch"
            />
          </View>
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Context weight warnings</Text>
              <Text style={settingsStyles.rowHint}>
                Show a warning above the message box when the context for this project takes a large
                share of the model window. The Context tab stays available either way.
              </Text>
            </View>
            <Switch
              value={settings.contextWarningsEnabled}
              onValueChange={handleContextWarningsEnabledChange}
              accessibilityLabel="Context weight warnings"
              testID="settings-context-warnings-switch"
            />
          </View>
        </View>
      </SettingsSection>
      {interfaceModeValue === "developer" ? (
        <SettingsSection title={t("settings.preview.title")}>
          <View style={settingsStyles.card}>
            <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.general.previewServerCloseBehavior.label")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.general.previewServerCloseBehavior.description")}
                </Text>
              </View>
              <SegmentedControl
                size="sm"
                value={settings.previewServerCloseBehavior}
                onValueChange={handlePreviewServerCloseBehaviorChange}
                options={previewServerCloseBehaviorOptions}
              />
            </View>
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.preview.autoStartOnRestore.label")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.preview.autoStartOnRestore.description")}
                </Text>
              </View>
              <Switch
                value={settings.previewAutoStartOnRestore}
                onValueChange={handlePreviewAutoStartOnRestoreChange}
                accessibilityLabel={t("settings.preview.autoStartOnRestore.label")}
                testID="settings-preview-auto-start-on-restore-switch"
              />
            </View>
          </View>
        </SettingsSection>
      ) : null}
      <DesktopWindowBehaviorSection />
    </Fragment>
  );
}

interface DiagnosticsSectionProps {
  voiceAudioEngine: ReturnType<typeof useVoiceAudioEngineOptional>;
  isPlaybackTestRunning: boolean;
  playbackTestResult: string | null;
  handlePlaybackTest: () => Promise<void>;
  appVersion: string | null;
  isDesktopApp: boolean;
}

function DiagnosticsSection({
  voiceAudioEngine,
  isPlaybackTestRunning,
  playbackTestResult,
  handlePlaybackTest,
  appVersion,
  isDesktopApp,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation();
  const [diagnosticSheetOpen, setDiagnosticSheetOpen] = useState(false);
  const handlePlayPress = useCallback(() => {
    void handlePlaybackTest();
  }, [handlePlaybackTest]);
  const handleOpenDiagnostic = useCallback(() => setDiagnosticSheetOpen(true), []);
  const handleCloseDiagnostic = useCallback(() => setDiagnosticSheetOpen(false), []);
  return (
    <SettingsSection title={t("settings.diagnostics.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive} testID="app-diagnostic-row">
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.app.rowTitle")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.diagnostics.app.rowHint")}</Text>
          </View>
          <Button variant="secondary" size="sm" onPress={handleOpenDiagnostic}>
            {t("settings.diagnostics.app.run")}
          </Button>
        </View>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.testAudio")}</Text>
            {playbackTestResult ? (
              <Text style={settingsStyles.rowHint}>{playbackTestResult}</Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handlePlayPress}
            disabled={!voiceAudioEngine || isPlaybackTestRunning}
          >
            {isPlaybackTestRunning
              ? t("settings.diagnostics.playing")
              : t("settings.diagnostics.playTest")}
          </Button>
        </View>
      </View>
      <AppDiagnosticSheet
        visible={diagnosticSheetOpen}
        onClose={handleCloseDiagnostic}
        appVersion={appVersion}
        isDesktopApp={isDesktopApp}
      />
    </SettingsSection>
  );
}

interface AboutSectionProps {
  appVersion: string | null;
  appVersionText: string;
  isDesktopApp: boolean;
}

function AboutSection({ appVersion, appVersionText, isDesktopApp }: AboutSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("settings.about.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.about.appVersion")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.about.thisDevice")}</Text>
            </View>
            <View style={styles.aboutVersionColumn}>
              <Text style={styles.aboutValue}>{appVersionText}</Text>
              <Text style={styles.aboutBaseVersion}>
                {t("settings.about.upstreamBase", {
                  brand: UPSTREAM_BASE_NAME,
                  version: formatVersionWithPrefix(UPSTREAM_BASE_VERSION),
                })}
              </Text>
            </View>
          </View>
          {isDesktopApp ? <DesktopAppUpdateRow /> : null}
          <SetupWizardRerunRow />
          <ThirdPartyCreditsRow />
        </View>
      </SettingsSection>
      <ConnectedHostsSection clientVersion={appVersion} />
      <View style={styles.aboutCommunity}>
        <CommunityLinks />
      </View>
    </>
  );
}

// Re-enters the first-run setup wizard from About. The wizard is idempotent —
// it loads the current mode/roster/teams and only ever adds — so this "resets"
// the intro, never any data. The completion flag stays true.
function SetupWizardRerunRow() {
  const { t } = useTranslation();
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push(buildSetupRoute());
  }, [router]);
  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.about.resetWizard.label")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.about.resetWizard.description")}</Text>
      </View>
      <Button variant="secondary" size="sm" onPress={handlePress} testID="settings-reset-wizard">
        {t("settings.about.resetWizard.action")}
      </Button>
    </View>
  );
}

function ThirdPartyCreditsRow() {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    void openLink(VISUALIZER_UPSTREAM_URL);
  }, []);
  return (
    <View style={ROW_WITH_BORDER_STYLE}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.about.credits.title")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.about.credits.visualizer", {
            name: VISUALIZER_UPSTREAM_NAME,
            license: VISUALIZER_UPSTREAM_LICENSE,
            author: VISUALIZER_UPSTREAM_AUTHOR,
          })}
        </Text>
      </View>
      <Button
        variant="ghost"
        size="sm"
        onPress={handlePress}
        testID="settings-visualizer-credits-link"
      >
        {t("settings.about.credits.viewSource")}
      </Button>
    </View>
  );
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

function ConnectedHostsSection({ clientVersion }: { clientVersion: string | null }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  if (hosts.length === 0) {
    return null;
  }
  return (
    <SettingsSection title={t("settings.about.connectedHosts")}>
      <View style={settingsStyles.card}>
        {hosts.map((host, index) => (
          <HostVersionRow
            key={host.serverId}
            host={host}
            showBorder={index > 0}
            clientVersion={clientVersion}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function HostVersionRow({
  host,
  showBorder,
  clientVersion,
}: {
  host: HostProfile;
  showBorder: boolean;
  clientVersion: string | null;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  const normalizedHost = normalizeVersion(daemonVersion);
  const normalizedClient = normalizeVersion(clientVersion);
  const isMismatch =
    normalizedHost !== null && normalizedClient !== null && normalizedHost !== normalizedClient;

  let valueText: string;
  if (!isConnected) {
    valueText = t("settings.about.offline");
  } else if (normalizedHost) {
    valueText = formatVersionWithPrefix(normalizedHost);
  } else {
    valueText = "—";
  }

  const valueStyle = useMemo(
    () => [styles.aboutValue, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
        {isMismatch ? (
          <Text style={settingsStyles.rowHint}>{t("settings.about.versionDiffers")}</Text>
        ) : null}
      </View>
      <Text style={valueStyle}>{valueText}</Text>
    </View>
  );
}

function getUpdateButtonLabel(
  t: TFunction,
  isInstalling: boolean,
  latestVersion: string | null | undefined,
): string {
  if (isInstalling) return t("settings.about.updates.installing");
  if (latestVersion) {
    return t("settings.about.updates.updateTo", {
      version: formatVersionWithPrefix(latestVersion),
    });
  }
  return t("settings.about.updates.update");
}

function DesktopAppUpdateRow() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const {
    isDesktopApp,
    statusText,
    availableUpdate,
    errorMessage,
    isChecking,
    isInstalling,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  useFocusEffect(
    useCallback(() => {
      if (!isDesktopApp) {
        return undefined;
      }
      void checkForUpdates({ intent: "automatic", silent: true });
      return undefined;
    }, [checkForUpdates, isDesktopApp]),
  );

  const handleCheckForUpdates = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates();
  }, [checkForUpdates, isDesktopApp]);

  const handleReleaseChannelChange = useCallback(
    (releaseChannel: EffectiveSettings["releaseChannel"]) => {
      void updateSettings({ releaseChannel });
    },
    [updateSettings],
  );
  const releaseChannelOptions = useMemo(
    () => [
      { value: "stable" as const, label: t("settings.about.releaseChannel.stable") },
      { value: "beta" as const, label: t("settings.about.releaseChannel.beta") },
    ],
    [t],
  );

  const handleInstallUpdate = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }

    // No confirmation — the button already says what happens, so just restart
    // into the update (user-locked; matches the sidebar callout's install path).
    void installUpdate();
  }, [installUpdate, isDesktopApp]);

  const isUpdateReady = availableUpdate?.readyToInstall === true;
  const readyUpdateVersion = isUpdateReady ? availableUpdate?.latestVersion : null;

  if (!isDesktopApp) {
    return null;
  }

  return (
    <>
      <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.about.releaseChannel.label")}</Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.about.releaseChannel.description")}
          </Text>
        </View>
        <SegmentedControl
          size="sm"
          value={settings.releaseChannel}
          onValueChange={handleReleaseChannelChange}
          options={releaseChannelOptions}
        />
      </View>
      <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.about.updates.label")}</Text>
          <Text style={settingsStyles.rowHint}>{statusText}</Text>
          {readyUpdateVersion ? (
            <Text style={settingsStyles.rowHint}>
              {t("settings.about.updates.readyToInstall", {
                version: formatVersionWithPrefix(readyUpdateVersion),
              })}
            </Text>
          ) : null}
          {errorMessage ? <Text style={styles.aboutErrorText}>{errorMessage}</Text> : null}
        </View>
        <View style={styles.aboutUpdateActions}>
          <Button
            variant="outline"
            size="sm"
            onPress={handleCheckForUpdates}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? t("settings.about.updates.checking") : t("settings.about.updates.check")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleInstallUpdate}
            disabled={isChecking || isInstalling || !isUpdateReady}
          >
            {getUpdateButtonLabel(t, isInstalling, readyUpdateVersion)}
          </Button>
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * Local daemon first, then remaining hosts in their existing order.
 */
function useSortedHosts(hosts: HostProfile[], localServerId: string | null): HostProfile[] {
  return useMemo(() => orderHostsLocalFirst(hosts, localServerId), [hosts, localServerId]);
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarSectionButtonProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.label, isSelected && { color: theme.colors.foreground }],
    [isSelected, theme.colors.foreground],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <IconComponent
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarHostSectionButtonProps {
  itemId: HostSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: HostSectionSlug) => void;
}

function SidebarHostSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarHostSectionButtonProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.label, isSelected && { color: theme.colors.foreground }],
    [isSelected, theme.colors.foreground],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      testID={`settings-host-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <IconComponent
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarProjectsButtonProps {
  isSelected: boolean;
  onSelect: () => void;
}

function SidebarProjectsButton({ isSelected, onSelect }: SidebarProjectsButtonProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.label, isSelected && { color: theme.colors.foreground }],
    [isSelected, theme.colors.foreground],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onSelect}
      testID="settings-projects"
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <FolderGit2
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {t("settings.projects")}
      </Text>
    </Pressable>
  );
}

interface HostPickerProps {
  activeServerId: string | null;
  sortedHosts: HostProfile[];
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  enableBuiltInDaemonOption: EnableBuiltInDaemonOption;
}

/**
 * Scopes the four host sections to a host. Reuses the canonical sidebar host
 * switcher pattern (left-sidebar.tsx): a quiet row-styled trigger opening a
 * <Combobox>. The local host is listed first, each row shows the connection it
 * is using right now; an "Add host" row is always reachable from the list —
 * even with a single host.
 */
function HostPicker({
  activeServerId,
  sortedHosts,
  onSelectHost,
  onAddHost,
  enableBuiltInDaemonOption,
}: HostPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<View | null>(null);
  const activeHost =
    sortedHosts.find((host) => host.serverId === activeServerId) ?? sortedHosts[0] ?? null;

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const hostOptionTestID = useCallback(
    (serverId: string) => `settings-host-picker-item-${serverId}`,
    [],
  );
  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      sidebarStyles.pickerTrigger,
      hovered && sidebarStyles.pickerTriggerHovered,
    ],
    [],
  );

  return (
    <SharedHostPicker
      hosts={sortedHosts}
      value={activeServerId ?? ""}
      onSelect={onSelectHost}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      includeEnableBuiltInDaemon={enableBuiltInDaemonOption.visible}
      onEnableBuiltInDaemon={enableBuiltInDaemonOption.onPress}
      showActiveConnection
      searchable={false}
      title={t("settings.hostPicker.switchHost")}
      desktopMinWidth={240}
      addHostTestID="settings-add-host"
      hostOptionTestID={hostOptionTestID}
    >
      <ComboboxTrigger
        ref={triggerRef}
        block
        style={triggerStyle}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={t("settings.hostPicker.switchHost")}
        testID="settings-host-picker"
      >
        {activeHost ? (
          <View style={sidebarStyles.pickerTriggerDot}>
            <HostStatusDot serverId={activeHost.serverId} />
          </View>
        ) : null}
        <Text style={sidebarStyles.pickerTriggerLabel} numberOfLines={1}>
          {activeHost?.label ?? t("settings.groups.host")}
        </Text>
      </ComboboxTrigger>
    </SharedHostPicker>
  );
}

interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onSelectProjects: () => void;
  onAddHost: () => void;
  onBackToWorkspace: () => void;
  onNavigateHome: () => void;
  onNavigateStats: () => void;
  activeHostServerId: string | null;
  layout: "desktop" | "mobile";
}

function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHostSection,
  onSelectHost,
  onSelectProjects,
  onAddHost,
  onBackToWorkspace,
  onNavigateHome,
  onNavigateStats,
  activeHostServerId,
  layout,
}: SettingsSidebarProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const hasHosts = sortedHosts.length > 0;
  const enableBuiltInDaemonOption = useEnableBuiltInDaemonOption();
  const isDesktopApp = isElectronRuntime();
  const insets = useSafeAreaInsets();
  const padding = useWindowControlsPadding("sidebar");
  const { settings } = useAppSettings();
  const isDeveloperMode = (settings.interfaceMode ?? "developer") === "developer";
  const items = SIDEBAR_SECTION_ITEMS.filter(
    (item) => (!item.desktopOnly || isDesktopApp) && (!item.developerOnly || isDeveloperMode),
  );
  // Projects renders right after Visualizer. Visualizer is developer-only, so in
  // User mode it's filtered out — fall back to Appearance (always present, and
  // the item just before Visualizer) so Projects never disappears.
  const projectsAnchorId: SettingsSectionSlug = items.some((item) => item.id === "visualizer")
    ? "visualizer"
    : "appearance";
  const hostItems = HOST_SECTION_ITEMS.filter((item) => !item.developerOnly || isDeveloperMode);
  const showTopSpacer = padding.top > 0 && !settings.compactSidebarTopSpacing;
  const isDesktop = layout === "desktop";
  // Shared with the workspace left sidebar: both read/write the same
  // panel-store width, so resizing here resizes there and vice versa.
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const startWidthRef = useRef(sidebarWidth);
  const resizeWidth = useSharedValue(sidebarWidth);

  useEffect(() => {
    resizeWidth.value = sidebarWidth;
  }, [sidebarWidth, resizeWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        // See the context-management splitter: Pan's default 15px activation
        // slop turns a 1px divider into a dead zone plus a catch-up jump.
        .minDistance(0)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = sidebarWidth;
          resizeWidth.value = sidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          const maxWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_SETTINGS_CONTENT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [sidebarWidth, resizeWidth, setSidebarWidth, viewportWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));
  const desktopSidebarStyle = useMemo(
    () => [staticSidebarStyles.desktopSidebar, resizeAnimatedStyle],
    [resizeAnimatedStyle],
  );
  const desktopBorderStyle = useMemo(
    () => [sidebarStyles.desktopContainer, { flex: 1, paddingTop: insets.top }],
    [insets.top],
  );
  const resizeHandleStyle = useMemo(
    () => [sidebarStyles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)],
    [],
  );
  const selectedSectionId = view.kind === "section" ? view.section : null;
  const selectedHostSection = view.kind === "host" ? view.section : null;
  const isProjectsSelected = view.kind === "projects" || view.kind === "project";
  // Matches the workspace left sidebar's trimmed spacer so the top menu rows of
  // the two sidebars stay vertically aligned when navigating between them.
  const paddingTopStyle = useMemo(
    () => ({ height: Math.max(0, padding.top - SIDEBAR_TOP_SPACER_TRIM) }),
    [padding.top],
  );

  // The Settings icon marks the surface the user is already on; pressing it
  // just returns to the General section rather than leaving settings.
  const handleFooterSettings = useCallback(() => {
    onSelectSection("general");
  }, [onSelectSection]);
  const footerLabels = useMemo(
    () => ({
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      // Temporary label (English-only) — mirrors the workspace sidebar footer.
      stats: "Metrics",
    }),
    [t],
  );

  const sidebarBody = (
    <>
      <View style={sidebarStyles.list}>
        <Text style={sidebarStyles.groupLabel}>{t("settings.groups.app")}</Text>
        {items.map((item) => (
          <Fragment key={item.id}>
            <SidebarSectionButton
              itemId={item.id}
              label={t(item.labelKey)}
              icon={item.icon}
              isSelected={selectedSectionId === item.id}
              onSelect={onSelectSection}
            />
            {item.id === projectsAnchorId ? (
              <SidebarProjectsButton isSelected={isProjectsSelected} onSelect={onSelectProjects} />
            ) : null}
          </Fragment>
        ))}
      </View>
      <SidebarSeparator />
      {hasHosts ? (
        <View style={sidebarStyles.list}>
          <Text style={sidebarStyles.groupLabel}>{t("settings.groups.host")}</Text>
          <HostPicker
            activeServerId={activeHostServerId}
            sortedHosts={sortedHosts}
            onSelectHost={onSelectHost}
            onAddHost={onAddHost}
            enableBuiltInDaemonOption={enableBuiltInDaemonOption}
          />
          {hostItems.map((item) => (
            <SidebarHostSectionButton
              key={item.id}
              itemId={item.id}
              label={t(item.labelKey)}
              icon={item.icon}
              isSelected={selectedHostSection === item.id}
              onSelect={onSelectHostSection}
            />
          ))}
        </View>
      ) : (
        <View style={sidebarStyles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.addHost")}
            onPress={onAddHost}
            testID="settings-add-host"
            style={sidebarItemStyle}
          >
            <Plus size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
            <Text style={sidebarStyles.label} numberOfLines={1}>
              {t("settings.addHost")}
            </Text>
          </Pressable>
          {enableBuiltInDaemonOption.visible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.enableBuiltInDaemon")}
              onPress={enableBuiltInDaemonOption.onPress}
              testID="settings-enable-built-in-daemon"
              style={sidebarItemStyle}
            >
              <Server size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              <Text style={sidebarStyles.label} numberOfLines={1}>
                {t("settings.enableBuiltInDaemon")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );

  if (!isDesktop) {
    return (
      <View style={sidebarStyles.mobileContainer} testID="settings-sidebar">
        {sidebarBody}
      </View>
    );
  }

  return (
    <Animated.View style={desktopSidebarStyle} testID="settings-sidebar">
      <View style={desktopBorderStyle}>
        <View style={sidebarStyles.sidebarDragArea}>
          <TitlebarDragRegion />
          {showTopSpacer ? <View style={paddingTopStyle} /> : null}
          <SidebarHeaderRow
            icon={ArrowLeft}
            label={t("settings.backToWorkspace")}
            onPress={onBackToWorkspace}
            testID="settings-back-to-workspace"
          />
        </View>
        <ScrollView style={sidebarStyles.scrollBody} showsVerticalScrollIndicator={false}>
          {sidebarBody}
        </ScrollView>

        {/* Same Home / Settings / Metrics bar as the workspace sidebar footer,
            so Home and Metrics remain one click away from inside settings. */}
        <View style={sidebarStyles.footer}>
          <SidebarFooterNavRow
            theme={theme}
            labels={footerLabels}
            onHome={onNavigateHome}
            onSettings={handleFooterSettings}
            onStats={onNavigateStats}
            activeItem="settings"
          />
        </View>

        {/* Resize handle - absolutely positioned over right border */}
        <GestureDetector gesture={resizeGesture}>
          <View style={resizeHandleStyle} />
        </GestureDetector>

        <SidebarSeamShadow seam="right" />
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
  openAddHostIntent?: string | null;
}

export default function SettingsScreen({ view, openAddHostIntent = null }: SettingsScreenProps) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const voiceAudioEngine = useVoiceAudioEngineOptional();
  const { settings, isLoading: settingsLoading, updateSettings } = useAppSettings();
  const isDeveloperMode = (settings.interfaceMode ?? "developer") === "developer";
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const [isPlaybackTestRunning, setIsPlaybackTestRunning] = useState(false);
  const [playbackTestResult, setPlaybackTestResult] = useState<string | null>(null);
  const lastOpenedAddHostIntentRef = useRef<string | null>(null);
  const isDesktopApp = isElectronRuntime();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const isCompactLayout = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  // The themed, auto-hiding overlay scrollbar replaces the native scrollbar on
  // web for every settings ScrollView — including narrow desktop windows that
  // fall into the compact layout branch. Native keeps its platform scrollbars.
  // Only one of the three ScrollViews below is ever mounted at a time, so a
  // single ref + hook serves whichever branch renders.
  const showWebScrollbar = isWeb;
  const scrollRef = useRef<ScrollView>(null);
  const webScrollbar = useWebScrollViewScrollbar(scrollRef, {
    enabled: showWebScrollbar,
  });
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const [selectedSettingsHostServerId, setSelectedSettingsHostServerId] = useState<string | null>(
    view.kind === "host" ? view.serverId : null,
  );
  const knownSelectedSettingsHostServerId = useMemo(() => {
    if (!selectedSettingsHostServerId) {
      return null;
    }
    return hosts.some((host) => host.serverId === selectedSettingsHostServerId)
      ? selectedSettingsHostServerId
      : null;
  }, [hosts, selectedSettingsHostServerId]);
  // The cached local-daemon serverId can outlive the daemon identity it points at
  // (e.g. the WSL daemon restarts with a new serverId): the ["desktop-daemon-server-id"]
  // query never refetches, so it keeps serving a stale id that is absent from the live
  // host registry. Validate it against `hosts` — same as the selected id above — so we
  // fall through to a real host instead of scoping every section to a ghost host
  // ("Host not found").
  const knownLocalServerId = useMemo(() => {
    if (!localServerId) {
      return null;
    }
    return hosts.some((host) => host.serverId === localServerId) ? localServerId : null;
  }, [hosts, localServerId]);

  useEffect(() => {
    if (view.kind === "host") {
      setSelectedSettingsHostServerId(view.serverId);
    }
  }, [view]);

  // Remember the current sub-page so re-opening Settings returns here instead of
  // resetting to General (see the /settings redirect in app/settings/index.tsx).
  useEffect(() => {
    rememberLastSettingsView(view);
  }, [view]);

  // The host the four sections scope to: the host on the active view, otherwise
  // the picker choice, otherwise the local daemon, otherwise the first host.
  const activeHostServerId = useMemo(() => {
    if (view.kind === "host") return view.serverId;
    return (
      knownSelectedSettingsHostServerId ?? knownLocalServerId ?? sortedHosts[0]?.serverId ?? null
    );
  }, [view, knownSelectedSettingsHostServerId, knownLocalServerId, sortedHosts]);

  const handleInterfaceModeChange = useCallback(
    (mode: InterfaceMode) => {
      void updateSettings({ interfaceMode: mode });
    },
    [updateSettings],
  );

  const handleAppStartScreenChange = useCallback(
    (screen: AppStartScreen) => {
      void updateSettings({ appStartScreen: screen });
    },
    [updateSettings],
  );

  const handleSuggestedTasksEnabledChange = useCallback(
    (enabled: boolean) => {
      void updateSettings({ suggestedTasksEnabled: enabled });
    },
    [updateSettings],
  );

  const handleSuggestedTasksDefaultModeChange = useCallback(
    (mode: SuggestedTasksDefaultMode) => {
      void updateSettings({ suggestedTasksDefaultMode: mode });
    },
    [updateSettings],
  );

  const handlePromptSuggestionsEnabledChange = useCallback(
    (promptSuggestionsEnabled: boolean) => {
      void updateSettings({ promptSuggestionsEnabled });
    },
    [updateSettings],
  );

  const handleContextWarningsEnabledChange = useCallback(
    (contextWarningsEnabled: boolean) => {
      void updateSettings({ contextWarningsEnabled });
    },
    [updateSettings],
  );

  const handleRateLimitWarningsEnabledChange = useCallback(
    (rateLimitWarningsEnabled: boolean) => {
      void updateSettings({ rateLimitWarningsEnabled });
    },
    [updateSettings],
  );

  const handleSendBehaviorChange = useCallback(
    (behavior: SendBehavior) => {
      void updateSettings({ sendBehavior: behavior });
    },
    [updateSettings],
  );

  const handleServiceUrlBehaviorChange = useCallback(
    (behavior: ServiceUrlBehavior) => {
      void updateSettings({ serviceUrlBehavior: behavior });
    },
    [updateSettings],
  );

  const handleLinkOpenBehaviorChange = useCallback(
    (behavior: LinkOpenBehavior) => {
      void updateSettings({ linkOpenBehavior: behavior });
    },
    [updateSettings],
  );

  const handleLanguageChange = useCallback(
    (language: AppLanguage) => {
      void updateSettings({ language });
    },
    [updateSettings],
  );

  const handleTerminalScrollbackLinesChange = useCallback(
    (terminalScrollbackLines: number) => {
      void updateSettings({ terminalScrollbackLines });
    },
    [updateSettings],
  );

  const handlePreviewServerCloseBehaviorChange = useCallback(
    (behavior: PreviewServerCloseBehavior) => {
      void updateSettings({ previewServerCloseBehavior: behavior });
    },
    [updateSettings],
  );

  const handlePreviewAutoStartOnRestoreChange = useCallback(
    (enabled: boolean) => {
      void updateSettings({ previewAutoStartOnRestore: enabled });
    },
    [updateSettings],
  );

  const handlePlaybackTest = useCallback(async () => {
    if (!voiceAudioEngine || isPlaybackTestRunning) {
      return;
    }

    setIsPlaybackTestRunning(true);
    setPlaybackTestResult(null);

    try {
      const bytes = Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64");
      await voiceAudioEngine.initialize();
      voiceAudioEngine.stop();
      await voiceAudioEngine.play({
        type: "audio/pcm;rate=16000;bits=16",
        size: bytes.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
      setPlaybackTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Playback test failed", error);
      setPlaybackTestResult(t("settings.diagnostics.playbackFailed", { message }));
    } finally {
      setIsPlaybackTestRunning(false);
    }
  }, [isPlaybackTestRunning, t, voiceAudioEngine]);

  const closeAddConnectionFlow = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
  }, []);

  const goBackToAddConnectionMethods = useCallback(() => {
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
    setIsAddHostMethodVisible(true);
  }, []);

  const handleAddHost = useCallback(() => {
    setIsAddHostMethodVisible(true);
  }, []);

  useEffect(() => {
    if (!openAddHostIntent || lastOpenedAddHostIntentRef.current === openAddHostIntent) {
      return;
    }
    lastOpenedAddHostIntentRef.current = openAddHostIntent;
    handleAddHost();
  }, [handleAddHost, openAddHostIntent]);

  const handleSelectDirectConnection = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(true);
  }, []);

  const handleSelectPasteLink = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsPasteLinkVisible(true);
  }, []);

  // Tracks whether the project settings form (the only settings view with a
  // draft/save cycle) has unsaved changes, so shell-level exits can warn.
  const projectSettingsDirtyRef = useRef(false);
  const handleProjectSettingsDirtyChange = useCallback((dirty: boolean) => {
    projectSettingsDirtyRef.current = dirty;
  }, []);

  // Web-only exit guard: on native the project screen guards its own route
  // removal via usePreventRemove, and running both would double-prompt.
  const guardProjectSettingsExit = useCallback(
    (action: () => void) => {
      if (isNative || !projectSettingsDirtyRef.current) {
        action();
        return;
      }
      void (async () => {
        if (await confirmDiscardProjectSettingsChanges(t)) {
          action();
        }
      })();
    },
    [t],
  );

  const handleHostAdded = useCallback(
    ({ serverId }: { serverId: string }) => {
      guardProjectSettingsExit(() => {
        const target = buildSettingsHostSectionRoute(serverId, "connections");
        if (isCompactLayout) {
          router.push(target);
        } else {
          router.replace(target);
        }
      });
    },
    [guardProjectSettingsExit, isCompactLayout, router],
  );

  const handleSelectSection = useCallback(
    (section: SettingsSectionSlug) => {
      guardProjectSettingsExit(() => {
        const target = buildSettingsSectionRoute(section);
        if (isCompactLayout) {
          router.push(target);
        } else {
          router.replace(target);
        }
      });
    },
    [guardProjectSettingsExit, isCompactLayout, router],
  );

  // Picker: choose the host for host-section rows. If the user is already on a
  // host detail route, keep that detail section and swap only the host segment.
  const handleSelectHost = useCallback(
    (serverId: string) => {
      setSelectedSettingsHostServerId(serverId);
      if (view.kind !== "host") {
        return;
      }
      const section: HostSectionSlug = view.section;
      const target = buildSettingsHostSectionRoute(serverId, section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router, view],
  );

  const handleSelectHostSection = useCallback(
    (section: HostSectionSlug) => {
      if (!activeHostServerId) {
        handleAddHost();
        return;
      }
      guardProjectSettingsExit(() => {
        const target = buildSettingsHostSectionRoute(activeHostServerId, section);
        if (isCompactLayout) {
          router.push(target);
        } else {
          router.replace(target);
        }
      });
    },
    [activeHostServerId, guardProjectSettingsExit, handleAddHost, isCompactLayout, router],
  );

  const handleSelectProjects = useCallback(() => {
    guardProjectSettingsExit(() => {
      const target = buildProjectsSettingsRoute();
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    });
  }, [guardProjectSettingsExit, isCompactLayout, router]);

  const handleScanQr = useCallback(() => {
    closeAddConnectionFlow();
    router.push({
      pathname: "/pair-scan",
      params: { source: "settings" },
    });
  }, [closeAddConnectionFlow, router]);

  const handleHostRemoved = useCallback(() => {
    const fallback = buildSettingsSectionRoute("general");
    if (isCompactLayout) {
      router.replace("/settings");
    } else {
      router.replace(fallback);
    }
  }, [isCompactLayout, router]);

  const handleBackToRoot = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings");
    }
  }, [router]);

  const handleBackToWorkspace = useCallback(() => {
    guardProjectSettingsExit(() => {
      if (navigateToLastWorkspace()) {
        return;
      }
      router.replace(buildOpenProjectRoute());
    });
  }, [guardProjectSettingsExit, router]);

  // Sidebar footer nav — leaves settings entirely, mirroring the workspace
  // sidebar's Home and Metrics buttons.
  const handleNavigateHome = useCallback(() => {
    guardProjectSettingsExit(() => {
      router.push(buildOpenProjectRoute());
    });
  }, [guardProjectSettingsExit, router]);

  const handleNavigateStats = useCallback(() => {
    guardProjectSettingsExit(() => {
      router.push(buildStatsRoute());
    });
  }, [guardProjectSettingsExit, router]);

  // See mountedSettingsScreens: fade the content pane on mount only when this
  // screen replaced another settings screen (cross-route-group navigation).
  const [contentFadeOnMount] = useState(() => mountedSettingsScreens > 0);
  useEffect(() => {
    mountedSettingsScreens += 1;
    return () => {
      mountedSettingsScreens -= 1;
    };
  }, []);

  const detailHeader = ((): {
    title: string;
    Icon: ComponentType<{ size: number; color: string }>;
    titleAccessory?: ReactNode;
  } | null => {
    if (view.kind === "host") {
      const item = HOST_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "project" || view.kind === "projects") {
      return { title: t("settings.projects"), Icon: FolderGit2 };
    }
    return null;
  })();

  const renderedContent = (() => {
    if (view.kind === "host") {
      return renderHostSettingsContent(view, handleHostRemoved, isDeveloperMode);
    }
    if (view.kind === "projects") {
      return <ProjectsScreen view={view} />;
    }
    if (view.kind === "project") {
      return (
        <ProjectSettingsScreen
          projectKey={view.projectKey}
          onDirtyChange={handleProjectSettingsDirtyChange}
        />
      );
    }
    if (view.kind === "section") {
      switch (view.section) {
        case "general":
          return (
            <GeneralSection
              settings={settings}
              isDesktopApp={isDesktopApp}
              handleInterfaceModeChange={handleInterfaceModeChange}
              handleAppStartScreenChange={handleAppStartScreenChange}
              handleSuggestedTasksEnabledChange={handleSuggestedTasksEnabledChange}
              handleSuggestedTasksDefaultModeChange={handleSuggestedTasksDefaultModeChange}
              handlePromptSuggestionsEnabledChange={handlePromptSuggestionsEnabledChange}
              handleRateLimitWarningsEnabledChange={handleRateLimitWarningsEnabledChange}
              handleContextWarningsEnabledChange={handleContextWarningsEnabledChange}
              handleSendBehaviorChange={handleSendBehaviorChange}
              handleServiceUrlBehaviorChange={handleServiceUrlBehaviorChange}
              handleLinkOpenBehaviorChange={handleLinkOpenBehaviorChange}
              handleLanguageChange={handleLanguageChange}
              handleTerminalScrollbackLinesChange={handleTerminalScrollbackLinesChange}
              handlePreviewServerCloseBehaviorChange={handlePreviewServerCloseBehaviorChange}
              handlePreviewAutoStartOnRestoreChange={handlePreviewAutoStartOnRestoreChange}
            />
          );
        case "appearance":
          return <AppearanceSection />;
        case "visualizer":
          return isDeveloperMode ? <VisualizerSection /> : null;
        case "shortcuts":
          return isDesktopApp ? <KeyboardShortcutsSection /> : null;
        case "integrations":
          return isDesktopApp ? <IntegrationsSection /> : null;
        case "permissions":
          return isDesktopApp ? <DesktopPermissionsSection /> : null;
        case "diagnostics":
          return (
            <DiagnosticsSection
              voiceAudioEngine={voiceAudioEngine}
              isPlaybackTestRunning={isPlaybackTestRunning}
              playbackTestResult={playbackTestResult}
              handlePlaybackTest={handlePlaybackTest}
              appVersion={appVersion}
              isDesktopApp={isDesktopApp}
            />
          );
        case "about":
          return (
            <AboutSection
              appVersion={appVersion}
              appVersionText={appVersionText}
              isDesktopApp={isDesktopApp}
            />
          );
      }
    }
    return null;
  })();

  // Scope render failures to the content pane so the settings header/back stays
  // usable instead of the whole screen dropping to the root fallback. The reset
  // key is the active view's stable identity, so switching sections clears a
  // caught error and re-attempts the render.
  const content = (
    <SettingsContentErrorBoundary resetKey={settingsViewKey(view)}>
      {renderedContent}
    </SettingsContentErrorBoundary>
  );

  if (settingsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t("settings.loading")}</Text>
      </View>
    );
  }

  const addHostModals = (
    <>
      <AddHostMethodModal
        visible={isAddHostMethodVisible}
        onClose={closeAddConnectionFlow}
        onDirectConnection={handleSelectDirectConnection}
        onPasteLink={handleSelectPasteLink}
        onScanQr={handleScanQr}
      />
      <AddHostModal
        visible={isDirectHostVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <PairLinkModal
        visible={isPasteLinkVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
    </>
  );

  // Mobile root: full-screen sidebar-as-list.
  if (isCompactLayout && view.kind === "root") {
    return (
      <View style={styles.container}>
        <BackHeader title={t("settings.title")} onBack={handleBackToWorkspace} />
        <View style={styles.scrollView}>
          <ScrollView
            ref={scrollRef}
            style={styles.scrollView}
            contentContainerStyle={insetBottomStyle}
            onLayout={webScrollbar.onLayout}
            onScroll={webScrollbar.onScroll}
            onContentSizeChange={webScrollbar.onContentSizeChange}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={!showWebScrollbar}
          >
            <SettingsSidebar
              view={view}
              onSelectSection={handleSelectSection}
              onSelectHostSection={handleSelectHostSection}
              onSelectHost={handleSelectHost}
              onSelectProjects={handleSelectProjects}
              onAddHost={handleAddHost}
              onBackToWorkspace={handleBackToWorkspace}
              onNavigateHome={handleNavigateHome}
              onNavigateStats={handleNavigateStats}
              activeHostServerId={activeHostServerId}
              layout="mobile"
            />
          </ScrollView>
          {webScrollbar.overlay}
        </View>
        {addHostModals}
      </View>
    );
  }

  // Mobile detail: full-screen content with a back header. Project detail uses
  // an app-level back (out of settings, to the workspace) since the in-body
  // "Back to projects" ghost button handles list-level back; other detail views
  // step back to the settings root.
  const detailBackHandler = view.kind === "project" ? handleBackToWorkspace : handleBackToRoot;
  if (isCompactLayout) {
    return (
      <View style={styles.container}>
        <BackHeader
          title={detailHeader?.title}
          titleAccessory={detailHeader?.titleAccessory}
          onBack={detailBackHandler}
        />
        <View style={styles.scrollView}>
          <ScrollView
            ref={scrollRef}
            style={styles.scrollView}
            contentContainerStyle={insetBottomStyle}
            onLayout={webScrollbar.onLayout}
            onScroll={webScrollbar.onScroll}
            onContentSizeChange={webScrollbar.onContentSizeChange}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={!showWebScrollbar}
          >
            <View style={styles.content}>{content}</View>
          </ScrollView>
          {webScrollbar.overlay}
        </View>
        {addHostModals}
      </View>
    );
  }

  // Desktop split view — mirrors AppContainer: sidebar owns the titlebar drag
  // region + traffic-light padding; detail pane renders whatever header the
  // selected section provides.
  const detailHeaderLeft = detailHeader ? (
    <>
      <HeaderIconBadge>
        <detailHeader.Icon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </HeaderIconBadge>
      <ScreenTitle testID="settings-detail-header-title">{detailHeader.title}</ScreenTitle>
      {detailHeader.titleAccessory}
    </>
  ) : null;
  return (
    <View style={styles.container}>
      <View style={desktopStyles.row}>
        <SettingsSidebar
          view={view}
          onSelectSection={handleSelectSection}
          onSelectHostSection={handleSelectHostSection}
          onSelectHost={handleSelectHost}
          onSelectProjects={handleSelectProjects}
          onAddHost={handleAddHost}
          onBackToWorkspace={handleBackToWorkspace}
          onNavigateHome={handleNavigateHome}
          onNavigateStats={handleNavigateStats}
          activeHostServerId={activeHostServerId}
          layout="desktop"
        />
        <View style={desktopStyles.contentPane}>
          {/* Pane-scoped page fade: the app-wide RouteFadeContainer treats all
              /settings* routes as one page on desktop (see
              use-route-transition-key.ts), so section changes fade only this
              pane and never veil the settings sidebar. */}
          <KeyedFadeContainer
            transitionKey={settingsViewKey(view)}
            fadeOnMount={contentFadeOnMount}
          >
            <ScreenHeader
              borderless={!detailHeader}
              windowControlsPaddingRole="detailHeader"
              left={detailHeaderLeft}
              leftStyle={desktopStyles.detailLeft}
            />
            <View style={styles.scrollView}>
              <ScrollView
                ref={scrollRef}
                style={styles.scrollView}
                contentContainerStyle={insetBottomStyle}
                onLayout={webScrollbar.onLayout}
                onScroll={webScrollbar.onScroll}
                onContentSizeChange={webScrollbar.onContentSizeChange}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={!showWebScrollbar}
              >
                <View style={styles.content}>{content}</View>
              </ScrollView>
              {webScrollbar.overlay}
            </View>
          </KeyedFadeContainer>
        </View>
      </View>
      {addHostModals}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  aboutValue: {
    color: theme.colors.foregroundMuted,
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
  },
  aboutVersionColumn: {
    alignItems: "flex-end",
  },
  aboutBaseVersion: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    marginTop: theme.spacing[1],
  },
  aboutVersionMismatch: {
    color: theme.colors.palette.amber[500],
  },
  aboutErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    marginTop: theme.spacing[1],
  },
  aboutCommunity: {
    marginTop: theme.spacing[4],
  },
  aboutUpdateActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  themeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  themeTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  terminalScrollbackInput: {
    width: 112,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const desktopStyles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
  },
  contentPane: {
    flex: 1,
  },
  detailLeft: {
    gap: theme.spacing[2],
  },
}));

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticSidebarStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
});

const sidebarStyles = StyleSheet.create((theme) => ({
  desktopContainer: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  scrollBody: {
    flex: 1,
  },
  sidebarDragArea: {
    position: "relative",
  },
  mobileContainer: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  // Matches the workspace sidebar's footer chrome (left-sidebar.tsx
  // `sidebarFooter`) so the nav bar sits identically on both sidebars.
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  list: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    gap: 1,
  },
  groupLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  itemSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  pickerTriggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pickerTriggerLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  // Match the setting items' icon footprint so the host label aligns with them.
  pickerTriggerDot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));
