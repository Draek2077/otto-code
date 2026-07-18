import {
  View,
  Pressable,
  Text,
  ActivityIndicator,
  Keyboard,
  type PressableStateCallbackType,
} from "react-native";
import type { TFunction } from "i18next";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShallow } from "zustand/shallow";
import {
  ArrowUp,
  Stop,
  Pencil,
  AudioLines,
  CircleDot,
  FileText,
  Folder,
  GitPullRequest,
  Github,
  Image as ImageIcon,
  UploadFile,
} from "@/components/icons/material-icons";
import Animated from "react-native-reanimated";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import {
  AgentControls,
  DraftAgentControls,
  type DraftAgentControlsProps,
} from "@/composer/agent-controls";
import { ContextWindowMeter } from "@/components/context-window-meter";
import { useCachedContextWindowUsage } from "@/hooks/use-cached-context-window-usage";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useFilePicker } from "@/hooks/use-file-picker";
import { useFileDrop } from "@/components/file-drop/use-file-drop";
import type { DroppedItem } from "@/components/file-drop/types";
import { MessageInput, type MessageInputRef, type AttachmentMenuItem } from "./input/input";
import type { ImageAttachment, MessagePayload } from "./types";
import { compactUp, type Theme, useIconSize } from "@/styles/theme";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import { encodeImages } from "@/utils/encode-images";
import { focusWithRetries } from "@/utils/web-focus";
import {
  cancelComposerAgent,
  dispatchComposerAgentMessage,
  editQueuedComposerMessage,
  findGithubItemByOption,
  isAttachmentSelectedForGithubItem,
  openComposerAttachment,
  pickAndPersistImages,
  queueComposerMessage,
  removeComposerAttachmentAtIndex,
  sendQueuedComposerMessageNow,
  toggleGithubAttachmentFromPicker,
  uploadFileAttachments,
  type AgentStreamWriter,
  type QueueWriter,
  type QueuedComposerMessage,
} from "@/composer/actions";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { AutocompletePopover } from "@/components/ui/autocomplete-popover";
import { useAgentAutocomplete } from "@/hooks/use-agent-autocomplete";
import {
  useHostRuntimeAgentDirectoryStatus,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import {
  deleteAttachments,
  persistAttachmentFromBlob,
  persistAttachmentFromFileUri,
} from "@/attachments/service";
import { resolveAgentControlsMode } from "@/composer/agent-controls/mode";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { submitAgentInput } from "@/composer/submit";
import { confirmInterruptWithLiveSubagents } from "@/components/interrupt-subagents-warning";
import { ComposerKeyboardScopeProvider } from "@/composer/keyboard-scope";
import { useAppSettings } from "@/hooks/use-settings";
import { isWeb, isNative } from "@/constants/platform";
import type { AgentRateLimitInfo, GitHubSearchItem } from "@otto-code/protocol/messages";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import type { PickedFile } from "@/attachments/picked-file";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import {
  useWorkspaceAttachmentsForScopes,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { useDirectorySearchQuery } from "@/hooks/use-directory-search-query";
import { droppedItemsToPickedFiles } from "@/composer/attachments/drop";
import { getFileTypeLabel } from "@/attachments/file-types";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { AttachmentLabel, AttachmentPill, AttachmentThumbnail } from "@/components/attachment-pill";
import { AttachmentLightbox } from "@/components/attachment-lightbox";
import { openLink } from "@/utils/open-link";
import { useIsDictationReady } from "@/hooks/use-is-dictation-ready";
import { useGithubSearchQuery, useHostingSearchFeature } from "@/git/use-github-search-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useComposerGithubAutoAttach } from "./github/auto-attach";
import { resolveClientSlashCommand, type ClientSlashCommand } from "@/client-slash-commands";

type QueuedMessage = QueuedComposerMessage;

type AttachmentListUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

const EMPTY_ATTACHMENT_SCOPE_KEYS: readonly string[] = [];
const EMPTY_FOLDER_SEARCH_PATHS: readonly string[] = [];

function noop() {}
const noopCallback = () => {};

function resolveComposerButtonIconSize(iconSize: Theme["iconSize"]): number {
  return isWeb ? iconSize.md : iconSize.lg;
}

function resolveIsComposerLocked(
  submitBehavior: "clear" | "preserve-and-lock",
  isSubmitLoading: boolean,
): boolean {
  return submitBehavior === "preserve-and-lock" && isSubmitLoading;
}

function resolveIsVoiceModeForAgent(
  voice: ReturnType<typeof useVoiceOptional>,
  serverId: string,
  agentId: string,
): boolean {
  return voice?.isVoiceModeForAgent(serverId, agentId) ?? false;
}

function resolveKeyboardPriority(isMessageInputFocused: boolean): number {
  return isMessageInputFocused ? 200 : 100;
}

function resolveIsDesktopWebBreakpoint(isMobile: boolean): boolean {
  return isWeb && !isMobile;
}

function resolveCompactLayout(override: boolean | undefined, formFactor: boolean): boolean {
  return override ?? formFactor;
}

function resolveMessagePlaceholder(isDesktopWebBreakpoint: boolean, t: TFunction): string {
  return isDesktopWebBreakpoint
    ? t("composer.placeholders.desktop")
    : t("composer.placeholders.mobile");
}

function resolvePickerSearchEnabled(
  isPickerOpen: boolean,
  isConnected: boolean,
  cwd: string,
): boolean {
  return isPickerOpen && isConnected && cwd.trim().length > 0;
}

function resolveCheckoutRemoteUrl(
  checkoutStatus: ReturnType<typeof useCheckoutStatusQuery>["status"],
): string | null {
  return checkoutStatus?.remoteUrl ?? null;
}

function buildCancelButtonStyle(isConnected: boolean, isCancellingAgent: boolean): object[] {
  const disabled = !isConnected || isCancellingAgent ? styles.buttonDisabled : undefined;
  return [styles.cancelButton, disabled].filter((value): value is object => Boolean(value));
}

function buildRealtimeVoiceButtonStyle(
  hovered: boolean | undefined,
  voiceButtonDisabled: boolean,
): object[] {
  const hoveredStyle = hovered ? styles.iconButtonHovered : undefined;
  const disabledStyle = voiceButtonDisabled ? styles.buttonDisabled : undefined;
  return [styles.realtimeVoiceButton, hoveredStyle, disabledStyle].filter(
    (value): value is object => Boolean(value),
  );
}

function pickAgentUsageFields(lastUsage: Agent["lastUsage"] | undefined) {
  return {
    contextWindowMaxTokens: lastUsage?.contextWindowMaxTokens ?? null,
    contextWindowUsedTokens: lastUsage?.contextWindowUsedTokens ?? null,
    totalCostUsd: lastUsage?.totalCostUsd ?? null,
  };
}

function buildAgentStateSelector(serverId: string, agentId: string) {
  return (state: ReturnType<typeof useSessionStore.getState>) => {
    const agent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
    return {
      status: agent?.status ?? null,
      model: agent?.model ?? null,
      provider: agent?.provider ?? null,
    };
  };
}

function buildAgentUsageSelector(serverId: string, agentId: string) {
  return (state: ReturnType<typeof useSessionStore.getState>) =>
    pickAgentUsageFields(state.sessions[serverId]?.agents?.get(agentId)?.lastUsage);
}

interface ComposerContextWindowMeterProps {
  serverId: string;
  agentId: string;
  provider: string | null;
}

// Owns the usage-field store subscription so streaming usage patches re-render
// only this meter, not the whole Composer (which would contend with keystroke
// renders while an agent turn is streaming).
function ComposerContextWindowMeter({
  serverId,
  agentId,
  provider,
}: ComposerContextWindowMeterProps): ReactElement {
  const usage = useSessionStore(useShallow(buildAgentUsageSelector(serverId, agentId)));
  const liveContextWindowValues = resolveContextWindowValues(
    usage.contextWindowMaxTokens,
    usage.contextWindowUsedTokens,
  );
  const contextWindowUsage = useCachedContextWindowUsage(serverId, agentId, {
    maxTokens: liveContextWindowValues.contextWindowMaxTokens,
    usedTokens: liveContextWindowValues.contextWindowUsedTokens,
    totalCostUsd: usage.totalCostUsd,
  });
  return (
    <ContextWindowMeter
      maxTokens={contextWindowUsage.maxTokens}
      usedTokens={contextWindowUsage.usedTokens}
      totalCostUsd={contextWindowUsage.totalCostUsd}
      serverId={serverId}
      agentId={agentId}
      provider={provider}
    />
  );
}

interface RenderLeftContentArgs {
  agentControls: DraftAgentControlsProps | undefined;
  agentId: string;
  serverId: string;
  focusInput: () => void;
  isCompactLayout: boolean;
  onPersonalitySwitchingChange: (switching: boolean) => void;
}

function renderLeftContent(args: RenderLeftContentArgs): ReactElement {
  const { agentControls, agentId, serverId, focusInput, isCompactLayout } = args;
  if (resolveAgentControlsMode(agentControls) === "draft" && agentControls) {
    return <DraftAgentControls {...agentControls} isCompactLayout={isCompactLayout} />;
  }
  return (
    <AgentControls
      agentId={agentId}
      serverId={serverId}
      onDropdownClose={focusInput}
      isCompactLayout={isCompactLayout}
      onPersonalitySwitchingChange={args.onPersonalitySwitchingChange}
    />
  );
}

interface RenderAttachmentTrayArgs {
  selectedAttachments: ComposerAttachment[];
  isComposerLocked: boolean;
  handleOpenAttachment: (attachment: ComposerAttachment) => void;
  handleRemoveAttachment: (index: number) => void;
  labels: {
    openImage: string;
    removeImage: string;
    removeFile: string;
    openGithub: (kind: string, number: number) => string;
    removeGithub: (kind: string, number: number) => string;
  };
}

function renderComposerFooter(footer: ReactNode, footerRight: ReactNode): ReactElement | null {
  if (!footer && !footerRight) return null;
  return (
    <View style={styles.footer}>
      <ChatWidthBounds style={styles.footerContent}>
        <View style={styles.footerLeft}>{footer}</View>
        <View style={styles.footerRight}>{footerRight}</View>
      </ChatWidthBounds>
    </View>
  );
}

function renderAttachmentTray(args: RenderAttachmentTrayArgs): ReactElement | null {
  const {
    selectedAttachments,
    isComposerLocked,
    handleOpenAttachment,
    handleRemoveAttachment,
    labels,
  } = args;
  if (selectedAttachments.length === 0) return null;
  return (
    <View style={styles.attachmentTray} testID="composer-attachment-tray">
      {selectedAttachments.map((attachment, index) =>
        renderComposerAttachmentPill({
          attachment,
          index,
          disabled: isComposerLocked,
          onOpen: handleOpenAttachment,
          onRemove: handleRemoveAttachment,
          labels,
        }),
      )}
    </View>
  );
}

interface RenderQueueTrackArgs {
  queuedMessages: readonly QueuedMessage[];
  handleEditQueuedMessage: (id: string) => void;
  handleSendQueuedNow: (id: string) => Promise<void>;
  editLabel: string;
  sendNowLabel: string;
}

function renderQueueTrack(args: RenderQueueTrackArgs): ReactElement | null {
  const { queuedMessages, handleEditQueuedMessage, handleSendQueuedNow, editLabel, sendNowLabel } =
    args;
  if (queuedMessages.length === 0) return null;
  return (
    <View style={styles.queueTrack}>
      {queuedMessages.map((item) => (
        <QueuedMessageRow
          key={item.id}
          item={item}
          onEdit={handleEditQueuedMessage}
          onSendNow={handleSendQueuedNow}
          editLabel={editLabel}
          sendNowLabel={sendNowLabel}
        />
      ))}
    </View>
  );
}

interface RenderComposerAttachmentPillArgs {
  attachment: ComposerAttachment;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
  labels: RenderAttachmentTrayArgs["labels"];
}

function renderComposerAttachmentPill(args: RenderComposerAttachmentPillArgs): ReactElement {
  const { attachment, index, disabled, onOpen, onRemove, labels } = args;
  if (attachment.kind === "image") {
    return (
      <ImageAttachmentPill
        key={attachment.metadata.id}
        attachment={attachment}
        index={index}
        disabled={disabled}
        onOpen={onOpen}
        onRemove={onRemove}
        openLabel={labels.openImage}
        removeLabel={labels.removeImage}
      />
    );
  }
  if (attachment.kind === "file") {
    return (
      <FileAttachmentPill
        key={attachment.attachment.id}
        attachment={attachment}
        index={index}
        disabled={disabled}
        onRemove={onRemove}
        removeLabel={labels.removeFile}
      />
    );
  }
  if (composerWorkspaceAttachment.is(attachment)) {
    return composerWorkspaceAttachment.renderPill({
      attachment,
      index,
      disabled,
      onOpen,
      onRemove,
    });
  }
  return (
    <GithubAttachmentPill
      key={`${attachment.item.kind}:${attachment.item.number}`}
      attachment={attachment}
      index={index}
      disabled={disabled}
      onOpen={onOpen}
      onRemove={onRemove}
      openLabel={labels.openGithub}
      removeLabel={labels.removeGithub}
    />
  );
}

function resolveVoiceStartErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

interface AttemptStartRealtimeVoiceArgs {
  voice: ReturnType<typeof useVoiceOptional>;
  isConnected: boolean;
  hasAgent: boolean;
  serverId: string;
  agentId: string;
  toastErrorRef: { current: (message: string) => void };
}

function attemptStartRealtimeVoice(args: AttemptStartRealtimeVoiceArgs): void {
  const { voice, isConnected, hasAgent, serverId, agentId, toastErrorRef } = args;
  if (!voice || !isConnected || !hasAgent) return;
  if (voice.isVoiceSwitching) return;
  if (voice.isVoiceModeForAgent(serverId, agentId)) return;
  void voice.startVoice(serverId, agentId).catch((error) => {
    console.error("[Composer] Failed to start voice mode", error);
    const message = resolveVoiceStartErrorMessage(error);
    if (message && message.trim().length > 0) {
      toastErrorRef.current(message);
    }
  });
}

function focusMessageInputWithPlatformStrategy(messageInputRef: {
  current: MessageInputRef | null;
}): void {
  if (isNative) {
    messageInputRef.current?.focus();
    return;
  }
  focusWithRetries({
    focus: () => messageInputRef.current?.focus(),
    isFocused: () => {
      const el = messageInputRef.current?.getNativeElement?.() ?? null;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      return Boolean(el) && active === el;
    },
  });
}

interface DispatchComposerKeyboardActionArgs {
  action: KeyboardActionDefinition;
  isPaneFocused: boolean;
  messageInputRef: { current: MessageInputRef | null };
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
  handleCancelAgent: () => void;
  focusMessageInputForKeyboardAction: () => void;
  hasComposerText: boolean;
  clearComposerText: () => void;
}

function dispatchComposerKeyboardAction(args: DispatchComposerKeyboardActionArgs): boolean {
  const {
    action,
    isPaneFocused,
    messageInputRef,
    isAgentRunning,
    isCancellingAgent,
    isConnected,
    handleCancelAgent,
    focusMessageInputForKeyboardAction,
    hasComposerText,
    clearComposerText,
  } = args;
  if (!isPaneFocused) return false;

  if (action.id === "agent.interrupt") {
    // Escape clears a typed message first; only a second Escape (empty box) begins
    // cancelling anything (dictation, then the running agent).
    if (hasComposerText) {
      clearComposerText();
      return true;
    }
    if (messageInputRef.current?.runKeyboardAction("dictation-cancel")) return true;
    if (!isAgentRunning || isCancellingAgent || !isConnected) return false;
    handleCancelAgent();
    return true;
  }

  if (action.id === "message-input.focus") {
    focusMessageInputForKeyboardAction();
    return true;
  }

  const passthroughAction = resolveMessageInputPassthroughAction(action.id);
  if (!passthroughAction) return false;
  const result = messageInputRef.current?.runKeyboardAction(passthroughAction);
  if (passthroughAction === "send" || passthroughAction === "dictation-confirm") {
    return result ?? false;
  }
  return true;
}

function resolveMessageInputPassthroughAction(
  actionId: string,
): MessageInputKeyboardActionKind | null {
  switch (actionId) {
    case "message-input.send":
      return "send";
    case "message-input.dictation-confirm":
      return "dictation-confirm";
    case "message-input.dictation-toggle":
      return "dictation-toggle";
    case "message-input.dictation-cancel":
      return "dictation-cancel";
    case "message-input.voice-toggle":
      return "voice-toggle";
    case "message-input.voice-mute-toggle":
      return "voice-mute-toggle";
    default:
      return null;
  }
}

interface QueuedMessageRowProps {
  item: QueuedMessage;
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
  editLabel: string;
  sendNowLabel: string;
}

function QueuedMessageRow({
  item,
  onEdit,
  onSendNow,
  editLabel,
  sendNowLabel,
}: QueuedMessageRowProps) {
  const iconSize = useIconSize();
  const handleEdit = useCallback(() => {
    onEdit(item.id);
  }, [onEdit, item.id]);
  const handleSendNow = useCallback(() => {
    onSendNow(item.id);
  }, [onSendNow, item.id]);
  return (
    <View style={styles.queueItem}>
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        <Pressable
          onPress={handleEdit}
          style={styles.queueActionButton}
          accessibilityLabel={editLabel}
          accessibilityRole="button"
        >
          <ThemedPencil size={iconSize.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        <Pressable
          onPress={handleSendNow}
          style={QUEUE_SEND_BUTTON_STYLE}
          accessibilityLabel={sendNowLabel}
          accessibilityRole="button"
        >
          <ThemedArrowUp size={iconSize.sm} uniProps={iconAccentForegroundMapping} />
        </Pressable>
      </View>
    </View>
  );
}

interface ImageAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "image" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
  openLabel: string;
  removeLabel: string;
}

function ImageAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
  openLabel,
  removeLabel,
}: ImageAttachmentPillProps) {
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-image-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={openLabel}
      removeAccessibilityLabel={removeLabel}
      disabled={disabled}
    >
      <AttachmentThumbnail metadata={attachment.metadata} />
    </AttachmentPill>
  );
}

