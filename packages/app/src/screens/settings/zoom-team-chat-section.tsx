import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { IntegrationAuthorizationOverview } from "@otto-code/protocol/integration-authorization";
import { ChevronDown, InboxText } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { shouldPollZoomTeamChatAuthorization } from "./zoom-team-chat-authorization-poll";
import { zoomTeamChatAccountLabel } from "./zoom-team-chat-connection-display";

const ZOOM_TEAM_CHAT_PROVIDER_ID = "zoom-team-chat";
const ZOOM_TEAM_CHAT_CONNECTION_ID = "primary";
const ZOOM_TEAM_CHAT_AUTHORIZATION_POLL_MS = 1_000;
const ThemedInboxText = withUnistyles(InboxText);
const ThemedChevronDown = withUnistyles(ChevronDown);

const inboxTextForegroundMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.md,
});

const chevronMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

function useIntegrationAuthorizationFeature(serverId: string): boolean {
  return useSessionStore((state) => {
    const features = state.sessions[serverId]?.serverInfo?.features;
    return (
      features?.integrationAuthorization === true &&
      features?.integrationAuthorizationBrowserFlow === true
    );
  });
}

function connectionStatusLabel(
  connection: IntegrationAuthorizationOverview["connections"][number] | undefined,
  isAwaitingAuthorization: boolean,
): string {
  switch (connection?.state) {
    case "connected":
      return "Connected";
    case "authorizing":
      return isAwaitingAuthorization
        ? "Finish the Zoom approval page. If Zoom showed an error or used the wrong account, choose Start again."
        : "A previous Zoom sign-in was not completed. Start a new sign-in when ready.";
    case "reauth_required":
      return "Your Zoom connection needs to be renewed.";
    case "error":
      if (connection.errorCode?.startsWith("exchange_failed_")) {
        return "Zoom rejected the sign-in exchange. Check this app's public client ID and OAuth redirect URL.";
      }
      if (connection.errorCode === "token_storage_failed") {
        return "Zoom sign-in succeeded, but Otto could not save the connection securely.";
      }
      return "Zoom sign-in did not complete. Try again.";
    default:
      return "Not connected";
  }
}

function findZoomTeamChatConnection(
  overview: IntegrationAuthorizationOverview | null,
): IntegrationAuthorizationOverview["connections"][number] | undefined {
  return overview?.connections.find(
    (item) =>
      item.integrationId === ZOOM_TEAM_CHAT_PROVIDER_ID &&
      item.connectionId === ZOOM_TEAM_CHAT_CONNECTION_ID,
  );
}

function authorizationButtonLabel(
  connection: IntegrationAuthorizationOverview["connections"][number] | undefined,
): string {
  if (connection?.state === "connected") return "Reconnect";
  if (connection?.state === "authorizing") return "Start again";
  return "Sign in with Zoom";
}

