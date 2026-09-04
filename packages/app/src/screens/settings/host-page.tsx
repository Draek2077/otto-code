import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  Globe,
  Monitor,
  Pencil,
  Plus,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "@/components/icons/material-icons";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import type { ServerInfoStatusPayload, TerminalProfile } from "@otto-code/protocol/messages";
import {
  getTerminalProfileIcon,
  DEFAULT_TERMINAL_PROFILES,
} from "@otto-code/protocol/terminal-profiles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import {
  ProfileDraft,
  TerminalProfileEditModal,
} from "@/screens/settings/terminal-profile-edit-modal";
import { getIsElectron } from "@/constants/platform";
import {
  getDesktopDaemonStatus,
  restartDesktopDaemon,
  startDesktopDaemon,
  stopDesktopDaemon,
} from "@/desktop/daemon/desktop-daemon";
import { LocalDaemonSection } from "@/desktop/components/desktop-updates-section";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { loadDesktopSettings, useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { ProvidersSection } from "@/screens/settings/providers-section";
import { AgentPersonalitiesSection } from "@/screens/settings/agent-personalities-section";
import { AgentTeamsSection } from "@/screens/settings/agent-teams-section";
import { SpeechSettingsCards } from "@/screens/settings/speech-settings-cards";
import { GitProvidersSettingsCards } from "@/screens/settings/git-providers-settings-cards";
import { ProviderUsageSettingsSection } from "@/provider-usage/settings-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { HostAppearanceSection } from "@/screens/settings/host-appearance-section";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isVersionMismatch } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { formatConnectionStatus, getConnectionStatusTone } from "@/utils/daemons";
import { formatLatency } from "@/utils/latency";
import { useIconSize } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { getProviderIcon } from "@/components/provider-icons";
import {
  AgentBehaviorRows,
  BrowserToolsSection,
  OttoToolsSection,
  TodoReminderRows,
  useTodoRemindersFeature,
} from "@/screens/settings/otto-tools-section";
import { ConnectorsSection } from "@/screens/settings/connectors-section";
import { TerminalCompatibilitySection } from "@/screens/settings/terminal-compatibility-section";
import { CodeIntelligenceSection } from "./code-intelligence-section";
import { StorageSection } from "./storage-section";
import { restartDaemonFromSettings } from "./daemon-restart";
import { supportsWorkflowStorage } from "@/workflows/storage-presentation";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedProfilePencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedProfileSquareTerminal = withUnistyles(SquareTerminal);
const ThemedPlus = withUnistyles(Plus);

interface DynamicProviderIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function DynamicProviderIcon({ iconKey, size, color = "" }: DynamicProviderIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedDynamicProviderIcon = withUnistyles(DynamicProviderIcon);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// These two module-level icon consts can't call `useIconSize()` (not components), so
// `size` is folded into a dedicated mapping instead - repaints from the live,
// compact-doubled `theme.iconSize` the same way `color` already does.
const mutedIconSmMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const destructiveIconSmMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
  size: theme.iconSize.sm,
});

const moveUpIcon = <ThemedArrowUp uniProps={mutedIconSmMapping} />;
const moveDownIcon = <ThemedArrowDown uniProps={mutedIconSmMapping} />;
const editProfileIcon = <ThemedProfilePencil uniProps={mutedIconSmMapping} />;
const removeProfileIcon = <ThemedTrash2 uniProps={destructiveIconSmMapping} />;
const addProfileIcon = <ThemedPlus uniProps={mutedIconSmMapping} />;

function formatHostConnectionLabel(connection: HostConnection, t: TFunction): string {
  if (connection.type === "relay") {
    return `${t("settings.host.badges.relay")} (${connection.relayEndpoint})`;
  }
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return `${t("settings.host.badges.local")} (${connection.path})`;
  }
  return `TCP (${connection.endpoint})`;
}

function formatActiveConnectionBadge(
  activeConnection: { type: HostConnection["type"]; display: string } | null,
  theme: ReturnType<typeof useUnistyles>["theme"],
  t: TFunction,
): { icon: React.ReactNode; text: string } | null {
  if (!activeConnection) return null;
  if (activeConnection.type === "relay") {
    return {
      icon: <Globe size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.relay"),
    };
  }
  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return {
      icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: t("settings.host.badges.local"),
    };
  }
  return {
    icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    text: activeConnection.display,
  };
}

function formatDaemonVersionBadge(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function useHostProfile(serverId: string): HostProfile | null {
  const daemons = useHosts();
  return daemons.find((entry) => entry.serverId === serverId) ?? null;
}

function HostNotFound() {
  const { t } = useTranslation();
  return (
    <View>
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{t("settings.host.notFound")}</Text>
      </View>
    </View>
  );
}

function HostStatusBadges({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );

  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const activeConnection = snapshot?.activeConnection ?? null;
  const statusLabel = formatConnectionStatus(connectionStatus);
  const statusTone = getConnectionStatusTone(connectionStatus);
  let statusVariant: StatusBadgeVariant = "muted";
  let statusDotColor = theme.colors.foregroundMuted;
  if (statusTone === "success") {
    statusVariant = "success";
    statusDotColor = theme.colors.statusDotSuccess;
  } else if (statusTone === "warning") {
    statusVariant = "warning";
    statusDotColor = theme.colors.statusDotWarning;
  } else if (statusTone === "error") {
    statusVariant = "error";
    statusDotColor = theme.colors.statusDotDanger;
  }
  const connectionBadge = formatActiveConnectionBadge(activeConnection, theme, t);
  const versionBadgeText = formatDaemonVersionBadge(daemonVersion);

  const statusDotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: statusDotColor }],
    [statusDotColor],
  );
  const statusLeading = useMemo(() => <View style={statusDotStyle} />, [statusDotStyle]);

  return (
    <View style={styles.identityBadges} testID="host-page-identity">
      <StatusBadge label={statusLabel} variant={statusVariant} leading={statusLeading} />
      {connectionBadge ? (
        <View style={styles.badgePill}>
          {connectionBadge.icon}
          <Text style={styles.badgeText} numberOfLines={1}>
            {connectionBadge.text}
          </Text>
        </View>
      ) : null}
      {versionBadgeText ? (
        <View style={styles.badgePill}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {versionBadgeText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HostConnectionError({ serverId }: { serverId: string }) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const lastError = snapshot?.lastError ?? null;
  const connectionError =
    typeof lastError === "string" && lastError.trim().length > 0 ? lastError.trim() : null;
  if (!connectionError) return null;
  return <Text style={styles.errorText}>{connectionError}</Text>;
}

export function HostConnectionsPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <HostConnectionError serverId={serverId} />
      <ConnectionsSection host={host} />
    </View>
  );
}

// The provider-agnostic task-list reminder toggles, grouped in their own titled
// section so the two related switches read as one set. Self-hiding: an old daemon
// without the todoReminders capability shows nothing rather than an empty card.
// Title is raw English, matching the English-only convention for these host
// toggle surfaces (see otto-tools-config.ts).
function HostTaskListSection({ serverId }: { serverId: string }) {
  const hasFeature = useTodoRemindersFeature(serverId);
  if (!hasFeature) {
    return null;
  }
  return (
    <SettingsSection title="Task list">
      <View style={settingsStyles.card}>
        <TodoReminderRows serverId={serverId} />
      </View>
    </SettingsSection>
  );
}

export function HostPairDevicePage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <SettingsSection title={t("settings.host.pairDevices.title")}>
      <PairDeviceRow serverId={serverId} />
    </SettingsSection>
  );
}