interface GithubAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "github_pr" | "github_issue" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
  openLabel: (kind: string, number: number) => string;
  removeLabel: (kind: string, number: number) => string;
}

function GithubAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
  openLabel,
  removeLabel,
}: GithubAttachmentPillProps) {
  const item = attachment.item;
  const kindLabel = item.kind === "pr" ? "PR" : "issue";
  const iconSize = useIconSize();
  const icon = useMemo(
    () =>
      item.kind === "pr" ? (
        <ThemedGitPullRequest size={iconSize.sm} uniProps={iconForegroundMutedMapping} />
      ) : (
        <ThemedCircleDot size={iconSize.sm} uniProps={iconForegroundMutedMapping} />
      ),
    [item.kind, iconSize.sm],
  );
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-github-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={openLabel(kindLabel, item.number)}
      removeAccessibilityLabel={removeLabel(kindLabel, item.number)}
      disabled={disabled}
    >
      <AttachmentLabel
        icon={icon}
        title={item.title}
        subtitle={`${item.kind === "pr" ? "PR" : "Issue"} #${item.number}`}
      />
    </AttachmentPill>
  );
}

interface FileAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "file" }>;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
  removeLabel: string;
}

function FileAttachmentPill({
  attachment,
  index,
  disabled,
  onRemove,
  removeLabel,
}: FileAttachmentPillProps) {
  const { t } = useTranslation();
  const iconSize = useIconSize();
  const icon = useMemo(
    () => <ThemedFileText size={iconSize.sm} uniProps={iconForegroundMutedMapping} />,
    [iconSize.sm],
  );
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  const fileName = attachment.attachment.fileName;
  return (
    <AttachmentPill
      testID="composer-file-attachment-pill"
      onOpen={noopCallback}
      onRemove={handleRemove}
      openAccessibilityLabel={fileName}
      removeAccessibilityLabel={removeLabel}
      disabled={disabled}
    >
      <AttachmentLabel
        icon={icon}
        title={fileName}
        subtitle={getFileTypeLabel(fileName) ?? t("message.attachments.file")}
      />
    </AttachmentPill>
  );
}

