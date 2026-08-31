import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import ReanimatedAnimated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import { useContainerHeight } from "@/hooks/use-container-height";
import invariant from "tiny-invariant";
import { Composer } from "@/composer";
import { ChatSeamFade } from "@/components/chat-seam-fade";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { ComposerImportPill } from "@/composer/draft/import-pill";
import { COMPOSER_PILL_CLEARANCE } from "@/composer/pill-styles";
import { AgentStreamView } from "@/agent-stream/view";
import {
  resolveBlackChatCanvasStyle,
  useBlackChatScope,
} from "@/components/black-chat-scope-context";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { useDraftAgentCreateFlow, type DraftCreateAttempt } from "@/composer/draft/create-flow";
import { resolveTurnPresentation, TURN_LIVENESS_IDLE } from "@/timeline/turn-liveness";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import type { SelectorProfile } from "@/components/combined-model-selector";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import type { Agent } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWakeWordAutoStartStore } from "@/stores/wake-word-auto-start-store";
import { useAgentControlCommandCenterActions } from "@/command-center/agent-control-registration";
import { encodeImages } from "@/utils/encode-images";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { shouldAutoFocusWorkspaceDraftComposer } from "@/screens/workspace/workspace-draft-pane-focus";
import {
  resolveAutoSubmitConfig,
  resolveDraftPersonality,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
  type DraftAutoSubmitConfig,
} from "@/composer/draft/workspace-tab-core";
import type { AgentCapabilityFlags } from "@otto-code/protocol/agent-types";
import type { AgentSnapshotPayload } from "@otto-code/protocol/messages";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  useDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { UserMessageImageAttachment } from "@/types/stream";
import { COMPACT_FORM_FACTOR_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { isWeb } from "@/constants/platform";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";
import { useSettings } from "@/hooks/use-settings";

const EMPTY_PENDING_PERMISSIONS = new Map();
const EMPTY_ONLINE_SERVER_IDS: string[] = [];
const DRAFT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

type AutoSubmitConfig = DraftAutoSubmitConfig;

function authoringArchitecturalViewDraftOption(
  draft: { viewId: string; draftId: string } | undefined,
): { architecturalViewDraft: { viewId: string; draftId: string } } | Record<string, never> {
  return draft ? { architecturalViewDraft: draft } : {};
}

// Reconcile the form's selected mode against the currently discovered modes.
// The mode picker displays modeOptions[0] when the stored mode isn't in the
// list (e.g. a globally-remembered "plan" that this workspace's OpenCode config
// no longer defines), so the submitted mode must match that display - otherwise
// we'd send a stale mode the provider rejects while the UI showed a valid one.
function reconcileSelectedMode(modeOptionIds: readonly string[], selectedMode: string): string {
  if (modeOptionIds.length === 0) {
    return "";
  }
  return modeOptionIds.includes(selectedMode) ? selectedMode : (modeOptionIds[0] ?? "");
}

function resolveDraftModeIdOverride(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  modeOptionIds: readonly string[];
  selectedMode: string;
}): { modeId: string } | Record<string, never> {
  const { autoSubmitConfig, modeOptionIds, selectedMode } = input;
  if (autoSubmitConfig?.modeId) {
    return { modeId: autoSubmitConfig.modeId };
  }
  const reconciled = reconcileSelectedMode(modeOptionIds, selectedMode);
  if (reconciled !== "") {
    return { modeId: reconciled };
  }
  return {};
}

function resolveDraftModeId(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  modeOptionIds: readonly string[];
  selectedMode: string;
}): string | null {
  const { autoSubmitConfig, modeOptionIds, selectedMode } = input;
  if (autoSubmitConfig?.modeId !== undefined) {
    return autoSubmitConfig.modeId;
  }
  const reconciled = reconcileSelectedMode(modeOptionIds, selectedMode);
  if (reconciled !== "") {
    return reconciled;
  }
  return null;
}