export function HostAgentsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <>
          <SettingsSection title={t("settings.hostSections.agents")}>
            <View style={settingsStyles.card}>
              <AppendSystemPromptCard serverId={serverId} />
              <AgentBehaviorRows serverId={serverId} />
            </View>
          </SettingsSection>
          <HostTaskListSection serverId={serverId} />
          {/* Owns its own per-card sections (Dictation / Voice / OpenAI). */}
          <SpeechSettingsCards serverId={serverId} />
        </>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

// Tools host section: the agent-facing tool surfaces (Otto tools + browser
// tools) on their own sidebar section after Teams, rather than trailing the
// Agents page where they read as a footnote.
export function HostToolsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <>
          <OttoToolsSection serverId={serverId} />
          <BrowserToolsSection serverId={serverId} />
          <ConnectorsSection serverId={serverId} />
        </>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

// Teams host section: agent teams and the profiles they draw from - split out
// of the Agents page onto their own sidebar section (after Agents) so each
// stays a clean grouped card. Teams lead: a team is what you pick day to day,
// and the profile list under it is the roster it composes from.
export function HostTeamsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <>
          <AgentTeamsSection serverId={serverId} />
          <AgentPersonalitiesSection serverId={serverId} />
        </>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

// Git-provider settings are folded into the Workspaces page as a "Git" panel -
// too few options to warrant their own sidebar category.
// Daemon-side language servers. Its own section rather than a card under Tools:
// the running-servers table needs the width, and the off-switch has to be findable.
export function HostCodePage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <CodeIntelligenceSection serverId={serverId} />
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

// Storage host section: what the agents on this host have accumulated on disk,
// and the way to get it back. Its own section rather than a footnote under Code
// or Workspaces - "where did my space go" is a question people arrive with.
export function HostStoragePage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <StorageSection serverId={serverId} />
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

export function HostWorkspacesPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // Git hosting is a developer feature family; hide its host-config card in User mode.
  const isDeveloperMode = useIsDeveloperMode();

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <>
          <SettingsSection title={t("settings.hostSections.workspaces")}>
            <View style={settingsStyles.card} testID="host-page-workspaces-card">
              <AutoArchiveMergedWorkspacesCard serverId={serverId} />
              <GitFetchCard serverId={serverId} />
              <HideMergeIntoBaseActionCard serverId={serverId} />
              <ProjectKnowledgeStoreLocationCard serverId={serverId} />
              <ProjectArtifactStoreLocationCard serverId={serverId} />
              <ProjectWorkflowStoreLocationCard serverId={serverId} />
            </View>
          </SettingsSection>
          {isDeveloperMode ? (
            <SettingsSection title={t("settings.hostSections.gitProviders")}>
              <GitProvidersSettingsCards serverId={serverId} />
            </SettingsSection>
          ) : null}
        </>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.host.workspaces.unavailable")}</Text>
        </View>
      )}
    </View>
  );
}

export function HostProvidersPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProvidersSection serverId={serverId} />
    </View>
  );
}

export function HostUsagePage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(serverId);
  const handleRefresh = useCallback(() => {
    void refreshProviderUsage();
  }, [refreshProviderUsage]);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProviderUsageSettingsSection view={providerUsageView} onRefresh={handleRefresh} />
    </View>
  );
}

export function HostSettingsPage({
  serverId,
  onHostRemoved,
}: {
  serverId: string;
  onHostRemoved?: () => void;
}) {
  const host = useHostProfile(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <View style={styles.daemonHeader}>
        <Text style={styles.daemonHeaderLabel} numberOfLines={1}>
          {host.label}
        </Text>
      </View>

      <HostStatusBadges serverId={serverId} />

      <HostAppearanceSection host={host} />

      {isLocalDaemon ? <LocalDaemonSection /> : null}

      {!isLocalDaemon ? <UpdateDaemonCard host={host} /> : null}

      <RemoveHostSection host={host} isLocalDaemon={isLocalDaemon} onRemoved={onHostRemoved} />
    </View>
  );
}

function ConnectionsSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { removeConnection } = useHostMutations();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const probeByConnectionId = snapshot?.probeByConnectionId ?? new Map();
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<{
    connectionId: string;
    title: string;
  } | null>(null);
  const [isRemovingConnection, setIsRemovingConnection] = useState(false);
  const removeConnectionHeader = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.connections.removeTitle") }),
    [t],
  );

  const handleRequestRemove = useCallback(
    (connection: HostConnection) => {
      setPendingRemoveConnection({
        connectionId: connection.id,
        title: formatHostConnectionLabel(connection, t),
      });
    },
    [t],
  );

  const handleCloseConfirm = useCallback(() => {
    if (isRemovingConnection) return;
    setPendingRemoveConnection(null);
  }, [isRemovingConnection]);

  const handleCancelConfirm = useCallback(() => {
    setPendingRemoveConnection(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!pendingRemoveConnection) return;
    const { connectionId } = pendingRemoveConnection;
    setIsRemovingConnection(true);
    void removeConnection(host.serverId, connectionId)
      .then(() => setPendingRemoveConnection(null))
      .catch((error) => {
        console.error("[HostPage] Failed to remove connection", error);
        Alert.alert(
          t("settings.host.connections.removeErrorTitle"),
          t("settings.host.connections.removeErrorMessage"),
        );
      })
      .finally(() => setIsRemovingConnection(false));
  }, [pendingRemoveConnection, removeConnection, host.serverId, t]);

  const removeConnectionFooter = useMemo(
    () => (
      <View style={styles.sheetFooterRow}>
        <Button
          variant="secondary"
          size="sm"
          style={FLEX_1_STYLE}
          onPress={handleCancelConfirm}
          disabled={isRemovingConnection}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          style={FLEX_1_STYLE}
          onPress={handleConfirmRemove}
          disabled={isRemovingConnection}
          testID="remove-connection-confirm"
        >
          {t("settings.host.connections.removeAction")}
        </Button>
      </View>
    ),
    [handleCancelConfirm, handleConfirmRemove, isRemovingConnection, t],
  );

  return (
    <SettingsSection title={t("settings.host.connections.title")}>
      <View style={settingsStyles.card} testID="host-page-connections-card">
        {host.connections.map((conn, index) => {
          const probe = probeByConnectionId.get(conn.id);
          return (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              showBorder={index > 0}
              latencyMs={probe?.status === "available" ? probe.latencyMs : undefined}
              latencyLoading={!probe || probe.status === "pending"}
              latencyError={probe?.status === "unavailable"}
              onRemove={handleRequestRemove}
            />
          );
        })}
      </View>

      {pendingRemoveConnection ? (
        <AdaptiveModalSheet
          header={removeConnectionHeader}
          visible
          onClose={handleCloseConfirm}
          footer={removeConnectionFooter}
          testID="remove-connection-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {t("settings.host.connections.removeMessage", {
              name: pendingRemoveConnection.title,
            })}
          </Text>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  showBorder,
  latencyMs,
  latencyLoading,
  latencyError,
  onRemove,
}: {
  connection: HostConnection;
  showBorder: boolean;
  latencyMs: number | null | undefined;
  latencyLoading: boolean;
  latencyError: boolean;
  onRemove: (connection: HostConnection) => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const title = formatHostConnectionLabel(connection, t);

  const latencyText = (() => {
    if (latencyLoading) return "...";
    if (latencyError) return t("settings.host.connections.timeout");
    if (latencyMs != null) return formatLatency(latencyMs);
    return "-";
  })();
  const latencyColor = latencyError ? theme.colors.palette.red[300] : theme.colors.foregroundMuted;

  const handlePressRemove = useCallback(() => {
    onRemove(connection);
  }, [onRemove, connection]);

  const rowStyle = useMemo(
    () => [settingsStyles.rowResponsive, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const latencyTextStyle = useMemo(
    () => [styles.connectionLatency, { color: latencyColor }],
    [latencyColor],
  );
  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={CONNECTION_TRAILING_STYLE}>
        <Text style={latencyTextStyle}>{latencyText}</Text>
        <Button
          variant="ghost"
          size="sm"
          textStyle={destructiveTextStyle}
          onPress={handlePressRemove}
        >
          {t("settings.host.connections.removeAction")}
        </Button>
      </View>
    </View>
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function RestartDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (restartRequest: Promise<void>) => {
      const disconnectTimeoutMs = 30000;
      const reconnectTimeoutMs = 30000;
      const requestFailureDisconnectGraceMs = 2000;
      const disconnectedPromise = isHostConnected()
        ? waitForCondition(() => !isHostConnected(), disconnectTimeoutMs)
        : Promise.resolve(true);
      const restartResult = await restartRequest.then(
        () => ({ status: "accepted" as const }),
        async (error) => ({
          status: "rejected" as const,
          error,
          disconnectedAfterFailure: await waitForCondition(
            () => !isHostConnected(),
            requestFailureDisconnectGraceMs,
            100,
          ),
        }),
      );
      if (!isMountedRef.current) return;

      if (restartResult.status === "rejected" && !restartResult.disconnectedAfterFailure) {
        console.error(`[HostPage] Failed to restart daemon ${host.label}`, restartResult.error);
        setIsRestarting(false);
        Alert.alert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          t("settings.host.daemon.restart.requestFailedMessage"),
        );
        return;
      }

      const disconnected =
        restartResult.status === "rejected"
          ? restartResult.disconnectedAfterFailure
          : await disconnectedPromise;
      const reconnected =
        disconnected && (await waitForCondition(() => isHostConnected(), reconnectTimeoutMs));
      if (isMountedRef.current) {
        setIsRestarting(false);
        if (!reconnected) {
          Alert.alert(
            t("settings.host.daemon.restart.unableToReconnectTitle"),
            t("settings.host.daemon.restart.unableToReconnectMessage", { name: host.label }),
          );
        }
      }
    },
    [host.label, isHostConnected, t, waitForCondition],
  );

  const handleRestart = useCallback(() => {
    if (!daemonClient) {
      Alert.alert(
        t("settings.host.daemon.restart.unavailableTitle"),
        t("settings.host.daemon.restart.unavailableMessage"),
      );
      return;
    }
    if (!isHostConnected()) {
      Alert.alert(
        t("settings.host.daemon.restart.offlineTitle"),
        t("settings.host.daemon.restart.offlineMessage"),
      );
      return;
    }

    void confirmDialog({
      title: t("settings.host.daemon.restart.confirmTitle", { name: host.label }),
      message: t("settings.host.daemon.restart.confirmMessage"),
      confirmLabel: t("settings.host.daemon.restart.confirm"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    })
      .then((confirmed) => {
        if (!confirmed) return;
        setIsRestarting(true);
        const restartRequest = restartDaemonFromSettings(
          host.serverId,
          `settings_daemon_restart_${host.serverId}`,
          {
            getIsElectron,
            getDesktopDaemonStatus,
            getDesktopSettings: loadDesktopSettings,
            restartDesktopDaemon,
            restartServer: (reason) => daemonClient.restartServer(reason),
          },
        );
        void waitForDaemonRestart(restartRequest);
        return;
      })
      .catch((error) => {
        console.error(`[HostPage] Failed to open restart confirmation for ${host.label}`, error);
        Alert.alert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          t("settings.host.daemon.restart.dialogFailedMessage"),
        );
      });
  }, [daemonClient, host.label, host.serverId, isHostConnected, t, waitForDaemonRestart]);

  const restartIcon = useMemo(
    () => <RotateCw size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  return (
    <View style={settingsStyles.card} testID="host-page-restart-card">
      <View style={settingsStyles.rowResponsive}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.restart.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.daemon.restart.hint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={restartIcon}
          onPress={handleRestart}
          disabled={isRestarting || !daemonClient || !isConnected}
          testID="host-page-restart-button"
        >
          {isRestarting
            ? t("settings.host.daemon.restart.restarting")
            : t("settings.host.daemon.restart.confirm")}
        </Button>
      </View>
    </View>
  );
}
function UpdateDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isUpdating, setIsUpdating] = useState(false);
  const [progressPhase, setProgressPhase] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );
  const supportsSelfUpdate = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonSelfUpdate === true,
  );

  const appVersion = resolveAppVersion();
  const hasVersionMismatch = isVersionMismatch(appVersion, daemonVersion);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      unsubscribeRef.current?.();
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );
  const hasReconnectedAfter = useCallback(
    (startGeneration: number | null) => {
      const snapshot = runtime.getSnapshot(host.serverId);
      if (!snapshot || !isHostRuntimeConnected(snapshot)) return false;
      return startGeneration === null || snapshot.clientGeneration !== startGeneration;
    },
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (startGeneration: number | null) => {
      const disconnectTimeoutMs = 15000;
      const reconnectTimeoutMs = 120000; // 2 minutes - npm update + restart can take a while
      if (!hasReconnectedAfter(startGeneration) && isHostConnected()) {
        await waitForCondition(
          () => !isHostConnected() || hasReconnectedAfter(startGeneration),
          disconnectTimeoutMs,
        );
      }
      const reconnected =
        hasReconnectedAfter(startGeneration) ||
        (await waitForCondition(() => hasReconnectedAfter(startGeneration), reconnectTimeoutMs));
      if (isMountedRef.current) {
        setIsUpdating(false);
        setProgressPhase(null);
        if (!reconnected) {
          Alert.alert(
            t("settings.host.daemon.update.unableToReconnectTitle"),
            t("settings.host.daemon.update.unableToReconnectMessage", { name: host.label }),
          );
        }
      }
    },
    [hasReconnectedAfter, host.label, isHostConnected, t, waitForCondition],
  );

  const handleUpdate = useCallback(() => {
    if (!daemonClient) {
      Alert.alert(
        t("settings.host.daemon.update.unavailableTitle"),
        t("settings.host.daemon.update.unavailableMessage"),
      );
      return;
    }
    if (!isHostConnected()) {
      Alert.alert(
        t("settings.host.daemon.update.offlineTitle"),
        t("settings.host.daemon.update.offlineMessage"),
      );
      return;
    }

    void confirmDialog({
      title: t("settings.host.daemon.update.confirmTitle", { name: host.label }),
      message: t("settings.host.daemon.update.confirmMessage"),
      confirmLabel: t("settings.host.daemon.update.confirm"),
      cancelLabel: t("common.actions.cancel"),
      destructive: false,
    })
      .then((confirmed) => {
        if (!confirmed) return;
        const startGeneration = runtime.getSnapshot(host.serverId)?.clientGeneration ?? null;
        setIsUpdating(true);
        setProgressPhase(t("settings.host.daemon.update.phaseStarting"));
        const requestId = `settings_daemon_update_${host.serverId}`;

        const unsubscribe = daemonClient.on("daemon.update.progress", (message) => {
          if (message.payload.requestId !== requestId) return;
          if (!isMountedRef.current) return;
          const { phase } = message.payload;
          if (phase === "starting")
            setProgressPhase(t("settings.host.daemon.update.phaseStarting"));
          else if (phase === "downloading")
            setProgressPhase(t("settings.host.daemon.update.phaseDownloading"));
          else if (phase === "installing")
            setProgressPhase(t("settings.host.daemon.update.phaseInstalling"));
          else if (phase === "complete")
            setProgressPhase(t("settings.host.daemon.update.phaseComplete"));
        });
        unsubscribeRef.current = unsubscribe;

        void daemonClient
          .updateDaemon(requestId)
          .then((response) => {
            unsubscribeRef.current = null;
            unsubscribe();
            if (!response.success) {
              if (!isMountedRef.current) return undefined;
              setIsUpdating(false);
              setProgressPhase(null);
              Alert.alert(
                t("settings.host.daemon.update.requestFailedTitle"),
                t("settings.host.daemon.update.requestFailedMessage", {
                  error: response.error ?? "Unknown error",
                }),
              );
              return undefined;
            }
            // Update succeeded - wait for daemon to restart and reconnect
            void waitForDaemonRestart(startGeneration);
            return undefined;
          })
          .catch((error) => {
            unsubscribeRef.current = null;
            unsubscribe();
            console.error(`[HostPage] Failed to update daemon ${host.label}`, error);
            if (!isMountedRef.current) return;
            setIsUpdating(false);
            setProgressPhase(null);
            Alert.alert(
              t("settings.host.daemon.update.requestFailedTitle"),
              t("settings.host.daemon.update.requestFailedMessage", {
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            );
          });
        return;
      })
      .catch((error) => {
        console.error(`[HostPage] Failed to open update confirmation for ${host.label}`, error);
        Alert.alert(
          t("settings.host.daemon.update.requestFailedTitle"),
          t("settings.host.daemon.update.dialogFailedMessage"),
        );
      });
  }, [daemonClient, host.label, host.serverId, isHostConnected, runtime, t, waitForDaemonRestart]);

  const updateIcon = useMemo(
    () => <ArrowUpToLine size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  // Don't show if the daemon doesn't support self-update or versions match
  if (!supportsSelfUpdate || !hasVersionMismatch) {
    return null;
  }

  const buttonLabel = isUpdating
    ? (progressPhase ?? t("settings.host.daemon.update.updating"))
    : t("settings.host.daemon.update.confirm");

  return (
    <View style={settingsStyles.card} testID="host-page-update-card">
      <View style={settingsStyles.rowResponsive}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.update.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.daemon.update.hint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={updateIcon}
          onPress={handleUpdate}
          disabled={isUpdating || !daemonClient || !isConnected}
          testID="host-page-update-button"
        >
          {buttonLabel}
        </Button>
      </View>
    </View>
  );
}

function AutoArchiveMergedWorkspacesCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ autoArchiveAfterMerge: next }).catch((error) => {
        console.error("[HostPage] Failed to update auto-archive after merge", error);
        Alert.alert(
          "Unable to update workspaces",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.row} testID="host-page-auto-archive-merged-workspaces-card">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Archive merged PR workspaces</Text>
        <Text style={settingsStyles.rowHint}>
          Automatically archive clean Otto workspaces after their pull request is merged
        </Text>
      </View>
      <Switch
        value={config?.autoArchiveAfterMerge === true}
        onValueChange={handleValueChange}
        accessibilityLabel="Archive merged PR workspaces"
        testID="host-page-auto-archive-merged-workspaces-switch"
      />
    </View>
  );
}

