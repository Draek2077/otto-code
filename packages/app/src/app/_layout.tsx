import "@/styles/unistyles";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalProvider } from "@gorhom/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useNavigationContainerRef, usePathname, useRouter } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { View } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { CommandCenter } from "@/components/command-center";
import { WorktreeSetupCalloutSource } from "@/components/worktree-setup-callout-source";
import { DownloadToast } from "@/components/download-toast";
import { QuittingOverlay } from "@/components/quitting-overlay";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { ConfirmDialogHost } from "@/components/confirm-dialog-host";
import { TutorialController } from "@/tutorial/controller";
import { QuitConfirmListener } from "@/desktop/components/quit-confirm-listener";
import { LeftSidebar } from "@/components/left-sidebar";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";
import { CompactExplorerSidebarHost } from "@/components/compact-explorer-sidebar-host";
import { ProjectPickerModal } from "@/components/project-picker-modal";
import { ProviderSettingsHost } from "@/components/provider-settings-host";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { WorkspaceSetupDialog } from "@/components/workspace-setup-dialog";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { FloatingPanelPortalHost } from "@/components/ui/floating-panel-portal";
import { HostChooserModal, useHostChooser } from "@/hosts/host-chooser";
import { getIsElectronRuntime, useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { HorizontalScrollProvider } from "@/contexts/horizontal-scroll-context";
import { SessionProvider } from "@/contexts/session-context";
import { SidebarCalloutProvider } from "@/contexts/sidebar-callout-context";
import { ToastProvider } from "@/contexts/toast-context";
import { VoiceProvider } from "@/contexts/voice-context";
import {
  resolveStartupBlocker,
  resolveStartupNavigationReady,
  shouldRunStartupGiveUpTimer,
  startDaemonIfGateAllows,
  startHostRuntimeBootstrap,
  type StartupBlocker,
} from "@/navigation/host-runtime-bootstrap";
import { registerWorkspaceRouteNavigationRef } from "@/navigation/workspace-route-navigation";
import { ThemedStack } from "@/navigation/themed-stack";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { signalDesktopWindowReady, updateDesktopWindowControls } from "@/desktop/electron/window";
import { getDesktopHost } from "@/desktop/host";
import { loadDesktopSettings } from "@/desktop/settings/desktop-settings";
import { RosettaCalloutSource } from "@/desktop/updates/rosetta-callout-source";
import { UpdateCalloutSource } from "@/desktop/updates/update-callout-source";
import { useActiveWorktreeNewAction } from "@/hooks/use-active-worktree-new-action";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";
import { useFaviconStatus } from "@/hooks/use-favicon-status";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShiftProvider } from "@/hooks/use-keyboard-shift-style";
import { useCompactWebViewportZoomLock } from "@/hooks/use-compact-web-viewport-zoom-lock";
import { useOpenProject } from "@/hooks/use-open-project";
import { useAppSettings } from "@/hooks/use-settings";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useOpenAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelsProvider } from "@/mobile-panels/provider";
import { I18nProvider } from "@/i18n/provider";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { polyfillCrypto } from "@/polyfills/crypto";
import { queryClient } from "@/data/query-client";
import {
  getHostRuntimeStore,
  hasConfiguredLocalDaemonOverride,
  useHostRegistryLoaded,
  useHostMutations,
  useHostRuntimeClient,
  useHosts,
} from "@/runtime/host-runtime";
import { getDaemonStartService } from "@/runtime/daemon-start-service";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { applyAppearance } from "@/screens/settings/appearance/apply-appearance";
import { applyColorScheme } from "@/screens/settings/appearance/apply-color-scheme";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import type { LightThemeName, DarkThemeName } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { toggleDesktopSidebarsWithCheckoutIntent } from "@/utils/desktop-sidebar-toggle";
import { buildOpenProjectRoute, parseServerIdFromPathname } from "@/utils/host-routes";
import { startDesktopResizeReflow } from "@/utils/desktop-window";
import { buildNotificationRoute, resolveNotificationTarget } from "@/utils/notification-routing";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  ensureOsNotificationPermission,
  WEB_NOTIFICATION_CLICK_EVENT,
  type WebNotificationClickDetail,
} from "@/utils/os-notifications";

polyfillCrypto();

// Keep the native splash up until Otto's bundled fonts (Inter, JetBrains Mono)
// are registered, so the app never flashes system fonts before swapping to the
// default theme fonts. No-op on web (there is no native splash to hold).
void SplashScreen.preventAutoHideAsync();