interface GithubPickerOptionProps {
  label: string;
  testID: string;
  active: boolean;
  selected: boolean;
  item: GitHubSearchItem;
  onToggle: (item: GitHubSearchItem) => void;
}

function GithubPickerOption({
  label,
  testID,
  active,
  selected,
  item,
  onToggle,
}: GithubPickerOptionProps) {
  const iconSize = useIconSize();
  const handlePress = useCallback(() => {
    onToggle(item);
  }, [onToggle, item]);
  const leadingSlot = useMemo(
    () =>
      item.kind === "pr" ? (
        <ThemedGitPullRequest size={iconSize.sm} uniProps={iconForegroundMutedMapping} />
      ) : (
        <ThemedCircleDot size={iconSize.sm} uniProps={iconForegroundMutedMapping} />
      ),
    [item.kind, iconSize.sm],
  );
  return (
    <ComboboxItem
      testID={testID}
      label={label}
      selected={selected}
      active={active}
      onPress={handlePress}
      leadingSlot={leadingSlot}
    />
  );
}

interface ComposerProps {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  onSubmitMessage?: (payload: MessagePayload) => Promise<void>;
  onClientSlashCommand?: (command: ClientSlashCommand) => Promise<void>;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the composer can submit even with no text or attachments. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  /** Optional testID for the primary submit button. */
  submitButtonTestID?: string;
  submitIcon?: "arrow" | "return";
  /** Externally controlled loading state. When true, disables the submit button. */
  isSubmitLoading?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  /** When true, blurs the input immediately when submitting. */
  blurOnSubmit?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  attachments: UserComposerAttachment[];
  attachmentScopeKeys?: readonly string[];
  /** Scope key new workspace attachments (e.g. a folder added from the attach menu) are written to. Defaults to the first entry of `attachmentScopeKeys`. */
  attachmentWriteScopeKey?: string;
  onOpenWorkspaceAttachment?: (attachment: WorkspaceComposerAttachment) => void;
  onChangeAttachments: (updater: AttachmentListUpdater) => void;
  cwd: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  /** When true, auto-focuses the text input on web. */
  autoFocus?: boolean;
  /** Callback to expose a focus function to parent components (desktop only). */
  onFocusInput?: (focus: () => void) => void;
  /** Optional draft context for listing commands before an agent exists. */
  commandDraftConfig?: DraftCommandConfig;
  /** Called when a message is about to be sent (any path: keyboard, dictation, queued). */
  onMessageSent?: () => void;
  onComposerHeightChange?: (height: number) => void;
  onAttentionInputFocus?: () => void;
  onAttentionPromptSend?: () => void;
  /** Controlled agent controls rendered in input area (draft flows). */
  agentControls?: DraftAgentControlsProps;
  /** Extra styles merged onto the message input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Rendered below the input, inside the keyboard-shifted container. */
  footer?: ReactNode;
  /** When true, a parent wrapper owns the keyboard shift, so the composer skips its own. */
  externalKeyboardShift?: boolean;
  /** Optional panel/container layout breakpoint. Defaults to the screen breakpoint. */
  isCompactLayout?: boolean;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const EMPTY_ARRAY: readonly QueuedMessage[] = [];
const StableMessageInput = memo(MessageInput);

function resolveContextWindowValues(
  rawMax: number | null,
  rawUsed: number | null,
): { contextWindowMaxTokens: number | null; contextWindowUsedTokens: number | null } {
  if (typeof rawMax === "number" && typeof rawUsed === "number") {
    return { contextWindowMaxTokens: rawMax, contextWindowUsedTokens: rawUsed };
  }
  return { contextWindowMaxTokens: null, contextWindowUsedTokens: null };
}

interface ComposerCancelButtonProps {
  buttonIconSize: number;
  cancelButtonStyle: (object | undefined)[];
  handleCancelAgent: () => void;
  isConnected: boolean;
  isCancellingAgent: boolean;
  agentInterruptKeys: ReturnType<typeof useShortcutKeys>;
  t: TFunction;
}

function ComposerCancelButton({
  buttonIconSize,
  cancelButtonStyle,
  handleCancelAgent,
  isConnected,
  isCancellingAgent,
  agentInterruptKeys,
  t,
}: ComposerCancelButtonProps) {
  const accessibilityLabel = isCancellingAgent
    ? t("composer.cancel.cancelingAgent")
    : t("composer.cancel.stopAgent");
  const icon = isCancellingAgent ? (
    <ActivityIndicator size="small" color="white" />
  ) : (
    <Stop size={buttonIconSize} color="white" />
  );
  const shortcutNode = agentInterruptKeys ? <Shortcut chord={agentInterruptKeys} /> : null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handleCancelAgent}
        disabled={!isConnected || isCancellingAgent}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={cancelButtonStyle}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{t("composer.cancel.interrupt")}</Text>
          {shortcutNode}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

interface ComposerCancelButtonSlotProps extends ComposerCancelButtonProps {
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
}

function ComposerCancelButtonSlot({
  isAgentRunning,
  hasSendableContent,
  isProcessing,
  ...rest
}: ComposerCancelButtonSlotProps) {
  if (!isAgentRunning || hasSendableContent || isProcessing) return null;
  return <ComposerCancelButton {...rest} />;
}

interface ComposerVoiceModeButtonProps {
  buttonIconSize: number;
  handleToggleRealtimeVoice: () => void;
  isConnected: boolean;
  isVoiceSwitching: boolean;
  isPersonalitySwitching: boolean;
  realtimeVoiceButtonStyle: (
    state: PressableStateCallbackType & { hovered?: boolean },
  ) => (object | undefined)[];
  voiceToggleKeys: ReturnType<typeof useShortcutKeys>;
  t: TFunction;
}

interface ComposerRightControlsSlotProps extends ComposerVoiceModeButtonProps {
  isVoiceModeForAgent: boolean;
  hasAgent: boolean;
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
  isCompact: boolean;
  cancelButton: ReactElement;
}

function ComposerRightControlsSlot({
  isVoiceModeForAgent,
  hasAgent,
  isAgentRunning,
  hasSendableContent,
  isProcessing,
  isCompact,
  cancelButton,
  ...voiceProps
}: ComposerRightControlsSlotProps) {
  const hideVoiceForCompactInput = isCompact && hasSendableContent;
  const showVoiceModeButton =
    !isVoiceModeForAgent && hasAgent && !isAgentRunning && !hideVoiceForCompactInput;
  const shouldShowCancelButton = isAgentRunning && !hasSendableContent && !isProcessing;
  if (!showVoiceModeButton && !shouldShowCancelButton) return null;
  return (
    <View style={styles.rightControls}>
      {showVoiceModeButton ? <ComposerVoiceModeButton {...voiceProps} /> : null}
      {cancelButton}
    </View>
  );
}

function ComposerVoiceModeButton({
  buttonIconSize,
  handleToggleRealtimeVoice,
  isConnected,
  isVoiceSwitching,
  isPersonalitySwitching,
  realtimeVoiceButtonStyle,
  voiceToggleKeys,
  t,
}: ComposerVoiceModeButtonProps) {
  const shortcutNode = voiceToggleKeys ? <Shortcut chord={voiceToggleKeys} /> : null;
  const renderTriggerContent = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (isVoiceSwitching) {
        return <ActivityIndicator size="small" color="white" />;
      }
      const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
      return <ThemedAudioLines size={buttonIconSize} uniProps={colorMapping} />;
    },
    [buttonIconSize, isVoiceSwitching],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handleToggleRealtimeVoice}
        disabled={!isConnected || isVoiceSwitching || isPersonalitySwitching}
        accessibilityLabel={t("composer.voice.enableVoiceMode")}
        accessibilityRole="button"
        style={realtimeVoiceButtonStyle}
      >
        {renderTriggerContent}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{t("composer.voice.voiceMode")}</Text>
          {shortcutNode}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