const GIT_FETCH_INTERVAL_OPTIONS = [
  { id: "one", value: 60, label: "Every minute" },
  { id: "three", value: 180, label: "Every 3 minutes" },
  { id: "five", value: 300, label: "Every 5 minutes" },
  { id: "ten", value: 600, label: "Every 10 minutes" },
  { id: "fifteen", value: 900, label: "Every 15 minutes" },
  { id: "thirty", value: 1_800, label: "Every 30 minutes" },
  { id: "sixty", value: 3_600, label: "Every hour" },
] as const satisfies SelectFieldOption<60 | 180 | 300 | 600 | 900 | 1_800 | 3_600>[];

const DEFAULT_GIT_FETCH_CONFIG = { enabled: true, intervalSeconds: 180 } as const;

function GitFetchCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  // COMPAT(gitFetchControl): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.gitFetchControl === true,
  );
  const gitFetch = config?.gitFetch ?? DEFAULT_GIT_FETCH_CONFIG;

  const patchGitFetch = useCallback(
    (patch: Partial<typeof gitFetch>) => {
      void patchConfig({ gitFetch: patch }).catch((error) => {
        console.error("[HostPage] Failed to update Git fetch settings", error);
        Alert.alert(
          "Unable to update Git fetch settings",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );
  const handleAutomaticFetchChange = useCallback(
    (enabled: boolean) => patchGitFetch({ enabled }),
    [patchGitFetch],
  );
  const handleFetchIntervalChange = useCallback(
    (intervalSeconds: 60 | 180 | 300 | 600 | 900 | 1_800 | 3_600) =>
      patchGitFetch({ intervalSeconds }),
    [patchGitFetch],
  );
  const selectedFetchInterval = useMemo(
    () => ({
      label:
        GIT_FETCH_INTERVAL_OPTIONS.find((option) => option.value === gitFetch.intervalSeconds)
          ?.label ?? "Every 3 minutes",
    }),
    [gitFetch.intervalSeconds],
  );

  if (!isConnected || !isSupported) return null;

  return (
    <>
      <View
        style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}
        testID="host-page-git-fetch-card"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Fetch active workspaces automatically</Text>
          <Text style={settingsStyles.rowHint}>
            Fetch origin and prune removed remote branches while a workspace is active
          </Text>
        </View>
        <Switch
          value={gitFetch.enabled}
          onValueChange={handleAutomaticFetchChange}
          accessibilityLabel="Fetch active workspaces automatically"
          testID="host-page-git-fetch-switch"
        />
      </View>
      {gitFetch.enabled ? (
        <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Fetch interval</Text>
            <Text style={settingsStyles.rowHint}>
              Choose how often Otto checks active repositories.
            </Text>
          </View>
          <SelectField<60 | 180 | 300 | 600 | 900 | 1_800 | 3_600>
            field={false}
            size="sm"
            label="Fetch interval"
            value={gitFetch.intervalSeconds}
            selectedDisplay={selectedFetchInterval}
            options={GIT_FETCH_INTERVAL_OPTIONS}
            onChange={handleFetchIntervalChange}
            placeholder="Every 3 minutes"
            emptyText="No fetch intervals available."
            triggerStyle={styles.rowPickerTrigger}
            triggerTestID="host-page-git-fetch-interval"
          />
        </View>
      ) : null}
    </>
  );
}

/**
 * The host default for where a project's Knowledge store lives.
 *
 * Deliberately a default and nothing more. A project's own override wins over
 * it, and so does a repository store that already exists on disk, so flipping
 * this never moves anyone's pages. It decides where projects that have no store
 * yet will start.
 */
function ProjectKnowledgeStoreLocationCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  // COMPAT(projectKnowledgeStoreLocation): added in v0.8.18, drop the gate when daemon floor >= v0.8.18.
  const isSupported = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.projectKnowledgeStoreLocation === true,
  );

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        projectKnowledge: { defaultStoreLocation: next ? "host" : "repository" },
      }).catch((error) => {
        console.error("[HostPage] Failed to update the knowledge store default", error);
        Alert.alert(
          "Unable to update Knowledge storage",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected || !isSupported) return null;

  return (
    <View
      style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}
      testID="host-page-project-knowledge-store-card"
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Store project Knowledge on this host</Text>
        <Text style={settingsStyles.rowHint}>
          Keep new projects&apos; Knowledge pages with the daemon instead of in an .otto folder in
          the repository, so nothing has to be gitignored. Projects that already have Knowledge in
          their repository are left alone, and any project can override this in Project Settings.
        </Text>
      </View>
      <Switch
        value={config?.projectKnowledge?.defaultStoreLocation === "host"}
        onValueChange={handleValueChange}
        accessibilityLabel="Store project Knowledge on this host"
        testID="host-page-project-knowledge-store-switch"
      />
    </View>
  );
}