export interface HostRuntimeBootstrapState {
  splashError: string | null;
  retry: () => void;
  hasGivenUpWaitingForHost: boolean;
  storeReady: boolean;
  startupBlocker: StartupBlocker;
}

const HostRuntimeBootstrapContext = createContext<HostRuntimeBootstrapState>({
  splashError: null,
  retry: () => {},
  hasGivenUpWaitingForHost: false,
  storeReady: false,
  startupBlocker: { kind: "none" },
});

function PushNotificationRouter() {
  const router = useRouter();
  const lastHandledIdRef = useRef<string | null>(null);
  const openNotification = useStableEvent((data: Record<string, unknown> | undefined) => {
    const target = resolveNotificationTarget(data);
    const serverId = target.serverId;
    const agentId = target.agentId;
    if (serverId && agentId) {
      navigateToAgent({ serverId, agentId, pin: true });
      return;
    }

    router.navigate(buildNotificationRoute(data));
  });

  useEffect(() => {
    if (isWeb) {
      let removeDesktopNotificationListener: (() => void) | null = null;
      let cancelled = false;

      if (getIsElectronRuntime()) {
        void ensureOsNotificationPermission();

        const unlistenResult = getDesktopHost()?.events?.on?.(
          "notification-click",
          (payload: unknown) => {
            const data =
              typeof payload === "object" &&
              payload !== null &&
              "data" in payload &&
              typeof (payload as { data?: unknown }).data === "object" &&
              (payload as { data?: unknown }).data !== null
                ? (payload as { data: Record<string, unknown> }).data
                : undefined;
            openNotification(data);
          },
        );

        void Promise.resolve(unlistenResult).then((unlisten) => {
          if (typeof unlisten !== "function") {
            return;
          }
          if (cancelled) {
            unlisten();
            return;
          }
          removeDesktopNotificationListener = unlisten;
          return;
        });
      }

      const openFromWebClick = (event: Event) => {
        const customEvent = event as CustomEvent<WebNotificationClickDetail>;
        event.preventDefault();
        openNotification(customEvent.detail?.data);
      };

      window.addEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick as EventListener);

      return () => {
        cancelled = true;
        removeDesktopNotificationListener?.();
        window.removeEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick as EventListener);
      };
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // When the app is open, don't show OS banners.
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const openFromResponse = (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (lastHandledIdRef.current === identifier) {
        return;
      }
      lastHandledIdRef.current = identifier;

      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      openNotification(data);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(openFromResponse);

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        openFromResponse(response);
      }
      return;
    });

    return () => {
      subscription.remove();
    };
  }, [openNotification]);

  return null;
}

function ManagedDaemonSession({ daemon }: { daemon: HostProfile }) {
  const client = useHostRuntimeClient(daemon.serverId);

  if (!client) {
    return null;
  }

  return (
    <SessionProvider key={daemon.serverId} serverId={daemon.serverId} client={client}>
      {null}
    </SessionProvider>
  );
}

function HostSessionManager() {
  const hosts = useHosts();

  if (hosts.length === 0) {
    return null;
  }

  return (
    <>
      {hosts.map((daemon) => (
        <ManagedDaemonSession key={daemon.serverId} daemon={daemon} />
      ))}
    </>
  );
}

export function useEarliestOnlineHostServerId(): string | null {
  const store = getHostRuntimeStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeAll = store.subscribeAll(listener);
      const unsubscribeHostList = store.subscribeHostList(listener);
      return () => {
        unsubscribeAll();
        unsubscribeHostList();
      };
    },
    [store],
  );
  return useSyncExternalStore(
    subscribe,
    () => store.getEarliestOnlineHostServerId(),
    () => store.getEarliestOnlineHostServerId(),
  );
}

function useDaemonStartLastError(): string | null {
  const service = getDaemonStartService({ store: getHostRuntimeStore() });
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getLastError(),
    () => service.getLastError(),
  );
}

function useDaemonStartIsRunning(): boolean {
  const service = getDaemonStartService({ store: getHostRuntimeStore() });
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.isRunning(),
    () => service.isRunning(),
  );
}

const STARTUP_GIVE_UP_TIMEOUT_MS = 5_000;