async function submitDraftCreateRequest(input: {
  attempt: { clientMessageId: string };
  text: string;
  images?: UserMessageImageAttachment[];
  attachments?: unknown;
  cwd: string;
  client: DaemonClient | null;
  workspaceDirectory: string | null;
  workspaceId: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  architecturalViewDraft?: { viewId: string; draftId: string };
  composerState: {
    selectedProvider: string | null;
    selectedMode: string;
    modeOptions: readonly { id: string }[];
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    featureValues: Record<string, unknown> | undefined;
    agentControls: {
      personality?: {
        selectedProfileId?: string | null;
        personalities?: SelectorProfile[];
      } | null;
    };
  };
  hostDisconnectedMessage: string;
  selectModelMessage: string;
}): Promise<{ agentId: string | null; result: AgentSnapshotPayload }> {
  const {
    attempt,
    text,
    images,
    attachments,
    cwd,
    client,
    workspaceDirectory,
    workspaceId,
    autoSubmitConfig,
    composerState,
  } = input;

  invariant(workspaceDirectory, "Workspace directory is required");
  invariant(workspaceId, "Workspace id is required");
  if (!client) {
    throw new Error(input.hostDisconnectedMessage);
  }

  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  const modeIdOverride = resolveDraftModeIdOverride({
    autoSubmitConfig,
    modeOptionIds: composerState.modeOptions.map((mode) => mode.id),
    selectedMode: composerState.selectedMode,
  });
  const config = buildWorkspaceDraftAgentConfig({
    provider,
    cwd,
    ...modeIdOverride,
    model: autoSubmitConfig?.model ?? (composerState.effectiveModelId || undefined),
    thinkingOptionId:
      autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || undefined),
    featureValues: autoSubmitConfig?.featureValues ?? composerState.featureValues,
  });

  const imagesData = await encodeImages(images);
  const attachmentsArray = Array.isArray(attachments) ? attachments : undefined;
  const draftPersonality = resolveDraftPersonality({
    autoSubmitConfig,
    agentControls: composerState.agentControls,
  });
  const result = await client.createAgent({
    config,
    workspaceId,
    ...(draftPersonality ? { personality: draftPersonality.id } : {}),
    ...(text ? { initialPrompt: text } : {}),
    clientMessageId: attempt.clientMessageId,
    ...(imagesData && imagesData.length > 0 ? { images: imagesData } : {}),
    ...(attachmentsArray && attachmentsArray.length > 0 ? { attachments: attachmentsArray } : {}),
    ...authoringArchitecturalViewDraftOption(input.architecturalViewDraft),
  });

  return {
    agentId: result.id,
    result,
  };
}

function buildDraftAgentSnapshot(input: {
  attempt: { timestamp: Date };
  serverId: string;
  tabId: string;
  workspaceDirectory: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  composerState: {
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    modeOptions: readonly { id: string }[];
    selectedMode: string;
    selectedProvider: string | null;
    agentControls: {
      features?: Agent["features"];
      personality?: {
        selectedProfileId?: string | null;
        personalities?: SelectorProfile[];
      } | null;
    };
  };
  selectModelMessage: string;
}): Agent {
  const { attempt, serverId, tabId, workspaceDirectory, autoSubmitConfig, composerState } = input;
  invariant(workspaceDirectory, "Workspace directory is required");
  const now = attempt.timestamp;
  const model = autoSubmitConfig?.model ?? (composerState.effectiveModelId || null);
  const thinkingOptionId =
    autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || null);
  const modeId = resolveDraftModeId({
    autoSubmitConfig,
    modeOptionIds: composerState.modeOptions.map((mode) => mode.id),
    selectedMode: composerState.selectedMode,
  });
  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  const draftPersonality = resolveDraftPersonality({
    autoSubmitConfig,
    agentControls: composerState.agentControls,
  });
  return {
    serverId,
    id: tabId,
    provider,
    personalitySpinner: draftPersonality?.spinner ?? null,
    status: "running",
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: DRAFT_CAPABILITIES,
    currentModeId: modeId,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: { provider, sessionId: null, model, modeId },
    title: "Agent",
    cwd: workspaceDirectory,
    model,
    features: composerState.agentControls.features,
    thinkingOptionId,
    parentAgentId: null,
    labels: {},
  };
}