function useZoomTeamChatConnection(props: { serverId: string | null; isLocalDaemon: boolean }) {
  const { serverId, isLocalDaemon } = props;
  const normalizedServerId = serverId ?? "";
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const hasFeature = useIntegrationAuthorizationFeature(normalizedServerId);
  const supportsChatAvailability = useHostFeature(
    normalizedServerId,
    "communicationsChatAvailability",
  );
  const [overview, setOverview] = useState<IntegrationAuthorizationOverview | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isChangingChatEnabled, setIsChangingChatEnabled] = useState(false);
  const [isAwaitingAuthorization, setIsAwaitingAuthorization] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!client || !isConnected || !hasFeature) {
      return;
    }
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setIsRefreshing(true);
    try {
      const nextOverview = await client.integrationsAuthorizationGetOverview();
      setOverview(nextOverview);
      if (findZoomTeamChatConnection(nextOverview)?.state !== "authorizing") {
        setNotice(null);
        setIsAwaitingAuthorization(false);
      }
      setError(null);
    } catch {
      setError("Could not read Zoom Team Chat connection status.");
    } finally {
      setIsRefreshing(false);
      refreshInFlight.current = false;
    }
  }, [client, hasFeature, isConnected]);

  const refreshChatEnabled = useCallback(async (): Promise<void> => {
    if (!client || !isConnected || !supportsChatAvailability) {
      setChatEnabled(false);
      return;
    }
    try {
      const communications = await client.communicationsGetOverview();
      const zoom = communications.providers.find(
        (provider) => provider.providerId === ZOOM_TEAM_CHAT_PROVIDER_ID,
      );
      setChatEnabled(zoom?.connectionState === "connected" && zoom.enabled !== false);
    } catch {
      setChatEnabled(false);
    }
  }, [client, isConnected, supportsChatAvailability]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshChatEnabled();
    }, [refresh, refreshChatEnabled]),
  );

  const connection = findZoomTeamChatConnection(overview);
  const isAuthorizing = shouldPollZoomTeamChatAuthorization(connection, isAwaitingAuthorization);

  useEffect(() => {
    if (!isAuthorizing) return;
    const timer = setInterval(() => void refresh(), ZOOM_TEAM_CHAT_AUTHORIZATION_POLL_MS);
    return () => clearInterval(timer);
  }, [isAuthorizing, refresh]);
  useEffect(() => {
    if (connection?.state === "connected") {
      void refreshChatEnabled();
    }
  }, [connection?.state, refreshChatEnabled]);
  const vaultReason = overview?.vault.status === "unavailable" ? overview.vault.reason : undefined;
  const vaultUnavailable = vaultReason !== undefined;
  const canStart =
    client !== null &&
    isConnected &&
    hasFeature &&
    isLocalDaemon &&
    !vaultUnavailable &&
    !isStarting;

  const startSignIn = useCallback(() => {
    if (!canStart || !client) {
      return;
    }
    const run = async (): Promise<void> => {
      setIsStarting(true);
      setError(null);
      setNotice(null);
      try {
        const result = await client.integrationsAuthorizationStartBrowser({
          integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
          connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
        });
        if (!result.authorizationUrl) {
          throw new Error(result.error ?? "Could not start Zoom sign-in.");
        }
        setIsAwaitingAuthorization(true);
        await refresh();
        void openExternalUrl(result.authorizationUrl);
        setNotice(
          "Finish the Zoom approval page. If it shows an error or uses the wrong account, choose Start again.",
        );
      } catch (reason) {
        setIsAwaitingAuthorization(false);
        setError(reason instanceof Error ? reason.message : "Could not start Zoom sign-in.");
      } finally {
        setIsStarting(false);
      }
    };
    void run();
  }, [canStart, client, refresh]);

  const canSetChatEnabled =
    client !== null &&
    isConnected &&
    supportsChatAvailability &&
    connection?.state === "connected" &&
    !isChangingChatEnabled;
  const changeChatEnabled = useCallback(
    (enabled: boolean) => {
      if (!client || !canSetChatEnabled) return;
      const run = async (): Promise<void> => {
        setIsChangingChatEnabled(true);
        try {
          const presence = await client.communicationsInboxSetEnabled({
            providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
            enabled,
          });
          setChatEnabled(presence.enabled ?? enabled);
        } finally {
          setIsChangingChatEnabled(false);
        }
      };
      void run();
    },
    [canSetChatEnabled, client],
  );

  return {
    hasFeature,
    serverId,
    isLocalDaemon,
    overview,
    connection,
    error,
    notice,
    vaultUnavailable,
    vaultReason,
    isRefreshing,
    isStarting,
    isChangingChatEnabled,
    isAwaitingAuthorization,
    chatEnabled,
    canSetChatEnabled,
    canStart,
    refresh,
    startSignIn,
    changeChatEnabled,
  };
}