async function shouldStartBuiltInDaemon(): Promise<boolean> {
  if (!shouldUseDesktopDaemon()) {
    return false;
  }
  if (hasConfiguredLocalDaemonOverride()) {
    return false;
  }
  const settings = await loadDesktopSettings();
  return settings.daemon.manageBuiltInDaemon;
}

function HostRuntimeBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = getHostRuntimeStore();
    const daemonStartService = getDaemonStartService({ store });
    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: shouldStartBuiltInDaemon,
      onGateError: (message) => daemonStartService.recordError(message),
    });
  }, []);

  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const daemonStartError = useDaemonStartLastError();
  const daemonStartIsRunning = useDaemonStartIsRunning();
  const [hasGivenUpWaitingForHost, setHasGivenUpWaitingForHost] = useState(false);
  const isDesktopRuntime = shouldUseDesktopDaemon();
  const startupBlocker = useMemo(
    () =>
      resolveStartupBlocker({
        isDesktopRuntime,
        anyOnlineHostServerId,
        daemonStartIsRunning,
        daemonStartError,
      }),
    [anyOnlineHostServerId, daemonStartError, daemonStartIsRunning, isDesktopRuntime],
  );
  const shouldRunGiveUpTimer = shouldRunStartupGiveUpTimer({
    startupBlocker,
    anyOnlineHostServerId,
    hasGivenUpWaitingForHost,
  });

  useEffect(() => {
    if (!shouldRunGiveUpTimer) {
      return;
    }
    const handle = setTimeout(() => {
      setHasGivenUpWaitingForHost(true);
    }, STARTUP_GIVE_UP_TIMEOUT_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [shouldRunGiveUpTimer]);

  const retry = useCallback(() => {
    const daemonStartService = getDaemonStartService({ store: getHostRuntimeStore() });
    startDaemonIfGateAllows({
      daemonStartService,
      shouldStartDaemon: shouldStartBuiltInDaemon,
      onGateError: (message) => daemonStartService.recordError(message),
    });
  }, []);

  const splashError =
    startupBlocker.kind === "managed-daemon-error" ? startupBlocker.message : null;
  const storeReady = resolveStartupNavigationReady({ startupBlocker });

  // Desktop reveal signal: tell main the first *durable* screen is ready so it
  // can show the window (main holds the reveal off raw first paint — see
  // createWindow). "Durable" means we won't immediately swap what's on screen:
  // the settling splash itself is fine to reveal on, the error splash must be
  // shown, we've given up waiting, or real content is ready. We deliberately do
  // NOT reveal on the premature Workspaces render that precedes the splash, so
  // the user sees splash → Workspaces (the expected order) in every render mode.
  const isPresentable =
    startupBlocker.kind === "managed-daemon-starting" ||
    splashError !== null ||
    hasGivenUpWaitingForHost ||
    (storeReady && anyOnlineHostServerId !== null);
  const hasSignaledReady = useRef(false);
  useEffect(() => {
    if (!isPresentable || hasSignaledReady.current) {
      return;
    }
    hasSignaledReady.current = true;
    void signalDesktopWindowReady();
  }, [isPresentable]);

  const state = useMemo<HostRuntimeBootstrapState>(
    () => ({ splashError, retry, hasGivenUpWaitingForHost, storeReady, startupBlocker }),
    [splashError, retry, hasGivenUpWaitingForHost, storeReady, startupBlocker],
  );

  return (
    <HostRuntimeBootstrapContext.Provider value={state}>
      {children}
    </HostRuntimeBootstrapContext.Provider>
  );
}

export function useStoreReady(): boolean {
  return useContext(HostRuntimeBootstrapContext).storeReady;
}

export function useHostRuntimeBootstrapState(): HostRuntimeBootstrapState {
  return useContext(HostRuntimeBootstrapContext);
}

function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const rowStyle = { flex: 1, flexDirection: "row" } as const;
const flexStyle = { flex: 1 } as const;
const MOBILE_WEB_GESTURE_TOUCH_ACTION = isWeb ? "auto" : "pan-y";

interface AppContainerProps {
  children: ReactNode;
  chromeEnabled?: boolean;
}

// Quick-cycle keyboard shortcut. System is deliberately excluded — its effect
// depends on the live OS scheme, which would make a manual cycle shortcut
// non-deterministic. Each step is an explicit (mode, variant) pair rather than
// a flat theme name, since there's no longer a single `settings.theme` value.
type ThemeCycleStep =
  | { colorSchemeMode: "dark"; darkTheme: DarkThemeName }
  | { colorSchemeMode: "light"; lightTheme: LightThemeName };

const THEME_CYCLE_ORDER: ThemeCycleStep[] = [
  { colorSchemeMode: "dark", darkTheme: "dark" }, // Twilight
  { colorSchemeMode: "dark", darkTheme: "zinc" }, // Graphite
  { colorSchemeMode: "dark", darkTheme: "midnight" }, // Nightfall
  { colorSchemeMode: "dark", darkTheme: "claude" }, // Ember
  { colorSchemeMode: "dark", darkTheme: "ghostty" }, // Slate
  { colorSchemeMode: "light", lightTheme: "daylight" }, // Daylight
];

function AppContainer({ children, chromeEnabled: chromeEnabledOverride }: AppContainerProps) {
  const daemons = useHosts();
  const { settings, updateSettings } = useAppSettings();
  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);
  const closeDesktopAgentList = usePanelStore((state) => state.closeDesktopAgentList);
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const toggleFocusMode = usePanelStore((state) => state.toggleFocusMode);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);

  const cycleTheme = useCallback(() => {
    // -1 (current mode is System, not in the cycle) wraps to index 0 — the
    // same graceful fallback the previous flat-list cycle already had for any
    // "current value not in the list" case.
    const currentIndex = THEME_CYCLE_ORDER.findIndex(
      (step) =>
        step.colorSchemeMode === settings.colorSchemeMode &&
        (step.colorSchemeMode === "dark"
          ? step.darkTheme === settings.darkTheme
          : step.lightTheme === settings.lightTheme),
    );
    const nextIndex = (currentIndex + 1) % THEME_CYCLE_ORDER.length;
    void updateSettings(THEME_CYCLE_ORDER[nextIndex]);
  }, [settings.colorSchemeMode, settings.darkTheme, settings.lightTheme, updateSettings]);

  const isCompactLayout = useIsCompactFormFactor();
  useCompactWebViewportZoomLock(isCompactLayout);
  const pathname = usePathname();
  const chromeEnabled = chromeEnabledOverride ?? daemons.length > 0;
  const toggleAgentList = isCompactLayout ? toggleMobileAgentList : toggleDesktopAgentList;
  const toggleDesktopSidebars = useCallback(() => {
    const { desktop } = usePanelStore.getState();
    toggleDesktopSidebarsWithCheckoutIntent({
      isAgentListOpen: desktop.agentListOpen,
      isFileExplorerOpen: desktop.fileExplorerOpen,
      openAgentList: openDesktopAgentList,
      closeAgentList: closeDesktopAgentList,
      closeFileExplorer: closeDesktopFileExplorer,
      toggleFocusedFileExplorer: () =>
        keyboardActionDispatcher.dispatch({
          id: "sidebar.toggle.right",
          scope: "sidebar",
        }),
    });
  }, [closeDesktopAgentList, closeDesktopFileExplorer, openDesktopAgentList]);
  // TODO: stop matching pathname here as a branch. `chromeEnabled` should not
  // conflate workspace/project-specific chrome (sidebar, mobile gesture) with
  // global concerns like keyboard shortcuts. Split those out so settings (and
  // other non-workspace routes) don't need a special-case to keep shortcuts alive.
  const keyboardShortcutsEnabled = chromeEnabled || pathname.startsWith("/settings");

  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled,
    isMobile: isCompactLayout,
    toggleAgentList,
    toggleBothSidebars: toggleDesktopSidebars,
    toggleFocusMode,
    cycleTheme,
  });

  useActiveWorktreeNewAction();
  useGlobalNewWorkspaceAction();

  const sidebarChrome = (
    <SidebarChrome
      showSidebar={chromeEnabled && (isCompactLayout || !isFocusModeEnabled)}
      keyboardShortcutsEnabled={keyboardShortcutsEnabled}
    />
  );

  const workspaceChrome = (
    <View style={rowStyle}>
      {!isCompactLayout ? sidebarChrome : null}
      {isCompactLayout && chromeEnabled ? (
        <CompactExplorerSidebarHost enabled={chromeEnabled}>
          <View style={flexStyle}>{children}</View>
        </CompactExplorerSidebarHost>
      ) : (
        <View style={flexStyle}>{children}</View>
      )}
    </View>
  );

  const surface = (
    <View style={layoutStyles.surfaceFill}>
      {workspaceChrome}
      <FloatingPanelPortalHost />
      {isCompactLayout ? sidebarChrome : null}
      <DownloadToast />
      <RosettaCalloutSource />
      <UpdateCalloutSource />
      <WorktreeSetupCalloutSource />
      <CommandCenter />
      <HostChooserModal />
      <ProjectPickerModal />
      <ProviderSettingsHost />
      <WorkspaceSetupDialog />
      <KeyboardShortcutsDialog />
      <ConfirmDialogHost />
      <QuitConfirmListener />
      <QuittingOverlay />
      <TutorialController />
    </View>
  );

  const content = isCompactLayout ? (
    <MobileGestureWrapper chromeEnabled={chromeEnabled}>{surface}</MobileGestureWrapper>
  ) : (
    surface
  );

  return content;
}