/**
 * The independent host default for project Artifacts. Existing repository and
 * host-local stores stay discoverable, so this selects future writes without
 * moving or hiding an artifact.
 */
function ProjectArtifactStoreLocationCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  // COMPAT(artifactStoreLocation): added in v0.9.0, remove after 2027-02-28.
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.artifactStoreLocation === true,
  );

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        projectArtifacts: { defaultStoreLocation: next ? "host" : "repository" },
      }).catch((error) => {
        console.error("[HostPage] Failed to update the Artifact store default", error);
        Alert.alert(
          "Unable to update Artifact storage",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected || !isSupported) return null;

  return (
    <View
      style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}
      testID="host-page-project-artifact-store-card"
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Store project Artifacts on this host</Text>
        <Text style={settingsStyles.rowHint}>
          Keep future Artifacts with this daemon instead of in the project&apos;s .otto folder.
          Existing Artifacts remain available wherever they were created.
        </Text>
      </View>
      <Switch
        value={config?.projectArtifacts?.defaultStoreLocation === "host"}
        onValueChange={handleValueChange}
        accessibilityLabel="Store project Artifacts on this host"
        testID="host-page-project-artifact-store-switch"
      />
    </View>
  );
}

/** The Workflow default is independent from Knowledge, Artifacts, and Schedules. */
function ProjectWorkflowStoreLocationCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isSupported = useSessionStore((state) =>
    supportsWorkflowStorage({
      categoryStorageResolver:
        state.sessions[serverId]?.serverInfo?.features?.categoryStorageResolver,
    }),
  );
  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        projectWorkflows: { defaultStoreLocation: next ? "host" : "repository" },
      }).catch((error) => {
        console.error("[HostPage] Failed to update the Workflow store default", error);
        Alert.alert(
          "Unable to update Workflow storage",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );
  if (!isConnected || !isSupported) return null;
  return (
    <View
      style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}
      testID="host-page-project-workflow-store-card"
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Store project Workflows on this host</Text>
        <Text style={settingsStyles.rowHint}>
          Choose where new Workflow definitions, templates, and run snapshots are written. Existing
          Workflow material stays available in its original location.
        </Text>
      </View>
      <Switch
        value={config?.projectWorkflows?.defaultStoreLocation === "host"}
        onValueChange={handleValueChange}
        accessibilityLabel="Store project Workflows on this host"
        testID="host-page-project-workflow-store-switch"
      />
    </View>
  );
}

function HideMergeIntoBaseActionCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  // COMPAT(hideMergeIntoBaseSetting): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.hideMergeIntoBaseSetting === true,
  );

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ hideMergeIntoBaseAction: next }).catch((error) => {
        console.error("[HostPage] Failed to update hide merge into base action", error);
        Alert.alert(
          "Unable to update workspaces",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected || !isSupported) return null;

  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      testID="host-page-hide-merge-into-base-action-card"
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Hide merge into base branch</Text>
        <Text style={settingsStyles.rowHint}>
          Remove the &quot;Merge into base&quot; action from the source control menu, for a
          pull-request-only workflow
        </Text>
      </View>
      <Switch
        value={config?.hideMergeIntoBaseAction === true}
        onValueChange={handleValueChange}
        accessibilityLabel="Hide merge into base branch"
        testID="host-page-hide-merge-into-base-action-switch"
      />
    </View>
  );
}

function EnableTerminalAgentHooksCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ enableTerminalAgentHooks: next }).catch((error) => {
        console.error("[HostPage] Failed to update terminal agent hooks", error);
        Alert.alert(
          "Unable to update terminal agent hooks",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-terminal-agent-hooks-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Enable terminal agent hooks</Text>
          <Text style={settingsStyles.rowHint}>
            Get notifications and status from terminal agents. This installs hooks in your agent
            config files.
          </Text>
        </View>
        <Switch
          value={config?.enableTerminalAgentHooks === true}
          onValueChange={handleValueChange}
          accessibilityLabel="Enable terminal agent hooks"
          testID="host-page-terminal-agent-hooks-switch"
        />
      </View>
    </View>
  );
}

function AppendSystemPromptCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedPrompt = config?.appendSystemPrompt ?? "";
  const [draft, setDraft] = useState(persistedPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.orchestration.systemPrompt.sheetTitle") }),
    [t],
  );

  useEffect(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const hasChanges = draft !== persistedPrompt;

  const handleOpen = useCallback(() => {
    setDraft(persistedPrompt);
    setIsEditing(true);
  }, [persistedPrompt]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persistedPrompt);
    setIsEditing(false);
  }, [isSaving, persistedPrompt]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ appendSystemPrompt: draft })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save append system prompt", error);
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig]);

  const handleReset = useCallback(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const appendPromptFooter = useMemo(
    () => (
      <View style={APPEND_PROMPT_FOOTER_STYLE}>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleReset}
          disabled={!hasChanges || isSaving}
          testID="host-page-append-system-prompt-reset"
        >
          {t("settings.host.orchestration.systemPrompt.reset")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
          testID="host-page-append-system-prompt-save"
        >
          {isSaving
            ? t("settings.host.orchestration.systemPrompt.saving")
            : t("settings.host.orchestration.systemPrompt.save")}
        </Button>
      </View>
    ),
    [handleReset, handleSave, hasChanges, isSaving, t],
  );

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.rowResponsive} testID="host-page-append-system-prompt-card">
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.orchestration.systemPrompt.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.orchestration.systemPrompt.hint")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={handleOpen}
          testID="host-page-append-system-prompt-edit"
        >
          {t("settings.host.orchestration.systemPrompt.edit")}
        </Button>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          footer={appendPromptFooter}
          testID="host-page-append-system-prompt-sheet"
          desktopMaxWidth={560}
        >
          <SettingsTextAreaCard
            testID="host-page-append-system-prompt-input"
            accessibilityLabel={t("settings.host.orchestration.systemPrompt.accessibilityLabel")}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("settings.host.orchestration.systemPrompt.placeholder")}
          />
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function PairDeviceRow({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <View style={settingsStyles.card}>
      <Pressable
        style={settingsStyles.row}
        onPress={handleOpen}
        accessibilityRole="button"
        testID="host-page-pair-device-row"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.pairDevices.rowTitle")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.pairDevices.rowHint")}</Text>
        </View>
        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>

      <PairDeviceModal
        serverId={serverId}
        visible={isModalOpen}
        onClose={handleClose}
        testID="host-page-pair-device-card"
      />
    </View>
  );
}

