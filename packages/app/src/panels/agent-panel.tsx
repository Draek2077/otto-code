import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { isExternalPreviewServerId } from "@otto-code/protocol/messages";
import type { TFunction } from "i18next";
import { ChevronRight, SquarePen } from "@/components/icons/material-icons";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import ReanimatedAnimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { shallow, useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AgentStreamView, type AgentStreamViewHandle } from "@/agent-stream/view";
import { ChatMessageSearchBar, type ChatMessageSearchHandle } from "@/chat/message-search-bar";
import type { ChatMessageSearchState } from "@/chat/message-search";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ArchivedAgentCallout } from "@/components/archived-agent-callout";
import { ObservedSubagentCallout } from "@/components/observed-subagent-callout";
import { BlackChatScope } from "@/components/black-chat-scope";
import {
  resolveBlackChatCanvasStyle,
  useBlackChatScope,
} from "@/components/black-chat-scope-context";
import { ChatThemeScope } from "@/components/chat-theme-scope";
import { ChatOutlineLayoutProvider } from "@/agent-stream/chat-outline/layout";
import { ChatWidthLayoutProvider } from "@/components/chat-width-layout-context";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { Composer } from "@/composer";
import { getActiveMessageSubmissions } from "@/composer/submission/model";
import { RewindComposerRestoreProvider } from "@/components/rewind/composer-restore";
import { getProviderIcon } from "@/components/provider-icons";
import {
  ToastViewport,
  useToastHost,
  type ToastApi,
  type ToastState,
} from "@/components/toast-host";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildAgentWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentScopeKey,
} from "@/attachments/workspace-attachments-store";
import { isNative, isWeb } from "@/constants/platform";
import { COMPACT_FORM_FACTOR_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import {
  resolveComposerTrackControlClearance,
  resolveComposerTrackTailClearance,
} from "@/composer/pill-styles";
import { useWorkspaceHasDiffStat } from "@/composer/workspace-diff-stat";
import { useAgentAttentionClear } from "@/hooks/use-agent-attention-clear";
import { useAgentInitialization } from "@/hooks/use-agent-initialization";
import { useWorkspaceChangeIndicator } from "@/hooks/use-workspace-change-indicator";
import { shouldSyncAgentTimelineOnFocus } from "@/timeline/timeline-sync-plan";
import { useAgentStreamRetention } from "@/timeline/use-agent-stream-retention";
import { useAppSettingValue, useAppSettings } from "@/hooks/use-settings";
import { useAgentInputDraft, type AgentInputDraft } from "@/composer/draft/input-draft";
import {
  type AgentScreenAgent,
  type AgentScreenContinuity,
  type AgentScreenMissingState,
  type AgentScreenViewState,
  useAgentScreenStateMachine,
} from "@/hooks/use-agent-screen-state-machine";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import { useContainerHeight } from "@/hooks/use-container-height";
import {
  clearHistorySyncErrorAfterSuccessfulSync,
  reconcileMissingAgentStateWithPresentAgent,
} from "@/panels/agent-panel-load-state";
import {
  reconcileReconnectToastState,
  type ReconnectToastState,
} from "@/panels/reconnect-toast-state";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { SidebarCallout } from "@/components/sidebar-callout";
import { i18n } from "@/i18n/i18next";
import { resolveAgentTabTitle } from "@/panels/agent-tab-title";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { RenderProfile } from "@/utils/render-profiler";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";
import {
  type HostRuntimeConnectionStatus,
  getHostRuntimeConnectionStatusSince,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeIsConnected,
  useHostRuntimeLastError,
  useHosts,
} from "@/runtime/host-runtime";
import {
  deriveRouteBottomAnchorIntent,
  deriveRouteBottomAnchorRequest,
} from "@/screens/agent/agent-ready-screen-bottom-anchor";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { useBrowserStore } from "@/desktop/browser/store";
import { AgentTaskList } from "@/composer/task-list";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { usePreviewRunningServersStore } from "@/stores/preview-running-servers-store";
import {
  selectAgentTimelineState,
  selectAgentTurnPresentation,
  type Agent,
  useSessionStore,
} from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import type { Theme } from "@/styles/theme";
import {
  useArchiveSubagent,
  useAutoClearCompletedSubagents,
  useClearCompletedSubagents,
  useClearedSubagentTokens,
  useDetachSubagent,
  useStopSubagent,
  useSubagentsForParent,
} from "@/subagents";
import { useAutoClearCompletedSubagentsSetting } from "@/hooks/use-auto-clear-completed-subagents";
import { SubagentsTrack } from "@/subagents/track";
import { AgentTracks } from "@/panels/agent-tracks";
import { ChatMetricsBar } from "@/subagents/chat-metrics-bar";
import {
  useAutoClearCompletedBackgroundTasks,
  useBackgroundShellTasksForParent,
  useClearCompletedBackgroundTasks,
  useStopBackgroundTask,
} from "@/background-tasks";
import {
  useAutoClearCompletedBackgroundTasksSetting,
  useAutoClearFailedBackgroundTasksSetting,
} from "@/hooks/use-auto-clear-completed-background-tasks";
import { BackgroundTasksTrack } from "@/background-tasks/track";
import { RateLimitWarningTrack } from "@/composer/rate-limit-warning-track";
import { ContextHealthTrack } from "@/composer/context-health-track";
import { FollowSuggestionTrack } from "@/composer/follow-suggestion/track";
import { COMPOSER_TRACK_LAYERS } from "@/composer/track-transition";
import {
  SuggestedTasksOverlay,
  useSuggestedTaskActions,
  useSuggestedTasksForParent,
} from "@/suggested-tasks";
import { PinnedTaskListOverlay, usePinnedTaskList } from "@/pinned-task-list";
import { ChatTopOverlayStack } from "@/panels/chat-top-overlay-stack";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import { type ChatExportFormat } from "@/chat/chat-export";
import { saveChatExport } from "@/chat/save-chat-export";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  contextMenuAnchorFromEvent,
} from "@/components/ui/context-menu";
import { ChatContextMenu, type ChatContextMenuHandle } from "@/chat/context-menu";
import { getInitDeferred, getInitKey } from "@/utils/agent-initialization";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openProviderSubagentTab } from "@/subagents/open-provider-subagent-tab";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { buildDraftAgentSetup, type ClientSlashCommand } from "@/client-slash-commands";

// Otto's pinned task-list overlay is the task-tracking surface. Keep Paseo's
// inline composer panel available for upstream convergence, but do not mount a
// second task-list UI.
const SHOW_PASEO_TASK_LIST_PANEL = false;

interface ChatAgentStateShape {
  serverId: string | null;
  id: string | null;
  provider?: Agent["provider"];
  status: Agent["status"] | null;
  cwd: string | null;
  workspaceId?: string;
  capabilities?: Agent["capabilities"];
  currentModeId?: Agent["currentModeId"];
  model?: Agent["model"];
  thinkingOptionId?: Agent["thinkingOptionId"];
  runtimeInfo?: Agent["runtimeInfo"];
  features?: Agent["features"];
  lastError?: Agent["lastError"] | null;
  personalitySpinner?: Agent["personalitySpinner"];
}

const RECONNECT_TOAST_DELAY_MS = 1_000;

const reconnectToastStateByServerId = new Map<string, ReconnectToastState>();

interface ChatAgentSelectedState extends ChatAgentStateShape {
  archivedAt: Date | null;
  requiresAttention: boolean;
  attentionReason: Agent["attentionReason"] | null;
}

function resolveChatAgentFromSession(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): Agent | null {
  if (!agentId) return null;
  const session = state.sessions[serverId];
  return session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
}

const EMPTY_CHAT_AGENT_STATE: ChatAgentSelectedState = {
  serverId: null,
  id: null,
  status: null,
  cwd: null,
  lastError: null,
  archivedAt: null,
  requiresAttention: false,
  attentionReason: null,
};

export function selectChatAgentState(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): ChatAgentSelectedState {
  const agent = resolveChatAgentFromSession(state, serverId, agentId);
  if (!agent) return EMPTY_CHAT_AGENT_STATE;
  return {
    serverId: agent.serverId,
    id: agent.id,
    provider: agent.provider,
    status: agent.status,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId,
    capabilities: agent.capabilities,
    currentModeId: agent.currentModeId,
    model: agent.model,
    thinkingOptionId: agent.thinkingOptionId,
    runtimeInfo: agent.runtimeInfo,
    features: agent.features,
    lastError: agent.lastError ?? null,
    personalitySpinner: agent.personalitySpinner ?? null,
    archivedAt: agent.archivedAt ?? null,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
  };
}

export function buildChatAgentFromState(
  state: ChatAgentStateShape,
  projectPlacement: Agent["projectPlacement"] | null,
): AgentScreenAgent | null {
  if (!state.serverId || !state.id || !state.status || !state.cwd) {
    return null;
  }
  return {
    serverId: state.serverId,
    id: state.id,
    provider: state.provider,
    status: state.status,
    cwd: state.cwd,
    workspaceId: state.workspaceId,
    capabilities: state.capabilities,
    currentModeId: state.currentModeId,
    model: state.model,
    thinkingOptionId: state.thinkingOptionId,
    runtimeInfo: state.runtimeInfo,
    features: state.features,
    lastError: state.lastError ?? null,
    personalitySpinner: state.personalitySpinner ?? null,
    projectPlacement,
  };
}