function SidebarChrome({
  showSidebar,
  keyboardShortcutsEnabled,
}: {
  showSidebar: boolean;
  keyboardShortcutsEnabled: boolean;
}) {
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  return (
    <SidebarModelProvider active={showSidebar && isOpen}>
      {showSidebar ? <LeftSidebar /> : null}
      <WorkspaceShortcutTargetsSubscriber enabled={keyboardShortcutsEnabled} />
    </SidebarModelProvider>
  );
}

function MobileGestureWrapper({
  children,
  chromeEnabled,
}: {
  children: ReactNode;
  chromeEnabled: boolean;
}) {
  const openGesture = useOpenAgentListGesture(chromeEnabled);

  return (
    <GestureDetector gesture={openGesture} touchAction={MOBILE_WEB_GESTURE_TOUCH_ACTION}>
      <View collapsable={false} style={layoutStyles.surfaceFill}>
        {children}
      </View>
    </GestureDetector>
  );
}

function ProvidersWrapper({ children }: { children: ReactNode }) {
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const { upsertConnectionFromOfferUrl } = useHostMutations();
  const isCompactLayout = useIsCompactFormFactor();

  // Apply theme setting on mount and when it changes. Keyed on all the
  // fields together (not split into separate effects) so the mirror repaint
  // in applyColorScheme always runs before the mode switch, never after.
  // The OS scheme is a dependency because in System mode the `black` chat
  // mirror follows whichever spectrum is actually showing — Unistyles flips
  // the light/dark keys adaptively on its own, but the black repaint must
  // re-run here when the OS scheme changes.
  const osColorScheme = useColorScheme();
  useEffect(() => {
    if (settingsLoading) return;
    applyColorScheme({
      colorSchemeMode: settings.colorSchemeMode,
      lightTheme: settings.lightTheme,
      darkTheme: settings.darkTheme,
      systemColorScheme: osColorScheme,
    });
  }, [
    settingsLoading,
    settings.colorSchemeMode,
    settings.lightTheme,
    settings.darkTheme,
    osColorScheme,
  ]);

  // Apply font / size / syntax appearance settings on mount and when they change.
  // Sibling to the theme effect above; order is irrelevant because both patch
  // all registered theme keys, so the active key is always current. Also re-runs on
  // compact-layout changes so fontSize/iconSize repaint when crossing the breakpoint.
  useEffect(() => {
    if (settingsLoading) return;
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiFontSize: settings.uiFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
      chatWidth: settings.chatWidth,
      isCompact: isCompactLayout,
    });
  }, [
    settingsLoading,
    settings.uiFontFamily,
    settings.monoFontFamily,
    settings.uiFontSize,
    settings.codeFontSize,
    settings.chatWidth,
    settings.syntaxTheme,
    isCompactLayout,
  ]);

  // Desktop only: maximize/unmaximize doesn't deliver a settled resize to the
  // web layout systems, so breakpoints, the sidebar, and tab sizing freeze at
  // the pre-maximize width until a manual resize. Subscribe once to the main
  // process's resize signal and replay a settled synthetic resize. Self-guards
  // to Electron and no-ops elsewhere.
  useEffect(() => {
    startDesktopResizeReflow();
  }, []);

  return (
    <VoiceProvider>
      <DesktopWindowControlsSync enabled={!settingsLoading} />
      <OfferLinkListener upsertDaemonFromOfferUrl={upsertConnectionFromOfferUrl} />
      <HostSessionManager />
      <FaviconStatusSync />
      {children}
    </VoiceProvider>
  );
}