function buildDraftInitialValues(input: {
  workingDir: string | null;
  initialSetup: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (!input.workingDir) {
    return undefined;
  }
  if (!input.initialSetup) {
    return { workingDir: input.workingDir };
  }
  return {
    workingDir: input.workingDir,
    provider: input.initialSetup.provider,
    modeId: input.initialSetup.modeId,
    model: input.initialSetup.model,
    thinkingOptionId: input.initialSetup.thinkingOptionId,
  };
}

function resolveDraftInitialPersonalityId(setup: WorkspaceDraftTabSetup | null): string | null {
  return setup?.personality ?? null;
}

function resolveDraftWorkingDirectory(input: {
  workspaceDirectory: string | null;
  initialSetup: WorkspaceDraftTabSetup | null;
}): string | null {
  if (input.initialSetup) {
    return input.initialSetup.cwd;
  }
  return input.workspaceDirectory;
}

function resolveOnlineServerIds(input: { isConnected: boolean; serverId: string }): string[] {
  if (!input.isConnected) {
    return EMPTY_ONLINE_SERVER_IDS;
  }
  return [input.serverId];
}

interface WorkspaceDraftAgentTabProps {
  serverId: string;
  workspaceId: string;
  tabId: string;
  draftId: string;
  initialSetup?: WorkspaceDraftTabSetup;
  architecturalViewDraft?: { viewId: string; draftId: string };
  isPaneFocused: boolean;
  onCreated: (snapshot: AgentSnapshotPayload) => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet?: () => void;
}

function resolveImportPillPress(
  onOpenImportSheet: (() => void) | undefined,
  isSubmitting: boolean,
): (() => void) | null {
  if (isSubmitting) {
    return null;
  }
  return onOpenImportSheet ?? null;
}

export function WorkspaceDraftAgentTab({
  serverId,
  workspaceId,
  tabId,
  draftId,
  initialSetup = undefined,
  architecturalViewDraft,
  isPaneFocused,
  onCreated,
  onOpenWorkspaceFile,
  onOpenImportSheet,
}: WorkspaceDraftAgentTabProps) {
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isBlackChat = useBlackChatScope();
  const insets = useSafeAreaInsets();
  const [pendingWakeWordAutoStart, setPendingWakeWordAutoStart] = useState(() =>
    useWakeWordAutoStartStore.getState().consumePending({ serverId, workspaceId, draftId }),
  );
  const handleAutoStartDictationConsumed = useCallback(() => {
    setPendingWakeWordAutoStart(null);
  }, []);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const workspaceFields = useWorkspaceFields(serverId, workspaceId, (w) => ({
    workspaceDirectory: w.workspaceDirectory,
    id: w.id,
  }));
  const workspaceDirectory = workspaceFields?.workspaceDirectory || null;
  const draftSetup = initialSetup ?? null;
  const draftWorkingDirectory = resolveDraftWorkingDirectory({
    workspaceDirectory,
    initialSetup: draftSetup,
  });
  const draftInitialValues = buildDraftInitialValues({
    workingDir: draftWorkingDirectory,
    initialSetup: draftSetup,
  });
  const onlineServerIds = resolveOnlineServerIds({ isConnected, serverId });
  const draftStoreKey = useMemo(
    () =>
      buildDraftStoreKey({
        serverId,
        agentId: tabId,
        draftId,
      }),
    [draftId, serverId, tabId],
  );
  const draftInput = useAgentInputDraft({
    draftKey: draftStoreKey,
    composer: {
      initialServerId: serverId,
      initialValues: draftInitialValues,
      initialFeatureValues: draftSetup?.featureValues,
      isVisible: true,
      onlineServerIds,
      lockedWorkingDir: draftWorkingDirectory ?? undefined,
      initialPersonalityId: resolveDraftInitialPersonalityId(draftSetup),
    },
  });
  const composerState = draftInput.composerState;
  if (!composerState) {
    throw new Error("Workspace draft composer state is required");
  }

  const draftProvider = composerState.selectedProvider;
  const draftProviderDefinitions = composerState.providerDefinitions;
  const draftThinkingOptions = composerState.availableThinkingOptions;
  const draftSelectedThinkingId = composerState.selectedThinkingOptionId;
  const draftSetThinkingOption = composerState.setThinkingOptionFromUser;
  const draftModeOptions = composerState.modeOptions;
  const draftSelectedMode = composerState.selectedMode;
  const draftSetMode = composerState.setModeFromUser;
  const draftFeatures = composerState.agentControls.features;
  const draftOnSetFeature = composerState.agentControls.onSetFeature;

  const clearDraftInput = draftInput.clear;
  const replaceDraftText = draftInput.replaceText;
  const setDraftAttachments = draftInput.setAttachments;
  const pendingAutoSubmit = useWorkspaceDraftSubmissionStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.workspaceId === workspaceId ? pending : null;
  });
  const pendingCreateAttempt = useCreateFlowStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.lifecycle === "active" ? pending : null;
  });
  const consumePendingAutoSubmit = useWorkspaceDraftSubmissionStore(
    (state) => state.consumePending,
  );
  const autoSubmitConfig = resolveAutoSubmitConfig(pendingAutoSubmit);
  const initialCreateAttempt = useMemo<DraftCreateAttempt | null>(() => {
    if (!pendingAutoSubmit || !pendingCreateAttempt) {
      return null;
    }
    if (pendingAutoSubmit.clientMessageId !== pendingCreateAttempt.clientMessageId) {
      return null;
    }
    return {
      clientMessageId: pendingCreateAttempt.clientMessageId,
      text: pendingCreateAttempt.text,
      timestamp: new Date(pendingCreateAttempt.timestamp),
      ...(pendingCreateAttempt.images && pendingCreateAttempt.images.length > 0
        ? { images: pendingCreateAttempt.images }
        : {}),
      ...(pendingCreateAttempt.attachments && pendingCreateAttempt.attachments.length > 0
        ? { attachments: pendingCreateAttempt.attachments }
        : {}),
    };
  }, [pendingAutoSubmit, pendingCreateAttempt]);
  const allowsEmptyAutoSubmit = pendingAutoSubmit?.allowEmptyText === true;
  // The composer row degrades one control at a time from its own measurements
  // (see composer/input/toolbar-stage.ts), so pane width must not flip the whole
  // control group to the mobile surface at a 500px cliff. Only a real compact
  // form factor selects that branch now.
  const { onLayout: onInputAreaLayout } = useContainerWidthBelow(COMPACT_FORM_FACTOR_WIDTH, {
    initialIsBelow: isCompactFormFactor,
  });
  // The tab, not the window, is what the composer has to fit inside - measured
  // on the outermost box, whose height its own parent owns, so a growing
  // composer can never feed back into it.
  const { onLayout: onTabLayout, height: tabHeight } = useContainerHeight();
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd: composerState.workingDir,
    workspaceId,
  });
  const draftAttachmentScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const attachmentScopeKeys = useMemo(
    () => [draftAttachmentScopeKey, workspaceAttachmentScopeKey].filter(Boolean),
    [draftAttachmentScopeKey, workspaceAttachmentScopeKey],
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind !== "review") {
        return;
      }
      openPreferredWorkspaceTarget({
        isCompact: isCompactFormFactor,
        workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? "" }),
        target: { kind: "working_diff" },
        source: "changesLinks",
        preferences: openInSidePane,
      });
    },
    [isCompactFormFactor, openInSidePane, serverId, workspaceId],
  );

  const {
    formErrorMessage,
    isSubmitting,
    submittedStreamItems,
    pendingMessageSubmissions,
    draftAgent,
    handleCreateFromInput,
    continueCreateFromAttempt,
  } = useDraftAgentCreateFlow<Agent, AgentSnapshotPayload>({
    draftId,
    getPendingServerId: () => serverId,
    initialAttempt: initialCreateAttempt,
    allowEmptyText: allowsEmptyAutoSubmit,
    validateBeforeSubmit: ({ text, attachments }) => {
      const allowsEmptyDraftText = shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit,
        attachments,
      });
      return validateDraftSubmission({
        text,
        allowsEmptyAutoSubmit: allowsEmptyDraftText,
        composerState,
        autoSubmitConfig,
        workspaceDirectory: draftWorkingDirectory,
        hasClient: Boolean(client),
      });
    },
    onBeforeSubmit: async () => {
      await composerState.persistFormPreferences();
      if (isWeb) {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      Keyboard.dismiss();
    },
    buildDraftAgent: (attempt) =>
      buildDraftAgentSnapshot({
        attempt,
        serverId,
        tabId,
        workspaceDirectory: draftWorkingDirectory,
        autoSubmitConfig,
        composerState,
        selectModelMessage: t("workspaceSetup.errors.selectModel"),
      }),
    createRequest: async ({ attempt, text, images, attachments, cwd }) =>
      submitDraftCreateRequest({
        attempt,
        text,
        images,
        attachments,
        cwd,
        client,
        workspaceDirectory: draftWorkingDirectory,
        workspaceId: workspaceFields?.id ?? null,
        autoSubmitConfig,
        ...authoringArchitecturalViewDraftOption(architecturalViewDraft),
        composerState,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
        selectModelMessage: t("workspaceSetup.errors.selectModel"),
      }),
    onCreateSuccess: ({ result }) => {
      clearDraftInput("sent");
      clearWorkspaceAttachments({ scopeKey: draftAttachmentScopeKey });
      useWorkspaceDraftSubmissionStore.getState().clearDraftSetup({ draftId });
      onCreated(result);
    },
  });
  const turnPresentation = useMemo(
    () => resolveTurnPresentation(TURN_LIVENESS_IDLE, pendingMessageSubmissions.length > 0),
    [pendingMessageSubmissions],
  );
  useAgentControlCommandCenterActions({
    sourceId: `draft:${serverId}:${tabId}`,
    enabled: isPaneFocused && !isSubmitting,
    controls: {
      serverId,
      ownerKey: tabId,
      provider: draftProvider,
      providerDefinitions: draftProviderDefinitions,
      models: {
        providers: composerState.modelSelectorProviders,
        selectedProvider: draftProvider,
        selectedModelId: composerState.effectiveModelId,
        select: composerState.setProviderAndModelFromUser,
      },
      thinking: {
        options: draftThinkingOptions,
        selectedId: draftSelectedThinkingId,
        select: draftSetThinkingOption,
      },
      modes: {
        options: draftModeOptions,
        selectedId: draftSelectedMode,
        select: draftSetMode,
      },
      features: {
        list: draftFeatures,
        set: draftOnSetFeature,
      },
    },
  });
  const isReadyForPendingAutoSubmit = Boolean(
    pendingAutoSubmit &&
    draftInput.isHydrated &&
    draftWorkingDirectory &&
    client &&
    !composerState.isModelLoading,
  );
  const autoSubmitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReadyForPendingAutoSubmit) {
      return;
    }
    const submitKey = `${serverId}:${workspaceId}:${draftId}`;
    if (autoSubmitKeyRef.current === submitKey) {
      return;
    }
    const submission = consumePendingAutoSubmit({ serverId, workspaceId, draftId });
    if (!submission) {
      return;
    }
    autoSubmitKeyRef.current = submitKey;
    replaceDraftText("");
    setDraftAttachments([]);
    const preparedAttempt =
      initialCreateAttempt?.clientMessageId === submission.clientMessageId
        ? initialCreateAttempt
        : null;
    const createPromise = preparedAttempt
      ? continueCreateFromAttempt({
          attempt: preparedAttempt,
          cwd: submission.cwd,
        })
      : handleCreateFromInput({
          text: submission.text,
          attachments: submission.attachments,
          cwd: submission.cwd,
        });
    void createPromise.catch(() => {
      replaceDraftText(submission.text);
      setDraftAttachments(composerWorkspaceAttachment.userAttachmentsOnly(submission.attachments));
      autoSubmitKeyRef.current = null;
    });
  }, [
    continueCreateFromAttempt,
    consumePendingAutoSubmit,
    draftId,
    handleCreateFromInput,
    initialCreateAttempt,
    isReadyForPendingAutoSubmit,
    serverId,
    setDraftAttachments,
    replaceDraftText,
    workspaceId,
  ]);

  const focusInputRef = useRef<(() => void) | null>(null);

  const handleFocusInputCallback = useCallback((focus: () => void) => {
    focusInputRef.current = focus;
  }, []);

  const { style: composerKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

  const inputAreaWrapperStyle = useMemo(
    () => [
      animatedStaticStyles.inputAreaWrapper,
      { paddingBottom: insets.bottom },
      composerKeyboardStyle,
    ],
    [insets.bottom, composerKeyboardStyle],
  );

  const handleDropdownCloseFocus = useCallback(() => {
    focusInputRef.current?.();
  }, []);
  const importPillPress = resolveImportPillPress(onOpenImportSheet, isSubmitting);
  const composerAgentControls = useMemo(
    () => ({
      ...composerState.agentControls,
      onDropdownClose: handleDropdownCloseFocus,
      disabled: isSubmitting,
    }),
    [composerState.agentControls, handleDropdownCloseFocus, isSubmitting],
  );
  return (
    <FileDropZone
      style={[styles.container, resolveBlackChatCanvasStyle(isBlackChat)]}
      onLayout={onTabLayout}
    >
      <View style={styles.contentContainer}>
        {isSubmitting && draftAgent ? (
          <View style={styles.streamContainer}>
            <AgentStreamView
              agentId={tabId}
              serverId={serverId}
              context={draftAgent}
              streamItems={submittedStreamItems}
              pendingMessageSubmissions={pendingMessageSubmissions}
              turnPresentation={turnPresentation}
              pendingPermissions={EMPTY_PENDING_PERMISSIONS}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.configScrollContent}>
            <View style={styles.configSection}>
              {formErrorMessage ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{formErrorMessage}</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        )}
        {/* The stream branch's AgentStreamView carries its own seam fades;
            rendering another here would double-stack the gradient. */}
        {isSubmitting && draftAgent ? null : <ChatSeamFade edge="top" />}
      </View>

      <ReanimatedAnimated.View style={inputAreaWrapperStyle} onLayout={onInputAreaLayout}>
        {importPillPress ? (
          <View style={styles.importPillRow}>
            <ChatWidthBounds style={styles.importPillContent}>
              <ComposerImportPill onPress={importPillPress} />
            </ChatWidthBounds>
          </View>
        ) : null}
        <Composer
          agentId={tabId}
          serverId={serverId}
          workspaceId={workspaceId}
          externalKeyboardShift
          isPaneFocused={isPaneFocused}
          autoStartDictation={pendingWakeWordAutoStart}
          onAutoStartDictationConsumed={handleAutoStartDictationConsumed}
          onSubmitMessage={handleCreateFromInput}
          isSubmitLoading={isSubmitting}
          blurOnSubmit={true}
          value={draftInput.text}
          onChangeText={draftInput.editText}
          textReplacementKey={draftInput.textReplacementKey}
          attachments={draftInput.attachments}
          attachmentScopeKeys={attachmentScopeKeys}
          attachmentWriteScopeKey={workspaceAttachmentScopeKey}
          onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
          onChangeAttachments={draftInput.setAttachments}
          cwd={composerState.workingDir}
          clearDraft={draftInput.clear}
          autoFocus={shouldAutoFocusWorkspaceDraftComposer({ isPaneFocused, isSubmitting })}
          autoFocusKey={String(draftInput.attachmentFocusRequestId)}
          onFocusInput={handleFocusInputCallback}
          commandDraftConfig={composerState.commandDraftConfig}
          agentControls={composerAgentControls}
          viewportHeight={tabHeight}
        />
      </ReanimatedAnimated.View>
    </FileDropZone>
  );
}

const animatedStaticStyles = RNStyleSheet.create({
  inputAreaWrapper: {
    width: "100%",
  },
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    width: "100%",
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    flex: 1,
  },
  streamContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  configScrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  configSection: {
    gap: theme.spacing[3],
  },
  importPillRow: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    paddingTop: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
    paddingBottom: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
    alignItems: "center",
  },
  importPillContent: {
    width: "100%",
    flexDirection: "row",
  },
  errorContainer: {
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  errorText: {
    color: theme.colors.destructive,
  },
}));