function ZoomTeamChatUnavailableCard() {
  return (
    <SettingsSection title="Chat">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Chat</Text>
            <Text style={settingsStyles.rowHint}>Update this host to configure Chat.</Text>
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}

function ZoomTeamChatConnectionCard(props: {
  connection: IntegrationAuthorizationOverview["connections"][number] | undefined;
  error: string | null;
  isLocalDaemon: boolean;
  isRefreshing: boolean;
  isStarting: boolean;
  isChangingChatEnabled: boolean;
  isAwaitingAuthorization: boolean;
  chatEnabled: boolean;
  canSetChatEnabled: boolean;
  notice: string | null;
  vaultReason: string | undefined;
  canStart: boolean;
  onRefresh: () => void;
  onStartSignIn: () => void;
  onChatEnabledChange: (enabled: boolean) => void;
}) {
  const [adapter, setAdapter] = useState<"zoom">("zoom");
  const selectZoomAdapter = useCallback(() => setAdapter("zoom"), []);
  const {
    connection,
    error,
    isLocalDaemon,
    isRefreshing,
    isStarting,
    isChangingChatEnabled,
    isAwaitingAuthorization,
    chatEnabled,
    canSetChatEnabled,
    notice,
    vaultReason,
    canStart,
    onRefresh,
    onStartSignIn,
    onChatEnabledChange,
  } = props;
  const status =
    error ?? vaultReason ?? notice ?? connectionStatusLabel(connection, isAwaitingAuthorization);
  const accountLabel = zoomTeamChatAccountLabel(connection);
  const isError = error !== null || connection?.state === "error";

  return (
    <SettingsSection title="Chat">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.rowTitleRow}>
              <ThemedInboxText uniProps={inboxTextForegroundMapping} />
              <Text style={settingsStyles.rowTitle}>Chat</Text>
            </View>
            <Text style={settingsStyles.rowHint}>Show Chat in the title bar.</Text>
          </View>
          <Switch
            value={chatEnabled}
            onValueChange={onChatEnabledChange}
            disabled={!canSetChatEnabled || isChangingChatEnabled}
            accessibilityLabel="Enable Chat"
            testID="chat-enabled-switch"
          />
        </View>
        <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Adapter</Text>
          </View>
          <DropdownMenu>
            <DropdownMenuTrigger
              style={styles.adapterTrigger}
              accessibilityLabel={`Chat adapter: ${adapter === "zoom" ? "Zoom" : adapter}`}
              testID="chat-adapter-picker"
            >
              <Text style={styles.adapterTriggerText}>Zoom</Text>
              <ThemedChevronDown uniProps={chevronMutedMapping} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" width={180}>
              <DropdownMenuItem selected={adapter === "zoom"} onSelect={selectZoomAdapter}>
                Zoom
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        {adapter === "zoom" ? (
          <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Zoom Team Chat</Text>
              <Text style={isError ? settingsStyles.rowError : settingsStyles.rowHint}>
                {status}
              </Text>
              {accountLabel ? <Text style={settingsStyles.rowHint}>{accountLabel}</Text> : null}
              {!isLocalDaemon ? (
                <Text style={settingsStyles.rowHint}>
                  Sign-in is currently available when this computer is running the selected Otto
                  host.
                </Text>
              ) : null}
            </View>
            <View style={[settingsStyles.rowControlGroup, styles.controls]}>
              <Button onPress={onRefresh} variant="secondary" size="sm" disabled={isRefreshing}>
                Refresh
              </Button>
              <Button onPress={onStartSignIn} size="sm" disabled={!canStart} loading={isStarting}>
                {authorizationButtonLabel(connection)}
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

export function ZoomTeamChatSection(props: { serverId: string | null; isLocalDaemon: boolean }) {
  const state = useZoomTeamChatConnection(props);
  const { refresh } = state;
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  if (!state.serverId || !state.hasFeature) {
    return <ZoomTeamChatUnavailableCard />;
  }

  return (
    <ZoomTeamChatConnectionCard
      connection={state.connection}
      error={state.error}
      isLocalDaemon={state.isLocalDaemon}
      isRefreshing={state.isRefreshing}
      isStarting={state.isStarting}
      isChangingChatEnabled={state.isChangingChatEnabled}
      isAwaitingAuthorization={state.isAwaitingAuthorization}
      chatEnabled={state.chatEnabled}
      canSetChatEnabled={state.canSetChatEnabled}
      notice={state.notice}
      vaultReason={state.vaultReason}
      canStart={state.canStart}
      onRefresh={handleRefresh}
      onStartSignIn={state.startSignIn}
      onChatEnabledChange={state.changeChatEnabled}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  adapterTrigger: {
    alignItems: "center",
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  adapterTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