function DesktopWindowControlsSync({ enabled }: { enabled: boolean }) {
  const { theme } = useUnistyles();
  // The explorer sidebar is the only surface that sits under the window controls
  // in a different color. Follow its *actual* painted state (owned by the
  // workspace screen) rather than predicting from route + open flag: during the
  // workspace load pause the route is already active and the flag is set, but the
  // sidebar hasn't rendered, so predicting would flip the chrome to the sidebar
  // color too early. This flag is true only once the sidebar is on screen, and
  // false everywhere else (so other pages switch to surface0 immediately).
  const explorerSidebarVisible = usePanelStore((state) => state.explorerSidebarVisible);
  // In focus mode the desktop tab row is the top strip under the window controls;
  // its gutter is surfaceSidebar too, so the caption strip must follow it there
  // just as it follows the explorer sidebar.
  const focusModeTabStripVisible = usePanelStore((state) => state.focusModeTabStripVisible);
  const backgroundColor =
    explorerSidebarVisible || focusModeTabStripVisible
      ? theme.colors.surfaceSidebar
      : theme.colors.surface0;
  const foreground = theme.colors.foreground;

  useEffect(() => {
    if (!enabled || isNative) return;
    void updateDesktopWindowControls({
      backgroundColor,
      foregroundColor: foreground,
    }).catch((error) => {
      console.warn("[DesktopWindow] Failed to update window controls overlay", error);
    });
  }, [enabled, backgroundColor, foreground]);

  return null;
}

