import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { isExternalPreviewServerId } from "@otto-code/protocol/messages";
import type { TFunction } from "i18next";
import { SquarePen } from "@/components/icons/material-icons";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import ReanimatedAnimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { shallow, useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AgentStreamView, type AgentStreamViewHandle } from "@/agent-stream/view";
import { ArchivedAgentCallout } from "@/components/archived-agent-callout";
import { ObservedSubagentCallout } from "@/components/observed-subagent-callout";
import { BlackChatScope } from "@/components/black-chat-scope";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { Composer } from "@/composer";
import { RewindComposerRestoreProvider } from "@/components/rewind/composer-restore";
import { getProviderIcon } from "@/components/provider-icons";
import {
  ToastViewport,
  useToastHost,
  type ToastApi,
  type ToastState,
} from "@/components/toast-host";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import { useWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { COMPACT_FORM_FACTOR_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useAgentAttentionClear } from "@/hooks/use-agent-attention-clear";
import { useAgentInitialization } from "@/hooks/use-agent-initialization";
import { useAppSettings } from "@/hooks/use-settings";
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
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import {
  clearHistorySyncErrorAfterSuccessfulSync,
  reconcileMissingAgentStateWithPresentAgent,
} from "@/panels/agent-panel-load-state";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { RenderProfile } from "@/utils/render-profiler";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";
import {
  type HostRuntimeConnectionStatus,
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
import { useBrowserStore } from "@/stores/browser-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { usePanelStore } from "@/stores/panel-store";
import { usePreviewRunningServersStore } from "@/stores/preview-running-servers-store";
import { type Agent, useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
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
import {
  useBackgroundShellTasksForParent,
  useClearCompletedBackgroundTasks,
  useStopBackgroundTask,
} from "@/background-tasks";
import { BackgroundTasksTrack } from "@/background-tasks/track";
import { RateLimitWarningTrack } from "@/composer/rate-limit-warning-track";
import { ContextHealthTrack } from "@/composer/context-health-track";
import {
  SuggestedTasksOverlay,
  useSuggestedTaskActions,
  useSuggestedTasksForParent,
} from "@/suggested-tasks";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import { getInitDeferred, getInitKey } from "@/utils/agent-initialization";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { buildDraftAgentSetup, type ClientSlashCommand } from "@/client-slash-commands";

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
  t: TFunction;
}): React.ReactElement | null {
  const { viewState, effectiveAgent, t } = args;
  if (viewState.tag === "not_found") {
    return (
      <View style={styles.container} testID="agent-not-found">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("agentPanel.states.notFound")}</Text>
        </View>
      </View>
    );
  }
  if (viewState.tag === "error") {
    return (
      <View style={styles.container} testID="agent-load-error">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("agentPanel.states.failedToLoad")}</Text>
          <Text style={styles.statusText}>{viewState.message}</Text>
        </View>
      </View>
    );
  }
  if (viewState.tag === "boot" || !effectiveAgent) {
    return (
      <View style={styles.container} testID="agent-loading">
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

function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent" || normalized.toLowerCase() === "new chat") {
    return null;
  }
  return normalized;
}

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
      return buildAgentDescriptorState(agent);
    }),
  );
  const provider = descriptorState.provider;
  const label = resolveWorkspaceAgentTabLabel(descriptorState.title);
  const icon = getProviderIcon(provider);

  return {
    label: label ?? "",
    subtitle: provider ? `${formatProviderLabel(provider)} agent` : "Agent",
    titleState: label ? "ready" : "loading",
    icon,
    statusBucket: descriptorState.status
      ? deriveSidebarStateBucket({
          status: descriptorState.status,
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
  const { serverId, target, openFileInWorkspace } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "agent", "AgentPanel requires agent target");

  return (
    <AgentPanelContent
      serverId={serverId}
      agentId={target.agentId}
      isPaneFocused={isInteractive}
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
  // mode. Chat tabs only — terminal/browser/preview panes are not wrapped.
  return <BlackChatScope enabled={settings.blackTabBackground}>{content}</BlackChatScope>;
}

export const agentPanelRegistration: PanelRegistration<"agent"> = {
  kind: "agent",
  component: AgentConversationPanel,
  useDescriptor: useAgentPanelDescriptor,
};

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
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId: string;
  isPaneFocused: boolean;
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
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
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
  // recoverable — let the user re-run the lookup instead of dead-ending.
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
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const { api: toastApi, toast: toastState, dismiss: dismissToast } = useToastHost();
  const { isArchivingAgent } = useArchiveAgent();
  const streamViewRef = useRef<AgentStreamViewHandle>(null);
  const clearOnAgentBlurRef = useRef<() => void>(() => {});
  const wasPaneFocusedRef = useRef(isPaneFocused);
  const reconnectToastArmedRef = useRef(false);
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
  const hasAppliedAuthoritativeHistory = useSessionStore((state) =>
    agentId
      ? state.sessions[serverId]?.agentAuthoritativeHistoryApplied?.get(agentId) === true
      : false,
  );
  const agentHistorySyncGeneration = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agentHistorySyncGeneration?.get(agentId) ?? -1) : -1,
  );
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

  const hasHydratedHistoryBefore = hasAppliedAuthoritativeHistory;

  const attentionController = useAgentAttentionClear({
    agentId,
    client,
    isConnected,
    requiresAttention: agentState.requiresAttention,
    attentionReason: agentState.attentionReason,
    isScreenFocused: isPaneFocused,
  });
  useEffect(() => {
    clearOnAgentBlurRef.current = attentionController.clearOnAgentBlur;
  }, [attentionController.clearOnAgentBlur]);

  const { style: animatedKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

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
    if (connectionStatus === "online") {
      if (reconnectToastArmedRef.current) {
        reconnectToastArmedRef.current = false;
        dismissToast();
      }
      return;
    }
    if (connectionStatus === "idle") {
      return;
    }
    if (!reconnectToastArmedRef.current) {
      reconnectToastArmedRef.current = true;
      toastApi.show(t("agentPanel.states.reconnecting"), {
        durationMs: null,
        testID: "agent-reconnecting-toast",
      });
    }
  }, [connectionStatus, dismissToast, toastApi, t]);

  useEffect(() => {
    if (!isPaneFocused || !agentId || !isConnected || !hasSession) {
      return;
    }
    ensureInitializedWithSyncErrorHandling("focus");
  }, [agentId, ensureInitializedWithSyncErrorHandling, hasSession, isConnected, isPaneFocused]);

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
  cwd: string;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const rawAgentInputDraft = useAgentInputDraft({
    draftKey: buildDraftStoreKey({
      serverId,
      agentId,
    }),
  });
  // Stabilize the agentInputDraft object identity so that memo(AgentComposerSection) can bail out
  // when only toast state changes (which does not affect any draft field).
  const { text, setText, attachments, setAttachments, clear, isHydrated, composerState } =
    rawAgentInputDraft;
  const agentInputDraft = useMemo(
    (): AgentInputDraft => ({
      text,
      setText,
      attachments,
      setAttachments,
      clear,
      isHydrated,
      composerState,
    }),
    [text, setText, attachments, setAttachments, clear, isHydrated, composerState],
  );
  const suggestedTaskRows = useSuggestedTasksForParent({ serverId, parentAgentId: agentId });
  const hasSuggestedTasks = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.suggestedTasks === true,
  );
  const suggestedTaskActions = useSuggestedTaskActions({ serverId, parentAgentId: agentId });
  const streamSection = (
    <RenderProfile id={`AgentStreamSection:${agentId}`}>
      <AgentStreamSection
        streamViewRef={streamViewRef}
        serverId={serverId}
        agentId={agentId}
        agent={effectiveAgent}
        routeBottomAnchorRequest={routeBottomAnchorRequest}
        hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
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
        agentInputDraft={agentInputDraft}
        onAttentionInputFocus={onAttentionInputFocus}
        onAttentionPromptSend={onAttentionPromptSend}
        onComposerHeightChange={handleComposerHeightChange}
        onMessageSent={handleMessageSent}
      />
    </RenderProfile>
  );
  const streamContent = (
    <ReanimatedAnimated.View style={animatedContentStyle}>{streamSection}</ReanimatedAnimated.View>
  );
  const contentContainer = (
    <View style={styles.contentContainer}>
      {streamContent}
      {hasSuggestedTasks ? (
        <SuggestedTasksOverlay rows={suggestedTaskRows} actions={suggestedTaskActions} />
      ) : null}
    </View>
  );

  return (
    <RewindComposerRestoreProvider text={agentInputDraft.text} setText={agentInputDraft.setText}>
      <View style={styles.root}>
        <FileDropZone style={styles.container} disabled={isArchivingCurrentAgent}>
          {contentContainer}

          {composerSection}

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
    </RewindComposerRestoreProvider>
  );
});