function renderChatAgentNonReadyView(args: {
  viewState: AgentScreenViewState;
  effectiveAgent: AgentScreenAgent | null;
  isBlackChat: boolean;
  t: TFunction;
}): React.ReactElement | null {
  const { viewState, effectiveAgent, isBlackChat, t } = args;
  if (viewState.tag === "not_found") {
    return (
      <View
        style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}
        testID="agent-not-found"
      >
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("agentPanel.states.notFound")}</Text>
        </View>
      </View>
    );
  }
  if (viewState.tag === "error") {
    return (
      <View
        style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}
        testID="agent-load-error"
      >
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("agentPanel.states.failedToLoad")}</Text>
          <Text style={styles.statusText}>{viewState.message}</Text>
        </View>
      </View>
    );
  }
  if (viewState.tag === "boot" || !effectiveAgent) {
    return (
      <View
        style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}
        testID="agent-loading"
      >
        <View style={styles.errorContainer}>
          <ThemedActivityIndicator size="large" uniProps={foregroundMutedColorMapping} />
        </View>
      </View>
    );
  }
  return null;
}

function formatProviderLabel(provider: Agent["provider"]): string {
  if (!provider) {
    return "Agent";
  }
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Tab naming lives in @/panels/agent-tab-title: a tab always has a name, and
// "loading" means a load is actually in flight rather than standing in for one.

function shouldStoreFetchedAgentInActiveDirectory(agent: Agent): boolean {
  return !agent.archivedAt && Boolean(agent.projectPlacement);
}

type FetchAgentResult = Awaited<ReturnType<DaemonClient["fetchAgent"]>>;

export function storeFetchedAgentDetail(input: {
  serverId: string;
  result: NonNullable<FetchAgentResult>;
}): Agent {
  const normalized = normalizeAgentSnapshot(input.result.agent, input.serverId);
  const hydrated: Agent = applyLegacyDaemonWorkspaceOwnership({
    serverId: input.serverId,
    agent: {
      ...normalized,
      projectPlacement: input.result.project,
    },
  });
  const store = useSessionStore.getState();

  if (shouldStoreFetchedAgentInActiveDirectory(hydrated)) {
    store.setAgents(input.serverId, (previous) => {
      const next = new Map(previous);
      next.set(hydrated.id, hydrated);
      return next;
    });
  } else {
    store.setAgentDetails(input.serverId, (previous) => {
      const next = new Map(previous);
      next.set(hydrated.id, hydrated);
      return next;
    });
  }

  store.setPendingPermissions(input.serverId, (previous) => {
    const next = new Map(previous);
    for (const [key, pending] of next.entries()) {
      if (pending.agentId === hydrated.id) {
        next.delete(key);
      }
    }
    for (const request of hydrated.pendingPermissions) {
      const key = derivePendingPermissionKey(hydrated.id, request);
      next.set(key, { key, agentId: hydrated.id, request });
    }
    return next;
  });

  return hydrated;
}

function buildAgentDescriptorState(agent: Agent | null) {
  return {
    // No fallback provider: an unhydrated agent must not borrow another
    // provider's logo. Empty resolves to the neutral Bot icon instead.
    provider: agent?.provider ?? "",
    // Distinguishes "still fetching this agent" from "fetched, and it has no
    // title" - only the former is a loading state.
    isHydrated: agent !== null,
    title: agent?.title ?? null,
    status: agent?.status ?? null,
    pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
    requiresAttention: agent?.requiresAttention ?? false,
    attentionReason: agent?.attentionReason ?? null,
    personalitySpinner: agent?.personalitySpinner ?? null,
  };
}

function useAgentPanelDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptorState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[context.serverId];
      const agent =
        session?.agents?.get(target.agentId) ?? session?.agentDetails?.get(target.agentId) ?? null;
      return {
        ...buildAgentDescriptorState(agent),
        isTurnActive: selectAgentTurnPresentation(session, target.agentId).isActive,
      };
    }),
  );
  const provider = descriptorState.provider;
  const { label, titleState } = resolveAgentTabTitle({
    title: descriptorState.title,
    isHydrated: descriptorState.isHydrated,
    fallbackLabel: i18n.t("workspace.tabs.fallback.agent"),
  });
  const icon = getProviderIcon(provider);

  return {
    label,
    tooltip: label,
    subtitle: provider ? `${formatProviderLabel(provider)} agent` : "Agent",
    titleState,
    icon,
    statusBucket: descriptorState.status
      ? deriveSidebarStateBucket({
          status: descriptorState.isTurnActive ? "running" : descriptorState.status,
          pendingPermissionCount: descriptorState.pendingPermissionCount,
          requiresAttention: descriptorState.requiresAttention,
          attentionReason: descriptorState.attentionReason,
        })
      : null,
    personalitySpinner: descriptorState.personalitySpinner,
    provider,
  };
}

function AgentPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace, openTab } = usePaneContext();
  const { isInteractive, isWorkspaceFocused } = usePaneFocus();
  invariant(target.kind === "agent", "AgentPanel requires agent target");
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  useEffect(() => {
    if (!client) return;
    return client.on("architectural-views.open.notification", (message) => {
      const request = message.payload;
      if (request.agentId !== target.agentId || request.workspaceId !== workspaceId) return;
      openTab({ kind: "architecturalView", viewId: request.viewId });
    });
  }, [client, openTab, target.agentId, workspaceId]);

  return (
    <AgentPanelContent
      serverId={serverId}
      agentId={target.agentId}
      isPaneFocused={isInteractive}
      isWorkspaceFocused={isWorkspaceFocused}
      onOpenWorkspaceFile={openFileInWorkspace}
    />
  );
}

function DraftPanel() {
  const {
    serverId,
    workspaceId,
    tabId,
    target,
    openFileInWorkspace,
    openImportSheet,
    retargetCurrentTab,
  } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "draft", "DraftPanel requires draft target");

  const handleCreated = useCallback(
    (agentSnapshot: Parameters<typeof normalizeAgentSnapshot>[0]) => {
      const normalized = normalizeAgentSnapshot(agentSnapshot, serverId);
      const agent = applyLegacyDaemonWorkspaceOwnership({ serverId, agent: normalized });
      useSessionStore.getState().setAgents(serverId, (prev) => {
        const next = new Map(prev);
        next.set(agentSnapshot.id, agent);
        return next;
      });
      retargetCurrentTab({ kind: "agent", agentId: agentSnapshot.id });
    },
    [retargetCurrentTab, serverId],
  );

  return (
    <WorkspaceDraftAgentTab
      serverId={serverId}
      workspaceId={workspaceId}
      tabId={tabId}
      draftId={target.draftId}
      initialSetup={target.setup}
      architecturalViewDraft={target.architecturalViewDraft}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
      onCreated={handleCreated}
      onOpenImportSheet={openImportSheet}
    />
  );
}

export function AgentConversationPanel() {
  const { target } = usePaneContext();
  const { settings } = useAppSettings();
  invariant(
    target.kind === "draft" || target.kind === "agent",
    "AgentConversationPanel requires an agent or draft target",
  );
  const content = target.kind === "draft" ? <DraftPanel /> : <AgentPanel />;
  // Black tab background: render the whole chat pane (stream + composer) on
  // pure black with dark-theme colors regardless of the app-wide light/dark
  // mode. Chat tabs only - terminal/browser/preview panes are not wrapped.
  return (
    <BlackChatScope enabled={settings.blackTabBackground}>
      <ChatOutlineLayoutProvider enabled={settings.chatOutlineEnabled}>
        <ChatWidthLayoutProvider>{content}</ChatWidthLayoutProvider>
      </ChatOutlineLayoutProvider>
    </BlackChatScope>
  );
}

export const agentPanelRegistration = definePanel("agent", {
  component: AgentConversationPanel,
  useDescriptor: useAgentPanelDescriptor,
});

export function useDraftPanelDescriptor(
  target: { kind: "draft"; draftId: string },
  context: { serverId: string },
) {
  const createDescriptorState = useCreateFlowStore(
    useShallow((state) => {
      const pending = state.pendingByDraftId[target.draftId];
      if (pending?.serverId !== context.serverId || pending.lifecycle !== "active") {
        return {
          isCreating: false,
          pendingPrompt: null,
        };
      }
      return {
        isCreating: true,
        pendingPrompt: pending.text,
      };
    }),
  );

  return buildDraftPanelDescriptor({
    ...createDescriptorState,
    icon: SquarePen,
  });
}

const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const EMPTY_MESSAGE_SUBMISSIONS = [] as const;
const EMPTY_PENDING_PERMISSIONS = new Map<string, PendingPermission>();
const EMPTY_PENDING_PERMISSION_LIST: PendingPermission[] = [];

type RouteBottomAnchorRequest = ReturnType<typeof deriveRouteBottomAnchorRequest>;