function OfferLinkListener({
  upsertDaemonFromOfferUrl,
}: {
  upsertDaemonFromOfferUrl: (offerUrlOrFragment: string) => Promise<unknown>;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const handleUrl = (url: string | null) => {
      if (!url) return;
      if (!url.includes("#offer=")) return;
      void upsertDaemonFromOfferUrl(url)
        .then((profile) => {
          if (cancelled) return;
          const serverId = (profile as { serverId?: unknown } | null)?.serverId;
          if (typeof serverId !== "string" || !serverId) return;
          router.replace(buildOpenProjectRoute());
          return;
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[Linking] Failed to import pairing offer", error);
        });
    };

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router, upsertDaemonFromOfferUrl]);

  return null;
}

interface OpenProjectEventPayload {
  path?: unknown;
}

interface PendingOpenProjectRequest {
  id: number;
  serverId: string;
  path: string;
}

let nextOpenProjectRequestId = 1;

function OpenProjectListener() {
  const chooseHost = useHostChooser();
  const hostRegistryLoaded = useHostRegistryLoaded();
  const [request, setRequest] = useState<PendingOpenProjectRequest | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const openProject = useOpenProject(request?.serverId ?? null);

  const openPathOnChosenHost = useCallback(
    (path: string) => {
      const nextPath = path.trim();
      if (!nextPath) {
        return;
      }

      if (!hostRegistryLoaded) {
        setPendingPath(nextPath);
        return;
      }

      chooseHost({
        title: "Choose host",
        onChooseHost: (serverId) => {
          setRequest({
            id: nextOpenProjectRequestId++,
            serverId,
            path: nextPath,
          });
        },
      });
    },
    [chooseHost, hostRegistryLoaded],
  );

  useEffect(() => {
    if (!hostRegistryLoaded || !pendingPath) {
      return;
    }
    const nextPath = pendingPath;
    setPendingPath(null);
    openPathOnChosenHost(nextPath);
  }, [hostRegistryLoaded, openPathOnChosenHost, pendingPath]);

  useEffect(() => {
    if (!request) {
      return;
    }
    let cancelled = false;
    void openProject(request.path).then((result) => {
      if (cancelled) {
        return null;
      }

      if (!result.ok) {
        setRequest((current) => (current?.id === request.id ? null : current));
        return null;
      }

      setRequest((current) => (current?.id === request.id ? null : current));
      return null;
    });
    return () => {
      cancelled = true;
    };
  }, [openProject, request]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getDesktopHost()
      ?.getPendingOpenProject?.()
      ?.then((pending) => {
        if (!disposed && pending) {
          openPathOnChosenHost(pending);
        }
        return;
      })
      .catch(() => undefined);

    // Listen for hot-start paths relayed via the second-instance event.
    void listenToDesktopEvent<OpenProjectEventPayload>("open-project", (payload) => {
      if (disposed) {
        return;
      }
      const nextPath = typeof payload?.path === "string" ? payload.path.trim() : "";
      openPathOnChosenHost(nextPath);
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        return;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openPathOnChosenHost]);

  return null;
}

function AppWithSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hosts = useHosts();
  const storeReady = useStoreReady();
  const routeServerId = useMemo(() => parseServerIdFromPathname(pathname), [pathname]);
  const routeHasKnownHost =
    routeServerId !== null && hosts.some((host) => host.serverId === routeServerId);
  const shouldShowAppChrome =
    storeReady &&
    (pathname === "/open-project" ||
      pathname === "/new" ||
      pathname === "/sessions" ||
      pathname === "/schedules" ||
      pathname === "/runs" ||
      pathname === "/artifacts" ||
      pathname === "/stats" ||
      routeHasKnownHost);

  return <AppContainer chromeEnabled={shouldShowAppChrome}>{children}</AppContainer>;
}

