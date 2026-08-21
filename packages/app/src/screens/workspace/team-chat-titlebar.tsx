/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react/jsx-max-depth -- notification cards bind their own explicit conversation and acknowledgement identities. */
// The Zoom team-chat title-bar surface: the header button, presence
// combobox, destination search, favorites, room popup, and the meeting
// notes button, with the header-action trigger styling they share.
// Extracted from workspace-screen.tsx, which keeps one registration
// point per control.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import {
  AlarmClock,
  CalendarClock,
  Chat,
  ChatBubbleOff,
  CircleX,
  HeadsetMic,
  HeadsetOff,
  MarkUnreadChatAlt,
  MoreHorizontal,
  Star,
  StarFilled,
} from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { compactUp, useIconSize, type Theme } from "@/styles/theme";
import { headerIconSlotStyle } from "@/components/headers/header-toggle-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TitlebarPopupSearchField } from "@/components/ui/titlebar-popup-search-field";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useAppSettingValue, type AppSettings } from "@/hooks/use-settings";
import { useRetainedScrollOffset } from "@/hooks/use-retained-scroll-offset";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { getDesktopHost } from "@/desktop/host";
import { supportsZoomRecorder } from "@/desktop/zoom-recorder-capability";
import { useZoomRecorderStatus } from "@/desktop/use-zoom-recorder-status";
import { MeetingTranscriptLibrary } from "@/meetings/meeting-transcript-library";
import { buildWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { getZoomMeetingTitlebarState } from "@/screens/workspace/zoom-meetings-titlebar-state";
import { shouldShowZoomTeamChatTitlebar } from "@/screens/workspace/zoom-team-chat-titlebar-visibility";
import { CommunicationsRoom } from "@/screens/workspace/communications-room";
import type { DaemonClient } from "@otto-code/client";
import type {
  CommunicationConversationSummary,
  CommunicationHomeSection,
  CommunicationPresence,
  CommunicationPresenceStatus,
  CommunicationProviderConnectionState,
  CommunicationSearchResult,
} from "@otto-code/protocol/communications";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useAppVisible } from "@/hooks/use-app-visible";
import { openExternalUrl } from "@/utils/open-external-url";
import { useHostFeature } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron } from "@/constants/platform";

// Duplicated from workspace-screen.tsx (keep in sync): a few lines each,
// and this module must not import the screen.
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const mutedSmMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

// The title-bar notification glyph must reflect notifications raised while
// the Chat popup is closed, so it is refreshed on its own low-frequency
// background cadence instead of only on mount and on popup open.
const CHAT_NOTIFICATION_BADGE_POLL_INTERVAL_MS = 60_000;

const ThemedAlarmClock = withUnistyles(AlarmClock);

const ThemedCalendarClock = withUnistyles(CalendarClock);

const ThemedChat = withUnistyles(Chat);

const ThemedChatBubbleOff = withUnistyles(ChatBubbleOff);

const ThemedMarkUnreadChatAlt = withUnistyles(MarkUnreadChatAlt);

const ThemedCircleX = withUnistyles(CircleX);

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);

const ThemedHeadsetMic = withUnistyles(HeadsetMic);

const ThemedHeadsetOff = withUnistyles(HeadsetOff);

const ThemedStar = withUnistyles(Star);

const ThemedStarFilled = withUnistyles(StarFilled);

export function headerActionTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
}) {
  return [
    styles.headerActionButton,
    (Boolean(hovered) || Boolean(pressed) || Boolean(open)) && styles.headerActionButtonHovered,
  ];
}

// Mirrors the menu button's own chrome (`headerIconSlotStyle`) instead of a
// separately-sized fixed box, so the mobile "..." trigger matches it exactly.
export function compactHeaderActionTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
}) {
  return [
    headerIconSlotStyle.slot,
    (Boolean(hovered) || Boolean(pressed) || Boolean(open)) && headerIconSlotStyle.slotHovered,
  ];
}

const selectZoomRecorderEnabled = (settings: AppSettings) => settings.zoomRecorderEnabled;

const selectZoomRecorderPaused = (settings: AppSettings) => settings.zoomRecorderPaused;

function zoomRecorderColorMapping(
  state: ReturnType<typeof useZoomRecorderStatus>["status"]["state"],
  modelReady: boolean,
  active: boolean,
) {
  const titlebarState = getZoomMeetingTitlebarState(state, modelReady);
  return (theme: Theme) => {
    if (!active) return { color: theme.colors.foregroundMuted };
    switch (titlebarState.tone) {
      case "success":
        return { color: theme.colors.statusSuccess };
      case "warning":
        return { color: theme.colors.statusWarning };
      case "info":
        return { color: theme.colors.statusInfo };
      case "danger":
        return { color: theme.colors.statusDanger };
      default:
        return { color: theme.colors.foregroundMuted };
    }
  };
}

function meetingNotesTriggerStyle(
  {
    hovered,
    pressed,
    open,
    focused,
  }: {
    hovered?: boolean;
    pressed?: boolean;
    open?: boolean;
    focused?: boolean;
  },
  active: boolean,
) {
  return [
    styles.headerActionButton,
    active && styles.headerActionButtonActive,
    Boolean(focused) && styles.headerActionButtonFocused,
    (Boolean(hovered) || Boolean(pressed) || Boolean(open)) && styles.headerActionButtonHovered,
  ];
}

function resolveZoomTeamChatConnectionState(
  connectionState: CommunicationProviderConnectionState | undefined,
): { label: string; isConnected: boolean } {
  switch (connectionState) {
    case "connected":
      return { label: "Connected", isConnected: true };
    case "connecting":
      return { label: "Signing in", isConnected: false };
    case "reauth_required":
      return { label: "Reconnect required", isConnected: false };
    case "error":
      return { label: "Needs attention", isConnected: false };
    default:
      return { label: "Not connected", isConnected: false };
  }
}

function canStartZoomTeamChatSignIn({
  supportsCommunications,
  supportsIntegrationAuthorization,
  isHostConnected,
  isLocalDaemon,
  isStartingSignIn,
}: {
  supportsCommunications: boolean;
  supportsIntegrationAuthorization: boolean;
  isHostConnected: boolean;
  isLocalDaemon: boolean;
  isStartingSignIn: boolean;
}): boolean {
  return (
    supportsCommunications &&
    supportsIntegrationAuthorization &&
    isHostConnected &&
    isLocalDaemon &&
    !isStartingSignIn
  );
}

function zoomTeamChatAccessibilityLabel(notificationCount: number, enabled: boolean): string {
  // "Offline", not "Disabled": the status picker already calls this state
  // Offline, and docs/glossary.md forbids two labels for one state.
  if (!enabled) return "Open Chat. Offline.";
  return notificationCount > 0
    ? `Open Chat. ${notificationCount} notification${notificationCount === 1 ? "" : "s"}.`
    : "Open Chat";
}

function zoomTeamChatTooltip(
  unreadCount: number,
  connectionLabel: string,
  presenceStatus: CommunicationPresenceStatus,
  observedStatusLabel: string | null,
  enabled: boolean,
  pendingPresence: boolean,
): string {
  if (!enabled) return "Chat: Offline";
  if (pendingPresence) return "Chat: Pending";
  if (unreadCount > 0) return "Chat: Notification";
  return `Chat: ${
    connectionLabel === "Connected"
      ? formatZoomChatPresence(presenceStatus, observedStatusLabel)
      : connectionLabel
  }`;
}

type ZoomChatDisplayedPresenceStatus = CommunicationPresenceStatus | "pending";

function zoomTeamChatPresenceColorMapping(status: ZoomChatDisplayedPresenceStatus) {
  return (theme: Theme) => {
    switch (status) {
      case "available":
        return { color: theme.colors.statusSuccess };
      case "busy":
      case "do_not_disturb":
        return { color: theme.colors.statusDanger };
      case "away":
      case "out_of_office":
        return { color: theme.colors.foregroundMuted };
      default:
        return { color: theme.colors.foregroundMuted };
    }
  };
}

const favoriteColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

const unreadChatColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