function findActiveCreateHandoff(input: {
  pendingByDraftId: ReturnType<typeof useCreateFlowStore.getState>["pendingByDraftId"];
  serverId: string;
  agentId?: string;
}): boolean {
  if (!input.agentId) {
    return false;
  }
  return Object.values(input.pendingByDraftId).some(
    (pending) =>
      pending.lifecycle === "sent" &&
      pending.serverId === input.serverId &&
      pending.agentId === input.agentId,
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isNotFoundErrorMessage(message: string): boolean {
  return /agent not found|not found/i.test(message);
}

type AgentLookupState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "not_found"; message: string }
  | { tag: "error"; message: string };

function AgentPanelContent({
  serverId,
  agentId,
  isPaneFocused,
  isWorkspaceFocused,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId: string;
  isPaneFocused: boolean;
  isWorkspaceFocused: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const resolvedAgentId = agentId.trim() || undefined;
  const resolvedServerId = serverId.trim() || undefined;
  const daemons = useHosts();
  const runtimeServerId = resolvedServerId ?? "";
  const runtimeClient = useHostRuntimeClient(runtimeServerId);
  const runtimeIsConnected = useHostRuntimeIsConnected(runtimeServerId);
  const runtimeConnectionStatus = useHostRuntimeConnectionStatus(runtimeServerId);
  const runtimeLastError = useHostRuntimeLastError(runtimeServerId);

  const connectionServerId = resolvedServerId ?? null;
  const daemon = connectionServerId
    ? (daemons.find((entry) => entry.serverId === connectionServerId) ?? null)
    : null;
  const serverLabel =
    daemon?.label ?? connectionServerId ?? t("agentPanel.unavailable.selectedHost");
  const isUnknownDaemon = Boolean(connectionServerId && !daemon);
  const connectionStatus: HostRuntimeConnectionStatus =
    isUnknownDaemon && runtimeConnectionStatus === "connecting"
      ? "offline"
      : runtimeConnectionStatus;
  const lastConnectionError = runtimeLastError;

  if (!resolvedServerId || !runtimeClient) {
    return (
      <AgentSessionUnavailableState
        serverLabel={serverLabel}
        connectionStatus={connectionStatus}
        lastError={lastConnectionError}
        isUnknownDaemon={isUnknownDaemon}
        t={t}
      />
    );
  }

  return (
    <AgentPanelBody
      serverId={resolvedServerId}
      agentId={resolvedAgentId}
      isPaneFocused={isPaneFocused}
      isWorkspaceFocused={isWorkspaceFocused}
      client={runtimeClient}
      isConnected={runtimeIsConnected}
      connectionStatus={connectionStatus}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function AgentPanelBody({
  serverId,
  agentId,
  isPaneFocused,
  isWorkspaceFocused,
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
  isWorkspaceFocused: boolean;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const { isArchivingAgent: _isArchivingAgent } = useArchiveAgent();
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return null;
      }
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const agentState = useSessionStore(
    useShallow((state) => selectChatAgentState(state, serverId, agentId)),
  );
  const [lookupState, setLookupState] = useState<AgentLookupState>({ tag: "idle" });
  const lookupAttemptTokenRef = useRef(0);

  useEffect(() => {
    lookupAttemptTokenRef.current += 1;
    setLookupState({ tag: "idle" });
  }, [agentId, serverId]);

  // A track row can outlive its record in the store (observed subagents are
  // ephemeral projections; a placement remove or reconnect drops them). The
  // fetch now resolves those from the daemon registry, so a not_found is
  // recoverable - let the user re-run the lookup instead of dead-ending.
  const handleRetryLookup = useCallback(() => {
    lookupAttemptTokenRef.current += 1;
    setLookupState({ tag: "idle" });
  }, []);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (agentState.id) {
      if (lookupState.tag !== "idle") {
        setLookupState({ tag: "idle" });
      }
      return;
    }
    if (!isConnected || !hasSession) {
      return;
    }
    if (lookupState.tag === "loading" || lookupState.tag === "not_found") {
      return;
    }

    setLookupState({ tag: "loading" });
    const attemptToken = ++lookupAttemptTokenRef.current;

    client
      .fetchAgent({ agentId })
      .then((result) => {
        if (attemptToken !== lookupAttemptTokenRef.current) {
          return;
        }
        if (!result) {
          setLookupState({
            tag: "not_found",
            message: `Agent not found: ${agentId}`,
          });
          return;
        }

        storeFetchedAgentDetail({ serverId, result });
        setLookupState({ tag: "idle" });
        return;
      })
      .catch((error) => {
        if (attemptToken !== lookupAttemptTokenRef.current) {
          return;
        }
        const message = toErrorMessage(error);
        if (isNotFoundErrorMessage(message)) {
          setLookupState({ tag: "not_found", message });
          return;
        }
        setLookupState({ tag: "error", message });
      });
  }, [agentId, agentState.id, client, hasSession, isConnected, lookupState.tag, serverId]);

  if (lookupState.tag === "not_found") {
    return (
      <View style={styles.container} testID="agent-not-found">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("agentPanel.states.notFound")}</Text>
          <Pressable
            accessibilityRole="button"
            testID="agent-not-found-retry"
            onPress={handleRetryLookup}
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>{t("common.actions.retry")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (lookupState.tag === "error") {
    return (
      <View style={styles.container} testID="agent-load-error">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("agentPanel.states.failedToLoad")}</Text>
          <Text style={styles.statusText}>{lookupState.message}</Text>
        </View>
      </View>
    );
  }

  const agent: AgentScreenAgent | null =
    agentState.serverId && agentState.id && agentState.status && agentState.cwd
      ? {
          serverId: agentState.serverId,
          id: agentState.id,
          provider: agentState.provider,
          status: agentState.status,
          cwd: agentState.cwd,
          workspaceId: agentState.workspaceId,
          capabilities: agentState.capabilities,
          currentModeId: agentState.currentModeId,
          model: agentState.model,
          thinkingOptionId: agentState.thinkingOptionId,
          runtimeInfo: agentState.runtimeInfo,
          features: agentState.features,
          lastError: agentState.lastError ?? null,
          personalitySpinner: agentState.personalitySpinner ?? null,
          projectPlacement,
        }
      : null;

  if (!agent) {
    return (
      <View style={styles.container} testID="agent-loading">
        <View style={styles.errorContainer}>
          <ThemedActivityIndicator size="large" uniProps={foregroundMutedColorMapping} />
        </View>
      </View>
    );
  }

  return (
    <ChatAgentContent
      serverId={serverId}
      agentId={agentId}
      isPaneFocused={isPaneFocused}
      isWorkspaceFocused={isWorkspaceFocused}
      client={client}
      isConnected={isConnected}
      connectionStatus={connectionStatus}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function ChatAgentContent({
  serverId,
  agentId,
  isPaneFocused,
  isWorkspaceFocused,
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
  isWorkspaceFocused: boolean;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const isBlackChat = useBlackChatScope();
  const { t } = useTranslation();
  const isPaneVisible = useRetainedPanelActive();
  const { api: toastApi, toast: toastState, dismiss: dismissToast } = useToastHost();
  const { isArchivingAgent } = useArchiveAgent();
  const streamViewRef = useRef<AgentStreamViewHandle>(null);
  const clearOnAgentBlurRef = useRef<() => void>(() => {});
  const wasPaneFocusedRef = useRef(isPaneFocused);
  const reconnectToastPresentedRef = useRef(false);
  const initAttemptTokenRef = useRef(0);
  const routeBottomAnchorRequestRef = useRef<{
    routeKey: string;
    reason: "initial-entry" | "resume";
  } | null>(null);
  const agentState = useSessionStore(
    useShallow((state) => selectChatAgentState(state, serverId, agentId)),
  );
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return null;
      }
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const isInitializingFromMap = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.initializingAgents?.get(agentId) ?? false) : false,
  );
  const historySyncGeneration = useSessionStore(
    (state) => state.sessions[serverId]?.historySyncGeneration ?? 0,
  );
  const replicaTimelineStatus = useSessionStore((state) =>
    agentId
      ? selectAgentTimelineState(state.sessions[serverId], agentId).status
      : ("cold" as const),
  );
  const hasAppliedAuthoritativeHistory = replicaTimelineStatus === "synced";
  const agentHistorySyncGeneration = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agentHistorySyncGeneration?.get(agentId) ?? -1) : -1,
  );
  // Per-agent catch-up status from the viewed-timeline sync. Until this agent's
  // subscription is acknowledged and caught up, the transcript on screen may be
  // behind the daemon, so the state machine holds "ready" back.
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const subscribeToVisibilityCatchUp = useCallback(
    (listener: () => void) => viewedTimelineSync?.subscribe(listener) ?? (() => {}),
    [viewedTimelineSync],
  );
  const readTimelineStatus = useCallback(
    () =>
      !agentId || !viewedTimelineSync
        ? ("ready" as const)
        : viewedTimelineSync.getAgentTimelineStatus(agentId),
    [agentId, viewedTimelineSync],
  );
  const timelineStatus = useSyncExternalStore(
    subscribeToVisibilityCatchUp,
    readTimelineStatus,
    readTimelineStatus,
  );
  // COMPAT(visibilityCatchUpStub): forcing "ready" for a hidden pane suppresses
  // exactly two states, `sync_error` on catch-up failure and the `catching_up`
  // indicator after backgrounding, neither of which a user can see on a pane
  // that is not on screen. Not date-bound: it clears if hidden panes ever need
  // to surface catch-up state, which today they do not.
  const visibilityCatchUpStatus = isPaneVisible ? timelineStatus : "ready";
  const hasActiveCreateHandoff = useCreateFlowStore((state) =>
    findActiveCreateHandoff({ pendingByDraftId: state.pendingByDraftId, serverId, agentId }),
  );
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));
  const { ensureAgentIsInitialized } = useAgentInitialization({
    serverId,
    client: hasSession ? client : null,
  });
  const [missingAgentState, setMissingAgentState] = useState<AgentScreenMissingState>({
    kind: "idle",
  });

  const hasHydratedHistoryBefore =
    hasAppliedAuthoritativeHistory || replicaTimelineStatus === "painted";

  const attentionController = useAgentAttentionClear({
    agentId,
    client,
    isConnected,
    requiresAttention: agentState.requiresAttention,
    attentionReason: agentState.attentionReason,
    isScreenFocused: isPaneFocused,
    isWorkspaceFocused,
  });
  useEffect(() => {
    clearOnAgentBlurRef.current = attentionController.clearOnAgentBlur;
  }, [attentionController.clearOnAgentBlur]);

  const { style: animatedKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });
  const shouldPresentReconnectToast =
    isPaneVisible && connectionStatus !== "online" && connectionStatus !== "idle";

  const handleHistorySyncFailure = useCallback(
    ({ origin, error }: { origin: "focus" | "entry"; error: unknown }) => {
      if (agentId) {
        console.warn("[AgentPanel] history sync failed", {
          origin,
          agentId,
          error,
        });
      }
      const message = toErrorMessage(error);
      setMissingAgentState((previous) => {
        if (previous.kind === "error" && previous.message === message) {
          return previous;
        }
        return { kind: "error", message };
      });
    },
    [agentId],
  );

  const ensureInitializedWithSyncErrorHandling = useCallback(
    (origin: "focus" | "entry") => {
      if (!agentId) {
        return;
      }
      ensureAgentIsInitialized(agentId)
        .then(() => {
          setMissingAgentState(clearHistorySyncErrorAfterSuccessfulSync);
          return undefined;
        })
        .catch((error) => {
          handleHistorySyncFailure({ origin, error });
          return undefined;
        });
    },
    [agentId, ensureAgentIsInitialized, handleHistorySyncFailure],
  );

  useEffect(() => {
    if (connectionStatus === "online" || connectionStatus === "idle") {
      reconnectToastStateByServerId.delete(serverId);
    }

    if (!shouldPresentReconnectToast) {
      if (reconnectToastPresentedRef.current) {
        reconnectToastPresentedRef.current = false;
        dismissToast();
      }
      return;
    }

    const startedAt = getHostRuntimeConnectionStatusSince(serverId) ?? Date.now();
    const previousReconnectToastState = reconnectToastStateByServerId.get(serverId);
    const reconnectToastState = reconcileReconnectToastState(
      previousReconnectToastState,
      startedAt,
    );
    if (reconnectToastState !== previousReconnectToastState) {
      reconnectToastStateByServerId.set(serverId, reconnectToastState);
    }

    if (reconnectToastState.presented) {
      if (!reconnectToastPresentedRef.current) {
        reconnectToastPresentedRef.current = true;
        toastApi.show(t("agentPanel.states.reconnecting"), {
          durationMs: null,
          icon: (
            <View
              accessible={false}
              testID="agent-reconnecting-status-dot"
              style={styles.reconnectingStatusDot}
            />
          ),
          testID: "agent-reconnecting-toast",
        });
      }
      return;
    }

    const delayMs = Math.max(0, startedAt + RECONNECT_TOAST_DELAY_MS - Date.now());
    const timer = setTimeout(() => {
      if (reconnectToastStateByServerId.get(serverId) !== reconnectToastState) {
        return;
      }
      reconnectToastState.presented = true;
      reconnectToastPresentedRef.current = true;
      toastApi.show(t("agentPanel.states.reconnecting"), {
        durationMs: null,
        icon: (
          <View
            accessible={false}
            testID="agent-reconnecting-status-dot"
            style={styles.reconnectingStatusDot}
          />
        ),
        testID: "agent-reconnecting-toast",
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [connectionStatus, dismissToast, serverId, shouldPresentReconnectToast, toastApi, t]);

  const isArchivingCurrentAgent = Boolean(agentId && isArchivingAgent({ serverId, agentId }));

  useEffect(() => {
    if (wasPaneFocusedRef.current && !isPaneFocused) {
      clearOnAgentBlurRef.current();
    }
    wasPaneFocusedRef.current = isPaneFocused;
  }, [isPaneFocused]);

  useEffect(() => {
    return () => {
      if (wasPaneFocusedRef.current) {
        clearOnAgentBlurRef.current();
      }
    };
  }, []);

  const isInitializing = agentId ? isInitializingFromMap : false;
  const isHistorySyncing = useMemo(() => {
    if (!agentId || !isInitializing) {
      return false;
    }
    const initKey = getInitKey(serverId, agentId);
    return Boolean(getInitDeferred(initKey));
  }, [agentId, isInitializing, serverId]);
  const needsAuthoritativeSync = useMemo(() => {
    if (!agentId) {
      return false;
    }
    return agentHistorySyncGeneration < historySyncGeneration;
  }, [agentHistorySyncGeneration, agentId, historySyncGeneration]);

  // A sync failure is a moment, not a mode. The focus refetch below is the only
  // thing that used to clear one, and it deliberately never runs again once the
  // client holds the transcript - so a single blip (a socket drop while the phone
  // slept, one timed-out request) pinned "Couldn't refresh agent history" to a
  // perfectly healthy chat for the rest of the session, while the timeline kept
  // streaming behind it. Catch-up landing on a synced transcript is the proof
  // that the warning has nothing left to describe.
  useEffect(() => {
    if (timelineStatus !== "ready" || !hasAppliedAuthoritativeHistory) {
      return;
    }
    setMissingAgentState(clearHistorySyncErrorAfterSuccessfulSync);
  }, [hasAppliedAuthoritativeHistory, timelineStatus]);

  // Focusing a pane only fetches when the client does not already hold the
  // transcript - see `shouldSyncAgentTimelineOnFocus` for why an unconditional
  // fetch here was the navigation path's most expensive redundant round-trip.
  useEffect(() => {
    if (!isPaneFocused || !agentId || !isConnected || !hasSession) {
      return;
    }
    if (
      !shouldSyncAgentTimelineOnFocus({
        hasAuthoritativeHistory: hasAppliedAuthoritativeHistory,
        needsAuthoritativeSync,
      })
    ) {
      return;
    }
    ensureInitializedWithSyncErrorHandling("focus");
  }, [
    agentId,
    ensureInitializedWithSyncErrorHandling,
    hasAppliedAuthoritativeHistory,
    hasSession,
    isConnected,
    isPaneFocused,
    needsAuthoritativeSync,
  ]);

  const agent = useMemo<AgentScreenAgent | null>(
    () => buildChatAgentFromState(agentState, projectPlacement),
    [agentState, projectPlacement],
  );
  const continuity = useMemo<AgentScreenContinuity>(() => {
    if (!hasActiveCreateHandoff || !agentId) {
      return { kind: "none" };
    }
    return {
      kind: "optimistic-create",
      agent: {
        serverId,
        id: agentId,
        status: "running",
        cwd: agent?.cwd ?? ".",
        projectPlacement: agent?.projectPlacement ?? null,
      },
    };
  }, [agent, agentId, hasActiveCreateHandoff, serverId]);

  const viewState = useAgentScreenStateMachine({
    routeKey: `${serverId}:${agentId ?? ""}`,
    input: {
      agent: agent ?? null,
      missingAgentState,
      isConnected,
      isArchivingCurrentAgent,
      isHistorySyncing,
      needsAuthoritativeSync,
      continuity,
      hasHydratedHistoryBefore,
      isArchived: agentState.archivedAt != null,
      visibilityCatchUpStatus,
    },
  });

  const effectiveAgent = viewState.tag === "ready" ? viewState.agent : null;
  const routeEntryKey = agentId ? `${serverId}:${agentId}` : null;
  routeBottomAnchorRequestRef.current = deriveRouteBottomAnchorIntent({
    cachedIntent: routeBottomAnchorRequestRef.current,
    routeKey: routeEntryKey,
    hasAppliedAuthoritativeHistoryAtEntry: hasAppliedAuthoritativeHistory,
  });
  const routeBottomAnchorRequest = useMemo(
    () =>
      deriveRouteBottomAnchorRequest({
        intent: routeBottomAnchorRequestRef.current,
        effectiveAgentId: effectiveAgent?.id ?? null,
      }),
    [effectiveAgent?.id],
  );

  const handleComposerHeightChange = useCallback(
    (_height: number) => {
      if (!agentId) {
        return;
      }
      streamViewRef.current?.prepareForViewportChange();
    },
    [agentId],
  );

  const handleMessageSent = useCallback(() => {
    if (!agentId) {
      return;
    }
    streamViewRef.current?.scrollToBottom("message-sent");
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (!isConnected || !hasSession) {
      return;
    }
    const shouldSyncOnEntry = needsAuthoritativeSync || isNative;
    if (!shouldSyncOnEntry) {
      return;
    }

    ensureInitializedWithSyncErrorHandling("entry");
  }, [
    agentId,
    ensureInitializedWithSyncErrorHandling,
    hasSession,
    isConnected,
    needsAuthoritativeSync,
  ]);

  useEffect(() => {
    initAttemptTokenRef.current += 1;
    setMissingAgentState({ kind: "idle" });
  }, [agentId, serverId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (agentState.id) {
      if (missingAgentState.kind === "resolving" || missingAgentState.kind === "not_found") {
        setMissingAgentState(reconcileMissingAgentStateWithPresentAgent);
      }
      return;
    }
    if (!isConnected || !hasSession) {
      return;
    }
    if (missingAgentState.kind === "resolving" || missingAgentState.kind === "not_found") {
      return;
    }

    setMissingAgentState({ kind: "resolving" });
    const attemptToken = ++initAttemptTokenRef.current;

    ensureAgentIsInitialized(agentId)
      .then(async () => {
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        const currentSession = useSessionStore.getState().sessions[serverId];
        const currentAgent =
          currentSession?.agents.get(agentId) ?? currentSession?.agentDetails.get(agentId);
        if (!currentAgent) {
          const result = await client.fetchAgent({ agentId });
          if (attemptToken !== initAttemptTokenRef.current) {
            return;
          }
          if (!result) {
            setMissingAgentState({
              kind: "not_found",
              message: `Agent not found: ${agentId}`,
            });
            return;
          }
          storeFetchedAgentDetail({ serverId, result });
        }
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        setMissingAgentState({ kind: "idle" });
        return;
      })
      .catch((error) => {
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        const message = toErrorMessage(error);
        if (isNotFoundErrorMessage(message)) {
          setMissingAgentState({ kind: "not_found", message });
          return;
        }
        setMissingAgentState({ kind: "error", message });
      });
  }, [
    agentState.id,
    agentId,
    client,
    ensureAgentIsInitialized,
    hasSession,
    isConnected,
    missingAgentState.kind,
    serverId,
  ]);

  const animatedContentStyle = useMemo(
    () => [styles.content, animatedKeyboardStyle],
    [animatedKeyboardStyle],
  );

  const nonReadyView = renderChatAgentNonReadyView({
    viewState,
    effectiveAgent,
    isBlackChat,
    t,
  });
  if (nonReadyView) return nonReadyView;
  invariant(agentId, "agent id is defined when agent content is ready");
  invariant(effectiveAgent, "effectiveAgent is defined when the non-ready view is absent");
  const agentCwd = agentState.cwd;
  invariant(agentCwd, "agent cwd is defined when agent content is ready");
  const showHistorySyncOverlay =
    viewState.tag === "ready" &&
    viewState.sync.status === "catching_up" &&
    viewState.sync.ui === "overlay";
  const showHistorySyncError = viewState.tag === "ready" && viewState.sync.status === "sync_error";
  const showHistorySyncMissing =
    viewState.tag === "ready" && viewState.sync.status === "sync_missing";

  return (
    <ChatAgentReadyContent
      serverId={serverId}
      agentId={agentId}
      isPaneFocused={isPaneFocused}
      isArchivingCurrentAgent={isArchivingCurrentAgent}
      agentState={agentState}
      effectiveAgent={effectiveAgent}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
      toastApi={toastApi}
      toast={toastState}
      dismiss={dismissToast}
      streamViewRef={streamViewRef}
      animatedContentStyle={animatedContentStyle}
      handleComposerHeightChange={handleComposerHeightChange}
      handleMessageSent={handleMessageSent}
      showHistorySyncOverlay={showHistorySyncOverlay}
      showHistorySyncError={showHistorySyncError}
      showHistorySyncMissing={showHistorySyncMissing}
      cwd={agentCwd}
      onAttentionInputFocus={attentionController.clearOnInputFocus}
      onAttentionPromptSend={attentionController.clearOnPromptSend}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

const ChatAgentReadyContent = memo(function ChatAgentReadyContent({
  serverId,
  agentId,
  isPaneFocused,
  isArchivingCurrentAgent,
  agentState,
  effectiveAgent,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  toastApi,
  toast,
  dismiss,
  streamViewRef,
  animatedContentStyle,
  handleComposerHeightChange,
  handleMessageSent,
  showHistorySyncOverlay,
  showHistorySyncError,
  showHistorySyncMissing,
  cwd,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  agentState: ChatAgentSelectedState;
  effectiveAgent: AgentScreenAgent;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  toastApi: ToastApi;
  toast: ToastState | null;
  dismiss: () => void;
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  animatedContentStyle: object[];
  handleComposerHeightChange: (height: number) => void;
  handleMessageSent: () => void;
  showHistorySyncOverlay: boolean;
  showHistorySyncError: boolean;
  showHistorySyncMissing: boolean;
  cwd: string;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const isBlackChat = useBlackChatScope();
  const subagentTrackPresentation = useAppSettingValue(
    (settings) => settings.subagentTrackPresentation,
  );
  const { workspaceId } = usePaneContext();
  const suggestedTaskRows = useSuggestedTasksForParent({ serverId, parentAgentId: agentId });
  const hasSuggestedTasks = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.suggestedTasks === true,
  );
  const suggestedTaskActions = useSuggestedTaskActions({ serverId, parentAgentId: agentId });
  // The live checklist, floated pinned at the top of the chat. While it's up we
  // hide its inline copy in the transcript so the same list isn't shown twice;
  // once dismissed (or the feature is off) it settles back inline as history.
  const pinnedTaskList = usePinnedTaskList({ serverId, agentId });
  const pinnedTaskListId = pinnedTaskList.item?.id;
  // The pane, not the window, is what the composer has to fit inside - measured
  // on `root`, whose height its own parent owns, so a growing composer can never
  // feed back into it.
  const { onLayout: onPaneLayout, height: paneHeight } = useContainerHeight();
  // The composer, the sync warning and the metrics bar are one bottom stack, and
  // the stack - not the composer alone - owns the safe-area inset. Padding the
  // composer left everything rendered under it sitting inside Android's gesture
  // strip, where the swipe-up bar covers it.
  const insets = useSafeAreaInsets();
  const bottomChromeStyle = useMemo(
    () => [
      styles.bottomChrome,
      resolveBlackChatCanvasStyle(isBlackChat),
      { paddingBottom: insets.bottom },
    ],
    [insets.bottom, isBlackChat],
  );
  const streamSection = (
    <RenderProfile id={`AgentStreamSection:${agentId}`}>
      <AgentStreamSection
        streamViewRef={streamViewRef}
        serverId={serverId}
        agentId={agentId}
        isPaneFocused={isPaneFocused}
        hiddenTodoListId={pinnedTaskListId}
        agent={effectiveAgent}
        routeBottomAnchorRequest={routeBottomAnchorRequest}
        hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
        hasActiveComposer={!agentState.archivedAt && !isArchivingCurrentAgent}
        toast={toastApi}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
      />
    </RenderProfile>
  );
  const composerSection = (
    <RenderProfile id={`AgentComposerSection:${agentId}`}>
      <AgentComposerSection
        agentId={agentId}
        serverId={serverId}
        isPaneFocused={isPaneFocused}
        isArchivingCurrentAgent={isArchivingCurrentAgent}
        archivedAt={agentState.archivedAt}
        cwd={cwd}
        isSubmitLoading={false}
        onAttentionInputFocus={onAttentionInputFocus}
        onAttentionPromptSend={onAttentionPromptSend}
        onComposerHeightChange={handleComposerHeightChange}
        onMessageSent={handleMessageSent}
        viewportHeight={paneHeight}
        subagentTrackPresentation={subagentTrackPresentation}
      />
    </RenderProfile>
  );
  const streamContent = (
    <ReanimatedAnimated.View style={animatedContentStyle}>
      {streamSection}
      {!agentState.archivedAt &&
      !isArchivingCurrentAgent &&
      subagentTrackPresentation === "pills" &&
      workspaceId ? (
        <AgentTracks serverId={serverId} workspaceId={workspaceId} agentId={agentId} />
      ) : null}
    </ReanimatedAnimated.View>
  );
  const contentContainer = (
    <View style={styles.contentContainer}>
      {streamContent}
      {/* One column, not two absolute wraps: a suggestion and a live checklist
          both belong at the top of the chat, and stacked at the same origin the
          upper one simply hid the lower. The offer the user must answer comes
          first; the ambient checklist sits under it. */}
      <ChatTopOverlayStack>
        {hasSuggestedTasks ? (
          <SuggestedTasksOverlay rows={suggestedTaskRows} actions={suggestedTaskActions} />
        ) : null}
        {pinnedTaskList.item ? (
          <PinnedTaskListOverlay
            item={pinnedTaskList.item}
            autoDismiss={pinnedTaskList.autoDismiss}
            onDismiss={pinnedTaskList.dismiss}
          />
        ) : null}
      </ChatTopOverlayStack>
    </View>
  );

  return (
    <View style={[styles.root, resolveBlackChatCanvasStyle(isBlackChat)]} onLayout={onPaneLayout}>
      <FileDropZone
        style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}
        disabled={isArchivingCurrentAgent}
      >
        {contentContainer}

        <View style={bottomChromeStyle}>
          {composerSection}

          {/* Under the message box, not over it: the sync warning is ambient
              status, so it must never push the composer down or cover the last
              message while the user is typing. It sits above the metrics bar so
              the run's own totals stay the bottom-most row. */}
          {showHistorySyncError ? (
            <SidebarCallout
              title={t("agentPanel.states.timelineSyncFailed")}
              variant="error"
              testID="agent-timeline-sync-error"
            />
          ) : null}

          {/* The host has answered and the chat is not there. Nothing is being
              retried, so the copy does not pretend otherwise. */}
          {showHistorySyncMissing ? (
            <SidebarCallout
              title={t("agentPanel.states.timelineAgentMissing")}
              variant="error"
              testID="agent-timeline-sync-missing"
            />
          ) : null}

          {/* Below the composer, at toolbar weight: this chat's total spend and
              everything spawned under it. Its top border separates it from the
              message box. Off unless switched on in Settings. See
              subagents/chat-metrics-bar.tsx. */}
          <ChatMetricsBar serverId={serverId} agentId={agentId} />
        </View>

        {showHistorySyncOverlay ? (
          <View style={styles.historySyncOverlay} testID="agent-history-overlay">
            <ThemedActivityIndicator size="large" uniProps={foregroundMutedColorMapping} />
          </View>
        ) : null}

        <ToastViewport toast={toast} onDismiss={dismiss} placement="panel" />
      </FileDropZone>

      {isArchivingCurrentAgent ? (
        <View style={styles.archivingOverlay} testID="agent-archiving-overlay">
          <ThemedActivityIndicator size="large" uniProps={foregroundColorMapping} />
          <Text style={styles.archivingTitle}>{t("agentPanel.states.archivingTitle")}</Text>
          <Text style={styles.archivingSubtitle}>{t("agentPanel.states.archivingSubtitle")}</Text>
        </View>
      ) : null}
    </View>
  );
});

const AgentStreamSection = memo(function AgentStreamSection({
  streamViewRef,
  serverId,
  agentId,
  isPaneFocused,
  agent,
  hiddenTodoListId,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  hasActiveComposer,
  toast,
  onOpenWorkspaceFile,
}: {
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
  agent: AgentScreenAgent;
  // When the pinned overlay is showing a checklist, its id is passed here so the
  // inline copy is dropped from the transcript (no double render).
  hiddenTodoListId?: string;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  /** False once the chat is archived or archiving, when no track bar renders. */
  hasActiveComposer: boolean;
  toast: ReturnType<typeof useToastHost>["api"];
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const searchRef = useRef<ChatMessageSearchHandle>(null);
  const [searchState, setSearchState] = useState<ChatMessageSearchState | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const exportMenuItemRef = useRef<View>(null);
  const chatContextMenuRef = useRef<ChatContextMenuHandle>(null);
  // While this panel slot is hidden, the selector returns the frozen tail
  // reference instead of the live one, so background agents' 48ms stream
  // flushes never re-render this section at all (the store notification sees
  // an identical snapshot). When the panel becomes active again the context
  // flip re-renders this component and the selector closure reads the live
  // tail during that same render - reactive, not an imperative getState()
  // snapshot, so reactivation can't freeze on a stale value.
  // This slot renders the tail even while hidden (it holds a frozen reference
  // to it), so it retains for as long as it is mounted - not only while active.
  useAgentStreamRetention(serverId, agentId ?? null);
  const isPanelActive = useRetainedPanelActive();
  // The transcript tail and the floating scroll-to-bottom control both have to
  // clear the composer's track bar, which a sibling section owns. Reading the
  // same store signals the tracks render from keeps the two memo boundaries
  // independent - lifting the track state into the shared parent would re-render
  // this section on every subagent tick. Tracks that decide their own visibility
  // (context health, rate limits, followed suggestions) are not counted here.
  const { workspaceId } = usePaneContext();
  const isCompactFormFactor = useIsCompactFormFactor();
  const trackSubagentRows = useSubagentsForParent({ serverId, parentAgentId: agentId ?? "" });
  const trackBackgroundTaskRows = useBackgroundShellTasksForParent({
    serverId,
    parentAgentId: agentId ?? "",
  });
  const workspaceChangeIndicator = useWorkspaceChangeIndicator();
  const hasWorkspaceDiffStat = useWorkspaceHasDiffStat(
    serverId,
    workspaceId ?? "",
    workspaceChangeIndicator,
  );
  const hasVisibleComposerTracks =
    hasActiveComposer &&
    (trackSubagentRows.length > 0 || trackBackgroundTaskRows.length > 0 || hasWorkspaceDiffStat);
  const bottomOverlayTailClearance = hasVisibleComposerTracks
    ? resolveComposerTrackTailClearance(isCompactFormFactor)
    : 0;
  const bottomOverlayControlClearance = hasVisibleComposerTracks
    ? resolveComposerTrackControlClearance(isCompactFormFactor)
    : 0;
  useKeyboardActionHandler({
    handlerId: `chat-find:${serverId}:${agentId ?? ""}`,
    actions: ["chat.find"],
    enabled: Boolean(agentId),
    priority: 120,
    isActive: () => isPanelActive && isPaneFocused,
    handle: (action) => {
      if (action.id !== "chat.find") return false;
      searchRef.current?.open();
      return true;
    },
  });
  const frozenStreamItemsRef = useRef<StreamItem[] | undefined>(undefined);
  const streamItemsRaw = useSessionStore((state) => {
    if (!isPanelActive) {
      return frozenStreamItemsRef.current;
    }
    return agentId ? state.sessions[serverId]?.agentStreamTail?.get(agentId) : undefined;
  });
  if (isPanelActive) {
    frozenStreamItemsRef.current = streamItemsRaw;
  }
  const rawStreamItems = streamItemsRaw ?? EMPTY_STREAM_ITEMS;
  const streamHead = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agentStreamHead?.get(agentId) : undefined,
  );
  const pendingMessageSubmissions = useSessionStore(
    useShallow((state) =>
      agentId
        ? getActiveMessageSubmissions(state.sessions[serverId]?.messageSubmissions.get(agentId))
        : EMPTY_MESSAGE_SUBMISSIONS,
    ),
  );
  const turnPresentation = useSessionStore(
    useShallow((state) =>
      agentId
        ? selectAgentTurnPresentation(state.sessions[serverId], agentId)
        : { isActive: false, isCancelling: false, startedAt: null, turnId: null },
    ),
  );
  // Drop the inline copy of the checklist currently shown in the pinned overlay,
  // so it isn't rendered in two places at once. When nothing is pinned this is a
  // no-op and the original array reference flows through untouched.
  const streamItems = useMemo(() => {
    if (!hiddenTodoListId) {
      return rawStreamItems;
    }
    const filtered = rawStreamItems.filter(
      (item) => !(item.kind === "todo_list" && item.id === hiddenTodoListId),
    );
    return filtered.length === rawStreamItems.length ? rawStreamItems : filtered;
  }, [rawStreamItems, hiddenTodoListId]);
  const searchItems = useMemo(
    () => [...streamItems, ...(streamHead ?? EMPTY_STREAM_ITEMS)],
    [streamHead, streamItems],
  );
  const navigateToSearchResult = useCallback(
    ({ itemId }: { itemId: string }) => streamViewRef.current?.scrollToMessage(itemId),
    [streamViewRef],
  );
  const handleSearchStateChange = useCallback((next: ChatMessageSearchState | null) => {
    setSearchState(next);
  }, []);
  const handleSearchClose = useCallback(() => {
    streamViewRef.current?.scrollToBottom("jump-to-bottom");
  }, [streamViewRef]);
  const pendingPermissionList = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return EMPTY_PENDING_PERMISSION_LIST;
      }
      const allPendingPermissions = state.sessions[serverId]?.pendingPermissions;
      if (!allPendingPermissions) {
        return EMPTY_PENDING_PERMISSION_LIST;
      }
      const filtered: PendingPermission[] = [];
      for (const permission of allPendingPermissions.values()) {
        if (permission.agentId === agentId) {
          filtered.push(permission);
        }
      }
      return filtered.length > 0 ? filtered : EMPTY_PENDING_PERMISSION_LIST;
    },
    shallow,
  );
  const pendingPermissions = useMemo(() => {
    if (pendingPermissionList.length === 0) {
      return EMPTY_PENDING_PERMISSIONS;
    }
    return new Map(pendingPermissionList.map((permission) => [permission.key, permission]));
  }, [pendingPermissionList]);

  const exportItems = useMemo(
    () => [...rawStreamItems, ...(streamHead ?? [])],
    [rawStreamItems, streamHead],
  );
  const exportChat = useCallback(
    (format: ChatExportFormat) => {
      void saveChatExport({ title: agent.id, items: exportItems, format }).catch(() => undefined);
    },
    [agent.id, exportItems],
  );
  const exportJson = useCallback(() => exportChat("json"), [exportChat]);
  const exportHtml = useCallback(() => exportChat("html"), [exportChat]);
  const exportMarkdown = useCallback(() => exportChat("markdown"), [exportChat]);
  const exportText = useCallback(() => exportChat("text"), [exportChat]);
  const openExportMenu = useCallback((event: Parameters<typeof contextMenuAnchorFromEvent>[0]) => {
    const pointerAnchor = contextMenuAnchorFromEvent(event);
    const exportMenuItem = exportMenuItemRef.current;
    if (!pointerAnchor || !exportMenuItem) return;
    exportMenuItem.measureInWindow((x, _y, width) => {
      setExportMenuAnchor({ x: x + width, y: pointerAnchor.y });
      setIsExportMenuOpen(true);
    });
  }, []);
  const handleExportMenuOpenChange = useCallback((open: boolean) => {
    setIsExportMenuOpen(open);
    if (!open) {
      chatContextMenuRef.current?.close();
    }
  }, []);
  const exportMenuChevron = useMemo(
    () => <ThemedChevronRight size="sm" uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const expandAll = useCallback(
    () => streamViewRef.current?.setAllExpandableContentExpanded(true),
    [streamViewRef],
  );
  const collapseAll = useCallback(
    () => streamViewRef.current?.setAllExpandableContentExpanded(false),
    [streamViewRef],
  );
  const streamView = (
    <AgentStreamView
      ref={streamViewRef}
      agentId={agent.id}
      serverId={serverId}
      context={agent}
      streamItems={streamItems}
      searchState={searchState}
      pendingPermissions={pendingPermissions}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      isAuthoritativeHistoryReady={hasAppliedAuthoritativeHistory}
      bottomOverlayTailClearance={bottomOverlayTailClearance}
      bottomOverlayControlClearance={bottomOverlayControlClearance}
      toast={toast}
      pendingMessageSubmissions={pendingMessageSubmissions}
      turnPresentation={turnPresentation}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
  const chatFallbackContextMenu = (
    <>
      <ContextMenuItem
        closeOnSelect={false}
        itemRef={exportMenuItemRef}
        onSelect={openExportMenu}
        testID="agent-chat-export-menu"
        trailing={exportMenuChevron}
      >
        Export
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={expandAll} testID="agent-chat-expand-all">
        {t("message.expandCollapse.expandAll")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={collapseAll} testID="agent-chat-collapse-all">
        {t("message.expandCollapse.collapseAll")}
      </ContextMenuItem>
    </>
  );

  return (
    <>
      <ChatMessageSearchBar
        ref={searchRef}
        items={searchItems}
        onNavigateToResult={navigateToSearchResult}
        onSearchStateChange={handleSearchStateChange}
        onClose={handleSearchClose}
      />
      <ChatContextMenu
        ref={chatContextMenuRef}
        fallbackContent={chatFallbackContextMenu}
        testID="agent-chat-background"
      >
        <View style={styles.chatContextTrigger}>{streamView}</View>
      </ChatContextMenu>
      <ContextMenu
        anchor={exportMenuAnchor}
        open={isExportMenuOpen}
        onOpenChange={handleExportMenuOpenChange}
      >
        <ContextMenuContent side="right" align="start" testID="agent-chat-export-context-menu">
          <ContextMenuItem onSelect={exportJson} testID="agent-chat-export-json">
            Export as JSON
          </ContextMenuItem>
          <ContextMenuItem onSelect={exportHtml} testID="agent-chat-export-html">
            Export as HTML
          </ContextMenuItem>
          <ContextMenuItem onSelect={exportMarkdown} testID="agent-chat-export-markdown">
            Export as Markdown
          </ContextMenuItem>
          <ContextMenuItem onSelect={exportText} testID="agent-chat-export-text">
            Export as Text
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
});

const AgentComposerSection = memo(function AgentComposerSection({
  agentId,
  serverId,
  isPaneFocused,
  isArchivingCurrentAgent,
  archivedAt,
  cwd,
  isSubmitLoading,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onComposerHeightChange,
  onMessageSent,
  viewportHeight,
  subagentTrackPresentation,
}: {
  agentId?: string;
  serverId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  archivedAt: Date | null;
  cwd: string;
  isSubmitLoading: boolean;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
  viewportHeight: number;
  subagentTrackPresentation: "panels" | "pills";
}) {
  const agentInputDraft = useAgentInputDraft({
    draftKey: buildDraftStoreKey({
      serverId,
      agentId: agentId ?? "",
    }),
  });
  const isObserved = useSessionStore((state) => {
    if (!agentId) {
      return false;
    }
    const session = state.sessions[serverId];
    const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId);
    return agent?.attend === "observed";
  });
  if (!agentId) {
    return null;
  }
  if (archivedAt) {
    return <ArchivedAgentCallout serverId={serverId} agentId={agentId} />;
  }
  if (isArchivingCurrentAgent) {
    return null;
  }
  // Observed subagents (Claude Task / ultracode fan-out) are read-only: replace
  // the composer with a disabled callout that only offers Stop. Interactive
  // parameter controls hide themselves off the subagent's all-false
  // capabilities. See projects/observed-subagents/observed-subagents.md.
  if (isObserved) {
    return <ObservedSubagentCallout serverId={serverId} agentId={agentId} />;
  }

  return (
    <RewindComposerRestoreProvider text={agentInputDraft.text} setText={agentInputDraft.setText}>
      <ActiveAgentComposer
        agentId={agentId}
        serverId={serverId}
        isPaneFocused={isPaneFocused}
        cwd={cwd}
        isSubmitLoading={isSubmitLoading}
        agentInputDraft={agentInputDraft}
        onAttentionInputFocus={onAttentionInputFocus}
        onAttentionPromptSend={onAttentionPromptSend}
        onComposerHeightChange={onComposerHeightChange}
        onMessageSent={onMessageSent}
        viewportHeight={viewportHeight}
        subagentTrackPresentation={subagentTrackPresentation}
      />
    </RewindComposerRestoreProvider>
  );
});

function ActiveAgentComposer({
  agentId,
  serverId,
  isPaneFocused,
  cwd,
  isSubmitLoading,
  agentInputDraft,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onComposerHeightChange,
  onMessageSent,
  viewportHeight,
  subagentTrackPresentation,
}: {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  cwd: string;
  isSubmitLoading: boolean;
  agentInputDraft: AgentInputDraft;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
  viewportHeight: number;
  subagentTrackPresentation: "panels" | "pills";
}) {
  const isBlackChat = useBlackChatScope();
  const isCompactFormFactor = useIsCompactFormFactor();
  // The composer row degrades one control at a time from its own measurements
  // (see composer/input/toolbar-stage.ts), so pane width must not flip the whole
  // control group to the mobile surface at a 500px cliff. Only a real compact
  // form factor selects that branch now.
  const { onLayout: onInputAreaLayout } = useContainerWidthBelow(COMPACT_FORM_FACTOR_WIDTH, {
    initialIsBelow: isCompactFormFactor,
  });
  const paneContext = usePaneContext();
  const { workspaceId, tabId, retargetCurrentTab } = paneContext;
  const { archiveAgent } = useArchiveAgent();
  const closeWorkspaceTab = useWorkspaceLayoutStore((state) => state.closeTab);
  const hideWorkspaceAgent = useWorkspaceLayoutStore((state) => state.hideAgent);
  const unpinWorkspaceAgent = useWorkspaceLayoutStore((state) => state.unpinAgent);
  const subagentRows = useSubagentsForParent({
    serverId,
    parentAgentId: agentId,
  });
  const canDetachSubagents = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentDetach === true,
  );
  const handleOpenSubagent = useCallback(
    (subagentId: string) => {
      navigateToAgent({ serverId, agentId: subagentId });
    },
    [serverId],
  );
  // Provider subagents are rows in this agent's timeline, not agents, so they
  // cannot go through `navigateToAgent` the way Otto's observed subagents do.
  const handleOpenProviderSubagent = useCallback(
    (parentAgentId: string, subagentId: string) => {
      if (!workspaceId) {
        return;
      }
      openProviderSubagentTab({ serverId, workspaceId, parentAgentId, subagentId });
    },
    [serverId, workspaceId],
  );
  const handleArchiveSubagent = useArchiveSubagent({ serverId });
  const handleStopSubagent = useStopSubagent({ serverId });
  const handleClearCompletedSubagents = useClearCompletedSubagents({
    serverId,
    parentAgentId: agentId,
  });
  const autoClearCompletedSubagents = useAutoClearCompletedSubagentsSetting();
  useAutoClearCompletedSubagents({
    serverId,
    parentAgentId: agentId,
    rows: subagentRows,
    enabled: autoClearCompletedSubagents && subagentTrackPresentation === "panels",
  });
  const clearedSubagentTokens = useClearedSubagentTokens(serverId, agentId);
  const handleDetachSubagent = useDetachSubagent({ serverId });
  const backgroundTaskRows = useBackgroundShellTasksForParent({
    serverId,
    parentAgentId: agentId,
  });
  const hasBackgroundShellTasks = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.backgroundShellTasks === true,
  );
  const handleStopBackgroundTask = useStopBackgroundTask({ serverId, parentAgentId: agentId });
  const handleClearCompletedBackgroundTasks = useClearCompletedBackgroundTasks({
    serverId,
    parentAgentId: agentId,
  });
  // An open track suspends every auto-clear driver: rows the user has pulled
  // open are rows they are reading, and sweeping them out from under the cursor
  // is the behavior that made this a bug report. Closing it resumes the sweep.
  const [backgroundTasksExpanded, setBackgroundTasksExpanded] = useState(false);
  // One driver per terminal group: completed and failed rows auto-clear on
  // independent settings, so neither can sweep the other's rows.
  const autoClearCompletedBackgroundTasks = useAutoClearCompletedBackgroundTasksSetting();
  useAutoClearCompletedBackgroundTasks({
    serverId,
    parentAgentId: agentId,
    rows: backgroundTaskRows,
    group: "completed",
    enabled: autoClearCompletedBackgroundTasks && !backgroundTasksExpanded,
  });
  const autoClearFailedBackgroundTasks = useAutoClearFailedBackgroundTasksSetting();
  useAutoClearCompletedBackgroundTasks({
    serverId,
    parentAgentId: agentId,
    rows: backgroundTaskRows,
    group: "failed",
    enabled: autoClearFailedBackgroundTasks && !backgroundTasksExpanded,
  });
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd,
    workspaceId,
  });
  const agentAttachmentScopeKey = useMemo(
    () => buildAgentWorkspaceAttachmentScopeKey(agentId),
    [agentId],
  );
  const attachmentScopeKeys = useMemo(
    () => [agentAttachmentScopeKey, workspaceAttachmentScopeKey],
    [agentAttachmentScopeKey, workspaceAttachmentScopeKey],
  );
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind === "file_context") {
        if (attachment.entryKind === "directory") {
          return;
        }
        paneContext.openFileInWorkspace({
          location: { path: attachment.path },
          disposition: "main",
        });
        return;
      }
      if (attachment.kind !== "review") {
        return;
      }
      const checkout = {
        serverId,
        cwd: attachment.attachment.cwd,
        isGit: true,
      };
      openExplorerSidebarView({
        isCompact: isCompactFormFactor,
        workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
        checkout,
        view: "changes",
      });
    },
    [isCompactFormFactor, paneContext, serverId, workspaceId],
  );

  const handleClientSlashCommand = useCallback(
    async (command: ClientSlashCommand) => {
      const agent = resolveChatAgentFromSession(useSessionStore.getState(), serverId, agentId);
      if (!agent) {
        throw new Error("Agent not found");
      }

      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (workspaceKey) {
        unpinWorkspaceAgent(workspaceKey, agentId);
        hideWorkspaceAgent(workspaceKey, agentId);

        // /clear disables the preview button for this chat (no agent tab is
        // focused anymore), so every preview server for this cwd should stop
        // instantly rather than keep running orphaned - not just close their
        // tabs. previewListConfig's runningServers is the source of truth for
        // "is a server running", since a server can outlive its bound tab.
        // External ("ext:") servers are excluded: those are port-probed
        // processes the daemon never spawned (e.g. the user's own dev server -
        // possibly the very Metro serving this app), and stopping one
        // tree-kills whatever owns the port. Only explicit user action may
        // stop an external server.
        const previewClient = useSessionStore.getState().sessions[serverId]?.client ?? null;
        if (previewClient) {
          void (async () => {
            const config = await previewClient.previewListConfig(cwd).catch(() => null);
            const browsersById = useBrowserStore.getState().browsersById;
            const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(workspaceKey);
            const managedServers = (config?.runningServers ?? []).filter(
              (server) => !isExternalPreviewServerId(server.serverId),
            );
            for (const server of managedServers) {
              void previewClient.previewStop(server.serverId).catch(() => undefined);
              usePreviewRunningServersStore.getState().markStopped(serverId, server.serverId);
              for (const tab of tabs) {
                if (
                  tab.target.kind === "browser" &&
                  browsersById[tab.target.browserId]?.previewServerId === server.serverId
                ) {
                  closeWorkspaceTab(workspaceKey, tab.tabId);
                }
              }
            }
          })();
        }
      }

      if (command.kind === "replace-agent-with-draft") {
        retargetCurrentTab({
          kind: "draft",
          draftId: generateDraftId(),
          setup: buildDraftAgentSetup(agent),
        });
      } else if (workspaceKey) {
        closeWorkspaceTab(workspaceKey, tabId);
      }

      await archiveAgent({ serverId, agentId });
    },
    [
      agentId,
      archiveAgent,
      closeWorkspaceTab,
      cwd,
      hideWorkspaceAgent,
      retargetCurrentTab,
      serverId,
      tabId,
      unpinWorkspaceAgent,
      workspaceId,
    ],
  );

  const { style: composerKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

  // The composer gutter is an opaque `surface0` band spanning the pane, so it
  // is a chat canvas in its own right and needs the same authoritative black
  // fill as the pane root - without it the whole bottom of a black chat pane
  // stays on the app palette.
  const inputAreaStyle = useMemo(
    () => [
      styles.inputAreaWrapper,
      resolveBlackChatCanvasStyle(isBlackChat),
      composerKeyboardStyle,
    ],
    [composerKeyboardStyle, isBlackChat],
  );

  return (
    // Re-assert the black palette on every render of the composer column: this
    // component re-renders on its own (draft text, queue, subagent rows) and
    // would otherwise re-register all of its chrome against the app theme.
    <ChatThemeScope>
      <ReanimatedAnimated.View style={inputAreaStyle} onLayout={onInputAreaLayout}>
        {/* Topmost card in the fanned stack (highest), yet painted first so it sits
          BEHIND every flyout below it and the composer - see RateLimitWarningTrack. */}
        {/* Mounted above the usage warning: highest in the fan, painted furthest
          back. Context health is important but never urgent, so it yields the
          position nearest the composer to the rate-limit strip. */}
        <ContextHealthTrack serverId={serverId} agentId={agentId} />
        <RateLimitWarningTrack serverId={serverId} agentId={agentId} />
        {/* Says out loud that the last prompt was accepted by Otto rather than
          typed, and carries the Stop for the chain. Only renders once a
          suggestion has actually been followed. */}
        <FollowSuggestionTrack serverId={serverId} agentId={agentId} />
        {SHOW_PASEO_TASK_LIST_PANEL ? (
          <AgentTaskList serverId={serverId} agentId={agentId} />
        ) : null}
        {subagentTrackPresentation === "panels" ? (
          <SubagentsTrack
            rows={subagentRows}
            onOpenSubagent={handleOpenSubagent}
            onOpenProviderSubagent={handleOpenProviderSubagent}
            onArchiveSubagent={handleArchiveSubagent}
            onStopSubagent={handleStopSubagent}
            onClearCompleted={handleClearCompletedSubagents}
            onDetachSubagent={canDetachSubagents ? handleDetachSubagent : undefined}
            clearedTokens={clearedSubagentTokens}
          />
        ) : null}
        {hasBackgroundShellTasks ? (
          <BackgroundTasksTrack
            rows={backgroundTaskRows}
            onStopTask={handleStopBackgroundTask}
            onClearTasks={handleClearCompletedBackgroundTasks}
            expanded={backgroundTasksExpanded}
            onExpandedChange={setBackgroundTasksExpanded}
          />
        ) : null}
        {/* Front of the fan: a card mid-entrance or mid-dismissal overflows its own
          collapsing box across this space, so the composer needs the highest
          explicit z-index for the card to pass behind it rather than over the
          input. See COMPOSER_TRACK_LAYERS in composer/track-layers.ts. */}
        <View style={styles.composerLayer}>
          <Composer
            agentId={agentId}
            serverId={serverId}
            externalKeyboardShift
            isPaneFocused={isPaneFocused}
            value={agentInputDraft.text}
            textReplacementKey={agentInputDraft.textReplacementKey}
            onChangeText={agentInputDraft.setText}
            attachments={agentInputDraft.attachments}
            attachmentScopeKeys={attachmentScopeKeys}
            attachmentWriteScopeKey={workspaceAttachmentScopeKey}
            onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
            onChangeAttachments={agentInputDraft.setAttachments}
            cwd={cwd}
            clearDraft={agentInputDraft.clear}
            autoFocus={isPaneFocused}
            isSubmitLoading={isSubmitLoading}
            onAttentionInputFocus={onAttentionInputFocus}
            onAttentionPromptSend={onAttentionPromptSend}
            onComposerHeightChange={onComposerHeightChange}
            onMessageSent={onMessageSent}
            onClientSlashCommand={handleClientSlashCommand}
            viewportHeight={viewportHeight}
          />
        </View>
      </ReanimatedAnimated.View>
    </ChatThemeScope>
  );
}