function FaviconStatusSync() {
  useFaviconStatus();
  return null;
}

const ROOT_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

function RootStack() {
  const storeReady = useStoreReady();
  return (
    <ThemedStack screenOptions={ROOT_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={storeReady}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/[section]" />
        <Stack.Screen name="settings/projects/index" />
        <Stack.Screen name="settings/projects/[projectKey]" />
        <Stack.Screen name="new" />
        <Stack.Screen name="open-project" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="schedules" />
        <Stack.Screen name="runs" />
        <Stack.Screen name="stats" />
        <Stack.Screen name="artifacts" />
        <Stack.Screen name="pair-scan" />
      </Stack.Protected>
      <Stack.Screen name="h/[serverId]" />
      {/* The `settings/hosts/[serverId]` layout owns its own `index`/`[hostSection]`
          leaves so the `[serverId]` segment matches before a leaf mounts (native
          blank-screen guard — see docs/expo-router.md and its `_layout.tsx`). */}
      <Stack.Screen name="settings/hosts/[serverId]" />
    </ThemedStack>
  );
}

function WorkspaceRouteNavigationBridge() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    return registerWorkspaceRouteNavigationRef(navigationRef);
  }, [navigationRef]);

  return null;
}

function AppShell() {
  return (
    <MobilePanelsProvider>
      <HorizontalScrollProvider>
        <OpenProjectListener />
        <AppWithSidebar>
          <WorkspaceRouteNavigationBridge />
          <RootStack />
        </AppWithSidebar>
      </HorizontalScrollProvider>
    </MobilePanelsProvider>
  );
}

function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <HostRuntimeBootstrapProvider>
      <PushNotificationRouter />
      <SidebarCalloutProvider>
        <ProvidersWrapper>{children}</ProvidersWrapper>
      </SidebarCalloutProvider>
    </HostRuntimeBootstrapProvider>
  );
}

// PortalProvider must stay inside normal app-wide context providers here.
// `@gorhom/portal` renders portaled children at the host's location in the
// tree, so any context a portaled sheet might consume (QueryClient, theme,
// auth, settings, …) must wrap PortalProvider — not be wrapped by it.
// BottomSheetModalProvider is the exception: Gorhom modals consume portal
// context and need one shared provider for sibling sheets to stack.
// ToastProvider lives here (not in RuntimeProviders) for the same reason:
// sheet content rendered through @gorhom/portal is a descendant of
// PortalProvider's host, not of RuntimeProviders, so useToast() would throw
// "must be used within ToastProvider" for any toast call inside a bottom
// sheet if Toast context were nested below PortalProvider instead of above it.
function SheetPortalProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <PortalProvider>
        <BottomSheetModalProvider>{children}</BottomSheetModalProvider>
      </PortalProvider>
    </ToastProvider>
  );
}

function RootProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <KeyboardShiftProvider>
          <SheetPortalProviders>{children}</SheetPortalProviders>
        </KeyboardShiftProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootAppTree() {
  return (
    <GestureHandlerRootView style={flexStyle}>
      <View style={layoutStyles.surfaceFill}>
        <RootProviders>
          <RuntimeProviders>
            <AppShell />
          </RuntimeProviders>
        </RootProviders>
      </View>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, JetBrainsMono_400Regular });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <QueryProvider>
      <I18nProvider>
        <RootErrorBoundary>
          <RootAppTree />
        </RootErrorBoundary>
      </I18nProvider>
    </QueryProvider>
  );
}

const layoutStyles = StyleSheet.create((theme) => ({
  surfaceFill: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