function ZoomTeamChatTitleIcon({
  unreadCount,
  connected,
  presenceStatus,
  pendingPresence,
  enabled,
  iconSize,
}: {
  unreadCount: number;
  connected: boolean;
  presenceStatus: CommunicationPresenceStatus;
  pendingPresence: boolean;
  enabled: boolean;
  iconSize: number;
}): ReactElement {
  if (enabled && pendingPresence) {
    return (
      <ThemedMoreHorizontal
        size={iconSize}
        uniProps={zoomTeamChatPresenceColorMapping("pending")}
      />
    );
  }
  if (enabled && unreadCount > 0) {
    return <ThemedMarkUnreadChatAlt size={iconSize} uniProps={unreadChatColorMapping} />;
  }
  return connected && enabled ? (
    <ThemedChat size={iconSize} uniProps={zoomTeamChatPresenceColorMapping(presenceStatus)} />
  ) : (
    <ThemedChatBubbleOff size={iconSize} uniProps={mutedColorMapping} />
  );
}

function toLegacyChatHomeSections(
  conversations: CommunicationConversationSummary[],
): CommunicationHomeSection[] {
  const directMessages = conversations.filter((conversation) => conversation.kind === "direct");
  const groups = conversations.filter((conversation) => conversation.kind === "group");
  const channels = conversations.filter((conversation) => conversation.kind === "channel");
  return [
    {
      id: "direct-messages",
      label: "Direct messages",
      conversations: directMessages,
      collections: [],
    },
    { id: "groups", label: "Groups", conversations: groups, collections: [] },
    { id: "channels", label: "Channels", conversations: channels, collections: [] },
  ].filter((section) => section.conversations.length > 0);
}

interface ZoomChatPresenceOption {
  id: Exclude<CommunicationPresenceStatus, "unknown"> | "offline";
  label: string;
}

const ZOOM_CHAT_PRESENCE_OPTIONS: ZoomChatPresenceOption[] = [
  { id: "available", label: "Available" },
  { id: "busy", label: "Busy" },
  { id: "do_not_disturb", label: "Do not disturb" },
  { id: "away", label: "Away" },
  { id: "out_of_office", label: "Out of office" },
  { id: "offline", label: "Offline" },
];

function formatZoomChatPresence(
  status: CommunicationPresenceStatus,
  observedStatusLabel: string | null,
): string {
  return (
    observedStatusLabel ??
    ZOOM_CHAT_PRESENCE_OPTIONS.find((option) => option.id === status)?.label ??
    ""
  );
}

function zoomChatPresenceDisplayText(
  status: CommunicationPresenceStatus,
  enabled: boolean,
  updating: boolean,
  pendingStatus: CommunicationPresenceStatus | null,
  observedStatusLabel: string | null,
): string | null {
  if (updating) return "Updating...";
  if (pendingStatus) return "Pending";
  if (!enabled) return "Offline";
  return formatZoomChatPresence(status, observedStatusLabel) || null;
}

function zoomStatusUpdateErrorMessage(error: unknown): string {
  const cooldownMatch = /available again at (\d{4}-\d{2}-\d{2}T[^.]+\.\d{3}Z)/.exec(
    getErrorMessage(error),
  );
  if (cooldownMatch) return "Status can be updated once per minute. Please wait for the timer.";
  const statusCode = /status (\d{3})/.exec(getErrorMessage(error))?.[1];
  return statusCode
    ? `The service rejected this status update (HTTP ${statusCode}).`
    : "Could not apply this status update.";
}