// oxlint-disable-next-line complexity
export function Composer({
  agentId,
  serverId,
  isPaneFocused,
  onSubmitMessage,
  onClientSlashCommand,
  hasExternalContent = false,
  allowEmptySubmit = false,
  submitButtonAccessibilityLabel,
  submitButtonTestID,
  submitIcon = "arrow",
  isSubmitLoading = false,
  submitBehavior = "clear",
  blurOnSubmit = false,
  value,
  onChangeText,
  attachments,
  attachmentScopeKeys = EMPTY_ATTACHMENT_SCOPE_KEYS,
  attachmentWriteScopeKey,
  onOpenWorkspaceAttachment,
  onChangeAttachments,
  cwd,
  clearDraft,
  autoFocus = false,
  onFocusInput,
  commandDraftConfig,
  onMessageSent,
  onComposerHeightChange,
  onAttentionInputFocus,
  onAttentionPromptSend,
  agentControls,
  inputWrapperStyle,
  footer,
  externalKeyboardShift,
  isCompactLayout: isCompactLayoutOverride,
}: ComposerProps) {
  const { t } = useTranslation();
  const iconSize = useIconSize();
  const buttonIconSize = resolveComposerButtonIconSize(iconSize);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const agentDirectoryStatus = useHostRuntimeAgentDirectoryStatus(serverId);
  const toast = useToast();
  const toastErrorRef = useRef(toast.error);
  toastErrorRef.current = toast.error;
  const voice = useVoiceOptional();
  const voiceToggleKeys = useShortcutKeys("voice-toggle");
  const agentInterruptKeys = useShortcutKeys("agent-interrupt");
  const isDictationReady = useIsDictationReady({
    serverId,
    isConnected,
    agentDirectoryStatus,
  });

  const { settings: appSettings } = useAppSettings();

  const agentState = useSessionStore(useShallow(buildAgentStateSelector(serverId, agentId)));

  const queuedMessagesRaw = useSessionStore((state) =>
    state.sessions[serverId]?.queuedMessages?.get(agentId),
  );
  const queuedMessages = queuedMessagesRaw ?? EMPTY_ARRAY;

  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const setAgentStreamTail = useSessionStore((state) => state.setAgentStreamTail);
  const setAgentStreamHead = useSessionStore((state) => state.setAgentStreamHead);

  // AI prompt suggestion (ghost-text watermark) + sent-message history stack.
  const promptSuggestion = useSessionStore((state) =>
    state.sessions[serverId]?.agentPromptSuggestions.get(agentId),
  );
  // Latest provider-reported plan rate-limit status (warning strip above the
  // input; hidden entirely via the rateLimitWarningsEnabled setting).
  const rateLimitInfo = useSessionStore((state) =>
    state.sessions[serverId]?.agentRateLimits.get(agentId),
  );
  const sentPromptHistory = useSessionStore((state) =>
    state.sessions[serverId]?.sentPromptHistory.get(agentId),
  );
  const setAgentPromptSuggestion = useSessionStore((state) => state.setAgentPromptSuggestion);
  const appendSentPrompt = useSessionStore((state) => state.appendSentPrompt);

  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompactLayout = resolveCompactLayout(isCompactLayoutOverride, isCompactFormFactor);
  const isDesktopWebBreakpoint = resolveIsDesktopWebBreakpoint(isCompactFormFactor);
  const isDesktopLayout = resolveIsDesktopWebBreakpoint(isCompactLayout);
  const messagePlaceholder = resolveMessagePlaceholder(isDesktopLayout, t);
  const userInput = value;
  const setUserInput = onChangeText;
  const workspaceAttachments = useWorkspaceAttachmentsForScopes(attachmentScopeKeys);
  const {
    selectedAttachments,
    buildOutgoingAttachments,
    removeAttachment,
    openAttachment,
    clearSentAttachments,
    completeSubmit,
    resetSuppression,
  } = composerWorkspaceAttachment.useBinding({
    normalAttachments: attachments,
    workspaceAttachments,
    onOpenWorkspaceAttachment,
  });
  const setSelectedAttachments = onChangeAttachments;
  const checkoutStatusQuery = useCheckoutStatusQuery({ serverId, cwd });
  const hostingSearchEnabled = useHostingSearchFeature(serverId);
  const githubAutoAttach = useComposerGithubAutoAttach({
    text: userInput,
    remoteUrl: resolveCheckoutRemoteUrl(checkoutStatusQuery.status),
    attachments,
    client,
    isConnected,
    serverId,
    cwd,
    hostingSearchEnabled,
    setAttachments: setSelectedAttachments,
  });
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isCancellingAgent, setIsCancellingAgent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const [isGithubPickerOpen, setIsGithubPickerOpen] = useState(false);
  const [githubSearchQuery, setGithubSearchQuery] = useState("");
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState("");
  const [lightboxMetadata, setLightboxMetadata] = useState<AttachmentMetadata | null>(null);
  // Mirrored up from AgentControls: true while an agent.personality.set RPC is
  // in flight. Locks send (button + keyboard), dictation, and voice mode —
  // typing and attachments deliberately stay enabled, so this must never feed
  // the MessageInput `disabled` prop.
  const [isPersonalitySwitching, setIsPersonalitySwitching] = useState(false);
  const attachButtonRef = useRef<View | null>(null);
  const messageInputRef = useRef<MessageInputRef>(null);
  const isComposerLocked = resolveIsComposerLocked(submitBehavior, isSubmitLoading);
  const keyboardHandlerIdRef = useRef(
    `message-input:${serverId}:${agentId}:${Math.random().toString(36).slice(2)}`,
  );

  // On mobile the chat layout reflows at send time as if the keyboard were
  // already gone, so the soft keyboard must start dismissing immediately with
  // the send — not linger over the response. Hardware-keyboard sends (soft
  // keyboard not visible) keep focus so the user can type the next message.
  const dismissKeyboardOnSubmit = useCallback(() => {
    if (blurOnSubmit || (isNative && Keyboard.isVisible())) {
      messageInputRef.current?.blur();
      if (isNative) {
        Keyboard.dismiss();
      }
    }
  }, [blurOnSubmit]);

  const runClientSlashCommand = useCallback(
    (command: ClientSlashCommand): boolean => {
      if (command.execution !== "immediate" || !onClientSlashCommand) {
        return false;
      }

      dismissKeyboardOnSubmit();
      clearDraft("sent");
      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      setSendError(null);
      setIsProcessing(true);
      void onClientSlashCommand(command)
        .catch((error) => {
          console.error("[Composer] Failed to run client slash command:", error);
          setSendError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setIsProcessing(false);
        });
      return true;
    },
    [
      clearDraft,
      dismissKeyboardOnSubmit,
      onClientSlashCommand,
      resetSuppression,
      setSelectedAttachments,
      setUserInput,
    ],
  );

  const autocomplete = useAgentAutocomplete({
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    draftConfig: commandDraftConfig,
    canExecuteClientSlashCommand: buildOutgoingAttachments(attachments).length === 0,
    onClientSlashCommand: runClientSlashCommand,
    onAutocompleteApplied: () => {
      messageInputRef.current?.focus();
    },
  });
  const autocompleteOnKeyPressRef = useRef(autocomplete.onKeyPress);
  autocompleteOnKeyPressRef.current = autocomplete.onKeyPress;

  // Clear send error when user edits the input
  useEffect(() => {
    if (sendError && userInput) {
      setSendError(null);
    }
  }, [userInput, sendError]);

  useEffect(() => {
    setCursorIndex((current) => Math.min(current, userInput.length));
  }, [userInput.length]);

  const { pickImages } = useImageAttachmentPicker();
  const { pickFiles } = useFilePicker();
  const agentIdRef = useRef(agentId);
  const sendAgentMessageRef = useRef<
    ((agentId: string, text: string, attachments: ComposerAttachment[]) => Promise<void>) | null
  >(null);
  const onSubmitMessageRef = useRef(onSubmitMessage);

  const addImages = useCallback(
    (images: ImageAttachment[]) => {
      setSelectedAttachments((prev) => [
        ...prev,
        ...images.map((metadata) => ({ kind: "image" as const, metadata })),
      ]);
    },
    [setSelectedAttachments],
  );

  const addFiles = useCallback(
    (files: UserComposerAttachment[]) => {
      setSelectedAttachments((prev) => [...prev, ...files]);
    },
    [setSelectedAttachments],
  );

  const focusInput = useCallback(() => {
    if (isNative) return;
    focusWithRetries({
      focus: () => messageInputRef.current?.focus(),
      isFocused: () => {
        const el = messageInputRef.current?.getNativeElement?.() ?? null;
        return el != null && document.activeElement === el;
      },
    });
  }, []);

  useEffect(() => {
    onFocusInput?.(focusInput);
  }, [focusInput, onFocusInput]);

  const submitMessage = useCallback(
    async (text: string, submitAttachments: ComposerAttachment[]) => {
      onMessageSent?.();
      if (onSubmitMessageRef.current) {
        await onSubmitMessageRef.current({ text, attachments: submitAttachments, cwd });
        return;
      }
      if (!sendAgentMessageRef.current) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      await sendAgentMessageRef.current(agentIdRef.current, text, submitAttachments);
    },
    [cwd, onMessageSent, t],
  );

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    sendAgentMessageRef.current = async (
      targetAgentId: string,
      text: string,
      sendAttachments: ComposerAttachment[],
    ) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const stream: AgentStreamWriter = {
        getTail: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamTail?.get(id),
        getHead: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamHead?.get(id),
        setHead: (updater) => setAgentStreamHead(serverId, updater),
        setTail: (updater) => setAgentStreamTail(serverId, updater),
      };
      await dispatchComposerAgentMessage({
        client,
        agentId: targetAgentId,
        text,
        attachments: sendAttachments,
        encodeImages,
        stream,
      });
      onAttentionPromptSend?.();
    };
  }, [client, onAttentionPromptSend, serverId, setAgentStreamTail, setAgentStreamHead, t]);

  useEffect(() => {
    onSubmitMessageRef.current = onSubmitMessage;
  }, [onSubmitMessage]);

  const isAgentRunning = agentState.status === "running";
  const hasAgent = agentState.status !== null;

  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages?.get(id) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );

  const queueMessage = useCallback(
    (queuedMessage: string, queuedAttachments: ComposerAttachment[]) => {
      const result = queueComposerMessage({
        agentId,
        text: queuedMessage,
        attachments: queuedAttachments,
        queue: queueWriter,
      });
      if (!result.queued) return;

      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      clearSentAttachments(queuedAttachments);
    },
    [
      agentId,
      clearSentAttachments,
      queueWriter,
      resetSuppression,
      setSelectedAttachments,
      setUserInput,
    ],
  );

  const sendMessageWithContent = useCallback(
    async (
      outgoingMessage: string,
      outgoingAttachments: ComposerAttachment[],
      forceSend?: boolean,
    ): Promise<boolean> => {
      // A forced send to a busy agent interrupts the active turn server-side,
      // which kills any in-flight observed subagents/workflows — confirm first
      // (suppressible). Runs before submitAgentInput so a cancel leaves the
      // composer untouched — including its grown height (the false return
      // tells the input not to collapse).
      if (forceSend && isAgentRunning) {
        const confirmedInterrupt = await confirmInterruptWithLiveSubagents({
          serverId,
          parentAgentId: agentId,
        });
        if (!confirmedInterrupt) {
          return false;
        }
      }
      const result = await submitAgentInput({
        message: outgoingMessage,
        attachments: outgoingAttachments,
        hasExternalContent,
        allowEmptySubmit,
        forceSend,
        submitBehavior,
        isAgentRunning,
        // Parent-managed submits are still valid submit paths even when the
        // transport is disconnected, because the parent decides the failure mode.
        canSubmit: Boolean(sendAgentMessageRef.current || onSubmitMessageRef.current),
        queueMessage: ({ message: queuedText, attachments: queuedAttachments }) => {
          queueMessage(queuedText, queuedAttachments);
        },
        submitMessage: async ({ message: submitText, attachments: submitAttachments }) => {
          await submitMessage(submitText, submitAttachments);
        },
        clearDraft,
        setUserInput,
        setAttachments: (nextAttachments) => {
          setSelectedAttachments(composerWorkspaceAttachment.userAttachmentsOnly(nextAttachments));
        },
        setSendError,
        setIsProcessing,
        onSubmitError: (error) => {
          console.error("[AgentInput] Failed to send message:", error);
        },
        failedToSendMessage: t("composer.errors.failedToSend"),
      });
      completeSubmit({
        result,
        outgoingAttachments,
      });
      // The prompt reached the chat (sent or queued): push it onto the recall
      // stack, exit history navigation, and drop any stale ghost suggestion.
      if ((result === "submitted" || result === "queued") && outgoingMessage.trim()) {
        appendSentPrompt(serverId, agentId, outgoingMessage);
        historyNavRef.current = { index: null, stashed: "" };
        setAgentPromptSuggestion(serverId, agentId, null);
      }
      return true;
    },
    [
      agentId,
      allowEmptySubmit,
      appendSentPrompt,
      clearDraft,
      completeSubmit,
      hasExternalContent,
      isAgentRunning,
      queueMessage,
      serverId,
      setAgentPromptSuggestion,
      setSelectedAttachments,
      setUserInput,
      submitBehavior,
      submitMessage,
      t,
    ],
  );

  const handleSubmit = useCallback(
    (payload: MessagePayload) => {
      const outgoingAttachments = buildOutgoingAttachments(attachments);
      const clientSlashCommand = resolveClientSlashCommand({
        text: payload.text,
        hasAttachments: outgoingAttachments.length > 0,
      });
      if (clientSlashCommand && runClientSlashCommand(clientSlashCommand)) {
        return;
      }

      dismissKeyboardOnSubmit();
      return sendMessageWithContent(payload.text, outgoingAttachments, payload.forceSend);
    },
    [
      attachments,
      buildOutgoingAttachments,
      dismissKeyboardOnSubmit,
      runClientSlashCommand,
      sendMessageWithContent,
    ],
  );

  const handlePickImage = useCallback(async () => {
    const newImages = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    if (newImages.length === 0) return;
    addImages(newImages);
  }, [addImages, pickImages]);

  const uploadPickedFiles = useCallback(
    async (files: PickedFile[]) => {
      if (files.length === 0) return;
      if (!client) {
        toastErrorRef.current(t("composer.errors.daemonClientDisconnected"));
        return;
      }

      const oversized = files.find((f) => f.bytes.byteLength > MAX_FILE_SIZE_BYTES);
      if (oversized) {
        toastErrorRef.current(
          t("composer.errors.fileTooLarge", { size: "50MB", fileName: oversized.fileName }),
        );
        return;
      }

      setIsUploadingFile(true);
      try {
        const uploaded = await uploadFileAttachments({ client, files });
        addFiles(uploaded);
      } catch (error) {
        console.error("[Composer] Failed to upload file:", error);
        toastErrorRef.current(
          error instanceof Error ? error.message : t("composer.errors.uploadFailed"),
        );
      } finally {
        setIsUploadingFile(false);
      }
    },
    [addFiles, client, t],
  );

  const handlePickFile = useCallback(async () => {
    if (!client) {
      toastErrorRef.current(t("composer.errors.daemonClientDisconnected"));
      return;
    }
    try {
      const files = await pickFiles();
      if (!files) return;
      await uploadPickedFiles(files);
    } catch (error) {
      console.error("[Composer] Failed to upload file:", error);
      toastErrorRef.current(
        error instanceof Error ? error.message : t("composer.errors.uploadFailed"),
      );
    }
  }, [client, pickFiles, t, uploadPickedFiles]);

  const handleGenericFilesDropped = useCallback(
    async (items: DroppedItem[]) => {
      try {
        const files = await droppedItemsToPickedFiles(items);
        if (files.length === 0) return;
        if (!client || !isConnected) {
          toastErrorRef.current(t("composer.errors.daemonClientDisconnected"));
          return;
        }
        await uploadPickedFiles(files);
      } catch (error) {
        console.error("[Composer] Failed to upload dropped files:", error);
        toastErrorRef.current(
          error instanceof Error ? error.message : t("composer.errors.uploadFailed"),
        );
      }
    },
    [client, isConnected, t, uploadPickedFiles],
  );

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      githubAutoAttach.markGithubAttachmentRemoved(selectedAttachments[index]);
      const didRemoveWorkspaceAttachment = removeAttachment({
        selectedAttachments,
        index,
      });
      if (didRemoveWorkspaceAttachment) {
        return;
      }
      setSelectedAttachments((prev) =>
        removeComposerAttachmentAtIndex({ attachments: prev, index, deleteAttachments }),
      );
    },
    [githubAutoAttach, removeAttachment, selectedAttachments, setSelectedAttachments],
  );

  const handleOpenAttachment = useCallback(
    (attachment: ComposerAttachment) => {
      openComposerAttachment({
        attachment,
        setLightboxMetadata,
        openWorkspaceAttachment: openAttachment,
        openExternalUrl: (url) => {
          void openLink(url);
        },
      });
    },
    [openAttachment],
  );

  useEffect(() => {
    if (!isAgentRunning || !isConnected) {
      setIsCancellingAgent(false);
    }
  }, [isAgentRunning, isConnected]);

  const handleCancelAgent = useCallback(() => {
    const didCancel = cancelComposerAgent({
      client,
      agentId: agentIdRef.current,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
    });
    if (!didCancel) return;
    setIsCancellingAgent(true);
    messageInputRef.current?.focus();
  }, [client, isAgentRunning, isCancellingAgent, isConnected]);

  const focusMessageInputForKeyboardAction = useCallback(() => {
    focusMessageInputWithPlatformStrategy(messageInputRef);
  }, []);

  const clearComposerText = useCallback(() => {
    historyNavRef.current = { index: null, stashed: "" };
    setUserInput("");
  }, [setUserInput]);

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean =>
      dispatchComposerKeyboardAction({
        action,
        isPaneFocused,
        messageInputRef,
        isAgentRunning,
        isCancellingAgent,
        isConnected,
        handleCancelAgent,
        focusMessageInputForKeyboardAction,
        // Read from a ref so per-keystroke text changes don't re-register the
        // keyboard handler; evaluated fresh each time the action fires.
        hasComposerText: userInputRef.current.trim().length > 0,
        clearComposerText,
      }),
    [
      clearComposerText,
      focusMessageInputForKeyboardAction,
      handleCancelAgent,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      isPaneFocused,
    ],
  );

  useKeyboardActionHandler({
    handlerId: keyboardHandlerIdRef.current,
    actions: [
      "agent.interrupt",
      "message-input.focus",
      "message-input.send",
      "message-input.dictation-toggle",
      "message-input.dictation-cancel",
      "message-input.dictation-confirm",
      "message-input.voice-toggle",
      "message-input.voice-mute-toggle",
    ],
    enabled: isPaneFocused,
    priority: resolveKeyboardPriority(isMessageInputFocused),
    isActive: () => isPaneFocused,
    handle: handleKeyboardAction,
  });

  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({
    mode: "translate",
    enabled: !externalKeyboardShift,
  });

  const isVoiceModeForAgent = resolveIsVoiceModeForAgent(voice, serverId, agentId);

  const handleToggleRealtimeVoice = useCallback(() => {
    attemptStartRealtimeVoice({
      voice,
      isConnected,
      hasAgent,
      serverId,
      agentId,
      toastErrorRef,
    });
  }, [agentId, hasAgent, isConnected, serverId, voice]);

  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const result = editQueuedComposerMessage({
        agentId,
        messageId: id,
        queue: queueWriter,
      });
      if (!result) return;
      setUserInput(result.text);
      setSelectedAttachments(result.attachments);
    },
    [agentId, queueWriter, setSelectedAttachments, setUserInput],
  );

  const handleSendQueuedNow = useCallback(
    async (id: string) => {
      if (!sendAgentMessageRef.current && !onSubmitMessageRef.current) return;
      // "Send now" on a queued message interrupts the active turn, which kills
      // any in-flight observed subagents/workflows — confirm first (suppressible).
      if (isAgentRunning) {
        const confirmedInterrupt = await confirmInterruptWithLiveSubagents({
          serverId,
          parentAgentId: agentId,
        });
        if (!confirmedInterrupt) {
          return;
        }
      }
      // Reuse the regular send path; server-side send atomically interrupts any active run.
      const result = await sendQueuedComposerMessageNow({
        agentId,
        messageId: id,
        queue: queueWriter,
        submitMessage: ({ text, attachments: queuedAttachments }) =>
          submitMessage(text, queuedAttachments),
        failedToSendMessage: t("composer.errors.failedToSend"),
      });
      if (result.status === "failed") {
        setSendError(result.errorMessage);
      }
    },
    [agentId, isAgentRunning, queueWriter, serverId, submitMessage, t],
  );

  const handleQueue = useCallback(
    (payload: MessagePayload) => {
      const outgoingAttachments = buildOutgoingAttachments(attachments);
      const clientSlashCommand = resolveClientSlashCommand({
        text: payload.text,
        hasAttachments: outgoingAttachments.length > 0,
      });
      if (clientSlashCommand && runClientSlashCommand(clientSlashCommand)) {
        return;
      }
      dismissKeyboardOnSubmit();
      queueMessage(payload.text, outgoingAttachments);
    },
    [
      attachments,
      buildOutgoingAttachments,
      dismissKeyboardOnSubmit,
      queueMessage,
      runClientSlashCommand,
    ],
  );

  const hasSendableContent = userInput.trim().length > 0 || selectedAttachments.length > 0;

  // Live values mirrored into refs so the key handler stays referentially stable
  // (MessageInput is memoized; a changing onKeyPress identity defeats that memo).
  const promptSuggestionRef = useRef(promptSuggestion);
  promptSuggestionRef.current = promptSuggestion;
  const promptSuggestionsEnabledRef = useRef(appSettings.promptSuggestionsEnabled);
  promptSuggestionsEnabledRef.current = appSettings.promptSuggestionsEnabled;
  const sentPromptHistoryRef = useRef(sentPromptHistory);
  sentPromptHistoryRef.current = sentPromptHistory;
  const userInputRef = useRef(userInput);
  userInputRef.current = userInput;
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  // History-recall navigation cursor. `index === null` means "showing the live
  // draft"; `stashed` holds the draft text saved before the first ArrowUp.
  const historyNavRef = useRef<{ index: number | null; stashed: string }>({
    index: null,
    stashed: "",
  });

  // Tab accepts the ghost-text suggestion (only when the box is empty).
  const acceptPromptSuggestion = useCallback(() => {
    if (!promptSuggestionsEnabledRef.current) return false;
    const suggestion = promptSuggestionRef.current;
    if (!suggestion || userInputRef.current.length > 0) return false;
    historyNavRef.current = { index: null, stashed: "" };
    setUserInput(suggestion);
    setAgentPromptSuggestion(serverId, agentId, null);
    messageInputRef.current?.focus();
    return true;
  }, [agentId, serverId, setAgentPromptSuggestion, setUserInput]);

  // ArrowUp/ArrowDown walk the sent-message stack (shell-history semantics). The
  // first ArrowUp requires the caret at the very start so it never hijacks
  // multiline cursor movement; once navigating, arrows own the box.
  const recallSentPrompt = useCallback(
    (direction: "prev" | "next") => {
      const history = sentPromptHistoryRef.current;
      if (!history || history.length === 0) return false;
      const nav = historyNavRef.current;
      if (direction === "prev") {
        if (nav.index === null) {
          const sel = selectionRef.current;
          if (sel.start !== 0 || sel.end !== 0) return false;
          historyNavRef.current = { index: history.length - 1, stashed: userInputRef.current };
        } else if (nav.index > 0) {
          historyNavRef.current = { index: nav.index - 1, stashed: nav.stashed };
        }
        setUserInput(history[historyNavRef.current.index ?? 0]);
        return true;
      }
      if (nav.index === null) return false;
      if (nav.index < history.length - 1) {
        const nextIndex = nav.index + 1;
        historyNavRef.current = { index: nextIndex, stashed: nav.stashed };
        setUserInput(history[nextIndex]);
      } else {
        const { stashed } = nav;
        historyNavRef.current = { index: null, stashed: "" };
        setUserInput(stashed);
      }
      return true;
    },
    [setUserInput],
  );

  // Compose the composer key handler: autocomplete popover first (it consumes
  // navigation keys while open), then ghost-text accept, then history recall.
  const handleCommandKeyPress = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      if (autocompleteOnKeyPressRef.current(event)) return true;
      if (event.key === "Tab" && acceptPromptSuggestion()) {
        event.preventDefault();
        return true;
      }
      if (event.key === "ArrowUp" && recallSentPrompt("prev")) {
        event.preventDefault();
        return true;
      }
      if (event.key === "ArrowDown" && recallSentPrompt("next")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    [acceptPromptSuggestion, recallSentPrompt],
  );

  const cancelButtonStyle = useMemo(
    () => buildCancelButtonStyle(isConnected, isCancellingAgent),
    [isConnected, isCancellingAgent],
  );

  const isVoiceSwitching = voice?.isVoiceSwitching ?? false;
  const voiceButtonDisabled = !isConnected || isVoiceSwitching;
  const realtimeVoiceButtonStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      buildRealtimeVoiceButtonStyle(state.hovered, voiceButtonDisabled),
    [voiceButtonDisabled],
  );

  const cancelButton = useMemo(
    () => (
      <ComposerCancelButtonSlot
        isAgentRunning={isAgentRunning}
        hasSendableContent={hasSendableContent}
        isProcessing={isProcessing}
        buttonIconSize={buttonIconSize}
        cancelButtonStyle={cancelButtonStyle}
        handleCancelAgent={handleCancelAgent}
        isConnected={isConnected}
        isCancellingAgent={isCancellingAgent}
        agentInterruptKeys={agentInterruptKeys}
        t={t}
      />
    ),
    [
      agentInterruptKeys,
      buttonIconSize,
      cancelButtonStyle,
      handleCancelAgent,
      hasSendableContent,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      isProcessing,
      t,
    ],
  );

  const rightContent = useMemo(
    () => (
      <ComposerRightControlsSlot
        isVoiceModeForAgent={isVoiceModeForAgent}
        hasAgent={hasAgent}
        isAgentRunning={isAgentRunning}
        hasSendableContent={hasSendableContent}
        isProcessing={isProcessing}
        isCompact={isCompactLayout}
        buttonIconSize={buttonIconSize}
        handleToggleRealtimeVoice={handleToggleRealtimeVoice}
        isConnected={isConnected}
        isVoiceSwitching={isVoiceSwitching}
        isPersonalitySwitching={isPersonalitySwitching}
        realtimeVoiceButtonStyle={realtimeVoiceButtonStyle}
        voiceToggleKeys={voiceToggleKeys}
        t={t}
        cancelButton={cancelButton}
      />
    ),
    [
      buttonIconSize,
      cancelButton,
      handleToggleRealtimeVoice,
      hasAgent,
      hasSendableContent,
      isAgentRunning,
      isConnected,
      isCompactLayout,
      isPersonalitySwitching,
      isProcessing,
      isVoiceModeForAgent,
      isVoiceSwitching,
      realtimeVoiceButtonStyle,
      t,
      voiceToggleKeys,
    ],
  );

  const contextWindowMeter = useMemo(
    () => (
      <ComposerContextWindowMeter
        serverId={serverId}
        agentId={agentId}
        provider={agentState.provider}
      />
    ),
    [serverId, agentId, agentState.provider],
  );

  const githubSearchQueryTrimmed = githubSearchQuery.trim();
  const githubSearchResultsQuery = useGithubSearchQuery({
    client,
    serverId,
    cwd,
    query: githubSearchQueryTrimmed,
    enabled: resolvePickerSearchEnabled(isGithubPickerOpen, isConnected, cwd),
  });

  const githubSearchItemsRaw = githubSearchResultsQuery.data?.items;
  const githubSearchItems = useMemo(() => githubSearchItemsRaw ?? [], [githubSearchItemsRaw]);
  const githubSearchOptions: ComboboxOption[] = useMemo(
    () =>
      githubSearchItems.map((item) => ({
        id: `${item.kind}:${item.number}`,
        label: `#${item.number} ${item.title}`,
        description: githubSearchQueryTrimmed,
      })),
    [githubSearchItems, githubSearchQueryTrimmed],
  );

  const folderSearchQueryTrimmed = folderSearchQuery.trim();
  const folderSearchResultsQuery = useDirectorySearchQuery({
    client,
    serverId,
    cwd,
    query: folderSearchQueryTrimmed,
    enabled: resolvePickerSearchEnabled(isFolderPickerOpen, isConnected, cwd),
  });
  const folderSearchPaths = folderSearchResultsQuery.data ?? EMPTY_FOLDER_SEARCH_PATHS;
  const folderSearchOptions: ComboboxOption[] = useMemo(
    () =>
      folderSearchPaths.map((path) => ({
        id: path,
        label: path,
        kind: "directory" as const,
      })),
    [folderSearchPaths],
  );

  const addWorkspaceAttachment = useWorkspaceAttachmentsStore(
    (state) => state.addWorkspaceAttachment,
  );
  const folderAttachmentScopeKey = attachmentWriteScopeKey ?? attachmentScopeKeys[0];
  const handleSelectFolder = useCallback(
    (path: string) => {
      if (!folderAttachmentScopeKey) return;
      addWorkspaceAttachment({
        scopeKey: folderAttachmentScopeKey,
        attachment: { kind: "file_context", id: path, path, entryKind: "directory" },
      });
    },
    [addWorkspaceAttachment, folderAttachmentScopeKey],
  );

  const attachmentMenuItems = useMemo<AttachmentMenuItem[]>(() => {
    const items: (AttachmentMenuItem | null)[] = [
      folderAttachmentScopeKey
        ? {
            id: "folder",
            label: t("composer.attachments.addFolder"),
            icon: <ThemedFolder size={iconSize.md} uniProps={iconForegroundMutedMapping} />,
            onSelect: () => {
              setIsFolderPickerOpen(true);
            },
          }
        : null,
      {
        id: "github",
        label: t("composer.attachments.addIssueOrPr"),
        icon: <ThemedGithub size={iconSize.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          setIsGithubPickerOpen(true);
        },
      },
      {
        id: "file",
        label: t("composer.attachments.addFile"),
        icon: <ThemedUploadFile size={iconSize.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          void handlePickFile();
        },
      },
      {
        id: "image",
        label: t("composer.attachments.addImage"),
        icon: <ThemedImageIcon size={iconSize.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          void handlePickImage();
        },
      },
    ];
    return items.filter((item): item is AttachmentMenuItem => item !== null);
  }, [handlePickImage, handlePickFile, folderAttachmentScopeKey, t, iconSize.md]);

  const handleToggleGithubItem = useCallback(
    (item: GitHubSearchItem) => {
      const nextAttachments = toggleGithubAttachmentFromPicker({
        current: attachments,
        item,
        provider: githubSearchResultsQuery.data?.provider,
        markGithubAttachmentRemoved: githubAutoAttach.markGithubAttachmentRemoved,
      });
      setSelectedAttachments(nextAttachments);
      setIsGithubPickerOpen(false);
      setGithubSearchQuery("");
    },
    [
      attachments,
      githubAutoAttach,
      githubSearchResultsQuery.data?.provider,
      setSelectedAttachments,
      setGithubSearchQuery,
      setIsGithubPickerOpen,
    ],
  );

  const leftContent = useMemo(
    () =>
      renderLeftContent({
        agentControls,
        agentId,
        serverId,
        focusInput,
        isCompactLayout,
        onPersonalitySwitchingChange: setIsPersonalitySwitching,
      }),
    [agentControls, agentId, focusInput, isCompactLayout, serverId],
  );

  const handleAttachButtonRef = useCallback((node: View | null) => {
    attachButtonRef.current = node;
  }, []);

  const handleSelectionChange = useCallback((selection: { start: number; end: number }) => {
    selectionRef.current = selection;
    setCursorIndex(selection.start);
  }, []);

  // Manual typing exits history-recall mode: the edited text becomes the new draft
  // (so editing a recalled prompt and sending it clones a fresh top entry).
  const handleComposerChangeText = useCallback(
    (text: string) => {
      historyNavRef.current = { index: null, stashed: "" };
      setUserInput(text);
    },
    [setUserInput],
  );

  const handleFocusChange = useCallback(
    (focused: boolean) => {
      setIsMessageInputFocused(focused);
      if (focused) {
        onAttentionInputFocus?.();
      }
    },
    [onAttentionInputFocus],
  );

  const handleLightboxClose = useCallback(() => {
    setLightboxMetadata(null);
  }, []);

  const handleGithubPickerOpenChange = useCallback(
    (open: boolean) => {
      setIsGithubPickerOpen(open);
      if (!open) {
        setGithubSearchQuery("");
      }
    },
    [setGithubSearchQuery],
  );

  const handleFolderPickerOpenChange = useCallback(
    (open: boolean) => {
      setIsFolderPickerOpen(open);
      if (!open) {
        setFolderSearchQuery("");
      }
    },
    [setFolderSearchQuery],
  );

  const renderGithubPickerOption = useCallback(
    ({ option, active }: { option: ComboboxOption; selected: boolean; active: boolean }) => {
      const item = findGithubItemByOption(githubSearchItems, option.id);
      if (!item) {
        return <View key={option.id} />;
      }
      const selected = isAttachmentSelectedForGithubItem(selectedAttachments, item);
      return (
        <GithubPickerOption
          key={option.id}
          testID={`composer-github-option-${option.id}`}
          label={option.label}
          selected={selected}
          active={active}
          item={item}
          onToggle={handleToggleGithubItem}
        />
      );
    },
    [githubSearchItems, selectedAttachments, handleToggleGithubItem],
  );

  const composerContainerStyle = useMemo(
    () => [styles.container, keyboardAnimatedStyle],
    [keyboardAnimatedStyle],
  );
  const inputAreaContainerStyle = useMemo(
    () => [styles.inputAreaContainer, isComposerLocked && styles.inputAreaLocked],
    [isComposerLocked],
  );

  const attachmentTray = useMemo(
    () =>
      renderAttachmentTray({
        selectedAttachments,
        isComposerLocked,
        handleOpenAttachment,
        handleRemoveAttachment,
        labels: {
          openImage: t("composer.attachments.openImage"),
          removeImage: t("composer.attachments.removeImage"),
          removeFile: t("composer.attachments.removeFile"),
          openGithub: (kind: string, number: number) =>
            t("composer.attachments.openGithub", { kind, number }),
          removeGithub: (kind: string, number: number) =>
            t("composer.attachments.removeGithub", { kind, number }),
        },
      }),
    [handleOpenAttachment, handleRemoveAttachment, isComposerLocked, selectedAttachments, t],
  );

  const queueList = useMemo(
    () =>
      renderQueueTrack({
        queuedMessages,
        handleEditQueuedMessage,
        handleSendQueuedNow,
        editLabel: t("composer.attachments.editQueuedMessage"),
        sendNowLabel: t("composer.attachments.sendQueuedMessageNow"),
      }),
    [handleEditQueuedMessage, handleSendQueuedNow, queuedMessages, t],
  );

  const messageInputContainerRef = useRef<View>(null);

  const isSubmitBusy = isProcessing || isSubmitLoading || isUploadingFile;

  // Disable drops while submitting/uploading: the submit path clears and restores attachments,
  // so a drop in that window would be lost or land on a locked draft. `disabled` hides the
  // backdrop and rejects the drop atomically, instead of accepting a drop with no feedback.
  useFileDrop(
    { onFiles: addImages, onGenericFiles: handleGenericFilesDropped },
    { disabled: isSubmitBusy },
  );

  const messageInputAutoFocus = autoFocus && isDesktopWebBreakpoint;
  const submitLoadingPressHandler = isAgentRunning ? handleCancelAgent : undefined;
  const sendErrorNode = useMemo(
    () => (sendError ? <Text style={styles.sendErrorText}>{sendError}</Text> : null),
    [sendError],
  );
  const rateLimitNode = useMemo(() => {
    if (!appSettings.rateLimitWarningsEnabled || !rateLimitInfo) {
      return null;
    }
    if (rateLimitInfo.status === "allowed") {
      return null;
    }
    return (
      <Text
        style={
          rateLimitInfo.status === "rejected"
            ? styles.rateLimitTextRejected
            : styles.rateLimitTextWarning
        }
        testID="composer-rate-limit-warning"
      >
        {formatRateLimitWarning(t, rateLimitInfo)}
      </Text>
    );
  }, [appSettings.rateLimitWarningsEnabled, rateLimitInfo, t]);
  const githubEmptyText = githubSearchResultsQuery.isFetching
    ? t("composer.github.searching")
    : t("composer.github.noResults");
  const folderEmptyText = folderSearchResultsQuery.isFetching
    ? t("composer.folder.searching")
    : t("composer.folder.noResults");
  const autocompleteVisible = autocomplete.isVisible && isPaneFocused;

  return (
    <ComposerKeyboardScopeProvider isActiveComposer={isPaneFocused}>
      <Animated.View style={composerContainerStyle}>
        <AttachmentLightbox metadata={lightboxMetadata} onClose={handleLightboxClose} />
        {/* Input area */}
        <View style={inputAreaContainerStyle}>
          <ChatWidthBounds style={styles.inputAreaContent}>
            {queueList}
            {sendErrorNode}
            {rateLimitNode}

            <View ref={messageInputContainerRef} style={styles.messageInputContainer}>
              <AutocompletePopover
                visible={autocompleteVisible}
                anchorRef={messageInputContainerRef}
                options={autocomplete.options}
                selectedIndex={autocomplete.selectedIndex}
                onSelect={autocomplete.onSelectOption}
                isLoading={autocomplete.isLoading}
                errorMessage={autocomplete.errorMessage}
                loadingText={autocomplete.loadingText}
                emptyText={autocomplete.emptyText}
              />

              {/* MessageInput handles everything: text, dictation, attachments, all buttons */}
              <StableMessageInput
                ref={messageInputRef}
                value={userInput}
                onChangeText={handleComposerChangeText}
                onSubmit={handleSubmit}
                hasExternalContent={hasExternalContent}
                allowEmptySubmit={allowEmptySubmit}
                submitButtonAccessibilityLabel={submitButtonAccessibilityLabel}
                submitButtonTestID={submitButtonTestID}
                submitIcon={submitIcon}
                isSubmitDisabled={isSubmitBusy || isPersonalitySwitching}
                isSubmitLoading={isSubmitBusy}
                preserveHeightOnSubmit={submitBehavior === "preserve-and-lock"}
                attachments={selectedAttachments}
                cwd={cwd}
                attachmentMenuItems={attachmentMenuItems}
                onAttachButtonRef={handleAttachButtonRef}
                onAddImages={addImages}
                client={client}
                isReadyForDictation={isDictationReady && !isPersonalitySwitching}
                placeholder={
                  appSettings.promptSuggestionsEnabled && promptSuggestion && userInput.length === 0
                    ? promptSuggestion
                    : messagePlaceholder
                }
                autoFocus={messageInputAutoFocus}
                autoFocusKey={`${serverId}:${agentId}`}
                disabled={isSubmitLoading}
                isPaneFocused={isPaneFocused}
                leadingContent={contextWindowMeter}
                leftContent={leftContent}
                rightContent={rightContent}
                voiceServerId={serverId}
                voiceAgentId={agentId}
                isAgentRunning={isAgentRunning}
                defaultSendBehavior={appSettings.sendBehavior}
                onQueue={handleQueue}
                onSubmitLoadingPress={submitLoadingPressHandler}
                onKeyPress={handleCommandKeyPress}
                onSelectionChange={handleSelectionChange}
                onFocusChange={handleFocusChange}
                onHeightChange={onComposerHeightChange}
                inputWrapperStyle={inputWrapperStyle}
                attachmentSlot={attachmentTray}
              />
              <Combobox
                options={githubSearchOptions}
                value=""
                onSelect={noop}
                keepOpenOnSelect
                searchable
                searchPlaceholder={t("composer.github.searchPlaceholder")}
                title={t("composer.github.title")}
                open={isGithubPickerOpen}
                onOpenChange={handleGithubPickerOpenChange}
                onSearchQueryChange={setGithubSearchQuery}
                desktopPlacement="top-start"
                anchorRef={attachButtonRef}
                emptyText={githubEmptyText}
                renderOption={renderGithubPickerOption}
              />
              <Combobox
                options={folderSearchOptions}
                value=""
                onSelect={handleSelectFolder}
                searchable
                searchPlaceholder={t("composer.folder.searchPlaceholder")}
                title={t("composer.folder.title")}
                open={isFolderPickerOpen}
                onOpenChange={handleFolderPickerOpenChange}
                onSearchQueryChange={setFolderSearchQuery}
                desktopPlacement="top-start"
                anchorRef={attachButtonRef}
                emptyText={folderEmptyText}
              />
            </View>
          </ChatWidthBounds>
        </View>
        {renderComposerFooter(footer, null)}
      </Animated.View>
    </ComposerKeyboardScopeProvider>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  borderSeparator: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  inputAreaLocked: {
    opacity: 0.6,
  },
  inputAreaContent: {
    width: "100%",
    gap: theme.spacing[3],
  },
  footer: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    // Negative margin pulls the footer up against the input area's paddingBottom.
    // On mobile, leave a 3px gap (no token sits below spacing[1]); desktop keeps more.
    marginTop: {
      xs: -(theme.spacing[4] - 3),
      md: -theme.spacing[3],
    },
    alignItems: "center",
    paddingBottom: theme.spacing[2],
  },
  footerContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // On mobile, the negative margins below cancel each glyph's internal padding
    // to reach the composer border; this inset adds a small visual gap from it.
    paddingLeft: {
      xs: 5,
      md: 10,
    },
    paddingRight: {
      xs: 5,
      md: 10,
    },
  },
  footerLeft: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    // On mobile, cancel the leading glyph's internal padding (chip paddingHorizontal)
    // so its icon aligns to the composer border before the footer inset is applied.
    marginLeft: {
      xs: -theme.spacing[2],
      md: 0,
    },
  },
  messageInputContainer: {
    position: "relative",
    width: "100%",
    gap: theme.spacing[3],
  },
  cancelButton: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[600],
    alignItems: "center",
    justifyContent: "center",
  },
  rightControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  footerRight: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
  },
  realtimeVoiceButton: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeVoiceButtonActive: {
    backgroundColor: theme.colors.palette.green[600],
    borderColor: theme.colors.palette.green[800],
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  attachmentTray: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  queueTrack: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    // Matches the sub-agent track surface so the stacked queue reads as part
    // of the same supervision chrome (user-locked).
    borderColor: theme.colors.borderAccent,
    gap: theme.spacing[2],
  },
  queueText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueSendButton: {
    backgroundColor: theme.colors.accent,
  },
  sendErrorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
  rateLimitTextWarning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  rateLimitTextRejected: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
})) as unknown as Record<string, object>;