function RemoveHostSection({
  host,
  isLocalDaemon,
  onRemoved,
}: {
  host: HostProfile;
  isLocalDaemon: boolean;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { removeHost } = useHostMutations();
  const { updateSettings } = useDesktopSettings();
  const { data: daemonStatusData, setStatus } = useDaemonStatus();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const daemonStatus = daemonStatusData?.status ?? null;
  const removeHostHeader = useMemo<SheetHeader>(
    () => ({
      title: isLocalDaemon
        ? t("settings.host.daemon.remove.localConfirmTitle")
        : t("settings.host.daemon.remove.title"),
    }),
    [isLocalDaemon, t],
  );

  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  const handleOpenConfirm = useCallback(() => setIsConfirming(true), []);
  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setIsConfirming(false);
  }, [isRemoving]);
  const handleCancel = useCallback(() => setIsConfirming(false), []);
  const rollbackLocalhostRemoval = useCallback(
    async (shouldRestartDaemon: boolean) => {
      await updateSettings({ daemon: { manageBuiltInDaemon: true } });
      if (!shouldRestartDaemon) {
        return;
      }
      setStatus(await startDesktopDaemon());
    },
    [setStatus, updateSettings],
  );
  const handleConfirmRemove = useCallback(() => {
    setIsRemoving(true);
    const remove = async () => {
      let didDisableDaemonManagement = false;
      let didStopDaemon = false;
      if (isLocalDaemon) {
        try {
          await updateSettings({ daemon: { manageBuiltInDaemon: false } });
          didDisableDaemonManagement = true;
          if (daemonStatus?.status === "running" && daemonStatus.desktopManaged) {
            setStatus(await stopDesktopDaemon("host_remove"));
            didStopDaemon = true;
          }
          await removeHost(host.serverId);
        } catch (error) {
          if (didDisableDaemonManagement) {
            try {
              await rollbackLocalhostRemoval(didStopDaemon);
            } catch (rollbackError) {
              console.error("[HostPage] Failed to roll back localhost removal", rollbackError);
            }
          }
          throw error;
        }
        return;
      }
      await removeHost(host.serverId);
    };
    void remove()
      .then(() => {
        setIsConfirming(false);
        onRemoved?.();
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to remove host", error);
        Alert.alert(
          t("settings.host.daemon.remove.errorTitle"),
          isLocalDaemon
            ? t("settings.host.daemon.remove.localErrorMessage")
            : t("settings.host.daemon.remove.errorMessage"),
        );
      })
      .finally(() => setIsRemoving(false));
  }, [
    daemonStatus,
    host.serverId,
    isLocalDaemon,
    onRemoved,
    removeHost,
    rollbackLocalhostRemoval,
    setStatus,
    t,
    updateSettings,
  ]);

  const removeIcon = useMemo(
    () => <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />,
    [theme.iconSize.sm, theme.colors.destructive],
  );

  const removeHostFooter = useMemo(
    () => (
      <View style={styles.sheetFooterRow}>
        <Button
          variant="secondary"
          size="sm"
          style={FLEX_1_STYLE}
          onPress={handleCancel}
          disabled={isRemoving}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          style={FLEX_1_STYLE}
          onPress={handleConfirmRemove}
          disabled={isRemoving}
          testID="remove-host-confirm"
        >
          {t("settings.host.connections.removeAction")}
        </Button>
      </View>
    ),
    [handleCancel, handleConfirmRemove, isRemoving, t],
  );

  return (
    <SettingsSection
      title={t("settings.host.daemon.dangerZone")}
      testID="host-page-remove-host-card"
    >
      <RestartDaemonCard host={host} />

      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {isLocalDaemon
                ? t("settings.host.daemon.remove.localTitle")
                : t("settings.host.daemon.remove.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {isLocalDaemon
                ? t("settings.host.daemon.remove.localHint")
                : t("settings.host.daemon.remove.hint")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={removeIcon}
            textStyle={destructiveTextStyle}
            onPress={handleOpenConfirm}
            testID="host-page-remove-host-button"
          >
            {t("settings.host.connections.removeAction")}
          </Button>
        </View>
      </View>

      {isConfirming ? (
        <AdaptiveModalSheet
          header={removeHostHeader}
          visible
          onClose={handleCloseConfirm}
          footer={removeHostFooter}
          testID="remove-host-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {isLocalDaemon
              ? t("settings.host.daemon.remove.localConfirmMessage")
              : t("settings.host.daemon.remove.confirmMessage", { name: host.label })}
          </Text>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Terminal Profiles
// ---------------------------------------------------------------------------

function generateProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function parseArgsString(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: "", command: "", args: "" };

interface TerminalProfileRowProps {
  profile: TerminalProfile;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function TerminalProfileRow({
  profile,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TerminalProfileRowProps) {
  const { t } = useTranslation();
  const iconSize = useIconSize();

  const handleEdit = useCallback(() => onEdit(profile.id), [onEdit, profile.id]);
  const handleRemove = useCallback(() => onRemove(profile.id), [onRemove, profile.id]);
  const handleMoveUp = useCallback(() => onMoveUp(profile.id), [onMoveUp, profile.id]);
  const handleMoveDown = useCallback(() => onMoveDown(profile.id), [onMoveDown, profile.id]);

  const commandText =
    profile.args && profile.args.length > 0
      ? `${profile.command} ${profile.args.join(" ")}`
      : profile.command;

  const rowStyle = useMemo(
    () => [
      settingsStyles.rowResponsive,
      !isFirst && settingsStyles.rowBorder,
      terminalProfileStyles.row,
    ],
    [isFirst],
  );

  const icon = getTerminalProfileIcon(profile);

  return (
    <View style={rowStyle} testID={`terminal-profile-row-${profile.id}`}>
      <View style={terminalProfileStyles.rowPrimary}>
        <View style={terminalProfileStyles.iconWrapper}>
          {icon ? (
            <ThemedDynamicProviderIcon
              iconKey={icon}
              size={iconSize.md}
              uniProps={mutedColorMapping}
            />
          ) : (
            <ThemedProfileSquareTerminal size={iconSize.md} uniProps={mutedColorMapping} />
          )}
        </View>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {profile.name}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {commandText}
          </Text>
        </View>
      </View>
      <View style={terminalProfileStyles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.host.terminalProfiles.moveUp")}
          testID={`terminal-profile-move-up-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.host.terminalProfiles.moveDown")}
          testID={`terminal-profile-move-down-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editProfileIcon}
          onPress={handleEdit}
          accessibilityLabel={t("settings.host.terminalProfiles.editProfile")}
          testID={`terminal-profile-edit-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={removeProfileIcon}
          onPress={handleRemove}
          accessibilityLabel={t("settings.host.terminalProfiles.remove")}
          testID={`terminal-profile-remove-${profile.id}`}
        />
      </View>
    </View>
  );
}

function TerminalProfilesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [editingProfile, setEditingProfile] = useState<{
    id: string;
    draft: ProfileDraft;
  } | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Settings edits what is persisted, not the adopted view. Any save here
  // writes the whole list back, so resolving first would bake read-time prompt
  // adoption into the user's config the first time they reorder a row.
  const profiles = useMemo(
    () => (config ? (config.terminalProfiles ?? DEFAULT_TERMINAL_PROFILES) : null),
    [config],
  );

  const saveProfiles = useCallback(
    async (next: TerminalProfile[]) => {
      await patchConfig({ terminalProfiles: next });
    },
    [patchConfig],
  );

  const handleAddOpen = useCallback(() => setIsAdding(true), []);
  const handleAddClose = useCallback(() => setIsAdding(false), []);

  const handleAddSave = useCallback(
    async (draft: ProfileDraft) => {
      const current = profiles ? [...profiles] : [];
      const next: TerminalProfile[] = [
        ...current,
        {
          id: generateProfileId(),
          name: draft.name,
          command: draft.command,
          args: parseArgsString(draft.args),
        },
      ];
      await saveProfiles(next);
      setIsAdding(false);
    },
    [profiles, saveProfiles],
  );

  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      setEditingProfile({
        id,
        draft: {
          name: profile.name,
          command: profile.command,
          args: profile.args ? profile.args.join(" ") : "",
        },
      });
    },
    [profiles],
  );

  const handleEditClose = useCallback(() => setEditingProfile(null), []);

  const handleEditSave = useCallback(
    async (draft: ProfileDraft) => {
      if (!editingProfile || !profiles) return;
      const next: TerminalProfile[] = profiles.map((p) =>
        p.id === editingProfile.id
          ? {
              ...p,
              name: draft.name,
              command: draft.command,
              args: parseArgsString(draft.args),
            }
          : p,
      );
      await saveProfiles(next);
      setEditingProfile(null);
    },
    [editingProfile, profiles, saveProfiles],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      void confirmDialog({
        title: t("settings.host.terminalProfiles.removeConfirmTitle"),
        message: t("settings.host.terminalProfiles.removeConfirmMessage", {
          name: profile.name,
        }),
        confirmLabel: t("settings.host.terminalProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed || !profiles) return;
        try {
          await saveProfiles(profiles.filter((p) => p.id !== id));
        } catch (error) {
          Alert.alert(
            t("common.errors.unableToSave"),
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      });
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveUp = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index <= 0) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index - 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveDown = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index < 0 || index >= profiles.length - 1) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index + 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addProfileIcon}
        onPress={handleAddOpen}
        disabled={!isConnected || !profiles}
        testID="terminal-profiles-add-button"
      />
    ),
    [handleAddOpen, isConnected, profiles],
  );

  if (!isConnected) {
    return (
      <View style={settingsStyles.card} testID="terminal-profiles-unavailable">
        <View style={terminalProfileStyles.emptyCard}>
          <Text style={terminalProfileStyles.emptyText}>
            {t("settings.host.terminalProfiles.unavailable")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.terminalProfiles.sectionTitle")}
        trailing={addButton}
        testID="terminal-profiles-section"
      >
        <View style={settingsStyles.card} testID="terminal-profiles-card">
          {profiles && profiles.length > 0 ? (
            profiles.map((profile, index) => (
              <TerminalProfileRow
                key={profile.id}
                profile={profile}
                isFirst={index === 0}
                isLast={index === profiles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <View style={terminalProfileStyles.emptyCard}>
              <Text style={terminalProfileStyles.emptyText}>
                {t("settings.host.terminalProfiles.emptyState")}
              </Text>
            </View>
          )}
        </View>
      </SettingsSection>

      <TerminalProfileEditModal
        visible={isAdding}
        title={t("settings.host.terminalProfiles.addProfileTitle")}
        initialDraft={EMPTY_PROFILE_DRAFT}
        onClose={handleAddClose}
        onSave={handleAddSave}
        testID="terminal-profile-edit-modal"
      />

      {editingProfile ? (
        <TerminalProfileEditModal
          visible
          title={t("settings.host.terminalProfiles.editProfileTitle")}
          initialDraft={editingProfile.draft}
          onClose={handleEditClose}
          onSave={handleEditSave}
        />
      ) : null}
    </>
  );
}

type WindowsTerminalShell = NonNullable<ServerInfoStatusPayload["terminalShells"]>[number];

function WindowsTerminalShellSection({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const platform = serverInfo?.platform;
  const terminalShells = serverInfo?.terminalShells;
  const shells = useMemo(
    () => (platform === "win32" ? (terminalShells ?? []) : []),
    [platform, terminalShells],
  );
  const selectedShell = config?.defaultTerminalShell;
  const shellOptions = useMemo<SelectFieldOption<WindowsTerminalShell["id"]>[]>(
    () => shells.map((shell) => ({ id: shell.id, value: shell.id, label: shell.label })),
    [shells],
  );
  const selectedDisplay = useMemo(() => {
    const shell = shells.find((candidate) => candidate.id === selectedShell);
    return shell ? { label: shell.label } : { label: "System default" };
  }, [selectedShell, shells]);

  const selectShell = useCallback(
    async (id: "command-prompt" | "windows-powershell" | "powershell-7") => {
      if (isSaving || selectedShell === id) return;
      setIsSaving(true);
      try {
        await patchConfig({ defaultTerminalShell: id });
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving, patchConfig, selectedShell],
  );

  if (shells.length === 0) return null;

  return (
    <SettingsSection title="Default terminal shell">
      <View style={settingsStyles.card} testID="windows-terminal-shells-card">
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Shell</Text>
            <Text style={settingsStyles.rowHint}>Used for new terminal sessions.</Text>
          </View>
          <SelectField<WindowsTerminalShell["id"]>
            field={false}
            size="sm"
            label="Default terminal shell"
            value={selectedShell ?? null}
            selectedDisplay={selectedDisplay}
            options={shellOptions}
            onChange={selectShell}
            placeholder="System default"
            emptyText="No terminal shells detected."
            disabled={isSaving}
            triggerStyle={styles.rowPickerTrigger}
            triggerTestID="windows-terminal-shell-select"
          />
        </View>
      </View>
    </SettingsSection>
  );
}

function TerminalAppearanceSection({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const supported = useHostFeature(serverId, "terminalTitleSettings");
  const [isSaving, setIsSaving] = useState(false);
  const mode = config?.terminalTitleMode ?? "auto";
  const includePaths = config?.terminalTitleIncludePaths ?? false;

  const update = useCallback(
    async (patch: {
      terminalTitleMode?: "auto" | "default";
      terminalTitleIncludePaths?: boolean;
    }) => {
      if (isSaving) return;
      setIsSaving(true);
      try {
        await patchConfig(patch);
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving, patchConfig],
  );
  const setAutoTitle = useCallback(
    (value: boolean) => void update({ terminalTitleMode: value ? "auto" : "default" }),
    [update],
  );
  const setIncludePaths = useCallback(
    (value: boolean) => void update({ terminalTitleIncludePaths: value }),
    [update],
  );
  if (!supported) return null;

  return (
    <SettingsSection title="Terminal appearance">
      <View style={settingsStyles.card} testID="terminal-title-settings-card">
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Auto title</Text>
            <Text style={settingsStyles.rowHint}>
              Show the active shell or command. Turn off to keep the stable default name.
            </Text>
          </View>
          <Switch
            value={mode === "auto"}
            onValueChange={setAutoTitle}
            disabled={isSaving}
            accessibilityLabel="Auto title"
          />
        </View>
        {mode === "auto" ? (
          <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Include paths in executable titles</Text>
              <Text style={settingsStyles.rowHint}>Off keeps titles concise, such as cmd.exe.</Text>
            </View>
            <Switch value={includePaths} onValueChange={setIncludePaths} disabled={isSaving} />
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

export function HostTerminalsPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <SettingsSection title="Terminal agents">
        <EnableTerminalAgentHooksCard serverId={serverId} />
      </SettingsSection>
      <TerminalCompatibilitySection serverId={serverId} />
      <TerminalAppearanceSection serverId={serverId} />
      <WindowsTerminalShellSection serverId={serverId} />
      <TerminalProfilesSection serverId={serverId} />
    </View>
  );
}

const terminalProfileStyles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 56,
  },
  // Icon + label; the first line of a profile row. Fills inline at sm+, stays
  // full-width above the centered action buttons when the row stacks. Uses an
  // auto flex-basis so it keeps its height in the stacked column (a 0 basis would
  // collapse it and overlap the buttons).
  rowPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexGrow: { xs: 0, sm: 1 },
    flexShrink: 1,
    flexBasis: "auto",
    alignSelf: { xs: "stretch", sm: "auto" },
  },
  iconWrapper: {
    width: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 5,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));

const styles = StyleSheet.create((theme) => ({
  // A picker sitting as the trailing control of a settings row. The desktop
  // popover never renders narrower than the trigger it was measured from, so
  // the trigger has to be wide enough to read the longest option, not just the
  // selected one.
  rowPickerTrigger: {
    minWidth: 180,
  },
  daemonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginBottom: theme.spacing[4],
  },
  daemonHeaderLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  identityBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
    marginBottom: theme.spacing[6],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusText: {
    // Explicit compact bump (not left to the ambient theme-patch scale).
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    maxWidth: 200,
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
  connectionLatency: {
    fontSize: theme.fontSize.base,
    marginRight: theme.spacing[2],
  },
  connectionTrailing: {
    flexDirection: "row",
    alignItems: "center",
  },
  confirmText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  // Action row handed to a sheet's `footer` slot. The sheet's footer wrapper
  // already owns the padding, top border, and outer alignment - this only
  // lays the buttons out inside it.
  sheetFooterRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  // Reset is a ghost button and Save is intrinsic-width, so this pair trails to
  // the right rather than splitting the bar the way the flex:1 pairs do.
  sheetFooterRowTrailing: {
    justifyContent: "flex-end",
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

const FLEX_1_STYLE = { flex: 1 };
const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
// Latency + Remove group: stacks below the connection title and centers on the
// narrowest widths, hugs the right edge inline at sm+.
const CONNECTION_TRAILING_STYLE = [styles.connectionTrailing, settingsStyles.rowControlGroup];

const APPEND_PROMPT_FOOTER_STYLE = [styles.sheetFooterRow, styles.sheetFooterRowTrailing];