function AgentSessionUnavailableState({
  serverLabel,
  connectionStatus,
  lastError,
  isUnknownDaemon = false,
  t,
}: {
  serverLabel: string;
  connectionStatus: HostRuntimeConnectionStatus;
  lastError: string | null;
  isUnknownDaemon?: boolean;
  t: TFunction;
}) {
  const isBlackChat = useBlackChatScope();
  if (isUnknownDaemon) {
    return (
      <View style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>
            {t("agentPanel.unavailable.unknownHost", { serverLabel })}
          </Text>
          <Text style={styles.statusText}>{t("agentPanel.unavailable.addHost")}</Text>
        </View>
      </View>
    );
  }

  const isConnecting = connectionStatus === "connecting";
  const isPreparingSession = connectionStatus === "online";

  return (
    <View style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}>
      <View style={styles.centerState}>
        {isConnecting || isPreparingSession ? (
          <>
            <LoadingSpinner size="large" />
            <Text style={styles.loadingText}>
              {isPreparingSession
                ? t("agentPanel.unavailable.preparingSession", { serverLabel })
                : t("agentPanel.unavailable.connecting", { serverLabel })}
            </Text>
            <Text style={styles.statusText}>
              {isPreparingSession
                ? t("agentPanel.unavailable.showSoon")
                : t("agentPanel.unavailable.showWhenOnline")}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.offlineTitle}>
              {t("agentPanel.unavailable.reconnectingTo", { serverLabel })}
            </Text>
            <Text style={styles.offlineDescription}>
              {t("agentPanel.unavailable.showAgainWhenReachable")}
            </Text>
            {lastError ? <Text style={styles.offlineDetails}>{lastError}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

const ThemedActivityIndicator = withUnistyles(LoadingSpinner);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    flex: 1,
    overflow: "hidden",
    ...(isWeb ? { userSelect: "none" as const } : {}),
  },
  content: {
    flex: 1,
  },
  chatContextTrigger: {
    flex: 1,
  },
  inputAreaWrapper: {
    width: "100%",
    backgroundColor: theme.colors.surface0,
  },
  bottomChrome: {
    width: "100%",
    backgroundColor: theme.colors.surface0,
  },
  // Highest layer in the composer fan so a dismissed card's exiting web clone -
  // appended after the composer in the DOM - still paints beneath it.
  composerLayer: {
    zIndex: COMPOSER_TRACK_LAYERS.composer,
  },
  historySyncOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 40,
  },
  archivingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(8, 10, 14, 0.86)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[8],
    gap: theme.spacing[3],
    zIndex: 50,
  },
  archivingTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  archivingSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  loadingText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  reconnectingStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.palette.amber[500],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[3],
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  retryButton: {
    marginTop: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  retryButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  statusText: {
    marginTop: theme.spacing[2],
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  offlineTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  offlineDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  offlineDetails: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