const QUEUE_SEND_BUTTON_STYLE = [styles.queueActionButton, styles.queueSendButton];

// One compact line, segments joined with " · ": headline (window-specific),
// then percent used, reset time, and overage note when reported.
function formatRateLimitWarning(t: TFunction, info: AgentRateLimitInfo): string {
  let windowLabel = t("composer.rateLimit.windowPlan");
  if (info.limitType === "five_hour") {
    windowLabel = t("composer.rateLimit.windowFiveHour");
  } else if (info.limitType?.startsWith("seven_day")) {
    windowLabel = t("composer.rateLimit.windowSevenDay");
  }
  const parts = [
    info.status === "rejected"
      ? t("composer.rateLimit.reached", { window: windowLabel })
      : t("composer.rateLimit.approaching", { window: windowLabel }),
  ];
  if (typeof info.utilizationPercent === "number") {
    parts.push(t("composer.rateLimit.usedPercent", { percent: info.utilizationPercent }));
  }
  if (info.resetsAt) {
    const resetDate = new Date(info.resetsAt);
    if (!Number.isNaN(resetDate.getTime())) {
      const withinDay = resetDate.getTime() - Date.now() < 24 * 60 * 60 * 1000;
      const time = withinDay
        ? resetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : resetDate.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
      parts.push(t("composer.rateLimit.resets", { time }));
    }
  }
  if (info.isUsingOverage) {
    parts.push(t("composer.rateLimit.usingOverage"));
  }
  return parts.join(" · ");
}

const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedAudioLines = withUnistyles(AudioLines);
const ThemedUploadFile = withUnistyles(UploadFile);
const ThemedFolder = withUnistyles(Folder);
const ThemedImageIcon = withUnistyles(ImageIcon);
const ThemedFileText = withUnistyles(FileText);
const ThemedGithub = withUnistyles(Github);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