const AgentStreamSection = memo(function AgentStreamSection({
  streamViewRef,
  serverId,
  agentId,
  agent,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  toast,
  onOpenWorkspaceFile,
}: {
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  serverId: string;
  agentId?: string;
  agent: AgentScreenAgent;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  toast: ReturnType<typeof useToastHost>["api"];
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  // While this panel slot is hidden, the selector returns the frozen tail
  // reference instead of the live one, so background agents' 48ms stream
  // flushes never re-render this section at all (the store notification sees
  // an identical snapshot). When the panel becomes active again the context
  // flip re-renders this component and the selector closure reads the live
  // tail during that same render — reactive, not an imperative getState()
  // snapshot, so reactivation can't freeze on a stale value.
  const isPanelActive = useRetainedPanelActive();
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
  const streamItems = streamItemsRaw ?? EMPTY_STREAM_ITEMS;
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

  return (
    <AgentStreamView
      ref={streamViewRef}
      agentId={agent.id}
      serverId={serverId}
      agent={agent}
      streamItems={streamItems}
      pendingPermissions={pendingPermissions}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      isAuthoritativeHistoryReady={hasAppliedAuthoritativeHistory}
      toast={toast}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
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
  agentInputDraft,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onComposerHeightChange,
  onMessageSent,
}: {
  agentId?: string;
  serverId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  archivedAt: Date | null;
  cwd: string;
  isSubmitLoading: boolean;
  agentInputDraft: AgentInputDraft;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
}) {
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
    />
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
}) {
  const insets = useSafeAreaInsets();
  const isCompactFormFactor = useIsCompactFormFactor();
  const { onLayout: onInputAreaLayout, isBelow: isCompactComposerLayout } = useContainerWidthBelow(
    COMPACT_FORM_FACTOR_WIDTH,
    { initialIsBelow: isCompactFormFactor },
  );
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
    enabled: autoClearCompletedSubagents,
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
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd,
    workspaceId,
  });
  const attachmentScopeKeys = useMemo(
    () => [workspaceAttachmentScopeKey],
    [workspaceAttachmentScopeKey],
  );
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
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
      openFileExplorerForCheckout({
        checkout,
        isCompact: isCompactFormFactor,
      });
      setExplorerTabForCheckout({
        ...checkout,
        tab: "changes",
      });
    },
    [
      isCompactFormFactor,
      openFileExplorerForCheckout,
      paneContext,
      serverId,
      setExplorerTabForCheckout,
    ],
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
        // instantly rather than keep running orphaned — not just close their
        // tabs. previewListConfig's runningServers is the source of truth for
        // "is a server running", since a server can outlive its bound tab.
        // External ("ext:") servers are excluded: those are port-probed
        // processes the daemon never spawned (e.g. the user's own dev server —
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

  const inputAreaStyle = useMemo(
    () => [styles.inputAreaWrapper, { paddingBottom: insets.bottom }, composerKeyboardStyle],
    [insets.bottom, composerKeyboardStyle],
  );

  return (
    <ReanimatedAnimated.View style={inputAreaStyle} onLayout={onInputAreaLayout}>
      {/* Topmost card in the fanned stack (highest), yet painted first so it sits
          BEHIND every flyout below it and the composer — see RateLimitWarningTrack. */}
      {/* Mounted above the usage warning: highest in the fan, painted furthest
          back. Context health is important but never urgent, so it yields the
          position nearest the composer to the rate-limit strip. */}
      <ContextHealthTrack serverId={serverId} agentId={agentId} />
      <RateLimitWarningTrack serverId={serverId} agentId={agentId} />
      <SubagentsTrack
        rows={subagentRows}
        onOpenSubagent={handleOpenSubagent}
        onArchiveSubagent={handleArchiveSubagent}
        onStopSubagent={handleStopSubagent}
        onClearCompleted={handleClearCompletedSubagents}
        onDetachSubagent={canDetachSubagents ? handleDetachSubagent : undefined}
        clearedTokens={clearedSubagentTokens}
      />
      {hasBackgroundShellTasks ? (
        <BackgroundTasksTrack
          rows={backgroundTaskRows}
          onStopTask={handleStopBackgroundTask}
          onClearCompleted={handleClearCompletedBackgroundTasks}
        />
      ) : null}
      <Composer
        agentId={agentId}
        serverId={serverId}
        externalKeyboardShift
        isPaneFocused={isPaneFocused}
        value={agentInputDraft.text}
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
        isCompactLayout={isCompactComposerLayout}
      />
    </ReanimatedAnimated.View>
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
  if (isUnknownDaemon) {
    return (
      <View style={styles.container}>
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
    <View style={styles.container}>
      <View style={styles.centerState}>
        {isConnecting || isPreparingSession ? (
          <>
            <ActivityIndicator size="large" />
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

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

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
  inputAreaWrapper: {
    width: "100%",
    backgroundColor: theme.colors.surface0,
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