function statusChangeAvailableAtFromError(error: unknown): string | null {
  const value = /available again at (\d{4}-\d{2}-\d{2}T[^.]+\.\d{3}Z)/.exec(
    getErrorMessage(error),
  )?.[1];
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function resolveZoomChatPresenceAfterUpdate(
  previous: CommunicationPresenceStatus,
  requested: CommunicationPresenceStatus,
  observed: CommunicationPresenceStatus,
): CommunicationPresenceStatus {
  if (observed === requested || observed !== "unknown") return observed;
  return previous;
}

function canChangeZoomChatPresence(
  current: CommunicationPresenceStatus,
  next: CommunicationPresenceStatus,
): boolean {
  if (current === next) return false;
  // Zoom's REST API does not permit entering Do Not Disturb on current desktop
  // clients. It remains display-only here, while a user already in DND can
  // return to a writable status.
  switch (current) {
    case "available":
      return next === "away";
    case "away":
      return next === "available";
    case "do_not_disturb":
      return next === "available" || next === "away";
    default:
      return false;
  }
}

function canSelectZoomChatPresenceOption({
  option,
  enabled,
  supportsPresence,
  currentPresence,
  statusChangeLocked,
  pendingStatus,
}: {
  option: ZoomChatPresenceOption;
  enabled: boolean;
  supportsPresence: boolean;
  currentPresence: CommunicationPresenceStatus;
  statusChangeLocked: boolean;
  pendingStatus: CommunicationPresenceStatus | null;
}): boolean {
  if (option.id === "offline") return enabled;
  if (!enabled) return option.id === "available";
  if (pendingStatus) return false;
  if (statusChangeLocked) return false;
  // A connected user can be in a Zoom presence which Otto does not expose as
  // a selectable state (for example, in a meeting). Available is the single
  // documented recovery transition that we can offer without inventing a
  // current status in the picker.
  if (currentPresence === "unknown") return option.id === "available";
  return supportsPresence && canChangeZoomChatPresence(currentPresence, option.id);
}

function getStatusChangeCooldownMs(
  availableAt: string | null,
  now: number,
  availableInMs?: number | null,
  snapshotReceivedAt?: number,
): number {
  if (availableInMs !== null && availableInMs !== undefined && snapshotReceivedAt !== undefined) {
    return Math.max(0, availableInMs - (now - snapshotReceivedAt));
  }
  if (!availableAt) return 0;
  const expiresAt = Date.parse(availableAt);
  return Number.isNaN(expiresAt) ? 0 : Math.max(0, expiresAt - now);
}

function formatStatusChangeCooldown(remainingMs: number): string {
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function zoomChatPresenceOptionAccessibilityLabel(params: {
  option: ZoomChatPresenceOption;
  disabled: boolean;
  statusChangeLocked: boolean;
  statusChangeCooldownMs: number;
}): string {
  if (!params.disabled) return `Set Chat status to ${params.option.label}`;
  if (params.statusChangeLocked && params.option.id !== "offline") {
    return `${params.option.label}, status changes available in ${formatStatusChangeCooldown(params.statusChangeCooldownMs)}`;
  }
  return `${params.option.label}, unavailable from the current status`;
}

function getZoomChatDisplayedPresenceStatus(params: {
  enabled: boolean;
  pendingStatus: CommunicationPresenceStatus | null;
  status: CommunicationPresenceStatus;
}): ZoomChatDisplayedPresenceStatus | "offline" {
  if (!params.enabled) return "offline";
  return params.pendingStatus ? "pending" : params.status;
}

function refreshWhenZoomChatMenuOpens(nextOpen: boolean, refresh: () => void): void {
  if (nextOpen) refresh();
}

function useZoomChatStatusChangeCooldown(
  statusChangeAvailableAt: string | null,
  statusChangeAvailableInMs: number | null,
  supported: boolean,
): { statusChangeCooldownMs: number; statusChangeLocked: boolean } {
  const [clock, setClock] = useState(() => Date.now());
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());
  const statusChangeCooldownMs = getStatusChangeCooldownMs(
    statusChangeAvailableAt,
    clock,
    statusChangeAvailableInMs,
    snapshotReceivedAt,
  );
  const statusChangeLocked = supported && statusChangeCooldownMs > 0;

  useEffect(() => {
    const receivedAt = Date.now();
    setClock(receivedAt);
    setSnapshotReceivedAt(receivedAt);
  }, [statusChangeAvailableAt, statusChangeAvailableInMs]);

  useEffect(() => {
    const remainingMs = getStatusChangeCooldownMs(statusChangeAvailableAt, clock);
    if (remainingMs <= 0) return;
    const timeout = setTimeout(() => setClock(Date.now()), Math.min(1_000, remainingMs));
    return () => clearTimeout(timeout);
  }, [clock, snapshotReceivedAt, statusChangeAvailableAt, statusChangeAvailableInMs]);

  return { statusChangeCooldownMs, statusChangeLocked };
}

function useZoomChatPendingPresenceRefresh(params: {
  enabled: boolean;
  pendingStatus: CommunicationPresenceStatus | null;
  statusChangeAvailableAt: string | null;
  statusChangeAvailableInMs: number | null;
  refresh: () => void;
}): void {
  const [refreshTick, setRefreshTick] = useState(0);
  const { enabled, pendingStatus, statusChangeAvailableAt, statusChangeAvailableInMs, refresh } =
    params;

  useEffect(() => {
    if (!enabled || !pendingStatus) return;
    const remainingMs = getStatusChangeCooldownMs(
      statusChangeAvailableAt,
      Date.now(),
      statusChangeAvailableInMs,
    );
    const delayMs = remainingMs > 0 ? remainingMs + 1_000 : 2_000;
    const timeout = setTimeout(() => {
      refresh();
      setRefreshTick((current) => current + 1);
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [
    enabled,
    pendingStatus,
    refresh,
    refreshTick,
    statusChangeAvailableAt,
    statusChangeAvailableInMs,
  ]);
}

function ZoomChatPresenceIcon({
  status,
  size,
}: {
  status: ZoomChatDisplayedPresenceStatus | "offline";
  size: number;
}): ReactElement {
  if (status === "pending") {
    return <ThemedMoreHorizontal size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  if (status === "busy") {
    return <ThemedCircleX size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  if (status === "away") {
    return <ThemedAlarmClock size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  if (status === "out_of_office") {
    return <ThemedCalendarClock size={size} uniProps={zoomTeamChatPresenceColorMapping(status)} />;
  }
  let dotColor = styles.teamChatPresenceDotMuted;
  if (status === "available") dotColor = styles.teamChatPresenceDotSuccess;
  if (status === "do_not_disturb") dotColor = styles.teamChatPresenceDotDanger;
  return (
    <View style={[styles.teamChatPresenceDot, { width: size, height: size }, dotColor]}>
      {status === "do_not_disturb" ? <View style={styles.teamChatPresenceDndBar} /> : null}
    </View>
  );
}

function zoomChatSearchInitials(title: string): string {
  const initials = title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return initials || "?";
}

function ZoomChatFavoriteButton({
  favorite,
  disabled,
  onPress,
  testID,
}: {
  favorite: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={favorite ? "Remove from Chat favorites" : "Add to Chat favorites"}
      style={[styles.teamChatFavoriteButton, disabled && styles.teamChatFavoriteButtonDisabled]}
    >
      {favorite ? (
        <ThemedStarFilled size={16} uniProps={favoriteColorMapping} />
      ) : (
        <ThemedStar size={16} uniProps={mutedSmMapping} />
      )}
    </Pressable>
  );
}

function useZoomChatDestinationSearch({
  client,
  enabled,
}: {
  client: ReturnType<typeof useHostRuntimeClient>;
  enabled: boolean;
}): {
  query: string;
  setQuery: (query: string) => void;
  reset: () => void;
  refresh: () => void;
  isSearchActive: boolean;
  people: CommunicationSearchResult[];
  conversations: CommunicationSearchResult[];
  isSearching: boolean;
  error: string | null;
} {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommunicationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const requestSequence = useRef(0);
  const isSearchActive = enabled && query.trim().length >= 2;
  const reset = useCallback(() => {
    requestSequence.current += 1;
    setQuery("");
    setResults([]);
    setError(null);
    setIsSearching(false);
  }, []);
  const refresh = useCallback(() => setRefreshSequence((sequence) => sequence + 1), []);
  useEffect(() => {
    const searchQuery = query.trim();
    const currentRequest = ++requestSequence.current;
    if (!isSearchActive || !client) {
      setResults([]);
      setError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      const search = async (): Promise<void> => {
        try {
          const searchResults = await client.communicationsInboxSearch({
            providerId: "zoom-team-chat",
            query: searchQuery,
          });
          if (requestSequence.current !== currentRequest) return;
          setResults(searchResults);
        } catch {
          if (requestSequence.current !== currentRequest) return;
          setResults([]);
          setError("Could not search Chat. Reconnect if access was just granted.");
        } finally {
          if (requestSequence.current === currentRequest) setIsSearching(false);
        }
      };
      void search();
    }, 300);
    return () => clearTimeout(timer);
  }, [client, isSearchActive, query, refreshSequence]);
  return {
    query,
    setQuery,
    reset,
    refresh,
    isSearchActive,
    people: results.filter((result) => result.category === "person"),
    conversations: results.filter((result) => result.category === "conversation"),
    isSearching,
    error,
  };
}

function ZoomChatSearchResultRow({
  result,
  iconSize,
  onOpenConversation,
  canToggleFavorite,
  isFavoriteUpdating,
  onToggleFavorite,
}: {
  result: CommunicationSearchResult;
  iconSize: number;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  canToggleFavorite: boolean;
  isFavoriteUpdating: boolean;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
}): ReactElement {
  const onPress = useCallback(
    () => onOpenConversation(result.conversation),
    [onOpenConversation, result.conversation],
  );
  const isPerson = result.category === "person";
  const favorite = result.conversation.favorite === true;
  const toggleFavorite = useCallback(
    () => onToggleFavorite(result.conversation, !favorite),
    [favorite, onToggleFavorite, result.conversation],
  );
  const detail = [result.detail, result.presenceLabel].filter(Boolean).join(" · ");
  return (
    <View style={styles.teamChatSearchResult}>
      <Pressable
        testID={`workspace-zoom-team-chat-search-${result.conversation.conversationId}`}
        onPress={onPress}
        accessibilityLabel={`${isPerson ? "Message" : "Open"} ${result.conversation.title}`}
        style={styles.teamChatSearchResultPrimary}
      >
        {isPerson ? (
          <View style={styles.teamChatSearchAvatar}>
            <Text style={styles.teamChatSearchAvatarText}>
              {zoomChatSearchInitials(result.conversation.title)}
            </Text>
          </View>
        ) : (
          <View style={styles.teamChatSearchConversationIcon}>
            <Chat size={iconSize} color={styles.teamChatSearchConversationIconGlyph.color} />
          </View>
        )}
        <View style={styles.teamChatSearchResultCopy}>
          <Text style={styles.teamChatSearchResultTitle} numberOfLines={1}>
            {result.conversation.title}
          </Text>
          {detail ? (
            <View style={styles.teamChatSearchResultDetailRow}>
              {result.presenceStatus ? (
                <ZoomChatPresenceIcon status={result.presenceStatus} size={10} />
              ) : null}
              <Text style={styles.teamChatSearchResultDetail} numberOfLines={1}>
                {detail}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {canToggleFavorite && result.conversation.canFavorite !== false ? (
        <ZoomChatFavoriteButton
          favorite={favorite}
          disabled={isFavoriteUpdating}
          onPress={toggleFavorite}
          testID={`workspace-zoom-team-chat-search-favorite-${result.conversation.conversationId}`}
        />
      ) : null}
    </View>
  );
}

function ZoomChatSearchResults({
  people,
  conversations,
  isSearching,
  error,
  iconSize,
  onOpenConversation,
  canToggleFavorite,
  isFavoriteUpdating,
  onToggleFavorite,
}: {
  people: CommunicationSearchResult[];
  conversations: CommunicationSearchResult[];
  isSearching: boolean;
  error: string | null;
  iconSize: number;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  canToggleFavorite: boolean;
  isFavoriteUpdating: (conversationId: string) => boolean;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
}): ReactElement {
  const empty = !isSearching && !error && people.length === 0 && conversations.length === 0;
  return (
    <View style={styles.teamChatSearchResults}>
      {isSearching ? (
        <View style={styles.teamChatSearchLoading}>
          <ActivityIndicator size="small" />
          <Text style={styles.teamChatSearchStatus}>Searching...</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.teamChatSearchError}>{error}</Text> : null}
      {people.length > 0 ? (
        <View style={styles.teamChatSearchGroup}>
          <Text style={styles.teamChatSearchGroupLabel}>People</Text>
          {people.map((result) => (
            <ZoomChatSearchResultRow
              key={`${result.category}:${result.conversation.conversationId}`}
              result={result}
              iconSize={iconSize}
              onOpenConversation={onOpenConversation}
              canToggleFavorite={canToggleFavorite}
              isFavoriteUpdating={isFavoriteUpdating(result.conversation.conversationId)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </View>
      ) : null}
      {conversations.length > 0 ? (
        <View style={styles.teamChatSearchGroup}>
          <Text style={styles.teamChatSearchGroupLabel}>Chats & channels</Text>
          {conversations.map((result) => (
            <ZoomChatSearchResultRow
              key={`${result.category}:${result.conversation.conversationId}`}
              result={result}
              iconSize={iconSize}
              onOpenConversation={onOpenConversation}
              canToggleFavorite={canToggleFavorite}
              isFavoriteUpdating={isFavoriteUpdating(result.conversation.conversationId)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </View>
      ) : null}
      {empty ? (
        <View style={styles.teamChatEmpty}>
          <Text style={styles.teamChatEmptyText}>No people or chats found.</Text>
        </View>
      ) : null}
    </View>
  );
}

function ZoomChatPopupSearchContents({
  connected,
  enabled,
  query,
  onChangeQuery,
  isSearchActive,
  people,
  conversations,
  isSearching,
  error,
  iconSize,
  onOpenConversation,
  canToggleFavorite,
  isFavoriteUpdating,
  onToggleFavorite,
  homeSections,
}: {
  connected: boolean;
  enabled: boolean;
  query: string;
  onChangeQuery: (query: string) => void;
  isSearchActive: boolean;
  people: CommunicationSearchResult[];
  conversations: CommunicationSearchResult[];
  isSearching: boolean;
  error: string | null;
  iconSize: number;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  canToggleFavorite: boolean;
  isFavoriteUpdating: (conversationId: string) => boolean;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
  homeSections: CommunicationHomeSection[];
}): ReactElement {
  const showSearch = connected && enabled;
  const showEmptyHome = showSearch && !isSearchActive && homeSections.length === 0 && !query;
  const showNoMatches =
    showSearch && !isSearchActive && Boolean(query) && homeSections.length === 0;
  return (
    <>
      {showSearch ? (
        <TitlebarPopupSearchField
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search chats or people"
          accessibilityLabel="Search chats or people"
        />
      ) : null}
      {isSearchActive ? (
        <ZoomChatSearchResults
          people={people}
          conversations={conversations}
          isSearching={isSearching}
          error={error}
          iconSize={iconSize}
          onOpenConversation={onOpenConversation}
          canToggleFavorite={canToggleFavorite}
          isFavoriteUpdating={isFavoriteUpdating}
          onToggleFavorite={onToggleFavorite}
        />
      ) : null}
      {showEmptyHome ? (
        <View style={styles.teamChatEmpty}>
          <Text style={styles.teamChatEmptyText}>No conversations yet.</Text>
        </View>
      ) : null}
      {showNoMatches ? (
        <View style={styles.teamChatEmpty}>
          <Text style={styles.teamChatEmptyText}>No matching chats.</Text>
        </View>
      ) : null}
    </>
  );
}

function ZoomChatHomeConversationRow({
  conversation,
  iconSize,
  canToggleFavorite,
  isFavoriteUpdating,
  onOpenConversation,
  onToggleFavorite,
}: {
  conversation: CommunicationConversationSummary;
  iconSize: number;
  canToggleFavorite: boolean;
  isFavoriteUpdating: boolean;
  onOpenConversation: (conversation: CommunicationConversationSummary) => void;
  onToggleFavorite: (conversation: CommunicationConversationSummary, favorite: boolean) => void;
}): ReactElement {
  const favorite = conversation.favorite === true;
  const isDirect = conversation.kind === "direct";
  const detail = zoomChatHomeConversationDetail(conversation);
  const openConversation = useCallback(
    () => onOpenConversation(conversation),
    [conversation, onOpenConversation],
  );
  const toggleFavorite = useCallback(
    () => onToggleFavorite(conversation, !favorite),
    [conversation, favorite, onToggleFavorite],
  );
  return (
    <View style={styles.teamChatHomeConversation}>
      <Pressable
        testID={`workspace-zoom-team-chat-home-${conversation.conversationId}`}
        onPress={openConversation}
        accessibilityLabel={`Open ${conversation.title}`}
        style={styles.teamChatHomeConversationPrimary}
      >
        {isDirect ? (
          <View style={styles.teamChatSearchAvatar}>
            <Text style={styles.teamChatSearchAvatarText}>
              {zoomChatSearchInitials(conversation.title)}
            </Text>
          </View>
        ) : (
          <View style={styles.teamChatSearchConversationIcon}>
            <Chat size={iconSize} color={styles.teamChatSearchConversationIconGlyph.color} />
          </View>
        )}
        <View style={styles.teamChatSearchResultCopy}>
          <Text style={styles.teamChatSearchResultTitle} numberOfLines={1}>
            {conversation.title}
          </Text>
          {detail ? (
            <Text style={styles.teamChatSearchResultDetail} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {canToggleFavorite && conversation.canFavorite !== false ? (
        <ZoomChatFavoriteButton
          favorite={favorite}
          disabled={isFavoriteUpdating}
          onPress={toggleFavorite}
          testID={`workspace-zoom-team-chat-home-favorite-${conversation.conversationId}`}
        />
      ) : null}
    </View>
  );
}

function zoomChatHomeConversationDetail(
  conversation: CommunicationConversationSummary,
): string | null {
  if (conversation.preview) return conversation.preview;
  if (conversation.kind === "direct") {
    const encodedTarget = conversation.conversationId.startsWith("contact:")
      ? conversation.conversationId.slice("contact:".length)
      : null;
    if (encodedTarget) {
      try {
        const contact = decodeURIComponent(encodedTarget);
        if (contact.includes("@")) return contact;
      } catch {
        // A malformed provider id cannot make a Home row fail to render.
      }
    }
    return "Direct message";
  }
  if (conversation.kind === "group") return "Group chat";
  if (conversation.kind === "channel") return "Channel";
  return null;
}

function zoomChatFavoriteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("Reconnect Zoom Chat in Settings")) {
    return "Reconnect Chat in Settings to allow favorites.";
  }
  return "Could not update Chat favorites. Try again.";
}

function canSearchZoomChatDestinations(
  supportsInboxSearch: boolean,
  connected: boolean,
  enabled: boolean,
): boolean {
  return supportsInboxSearch && connected && enabled;
}

function ZoomChatPopupRoomPage({
  client,
  serverId,
  conversation,
  onBack,
  onOpenChat,
}: {
  client: DaemonClient | null;
  serverId: string;
  conversation: CommunicationConversationSummary;
  onBack: () => void;
  onOpenChat: (conversation: CommunicationConversationSummary) => void;
}): ReactElement {
  const handleOpenChat = useCallback(() => onOpenChat(conversation), [conversation, onOpenChat]);
  const isCompactPopup = useIsCompactFormFactor();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // The room's natural size (720x680) can exceed a short or narrow desktop
  // window; nothing else clips it, since this popup does not use the
  // scrollable DropdownMenuContent path. Bound it to the viewport instead.
  const popupStyle = useMemo(
    () => [
      styles.teamChatRoomPopup,
      { width: Math.min(720, windowWidth - 48), height: Math.min(680, windowHeight - 96) },
    ],
    [windowHeight, windowWidth],
  );
  return (
    <View style={popupStyle}>
      <View style={styles.teamChatRoomHeader}>
        <Button size="xs" variant="ghost" onPress={onBack}>
          Back
        </Button>
        <Text style={styles.teamChatRoomTitle} numberOfLines={1}>
          {conversation.title}
        </Text>
        <Button size="xs" variant="ghost" onPress={handleOpenChat}>
          Open chat
        </Button>
      </View>
      <CommunicationsRoom
        client={client}
        serverId={serverId}
        conversation={conversation}
        compact={isCompactPopup}
      />
    </View>
  );
}

export function WorkspaceTeamChatButton({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const isDesktop = getIsElectron();
  const supportsCommunications = useHostFeature(serverId, "communications");
  const supportsChatHome = useHostFeature(serverId, "communicationsChatHome");
  const supportsInboxSearch = useHostFeature(serverId, "communicationsInboxSearch");
  const supportsChatFavorites = useHostFeature(serverId, "communicationsFavorites");
  const supportsPresence = useHostFeature(serverId, "communicationsPresence");
  const supportsChatAvailability = useHostFeature(serverId, "communicationsChatAvailability");
  const supportsPresenceChangeTiming = useHostFeature(
    serverId,
    "communicationsPresenceChangeTiming",
  );
  const supportsPresenceUpdates = useHostFeature(serverId, "communicationsPresenceUpdates");
  const supportsCommunicationsRooms = useHostFeature(serverId, "communicationsRooms");
  const supportsRoomNotifications = useHostFeature(serverId, "communicationsRoomNotifications");
  const supportsIntegrationAuthorization = useHostFeature(serverId, "integrationAuthorization");
  const client = useHostRuntimeClient(serverId);
  const openWorkspaceTabFocused = useWorkspaceLayoutStore((state) => state.openTabFocused);
  const isHostConnected = useHostRuntimeIsConnected(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const isAppVisible = useAppVisible();
  const iconSize = useIconSize(1.5);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatConnectionLabel, setChatConnectionLabel] = useState("Not connected");
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [isChatConnected, setIsChatConnected] = useState(false);
  const [isChatEnabled, setIsChatEnabled] = useState(false);
  const [conversations, setConversations] = useState<CommunicationConversationSummary[]>([]);
  const [chatHomeSections, setChatHomeSections] = useState<CommunicationHomeSection[]>([]);
  const [chatNotifications, setChatNotifications] = useState<
    { notificationId: string; conversation: CommunicationConversationSummary }[]
  >([]);
  const [favoriteUpdatingIds, setFavoriteUpdatingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [presenceStatus, setPresenceStatus] = useState<CommunicationPresenceStatus>("unknown");
  const [observedPresenceLabel, setObservedPresenceLabel] = useState<string | null>(null);
  const [pendingPresenceStatus, setPendingPresenceStatus] =
    useState<CommunicationPresenceStatus | null>(null);
  const [statusChangeAvailableAt, setStatusChangeAvailableAt] = useState<string | null>(null);
  const [statusChangeAvailableInMs, setStatusChangeAvailableInMs] = useState<number | null>(null);
  const [presencePickerOpen, setPresencePickerOpen] = useState(false);
  const [isUpdatingPresence, setIsUpdatingPresence] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const {
    query: chatSearch,
    setQuery: setChatSearch,
    reset: resetChatSearch,
    refresh: refreshChatSearch,
    isSearchActive: isChatDestinationSearch,
    people: chatSearchPeople,
    conversations: chatSearchConversations,
    isSearching: isSearchingChat,
    error: chatSearchError,
  } = useZoomChatDestinationSearch({
    client,
    enabled: canSearchZoomChatDestinations(supportsInboxSearch, isChatConnected, isChatEnabled),
  });
  const [selectedConversation, setSelectedConversation] =
    useState<CommunicationConversationSummary | null>(null);
  // The Home list and child room are separate reading surfaces. Back restores
  // the Home list exactly where the reader left it instead of inheriting room
  // scroll state.
  const chatHomeScroll = useRetainedScrollOffset(`communications-popup:${serverId}:zoom-team-chat`);
  const applyZoomChatPresence = useCallback((presence: CommunicationPresence) => {
    // `unknown` is transport state, not a user-facing presence. Preserve a
    // confirmed value through a transient provider read failure.
    if (presence.status !== "unknown") setPresenceStatus(presence.status);
    if (presence.observedStatusLabel) setObservedPresenceLabel(presence.observedStatusLabel);
    setStatusChangeAvailableAt(presence.statusChangeAvailableAt ?? null);
    setStatusChangeAvailableInMs(presence.statusChangeAvailableInMs ?? null);
    setPendingPresenceStatus(presence.pendingStatus ?? null);
    setPresenceError(presence.statusChangeError ?? null);
    setIsChatEnabled((enabled) => presence.enabled ?? enabled);
  }, []);
  const refreshPendingZoomChatPresence = useCallback(() => {
    void client
      ?.communicationsInboxGetPresence("zoom-team-chat")
      .then(applyZoomChatPresence)
      .catch(() => undefined);
  }, [applyZoomChatPresence, client]);
  const refreshCommunicationsState = useCallback(() => {
    if (!isDesktop || !supportsCommunications || !client || !isHostConnected) {
      setUnreadCount(0);
      setChatConnectionLabel(
        supportsCommunications ? "Not connected" : "Update this host to use Chat",
      );
      setIsChatConnected(false);
      setIsChatEnabled(false);
      return;
    }

    void (async () => {
      try {
        const overview = await client.communicationsGetOverview();
        setUnreadCount(overview.unreadCount);
        setConversations(
          overview.conversations.filter(
            (conversation) => conversation.providerId === "zoom-team-chat",
          ),
        );
        const zoom = overview.providers.find(
          (provider) => provider.providerId === "zoom-team-chat",
        );
        const chatConnectionState = resolveZoomTeamChatConnectionState(zoom?.connectionState);
        const chatEnabled = chatConnectionState.isConnected && zoom?.enabled !== false;
        setChatConnectionLabel(chatEnabled ? chatConnectionState.label : "Offline");
        setIsChatConnected(chatConnectionState.isConnected);
        setIsChatEnabled(chatEnabled);
        if (supportsChatHome && chatConnectionState.isConnected) {
          try {
            const home = await client.communicationsInboxGetHome("zoom-team-chat");
            setChatHomeSections(home.sections);
            const notifications = home.notifications ?? [];
            setChatNotifications(notifications);
            // The title-bar glyph is Otto's active-window notification, not a
            // mirror of the provider's remote unread tally. It must disappear
            // as soon as the corresponding room is opened or dismissed.
            setUnreadCount(notifications.length);
          } catch {
            // Home access can be newly granted after the original token was
            // issued. Keep the established connection state honest and let the
            // settings reconnect flow obtain the expanded token.
            setChatHomeSections([]);
            setChatNotifications([]);
          }
        } else {
          setChatHomeSections([]);
        }
        if (supportsPresence && chatConnectionState.isConnected) {
          try {
            const presence = await client.communicationsInboxGetPresence("zoom-team-chat");
            applyZoomChatPresence(presence);
            setIsChatEnabled(presence.enabled ?? chatEnabled);
          } catch {
            setPresenceStatus("unknown");
          }
        } else {
          setPresenceStatus("unknown");
        }
      } catch {
        setUnreadCount(0);
        setConversations([]);
        setChatHomeSections([]);
        setChatNotifications([]);
        setPresenceStatus("unknown");
        setChatConnectionLabel("Unavailable");
        setIsChatConnected(false);
        setIsChatEnabled(false);
      }
    })();
  }, [
    client,
    applyZoomChatPresence,
    isDesktop,
    isHostConnected,
    supportsChatHome,
    supportsCommunications,
    supportsPresence,
  ]);
  useEffect(() => {
    refreshCommunicationsState();
  }, [refreshCommunicationsState]);
  // Independent of the popup menu's open state: the title-bar glyph must
  // still notify of a new unread conversation while the popup is closed.
  useEffect(() => {
    if (!isAppVisible) return;
    const intervalId = setInterval(
      refreshCommunicationsState,
      CHAT_NOTIFICATION_BADGE_POLL_INTERVAL_MS,
    );
    return () => clearInterval(intervalId);
  }, [isAppVisible, refreshCommunicationsState]);
  useEffect(() => {
    if (!client || !supportsPresenceUpdates) return;
    return client.on("communications.inbox.presence.changed.notification", (message) => {
      if (message.payload.presence.providerId === "zoom-team-chat") {
        applyZoomChatPresence(message.payload.presence);
      }
    });
  }, [applyZoomChatPresence, client, supportsPresenceUpdates]);
  const { statusChangeCooldownMs, statusChangeLocked } = useZoomChatStatusChangeCooldown(
    statusChangeAvailableAt,
    statusChangeAvailableInMs,
    supportsPresenceChangeTiming,
  );
  useZoomChatPendingPresenceRefresh({
    // The daemon event is the normal path. Keep one pending-only watchdog so a
    // reconnect or mixed-version host cannot strand a visible Pending state if
    // that event is missed. A successful event clears Pending and cancels this
    // timeout before it performs a read.
    enabled: true,
    pendingStatus: pendingPresenceStatus,
    statusChangeAvailableAt,
    statusChangeAvailableInMs,
    refresh: refreshPendingZoomChatPresence,
  });
  const handleMenuOpenChange = useCallback(
    (nextOpen: boolean) => {
      setMenuOpen(nextOpen);
      // The status chooser belongs to this popup session only. Closing the
      // Chat popup never changes provider presence, but it must collapse the
      // chooser so the next open begins with the compact Chat Home.
      setPresencePickerOpen(false);
      if (!nextOpen) {
        resetChatSearch();
        setSelectedConversation(null);
      }
      refreshWhenZoomChatMenuOpens(nextOpen, refreshCommunicationsState);
    },
    [refreshCommunicationsState, resetChatSearch],
  );
  const canStartSignIn = canStartZoomTeamChatSignIn({
    supportsCommunications,
    supportsIntegrationAuthorization,
    isHostConnected,
    isLocalDaemon,
    isStartingSignIn,
  });
  const handleStartSignIn = useCallback(() => {
    if (!client || !canStartSignIn) {
      return;
    }
    const start = async (): Promise<void> => {
      setIsStartingSignIn(true);
      try {
        const result = await client.integrationsZoomStartAuthorization();
        if (!result.authorizationUrl) {
          throw new Error(result.error ?? "Could not start Chat sign-in.");
        }
        setChatConnectionLabel("Finish sign-in in your browser");
        await openExternalUrl(result.authorizationUrl);
      } catch {
        setChatConnectionLabel("Could not start Chat sign-in");
      } finally {
        setIsStartingSignIn(false);
      }
    };
    void start();
  }, [client, canStartSignIn]);
  const togglePresencePicker = useCallback(() => {
    setPresencePickerOpen((open) => !open);
  }, []);
  const handlePresenceSelect = useCallback(
    (status: string) => {
      if (!client || isUpdatingPresence || pendingPresenceStatus) return;
      const nextStatus = status as ZoomChatPresenceOption["id"];
      const updatePresence = async (): Promise<void> => {
        setIsUpdatingPresence(true);
        try {
          let presence: CommunicationPresence;
          if (nextStatus === "offline") {
            presence = await client.communicationsInboxSetEnabled({
              providerId: "zoom-team-chat",
              enabled: false,
            });
          } else {
            if (!isChatEnabled) {
              await client.communicationsInboxSetEnabled({
                providerId: "zoom-team-chat",
                enabled: true,
              });
            }
            presence = await client.communicationsInboxSetPresence({
              providerId: "zoom-team-chat",
              status: nextStatus,
            });
          }
          let resolvedStatus = presence.pendingStatus ? presenceStatus : presence.status;
          if (nextStatus !== "offline" && !presence.pendingStatus) {
            resolvedStatus = isChatEnabled
              ? resolveZoomChatPresenceAfterUpdate(presenceStatus, nextStatus, presence.status)
              : nextStatus;
          }
          setPresenceStatus(resolvedStatus);
          setStatusChangeAvailableAt(presence.statusChangeAvailableAt ?? null);
          setStatusChangeAvailableInMs(presence.statusChangeAvailableInMs ?? null);
          setPendingPresenceStatus(presence.pendingStatus ?? null);
          setIsChatEnabled(presence.enabled ?? nextStatus !== "offline");
          setChatConnectionLabel(
            (presence.enabled ?? nextStatus !== "offline") ? "Connected" : "Offline",
          );
          const presenceUpdateError =
            presence.pendingStatus ||
            nextStatus === "offline" ||
            !isChatEnabled ||
            resolvedStatus === nextStatus
              ? null
              : "The service did not apply that status update. Your current status is unchanged.";
          setPresenceError(presenceUpdateError);
          // On success the status has landed; close the whole Chat popup so
          // the updated title-bar state is what the user sees. On failure the
          // popup stays open so the error callout is readable.
          if (!presenceUpdateError) setMenuOpen(false);
        } catch (error) {
          const availableAt = statusChangeAvailableAtFromError(error);
          if (availableAt) {
            setStatusChangeAvailableAt(availableAt);
          }
          setPresenceError(zoomStatusUpdateErrorMessage(error));
          setPresencePickerOpen(false);
        } finally {
          setIsUpdatingPresence(false);
        }
      };
      void updatePresence();
    },
    [client, isChatEnabled, isUpdatingPresence, pendingPresenceStatus, presenceStatus],
  );
  const presenceSelectHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const option of ZOOM_CHAT_PRESENCE_OPTIONS) {
      handlers.set(option.id, () => handlePresenceSelect(option.id));
    }
    return handlers;
  }, [handlePresenceSelect]);
  const chatTitlebarTriggerStyle = useCallback(
    (state: { hovered?: boolean; pressed?: boolean; open?: boolean; focused?: boolean }) =>
      meetingNotesTriggerStyle(state, isChatConnected && isChatEnabled),
    [isChatConnected, isChatEnabled],
  );
  const visibleChatHomeSections = useMemo(() => {
    const query = isChatDestinationSearch ? "" : chatSearch.trim().toLocaleLowerCase();
    const source = supportsChatHome ? chatHomeSections : toLegacyChatHomeSections(conversations);
    if (!query) return source;
    const sections: CommunicationHomeSection[] = [];
    for (const section of source) {
      const matchingConversations = section.conversations.filter((conversation) =>
        conversation.title.toLocaleLowerCase().includes(query),
      );
      const matchingCollections = section.collections.filter((collection) =>
        `${collection.title}\n${collection.description ?? ""}`.toLocaleLowerCase().includes(query),
      );
      if (matchingConversations.length > 0 || matchingCollections.length > 0) {
        sections.push({
          id: section.id,
          label: section.label,
          conversations: matchingConversations,
          collections: matchingCollections,
        });
      }
    }
    return sections;
  }, [chatHomeSections, chatSearch, conversations, isChatDestinationSearch, supportsChatHome]);
  const displayedChatHomeSections = isChatDestinationSearch ? [] : visibleChatHomeSections;
  const acknowledgeConversationNotifications = useCallback(
    (conversation: CommunicationConversationSummary) => {
      const notificationIds = chatNotifications
        .filter(
          (notification) =>
            notification.conversation.conversationId === conversation.conversationId &&
            notification.conversation.providerId === conversation.providerId,
        )
        .map((notification) => notification.notificationId);
      if (notificationIds.length === 0) return;

      // Opening a room resolves Otto's local notification immediately. The
      // provider may retain its own unread count, but that is not what the
      // active-window title-bar glyph represents.
      setChatNotifications((current) =>
        current.filter((notification) => !notificationIds.includes(notification.notificationId)),
      );
      setUnreadCount((current) => Math.max(0, current - notificationIds.length));

      if (!client || !supportsRoomNotifications) return;
      void client
        .communicationsInboxAcknowledgeNotifications({
          providerId: conversation.providerId,
          notificationIds,
        })
        .then((home) => {
          const notifications = home.notifications ?? [];
          setChatHomeSections(home.sections);
          setChatNotifications(notifications);
          setUnreadCount(notifications.length);
          return undefined;
        })
        .catch(() => undefined);
    },
    [chatNotifications, client, supportsRoomNotifications],
  );
  const openConversation = useCallback(
    (conversation: CommunicationConversationSummary) => {
      if (!supportsCommunicationsRooms) {
        setRoomError("Update the host to use this.");
        return;
      }
      acknowledgeConversationNotifications(conversation);
      // Keep the root dropdown mounted so its search and scroll context survive
      // the child room page. Back only clears selectedConversation.
      setRoomError(null);
      setSelectedConversation(conversation);
    },
    [acknowledgeConversationNotifications, supportsCommunicationsRooms],
  );
  const openConversationInWorkspace = useCallback(
    (conversation: CommunicationConversationSummary) => {
      const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (!persistenceKey) return;
      acknowledgeConversationNotifications(conversation);
      openWorkspaceTabFocused(persistenceKey, {
        kind: "communicationsRoom",
        providerId: conversation.providerId,
        conversationId: conversation.conversationId,
        title: conversation.title,
      });
      setSelectedConversation(null);
      setMenuOpen(false);
    },
    [acknowledgeConversationNotifications, openWorkspaceTabFocused, serverId, workspaceId],
  );
  const closeConversation = useCallback(() => setSelectedConversation(null), []);
  const acknowledgeNotifications = useCallback(
    (input: { notificationIds?: string[]; clearAll?: boolean }) => {
      if (!client || !supportsRoomNotifications) return;
      void client
        .communicationsInboxAcknowledgeNotifications({ providerId: "zoom-team-chat", ...input })
        .then((home) => {
          const notifications = home.notifications ?? [];
          setChatHomeSections(home.sections);
          setChatNotifications(notifications);
          setUnreadCount(notifications.length);
          return undefined;
        })
        .catch(() => undefined);
    },
    [client, supportsRoomNotifications],
  );
  const isFavoriteUpdating = useCallback(
    (conversationId: string) => favoriteUpdatingIds.has(conversationId),
    [favoriteUpdatingIds],
  );
  const handleToggleFavorite = useCallback(
    (conversation: CommunicationConversationSummary, favorite: boolean) => {
      if (
        !client ||
        !supportsChatFavorites ||
        favoriteUpdatingIds.has(conversation.conversationId)
      ) {
        return;
      }
      setFavoriteError(null);
      setFavoriteUpdatingIds((ids) => new Set(ids).add(conversation.conversationId));
      void client
        .communicationsInboxSetFavorite({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
          favorite,
        })
        .then((home) => {
          setChatHomeSections(home.sections);
          refreshChatSearch();
          return undefined;
        })
        .catch((error: unknown) => setFavoriteError(zoomChatFavoriteErrorMessage(error)))
        .finally(() => {
          setFavoriteUpdatingIds((ids) => {
            const next = new Set(ids);
            next.delete(conversation.conversationId);
            return next;
          });
        });
    },
    [client, favoriteUpdatingIds, refreshChatSearch, supportsChatFavorites],
  );
  // Connection earns the title-bar surface, not availability. The rule and the
  // reason it keeps getting reverted live in zoom-team-chat-titlebar-visibility.ts.
  if (!shouldShowZoomTeamChatTitlebar({ isDesktop, isChatConnected, isChatEnabled })) {
    return null;
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="triggerRef">
          <DropdownMenuTrigger
            testID="workspace-zoom-team-chat-trigger"
            suppressFocusOutline
            accessibilityRole="button"
            accessibilityLabel={zoomTeamChatAccessibilityLabel(unreadCount, isChatEnabled)}
            style={chatTitlebarTriggerStyle}
          >
            {() => (
              <ZoomTeamChatTitleIcon
                unreadCount={unreadCount}
                connected={isChatConnected}
                enabled={isChatEnabled}
                presenceStatus={presenceStatus}
                pendingPresence={pendingPresenceStatus !== null}
                iconSize={iconSize.md}
              />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={styles.headerMenuTooltipText}>
            {zoomTeamChatTooltip(
              unreadCount,
              chatConnectionLabel,
              presenceStatus,
              observedPresenceLabel,
              isChatEnabled,
              pendingPresenceStatus !== null,
            )}
          </Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        width={selectedConversation ? 720 : 320}
        maxHeight={selectedConversation ? 720 : 420}
        scrollable={!selectedConversation}
        scrollViewRef={chatHomeScroll.ref}
        onScroll={chatHomeScroll.onScroll}
        onContentSizeChange={chatHomeScroll.onContentSizeChange}
        testID="workspace-zoom-team-chat-menu"
      >
        {selectedConversation ? (
          <ZoomChatPopupRoomPage
            client={client}
            serverId={serverId}
            conversation={selectedConversation}
            onBack={closeConversation}
            onOpenChat={openConversationInWorkspace}
          />
        ) : (
          <>
            <View style={styles.teamChatPopup}>
              <View style={styles.teamChatPopupHeader}>
                <View style={styles.teamChatPopupHeaderCopy}>
                  <Text style={styles.teamChatPopupTitle}>{chatConnectionLabel}</Text>
                </View>
                {isChatConnected ? (
                  <Pressable
                    testID="workspace-zoom-team-chat-presence"
                    onPress={togglePresencePicker}
                    disabled={!supportsPresence || isUpdatingPresence}
                    accessibilityLabel="Change Chat status"
                    style={styles.teamChatPresenceTrigger}
                  >
                    <ZoomChatPresenceIcon
                      status={getZoomChatDisplayedPresenceStatus({
                        enabled: isChatEnabled,
                        pendingStatus: pendingPresenceStatus,
                        status: presenceStatus,
                      })}
                      size={iconSize.sm}
                    />
                    {zoomChatPresenceDisplayText(
                      presenceStatus,
                      isChatEnabled,
                      isUpdatingPresence,
                      pendingPresenceStatus,
                      observedPresenceLabel,
                    ) ? (
                      <Text style={styles.teamChatPresenceText} numberOfLines={1}>
                        {zoomChatPresenceDisplayText(
                          presenceStatus,
                          isChatEnabled,
                          isUpdatingPresence,
                          pendingPresenceStatus,
                          observedPresenceLabel,
                        )}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : (
                  <Button
                    testID="workspace-zoom-team-chat-open"
                    variant="secondary"
                    size="xs"
                    onPress={handleStartSignIn}
                    disabled={!canStartSignIn}
                  >
                    Sign in
                  </Button>
                )}
              </View>
              {presenceError ? (
                <View style={styles.teamChatPresenceErrorCallout}>
                  <Text style={styles.teamChatPresenceError}>{presenceError}</Text>
                </View>
              ) : null}
              {favoriteError ? (
                <View style={styles.teamChatFavoriteErrorCallout}>
                  <Text style={styles.teamChatSearchError}>{favoriteError}</Text>
                </View>
              ) : null}
              {roomError ? (
                <View style={styles.teamChatFavoriteErrorCallout}>
                  <Text style={styles.teamChatSearchError}>{roomError}</Text>
                </View>
              ) : null}
              {isChatConnected && presencePickerOpen ? (
                <View style={styles.teamChatPresenceOptions}>
                  {ZOOM_CHAT_PRESENCE_OPTIONS.filter(
                    (option) => option.id !== "offline" || supportsChatAvailability,
                  ).map((option) => {
                    const canSelect = canSelectZoomChatPresenceOption({
                      option,
                      enabled: isChatEnabled,
                      supportsPresence,
                      currentPresence: presenceStatus,
                      statusChangeLocked,
                      pendingStatus: pendingPresenceStatus,
                    });
                    const disabled = !canSelect || isUpdatingPresence;
                    return (
                      <Pressable
                        key={option.id}
                        onPress={disabled ? undefined : presenceSelectHandlers.get(option.id)}
                        disabled={disabled}
                        accessibilityLabel={zoomChatPresenceOptionAccessibilityLabel({
                          option,
                          disabled,
                          statusChangeLocked,
                          statusChangeCooldownMs,
                        })}
                        style={[
                          styles.teamChatPresenceOption,
                          disabled && styles.teamChatPresenceOptionDisabled,
                        ]}
                      >
                        <ZoomChatPresenceIcon status={option.id} size={iconSize.sm} />
                        <Text
                          style={[
                            styles.teamChatPresenceOptionText,
                            disabled && styles.teamChatPresenceOptionTextDisabled,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {statusChangeLocked ? (
                    <Text style={styles.teamChatPresenceCooldown}>
                      Status changes available in{" "}
                      {formatStatusChangeCooldown(statusChangeCooldownMs)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <ZoomChatPopupSearchContents
                connected={isChatConnected}
                enabled={isChatEnabled}
                query={chatSearch}
                onChangeQuery={setChatSearch}
                isSearchActive={isChatDestinationSearch}
                people={chatSearchPeople}
                conversations={chatSearchConversations}
                isSearching={isSearchingChat}
                error={chatSearchError}
                iconSize={iconSize.sm}
                onOpenConversation={openConversation}
                canToggleFavorite={supportsChatFavorites && isChatConnected && isChatEnabled}
                isFavoriteUpdating={isFavoriteUpdating}
                onToggleFavorite={handleToggleFavorite}
                homeSections={displayedChatHomeSections}
              />
              {chatNotifications.length > 0 ? (
                <View style={styles.teamChatNotifications}>
                  <View style={styles.teamChatNotificationsHeader}>
                    <Text style={styles.teamChatNotificationsTitle}>Notifications</Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      onPress={() => acknowledgeNotifications({ clearAll: true })}
                      disabled={!supportsRoomNotifications}
                    >
                      Clear all
                    </Button>
                  </View>
                  {chatNotifications.map((notification) => (
                    <View key={notification.notificationId} style={styles.teamChatNotificationCard}>
                      <Pressable
                        onPress={() => openConversation(notification.conversation)}
                        accessibilityLabel={`Open ${notification.conversation.title}`}
                        style={styles.teamChatNotificationOpen}
                      >
                        <Text style={styles.teamChatNotificationTitle} numberOfLines={1}>
                          {notification.conversation.title}
                        </Text>
                        {notification.conversation.preview ? (
                          <Text style={styles.teamChatNotificationPreview} numberOfLines={1}>
                            {notification.conversation.preview}
                          </Text>
                        ) : null}
                      </Pressable>
                      <Button
                        size="xs"
                        variant="ghost"
                        onPress={() =>
                          acknowledgeNotifications({
                            notificationIds: [notification.notificationId],
                          })
                        }
                        disabled={!supportsRoomNotifications}
                      >
                        Dismiss
                      </Button>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            {displayedChatHomeSections.map((section) => (
              <View key={section.id}>
                <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                {section.conversations.map((conversation) => (
                  <ZoomChatHomeConversationRow
                    key={conversation.conversationId}
                    conversation={conversation}
                    iconSize={iconSize.sm}
                    canToggleFavorite={supportsChatFavorites && isChatConnected && isChatEnabled}
                    isFavoriteUpdating={isFavoriteUpdating(conversation.conversationId)}
                    onOpenConversation={openConversation}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
                {section.collections.map((collection) => (
                  <DropdownMenuItem
                    key={collection.collectionId}
                    description={collection.description ?? "Coming soon"}
                    disabled
                  >
                    {collection.title}
                  </DropdownMenuItem>
                ))}
              </View>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceMeetingNotesButton({
  serverId,
  workspaceId,
  activeChatAttachmentScopeKey,
}: {
  serverId: string;
  workspaceId: string;
  activeChatAttachmentScopeKey: string | null;
}) {
  const isDesktop = getIsElectron();
  const zoomRecorderEnabled = useAppSettingValue(selectZoomRecorderEnabled);
  const zoomRecorderPaused = useAppSettingValue(selectZoomRecorderPaused);
  const { status } = useZoomRecorderStatus();
  const iconSize = useIconSize(1.5);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const attachmentScopeKey = useMemo(
    () =>
      activeChatAttachmentScopeKey
        ? activeChatAttachmentScopeKey
        : buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd: "/" }),
    [activeChatAttachmentScopeKey, serverId, workspaceId],
  );
  const recorderActive = !zoomRecorderPaused;
  const triggerStyle = useCallback(
    (triggerState: { hovered?: boolean; pressed?: boolean; open?: boolean; focused?: boolean }) =>
      meetingNotesTriggerStyle(triggerState, recorderActive),
    [recorderActive],
  );
  const supported = isDesktop && zoomRecorderEnabled && supportsZoomRecorder(getDesktopHost());

  if (!supported) {
    return null;
  }

  const stateLabel = recorderActive
    ? getZoomMeetingTitlebarState(status.state, status.modelReady).label
    : "Disabled";
  return (
    <DropdownMenu open={libraryOpen} onOpenChange={setLibraryOpen}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="triggerRef">
          <DropdownMenuTrigger
            testID="workspace-zoom-meetings-trigger"
            suppressFocusOutline
            style={triggerStyle}
            accessibilityRole="button"
            accessibilityLabel={`Open Meeting notes. ${stateLabel}.`}
          >
            {recorderActive ? (
              <ThemedHeadsetMic
                size={iconSize.md}
                uniProps={zoomRecorderColorMapping(status.state, status.modelReady, recorderActive)}
              />
            ) : (
              <ThemedHeadsetOff size={iconSize.md} uniProps={mutedColorMapping} />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <Text style={styles.headerMenuTooltipText}>Meeting: {stateLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <MeetingTranscriptLibrary
        open={libraryOpen}
        onClose={closeLibrary}
        serverId={serverId}
        attachmentScopeKey={attachmentScopeKey}
      />
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerActionButton: {
    // Reserve the focus border in the resting geometry. Reducing the padding
    // by the same pixel keeps this title-bar control's outer size unchanged.
    paddingVertical: compactUp(theme.spacing[2] - 1),
    paddingHorizontal: compactUp(theme.spacing[2] - 1),
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  // Hover and selection colors are shared with `headerIconSlotStyle` - see the
  // comments there, and the token derivations in `theme.ts`.
  headerActionButtonHovered: {
    backgroundColor: theme.colors.surfaceToggleHover,
  },
  headerActionButtonActive: {
    backgroundColor: theme.colors.surfaceToggleSelected,
  },
  headerActionButtonFocused: {
    borderColor: theme.colors.accent,
  },
  teamChatPopup: {
    gap: 0,
    paddingTop: theme.spacing[2],
  },
  teamChatRoomPopup: {
    backgroundColor: theme.colors.surface0,
    height: 680,
    width: 720,
  },
  teamChatRoomHeader: {
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  teamChatRoomTitle: {
    color: theme.colors.foreground,
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textAlign: "center",
  },
  teamChatPopupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  teamChatPopupHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  teamChatPopupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  teamChatPresenceTrigger: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  teamChatPresenceText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  teamChatPresenceOptions: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  teamChatPresenceOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
  },
  teamChatPresenceOptionDisabled: {
    opacity: 0.45,
  },
  teamChatPresenceOptionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  teamChatPresenceOptionTextDisabled: {
    color: theme.colors.foregroundMuted,
  },
  teamChatPresenceCooldown: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  teamChatSearchResults: {
    paddingTop: theme.spacing[1],
  },
  teamChatSearchLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  teamChatSearchStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  teamChatSearchError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  teamChatSearchGroup: {
    paddingBottom: theme.spacing[1],
  },
  teamChatSearchGroupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  teamChatSearchResult: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  teamChatSearchResultPrimary: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  teamChatSearchAvatar: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.full,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  teamChatSearchAvatarText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  teamChatSearchConversationIcon: {
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  teamChatSearchConversationIconGlyph: {
    color: theme.colors.foregroundMuted,
  },
  teamChatSearchResultCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  teamChatSearchResultTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
  teamChatSearchResultDetailRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
    minWidth: 0,
  },
  teamChatSearchResultDetail: {
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
  },
  teamChatFavoriteButton: {
    alignItems: "center",
    borderRadius: theme.borderRadius.sm,
    height: 32,
    justifyContent: "center",
    marginLeft: theme.spacing[2],
    width: 32,
  },
  teamChatFavoriteButtonDisabled: {
    opacity: 0.45,
  },
  teamChatFavoriteErrorCallout: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[1],
  },
  teamChatNotifications: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  teamChatNotificationsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  teamChatNotificationsTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  teamChatNotificationCard: {
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  teamChatNotificationOpen: { flex: 1, gap: 1, minWidth: 0 },
  teamChatNotificationTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
  teamChatNotificationPreview: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  teamChatHomeConversation: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  teamChatHomeConversationPrimary: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  teamChatPresenceDot: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  teamChatPresenceDotSuccess: {
    backgroundColor: theme.colors.statusSuccess,
  },
  teamChatPresenceDotDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  teamChatPresenceDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  teamChatPresenceDndBar: {
    width: "56%",
    height: 2,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  teamChatPresenceErrorCallout: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.statusDangerSurface,
  },
  teamChatPresenceError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  teamChatEmpty: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
  },
  teamChatEmptyText: {
    fontSize: 13,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  },
  // Duplicated from workspace-screen.tsx styles (keep in sync).
  headerMenuTooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
