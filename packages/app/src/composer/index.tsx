import { View, Pressable, Text, Keyboard, type PressableStateCallbackType } from "react-native";
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
  ChevronDown,
  ChevronUp,
  Stop,
  Pencil,
  AudioLines,
  CircleDot,
  FileText,
  Folder,
  GitPullRequest,
  Github,
  Image as ImageIcon,
  ClipboardPaste,
  Paperclip,
  UploadFile,
} from "@/components/icons/material-icons";
import * as Clipboard from "expo-clipboard";
import {
  appendWorkspaceFileAttachment,
  getWorkspaceFileAttachmentKey,
  getWorkspaceFileAttachmentSubtitle,
} from "@/attachments/workspace-file";
import {
  resolveWorkspaceFileDrop,
  type WorkspaceFileDragPayload,
} from "@/attachments/workspace-file-drag";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import {
  AgentControls,
  DraftAgentControls,
  type DraftAgentControlsProps,
} from "@/composer/agent-controls";
import { ContextWindowMeter } from "@/components/context-window-meter";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCachedContextWindowUsage } from "@/hooks/use-cached-context-window-usage";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { selectAgentTurnPresentation, useSessionStore, type Agent } from "@/stores/session-store";
import { useWidgetPromptStore } from "@/widgets/prompt-store";
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
  findGithubItemByOption,
  isAttachmentSelectedForGithubItem,
  openComposerAttachment,
  pickAndPersistImages,
  removeComposerAttachmentAtIndex,
  toggleGithubAttachmentFromPicker,
  uploadFileAttachments,
  type AttachmentPersister,
} from "@/composer/actions";
import { useComposerQueue, type ComposerQueueItem } from "@/composer/queue";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
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
  persistAttachmentFromDataUrl,
  persistAttachmentFromFileUri,
} from "@/attachments/service";
import { resolveAgentControlsMode } from "@/composer/agent-controls/mode";
import { resolveComposerInputMode, type ComposerInputMode } from "@/composer/input-mode";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { dispatchComposerKeyboardAction } from "@/composer/keyboard-actions";
import { submitAgentInput } from "@/composer/submit";
import { useFollowPromptSuggestion } from "@/composer/follow-suggestion/use-follow-prompt-suggestion";
import { useFollowSuggestionChainStore } from "@/composer/follow-suggestion/chain-store";
import { confirmInterruptWithLiveSubagents } from "@/components/interrupt-subagents-warning";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { ComposerKeyboardScopeProvider } from "@/composer/keyboard-scope";
import { useAppSettings } from "@/hooks/use-settings";
import { isWeb, isNative } from "@/constants/platform";
import type { ForgeSearchItem } from "@otto-code/protocol/messages";
import type { WorkspaceFileComposerAttachment } from "@/attachments/types";
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
import { createFileContextAttachment } from "@/attachments/file-context";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { AttachmentLabel, AttachmentPill, AttachmentThumbnail } from "@/components/attachment-pill";
import { AttachmentLightbox } from "@/components/attachment-lightbox";
import { openLink } from "@/utils/open-link";
import { useIsDictationReady } from "@/hooks/use-is-dictation-ready";
import { useForgeSearchQuery } from "@/git/use-forge-search-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useComposerGithubAutoAttach } from "./github/auto-attach";
import { readClipboardImage } from "./clipboard-image";
import { resolveClientSlashCommand, type ClientSlashCommand } from "@/client-slash-commands";
import { ComposerFrame } from "@/composer/composer-frame";
import { focusMessageInputWithPlatformStrategy } from "@/composer/message-input-keyboard";

const composerImageAttachmentPersister: Pick<
  AttachmentPersister,
  "persistFromBlob" | "persistFromDataUrl" | "persistFromFileUri"
> = {
  persistFromBlob: persistAttachmentFromBlob,
  persistFromDataUrl: persistAttachmentFromDataUrl,
  persistFromFileUri: persistAttachmentFromFileUri,
};

type QueuedMessage = ComposerQueueItem;

type AttachmentListUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

const EMPTY_ATTACHMENT_SCOPE_KEYS: readonly string[] = [];
const EMPTY_FOLDER_SEARCH_PATHS: readonly string[] = [];

function noop() {}
const noopCallback = () => {};

function resolveErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

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

function resolveMessagePlaceholder(
  inputMode: ComposerInputMode,
  isDesktopWebBreakpoint: boolean,
  t: TFunction,
  override: string | undefined,
): string {
  // A terminal placeholder names what it launches ("Prompt Codex", "Run a
  // command"), which depends on the selected profile. Only the caller knows
  // that, so it wins when supplied.
  if (override !== undefined) {
    return override;
  }
  if (inputMode === "terminal") {
    return t("composer.placeholders.terminal");
  }
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
  isPaneFocused: boolean;
  showAgentControls: boolean;
}

function renderLeftContent(args: RenderLeftContentArgs): ReactElement | null {
  const { agentControls, agentId, serverId, focusInput, isCompactLayout, isPaneFocused } = args;
  if (!args.showAgentControls) return null;
  if (resolveAgentControlsMode(agentControls) === "draft" && agentControls) {
    return <DraftAgentControls {...agentControls} isCompactLayout={isCompactLayout} />;
  }
  return (
    <AgentControls
      agentId={agentId}
      serverId={serverId}
      isPaneFocused={isPaneFocused}
      onDropdownClose={focusInput}
      isCompactLayout={isCompactLayout}
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
  handleSendAllQueued: () => Promise<void>;
  handleMoveQueuedMessage: ((id: string, direction: "up" | "down") => void) | null;
  editLabel: string;
  sendNowLabel: string;
  sendAllLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  /** Pluralized "N attachments" for the row's leading count badge. */
  formatAttachmentCount: (count: number) => string;
}

function renderQueueTrack(args: RenderQueueTrackArgs): ReactElement | null {
  const {
    queuedMessages,
    handleEditQueuedMessage,
    handleSendQueuedNow,
    handleSendAllQueued,
    handleMoveQueuedMessage,
    editLabel,
    sendNowLabel,
    sendAllLabel,
    moveUpLabel,
    moveDownLabel,
    formatAttachmentCount,
  } = args;
  if (queuedMessages.length === 0) return null;
  // One row cannot be re-ordered, so the controls only appear once there is
  // somewhere to move to.
  const onMove = queuedMessages.length > 1 ? handleMoveQueuedMessage : null;
  // "Send all" is about the queue, not a row, so it rides on the head row only,
  // the one whose "send now" it generalizes. With a single queued message that
  // button already does exactly this, so the pill would say it twice.
  const onSendAll = queuedMessages.length > 1 ? handleSendAllQueued : null;
  return (
    <View style={styles.queueTrack}>
      {queuedMessages.map((item, index) => (
        <QueuedMessageRow
          key={item.id}
          item={item}
          onEdit={handleEditQueuedMessage}
          onSendNow={handleSendQueuedNow}
          onSendAll={index === 0 ? onSendAll : null}
          onMove={onMove}
          canMoveUp={index > 0}
          canMoveDown={index < queuedMessages.length - 1}
          editLabel={editLabel}
          sendNowLabel={sendNowLabel}
          sendAllLabel={sendAllLabel}
          moveUpLabel={moveUpLabel}
          moveDownLabel={moveDownLabel}
          formatAttachmentCount={formatAttachmentCount}
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
  if (attachment.kind === "workspace_file") {
    return (
      <WorkspaceFileAttachmentPill
        key={`workspace-file:${getWorkspaceFileAttachmentKey(attachment)}`}
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

interface QueuedMessageRowProps {
  item: QueuedMessage;
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
  /** Non-null on the head row only, and only when more than one message waits. */
  onSendAll: (() => void) | null;
  /** Null when the host cannot re-order - the move controls are then absent. */
  onMove: ((id: string, direction: "up" | "down") => void) | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  editLabel: string;
  sendNowLabel: string;
  sendAllLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  formatAttachmentCount: (count: number) => string;
}

function QueuedMessageRow({
  item,
  onEdit,
  onSendNow,
  onSendAll,
  onMove,
  canMoveUp,
  canMoveDown,
  editLabel,
  sendNowLabel,
  sendAllLabel,
  moveUpLabel,
  moveDownLabel,
  formatAttachmentCount,
}: QueuedMessageRowProps) {
  const iconSize = useIconSize();
  const handleEdit = useCallback(() => {
    onEdit(item.id);
  }, [onEdit, item.id]);
  const handleSendNow = useCallback(() => {
    onSendNow(item.id);
  }, [onSendNow, item.id]);
  const handleMoveUp = useCallback(() => {
    onMove?.(item.id, "up");
  }, [onMove, item.id]);
  const handleMoveDown = useCallback(() => {
    onMove?.(item.id, "down");
  }, [onMove, item.id]);
  // The daemon-backed queue reports what IT holds; the client-held queue only
  // has its own array. Read both so the count is right on either path.
  const attachmentCount = item.attachmentCount ?? item.attachments.length;
  return (
    <View style={styles.queueItem}>
      {onMove ? (
        // Stacked half-height arrows read as one order control instead of two
        // buttons competing with edit/send. The ends of the queue keep their
        // arrow, disabled, so every row's controls stay on the same grid.
        <View style={styles.queueMoveColumn}>
          <Pressable
            onPress={handleMoveUp}
            disabled={!canMoveUp}
            hitSlop={QUEUE_MOVE_UP_HIT_SLOP}
            style={canMoveUp ? styles.queueMoveButton : QUEUE_MOVE_BUTTON_DISABLED_STYLE}
            accessibilityLabel={moveUpLabel}
            accessibilityRole="button"
            accessibilityState={canMoveUp ? undefined : QUEUE_MOVE_DISABLED_STATE}
          >
            <ThemedChevronUp
              size={iconSize.xs}
              uniProps={canMoveUp ? iconForegroundMapping : iconForegroundMutedMapping}
            />
          </Pressable>
          <Pressable
            onPress={handleMoveDown}
            disabled={!canMoveDown}
            hitSlop={QUEUE_MOVE_DOWN_HIT_SLOP}
            style={canMoveDown ? styles.queueMoveButton : QUEUE_MOVE_BUTTON_DISABLED_STYLE}
            accessibilityLabel={moveDownLabel}
            accessibilityRole="button"
            accessibilityState={canMoveDown ? undefined : QUEUE_MOVE_DISABLED_STATE}
          >
            <ThemedChevronDown
              size={iconSize.xs}
              uniProps={canMoveDown ? iconForegroundMapping : iconForegroundMutedMapping}
            />
          </Pressable>
        </View>
      ) : null}
      {attachmentCount > 0 ? (
        // Leads the row, ahead of the text: the whole point is that the
        // attachments are visibly part of the queued message, not an
        // afterthought hidden behind the actions.
        <View
          style={styles.queueAttachmentBadge}
          testID="composer-queue-attachment-count"
          accessibilityLabel={formatAttachmentCount(attachmentCount)}
        >
          <ThemedPaperclip size={iconSize.xs} uniProps={iconForegroundMutedMapping} />
          <Text style={styles.queueAttachmentCount}>{attachmentCount}</Text>
        </View>
      ) : null}
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        {onSendAll ? (
          <Pressable
            onPress={onSendAll}
            style={styles.queueSendAllButton}
            accessibilityLabel={sendAllLabel}
            accessibilityRole="button"
          >
            <Text style={styles.queueSendAllText}>{sendAllLabel}</Text>
          </Pressable>
        ) : null}
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
  attachment: Extract<
    ComposerAttachment,
    { kind: "github_pr" | "github_issue" | "forge_change_request" | "forge_issue" }
  >;
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
  const kindLabel = item.kind === "change_request" ? "PR" : "issue";
  const iconSize = useIconSize();
  const icon = useMemo(
    () =>
      item.kind === "change_request" ? (
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
        subtitle={`${item.kind === "change_request" ? "PR" : "Issue"} #${item.number}`}
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

interface WorkspaceFileAttachmentPillProps {
  attachment: WorkspaceFileComposerAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
  removeLabel: string;
}

function WorkspaceFileAttachmentPill({
  attachment,
  index,
  disabled,
  onRemove,
  removeLabel,
}: WorkspaceFileAttachmentPillProps) {
  const iconSize = useIconSize();
  const icon = useMemo(
    () => <ThemedFileText size={iconSize.sm} uniProps={iconForegroundMutedMapping} />,
    [iconSize.sm],
  );
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [index, onRemove]);
  const fileName = attachment.path.split("/").pop() ?? attachment.path;
  return (
    <AttachmentPill
      testID="composer-workspace-file-attachment-pill"
      onOpen={noopCallback}
      onRemove={handleRemove}
      openAccessibilityLabel={fileName}
      removeAccessibilityLabel={removeLabel}
      disabled={disabled}
    >
      <AttachmentLabel
        icon={icon}
        title={fileName}
        subtitle={getWorkspaceFileAttachmentSubtitle(attachment)}
      />
    </AttachmentPill>
  );
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
  item: ForgeSearchItem;
  onToggle: (item: ForgeSearchItem) => void;
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
      item.kind === "change_request" ? (
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
  workspaceId?: string | null;
  /** Changing this re-runs autofocus, e.g. when a draft tab is re-selected. */
  autoFocusKey?: string;
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  /** When set, this composer starts dictation itself once ready - see
   * MessageInputProps.autoStartDictation. Consumed once via
   * onAutoStartDictationConsumed. */
  autoStartDictation?: {
    autoSend: boolean;
    preRollPcm?: string;
    speechAlreadyDetected?: boolean;
  } | null;
  onAutoStartDictationConsumed?: () => void;
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
  /** When true, pasted GitHub links must finish resolving before submit. */
  waitForGithubAutoAttachOnSubmit?: boolean;
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
  /**
   * Height of the box this composer has to fit inside, when the host measures
   * one. Caps how far the input grows on a large paste. Defaults to the window
   * height, which overstates the room a short split pane actually has.
   */
  viewportHeight?: number;
  /**
   * What this composer is for. Terminal drops the chat-agent affordances and
   * uses the terminal font; see `@/composer/input-mode`. Callers set the mode
   * and nothing else — never branch on it at the call site.
   */
  inputMode?: ComposerInputMode;
  /** Renders `value` as static text on the same surface, for content there is nothing to type into. */
  readOnly?: boolean;
  /** Replaces the submit icon with this label, still inside the composer's own toolbar row. */
  submitLabel?: string;
  /** Overrides the mode's default placeholder, for text only the caller can build. */
  placeholder?: string;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

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
    <LoadingSpinner size="small" />
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

interface ComposerVoiceModeButtonProps {
  buttonIconSize: number;
  handleToggleRealtimeVoice: () => void;
  isConnected: boolean;
  isVoiceSwitching: boolean;
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
  isCompact: boolean;
  showVoice: boolean;
}

function ComposerRightControlsSlot({
  isVoiceModeForAgent,
  hasAgent,
  isAgentRunning,
  hasSendableContent,
  isCompact,
  showVoice,
  ...voiceProps
}: ComposerRightControlsSlotProps) {
  // Live mode does not consume a typed draft, so keep the control out of the
  // way until the composer is clear on every form factor.
  const hideVoiceForCompactInput = isCompact && hasSendableContent;
  const showVoiceModeButton =
    showVoice && !isVoiceModeForAgent && hasAgent && !isAgentRunning && !hideVoiceForCompactInput;
  if (!showVoiceModeButton) return null;
  return (
    <View style={styles.rightControls}>
      <ComposerVoiceModeButton {...voiceProps} />
    </View>
  );
}

function ComposerVoiceModeButton({
  buttonIconSize,
  handleToggleRealtimeVoice,
  isConnected,
  isVoiceSwitching,
  realtimeVoiceButtonStyle,
  voiceToggleKeys,
  t,
}: ComposerVoiceModeButtonProps) {
  const shortcutNode = voiceToggleKeys ? <Shortcut chord={voiceToggleKeys} /> : null;
  const renderTriggerContent = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (isVoiceSwitching) {
        return <LoadingSpinner size="small" />;
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
        disabled={!isConnected || isVoiceSwitching}
        accessibilityLabel={t("composer.voice.enableVoiceMode")}
        accessibilityRole="button"
        style={realtimeVoiceButtonStyle}
      >
        {(state) => (
          <View style={styles.shortcutDiscoveryAnchor}>
            {renderTriggerContent({
              hovered: "hovered" in state && Boolean(state.hovered),
              pressed: state.pressed,
            })}
            <ShortcutDiscoveryHint
              action="message-input.action"
              bindingIds={[
                "message-input-voice-toggle-cmd-shift-d-mac",
                "message-input-voice-toggle-ctrl-shift-d-non-mac",
              ]}
              style={styles.shortcutDiscoveryHint}
            />
          </View>
        )}
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
  workspaceId,
  autoFocusKey,
  agentId,
  serverId,
  isPaneFocused,
  autoStartDictation,
  onAutoStartDictationConsumed,
  onSubmitMessage,
  onClientSlashCommand,
  hasExternalContent = false,
  allowEmptySubmit = false,
  submitButtonAccessibilityLabel,
  submitButtonTestID,
  submitIcon = "arrow",
  isSubmitLoading = false,
  waitForGithubAutoAttachOnSubmit = false,
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
  viewportHeight,
  inputMode = "chat",
  readOnly = false,
  submitLabel,
  placeholder,
}: ComposerProps) {
  const mode = resolveComposerInputMode(inputMode);
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

  // Daemon-owned when the host advertises it, client-held otherwise - the
  // composer only ever talks to this controller. See composer/queue.ts.
  const messageQueue = useComposerQueue({ serverId, agentId, client, encodeImages });
  const queuedMessages = messageQueue.items;

  // AI prompt suggestion (ghost-text watermark) + sent-message history stack.
  const promptSuggestion = useSessionStore((state) =>
    state.sessions[serverId]?.agentPromptSuggestions.get(agentId),
  );
  const sentPromptHistory = useSessionStore((state) =>
    state.sessions[serverId]?.sentPromptHistory.get(agentId),
  );
  const setAgentPromptSuggestion = useSessionStore((state) => state.setAgentPromptSuggestion);
  // "Follow prompt suggestions" (composer/follow-suggestion/). Separate from
  // Auto mode by construction: nothing here touches a permission mode.
  const resetFollowSuggestionChain = useFollowSuggestionChainStore((state) => state.resetChain);
  const appendSentPrompt = useSessionStore((state) => state.appendSentPrompt);

  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompactLayout = resolveCompactLayout(isCompactLayoutOverride, isCompactFormFactor);
  const isDesktopWebBreakpoint = resolveIsDesktopWebBreakpoint(isCompactFormFactor);
  const isDesktopLayout = resolveIsDesktopWebBreakpoint(isCompactLayout);
  const messagePlaceholder = resolveMessagePlaceholder(inputMode, isDesktopLayout, t, placeholder);
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
  const supportsForgeSearch = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeSearch === true,
  );
  const githubAutoAttach = useComposerGithubAutoAttach({
    text: userInput,
    remoteUrl: resolveCheckoutRemoteUrl(checkoutStatusQuery.status),
    attachments,
    client,
    isConnected,
    serverId,
    cwd,
    supportsForgeSearch,
    setAttachments: setSelectedAttachments,
  });
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const [isGithubPickerOpen, setIsGithubPickerOpen] = useState(false);
  const [githubSearchQuery, setGithubSearchQuery] = useState("");
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState("");
  const [lightboxMetadata, setLightboxMetadata] = useState<AttachmentMetadata | null>(null);
  const attachButtonRef = useRef<View | null>(null);
  const messageInputRef = useRef<MessageInputRef>(null);
  const isComposerLocked = resolveIsComposerLocked(submitBehavior, isSubmitLoading);
  const keyboardHandlerIdRef = useRef(
    `message-input:${serverId}:${agentId}:${Math.random().toString(36).slice(2)}`,
  );

  // On mobile the chat layout reflows at send time as if the keyboard were
  // already gone, so the soft keyboard must start dismissing immediately with
  // the send - not linger over the response. Hardware-keyboard sends (soft
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

  // Picking an `@` mention attaches a pill instead of splicing a quoted path
  // into the prose - the same `file_context` attachment the file explorer, the
  // Changes pane and the editor produce, so one file has one pill however the
  // user reached for it, and one X removes it.
  const mentionAttachmentScopeKey = attachmentWriteScopeKey ?? attachmentScopeKeys[0];
  const attachWorkspaceEntryMention = useCallback(
    (entry: { path: string; kind: "file" | "directory" }) => {
      if (!mentionAttachmentScopeKey) {
        return false;
      }
      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({
        scopeKey: mentionAttachmentScopeKey,
        attachment: createFileContextAttachment({ path: entry.path, entryKind: entry.kind }),
      });
      return true;
    },
    [mentionAttachmentScopeKey],
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
    onAttachWorkspaceEntry: attachWorkspaceEntryMention,
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

  const handleWorkspaceFileDropped = useCallback(
    (payload: WorkspaceFileDragPayload) => {
      if (!workspaceId) return;
      const attachment = resolveWorkspaceFileDrop({ payload, serverId, workspaceId });
      if (!attachment) return;
      setSelectedAttachments((current) => appendWorkspaceFileAttachment(current, attachment));
      focusInput();
    },
    [focusInput, serverId, setSelectedAttachments, workspaceId],
  );

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

  const registerWidgetPromptSender = useWidgetPromptStore((state) => state.registerSender);

  // Widgets in this chat's transcript may call sendPrompt(). Registering here
  // is what makes the "active chat only" rule real rather than advisory: a
  // widget resolves its sender from the mounted composer, so one sitting in a
  // background tab or an unopened transcript finds nothing and does nothing.
  //
  // Routes through submitMessage rather than the full composer submit path on
  // purpose - the widget's message must not clear a draft the user is halfway
  // through typing, and must not force-interrupt a running turn.
  useEffect(() => {
    return registerWidgetPromptSender({ serverId, agentId }, (text) => {
      void submitMessage(text, []).catch((error: unknown) => {
        console.error("[Composer] Widget prompt failed to send:", error);
      });
    });
  }, [registerWidgetPromptSender, serverId, agentId, submitMessage]);

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
      await dispatchComposerAgentMessage({
        client,
        agentId: targetAgentId,
        text,
        attachments: sendAttachments,
        encodeImages,
        submission: createMessageSubmissionWriter(serverId),
      });
      onAttentionPromptSend?.();
    };
  }, [client, onAttentionPromptSend, serverId, t]);

  useEffect(() => {
    onSubmitMessageRef.current = onSubmitMessage;
  }, [onSubmitMessage]);

  const hasActiveTurn = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isActive,
  );
  const isCancellingAgent = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isCancelling,
  );
  const beginAgentCancellation = useSessionStore((state) => state.beginAgentCancellation);
  const settleAgentCancellation = useSessionStore((state) => state.settleAgentCancellation);
  const isAgentRunning = hasActiveTurn;
  const hasAgent = agentState.status !== null;

  const queueMessage = useCallback(
    (queuedMessage: string, queuedAttachments: ComposerAttachment[]) => {
      const trimmed = queuedMessage.trim();
      if (!trimmed && queuedAttachments.length === 0) return;

      // Queueing is a send from the reader's point of view: they hit Enter and
      // expect to see where their words landed. docs/chat-scrolling.md counts
      // "sending a message" among the three explicit take-me-to-the-bottom
      // requests, and leaving this path out of it meant a reader who had scrolled
      // up stayed scrolled up with no sign the message went anywhere.
      onMessageSent?.();

      // Clear optimistically: the row appears from the queue controller either
      // way, and a failed enqueue surfaces as a send error like any other.
      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      clearSentAttachments(queuedAttachments);
      void messageQueue.enqueue(trimmed, queuedAttachments).catch((error: unknown) => {
        setSendError(error instanceof Error ? error.message : t("composer.errors.failedToSend"));
      });
    },
    [
      clearSentAttachments,
      messageQueue,
      onMessageSent,
      resetSuppression,
      setSelectedAttachments,
      setUserInput,
      t,
    ],
  );

  const sendMessageWithContent = useCallback(
    async (
      outgoingMessage: string,
      outgoingAttachments: ComposerAttachment[],
      forceSend?: boolean,
      // "follow-suggestion" marks a prompt Otto accepted on the user's behalf.
      // Only a "user" send re-arms the follow chain, which is what keeps a
      // self-prompting chat from renewing its own budget.
      origin: "user" | "follow-suggestion" = "user",
    ): Promise<boolean> => {
      // A forced send to a busy agent interrupts the active turn server-side,
      // which kills any in-flight observed subagents/workflows - confirm first
      // (suppressible). Runs before submitAgentInput so a cancel leaves the
      // composer untouched - including its grown height (the false return
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
      // The user participating re-arms the follow chain, so an attachment-only
      // send counts too - hence the reset sits outside the text-only block.
      if ((result === "submitted" || result === "queued") && origin === "user") {
        resetFollowSuggestionChain(serverId, agentId);
      }
      if ((result === "submitted" || result === "queued") && outgoingMessage.trim()) {
        appendSentPrompt(serverId, agentId, outgoingMessage);
        historyNavRef.current = { index: null, stashed: "" };
        // The box was just cleared programmatically, which fires no selection
        // event - mirror that so the ArrowUp caret gate is not left stale.
        selectionRef.current = { start: 0, end: 0 };
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
      resetFollowSuggestionChain,
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

  // Opt-in autonomy: take the suggestion the agent already produced instead of
  // waiting for Tab and Enter. Every guard, and the per-chat bound that stops an
  // unattended chat from prompting itself forever, lives in
  // composer/follow-suggestion/decide.ts.
  useFollowPromptSuggestion({
    serverId,
    agentId,
    suggestion: promptSuggestion,
    arePromptSuggestionsEnabled: appSettings.promptSuggestionsEnabled,
    draftText: userInput,
    attachmentCount: selectedAttachments.length,
    queuedCount: queuedMessages.length,
    isAgentRunning,
    canSubmit: isConnected || Boolean(onSubmitMessage),
    onFollow: (prompt) => {
      void sendMessageWithContent(prompt, [], false, "follow-suggestion");
    },
  });

  const handlePickImage = useCallback(async () => {
    const newImages = await pickAndPersistImages({
      pickImages,
      persister: composerImageAttachmentPersister,
    });
    if (newImages.length === 0) return;
    addImages(newImages);
  }, [addImages, pickImages]);

  const handlePasteImage = useCallback(async () => {
    try {
      const newImages = await pickAndPersistImages({
        pickImages: async () => {
          const image = await readClipboardImage(Clipboard);
          return image ? [image] : null;
        },
        persister: composerImageAttachmentPersister,
      });
      if (newImages.length === 0) {
        toastErrorRef.current(t("composer.errors.noClipboardImage"));
        return;
      }
      addImages(newImages);
    } catch (error) {
      console.error("[Composer] Failed to paste clipboard image:", error);
      toastErrorRef.current(t("composer.errors.pasteImageFailed"));
    }
  }, [addImages, t]);

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

  const handleCancelAgent = useCallback(() => {
    const targetAgentId = agentIdRef.current;
    const cancellation = cancelComposerAgent({
      client,
      agentId: targetAgentId,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
    });
    if (!cancellation) return;
    const requestId = beginAgentCancellation(serverId, targetAgentId);
    void cancellation
      .catch((error) => {
        const message = resolveErrorMessage(error);
        if (message && message.trim().length > 0) {
          toastErrorRef.current(message);
        }
      })
      .finally(() => {
        settleAgentCancellation(serverId, targetAgentId, requestId);
      });
    messageInputRef.current?.focus();
  }, [
    beginAgentCancellation,
    client,
    isAgentRunning,
    isCancellingAgent,
    isConnected,
    serverId,
    settleAgentCancellation,
  ]);

  const focusMessageInputForKeyboardAction = useCallback(() => {
    focusMessageInputWithPlatformStrategy(messageInputRef);
  }, []);

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
      }),
    [
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
      void (async () => {
        try {
          const item = await messageQueue.take(id);
          if (!item) return;
          setUserInput(item.text);
          setSelectedAttachments(composerWorkspaceAttachment.userAttachmentsOnly(item.attachments));
        } catch (error) {
          setSendError(error instanceof Error ? error.message : t("composer.errors.failedToSend"));
        }
      })();
    },
    [messageQueue, setSelectedAttachments, setUserInput, t],
  );

  // Null when this host has no way to re-order, which is what hides the
  // controls - the capability check lives in useComposerQueue, not here.
  const queueMove = messageQueue.move;
  const handleMoveQueuedMessage = useMemo(
    () =>
      queueMove
        ? (id: string, direction: "up" | "down") => {
            void queueMove(id, direction).catch((error: unknown) => {
              setSendError(
                error instanceof Error ? error.message : t("composer.errors.failedToSend"),
              );
            });
          }
        : null,
    [queueMove, t],
  );

  const handleSendQueuedNow = useCallback(
    async (id: string) => {
      if (!sendAgentMessageRef.current && !onSubmitMessageRef.current) return;
      // "Send now" on a queued message interrupts the active turn, which kills
      // any in-flight observed subagents/workflows - confirm first (suppressible).
      if (isAgentRunning) {
        const confirmedInterrupt = await confirmInterruptWithLiveSubagents({
          serverId,
          parentAgentId: agentId,
        });
        if (!confirmedInterrupt) {
          return;
        }
      }
      // Take it out of the queue first, then reuse the regular send path - the
      // server-side send atomically interrupts whatever is running.
      let taken: ComposerQueueItem | null = null;
      try {
        taken = await messageQueue.take(id);
        if (!taken) return;
        await submitMessage(taken.text, taken.attachments);
      } catch (error) {
        // The entry is already out of the queue, so put it back where the user
        // can act on it rather than dropping it on the floor.
        if (taken) {
          setUserInput(taken.text);
          setSelectedAttachments(
            composerWorkspaceAttachment.userAttachmentsOnly(taken.attachments),
          );
        }
        setSendError(error instanceof Error ? error.message : t("composer.errors.failedToSend"));
      }
    },
    [
      agentId,
      isAgentRunning,
      messageQueue,
      serverId,
      setSelectedAttachments,
      setUserInput,
      submitMessage,
      t,
    ],
  );

  /**
   * Run the whole queue now, as ONE turn: the same thing the drain does when
   * the turn in flight ends, just without the wait. Text is joined with a blank
   * line and attachments are concatenated in queue order, matching the daemon's
   * `mergeSteerQueueBatch`, so "Send all" and a natural drain produce the same
   * prompt. Entries the drain beat us to simply come back empty and are skipped.
   */
  const handleSendAllQueued = useCallback(async () => {
    if (!sendAgentMessageRef.current && !onSubmitMessageRef.current) return;
    // Which entries may merge is the queue's own question, and it must be asked
    // live: a message queued a moment ago is on screen before this client knows
    // the id to file its attachments under, so the rendered snapshot can show a
    // row as unbackable that is merely still settling. See useComposerQueue.
    const sendable = await messageQueue.listSendable();
    const ids = sendable.map((item) => item.id);
    if (ids.length === 0) return;
    if (isAgentRunning) {
      const confirmedInterrupt = await confirmInterruptWithLiveSubagents({
        serverId,
        parentAgentId: agentId,
      });
      if (!confirmedInterrupt) {
        return;
      }
    }
    const taken: ComposerQueueItem[] = [];
    try {
      for (const id of ids) {
        const item = await messageQueue.take(id);
        if (item) {
          taken.push(item);
        }
      }
      if (taken.length === 0) return;
      const mergedText = taken
        .map((item) => item.text.trim())
        .filter((text) => text.length > 0)
        .join("\n\n");
      const mergedAttachments = taken.flatMap((item) => item.attachments);
      await submitMessage(mergedText, mergedAttachments);
    } catch (error) {
      // Everything pulled so far is already out of the queue, so hand it back in
      // the box rather than dropping it.
      if (taken.length > 0) {
        setUserInput(
          taken
            .map((item) => item.text.trim())
            .filter((text) => text.length > 0)
            .join("\n\n"),
        );
        setSelectedAttachments(
          composerWorkspaceAttachment.userAttachmentsOnly(taken.flatMap((it) => it.attachments)),
        );
      }
      setSendError(error instanceof Error ? error.message : t("composer.errors.failedToSend"));
    }
  }, [
    agentId,
    isAgentRunning,
    messageQueue,
    serverId,
    setSelectedAttachments,
    setUserInput,
    submitMessage,
    t,
  ]);

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

  // Recall swaps the value programmatically, which does not move the caret on
  // every platform - park it at the end so the next keystroke appends, matching
  // shell history. Deferred a frame so the new value has reached the TextInput.
  const parkCaretAtEnd = useCallback(() => {
    setTimeout(() => {
      messageInputRef.current?.moveCaretToEnd();
    }, 0);
  }, []);

  // ArrowUp/ArrowDown walk the sent-message stack (shell-history semantics). The
  // first ArrowUp requires an empty box or the caret at the very start so it
  // never hijacks multiline cursor movement; once navigating, arrows own the box.
  const recallSentPrompt = useCallback(
    (direction: "prev" | "next") => {
      const history = sentPromptHistoryRef.current;
      if (!history || history.length === 0) return false;
      const nav = historyNavRef.current;
      if (direction === "prev") {
        if (nav.index === null) {
          const sel = selectionRef.current;
          // An empty box has nowhere for ArrowUp to move the caret, so it always
          // recalls - `selectionRef` can still hold the pre-clear offset after a
          // send, since clearing the value fires no selection event.
          if (userInputRef.current.length > 0 && (sel.start !== 0 || sel.end !== 0)) return false;
          historyNavRef.current = { index: history.length - 1, stashed: userInputRef.current };
        } else if (nav.index > 0) {
          historyNavRef.current = { index: nav.index - 1, stashed: nav.stashed };
        }
        setUserInput(history[historyNavRef.current.index ?? 0]);
        parkCaretAtEnd();
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
      parkCaretAtEnd();
      return true;
    },
    [parkCaretAtEnd, setUserInput],
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

  const activeActionContent = useMemo(
    () => (
      <ComposerCancelButton
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
      isCancellingAgent,
      isConnected,
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
        isCompact={isCompactLayout}
        showVoice={mode.showVoice}
        buttonIconSize={buttonIconSize}
        handleToggleRealtimeVoice={handleToggleRealtimeVoice}
        isConnected={isConnected}
        isVoiceSwitching={isVoiceSwitching}
        realtimeVoiceButtonStyle={realtimeVoiceButtonStyle}
        voiceToggleKeys={voiceToggleKeys}
        t={t}
      />
    ),
    [
      buttonIconSize,
      handleToggleRealtimeVoice,
      hasAgent,
      hasSendableContent,
      isAgentRunning,
      isConnected,
      isCompactLayout,
      isVoiceModeForAgent,
      isVoiceSwitching,
      mode.showVoice,
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
  const githubSearchResultsQuery = useForgeSearchQuery({
    client,
    serverId,
    cwd,
    query: githubSearchQueryTrimmed,
    enabled: resolvePickerSearchEnabled(isGithubPickerOpen, isConnected, cwd),
    supportsForgeSearch,
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
  const folderAttachmentScopeKey = mentionAttachmentScopeKey;
  const handleSelectFolder = useCallback(
    (path: string) => {
      if (!folderAttachmentScopeKey) return;
      addWorkspaceAttachment({
        scopeKey: folderAttachmentScopeKey,
        attachment: createFileContextAttachment({ path, entryKind: "directory" }),
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
        id: "image",
        label: t("composer.attachments.addImage"),
        icon: <ThemedImageIcon size={iconSize.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          void handlePickImage();
        },
      },
      isNative
        ? {
            id: "paste-image",
            label: t("composer.attachments.pasteImage"),
            icon: <ThemedClipboardPaste size={iconSize.md} uniProps={iconForegroundMutedMapping} />,
            onSelect: () => {
              void handlePasteImage();
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
    ];
    return items.filter((item): item is AttachmentMenuItem => item !== null);
  }, [folderAttachmentScopeKey, handlePasteImage, handlePickFile, handlePickImage, iconSize.md, t]);

  const handleToggleGithubItem = useCallback(
    (item: ForgeSearchItem) => {
      const nextAttachments = toggleGithubAttachmentFromPicker({
        current: attachments,
        item,
        markGithubAttachmentRemoved: githubAutoAttach.markGithubAttachmentRemoved,
      });
      setSelectedAttachments(nextAttachments);
      setIsGithubPickerOpen(false);
      setGithubSearchQuery("");
    },
    [
      attachments,
      githubAutoAttach,
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
        isPaneFocused,
        showAgentControls: mode.showAgentControls,
      }),
    [
      agentControls,
      agentId,
      focusInput,
      isCompactLayout,
      isPaneFocused,
      mode.showAgentControls,
      serverId,
    ],
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
        handleSendAllQueued,
        handleMoveQueuedMessage,
        editLabel: t("composer.attachments.editQueuedMessage"),
        sendNowLabel: t("composer.attachments.sendQueuedMessageNow"),
        sendAllLabel: t("composer.attachments.sendAllQueuedMessages"),
        moveUpLabel: t("composer.attachments.moveQueuedMessageUp"),
        moveDownLabel: t("composer.attachments.moveQueuedMessageDown"),
        formatAttachmentCount: (count: number) =>
          t("composer.attachments.queuedAttachments", { count }),
      }),
    [
      handleEditQueuedMessage,
      handleMoveQueuedMessage,
      handleSendAllQueued,
      handleSendQueuedNow,
      queuedMessages,
      t,
    ],
  );

  const messageInputContainerRef = useRef<View>(null);

  const isSubmitLoadingVisible = isProcessing || isSubmitLoading || isUploadingFile;
  const isSubmitDisabled =
    isSubmitLoadingVisible || (waitForGithubAutoAttachOnSubmit && githubAutoAttach.isResolving);

  // Disable drops while submitting/uploading: the submit path clears and restores attachments,
  // so a drop in that window would be lost or land on a locked draft. `disabled` hides the
  // backdrop and rejects the drop atomically, instead of accepting a drop with no feedback.
  useFileDrop(
    {
      onFiles: addImages,
      onGenericFiles: handleGenericFilesDropped,
      onWorkspaceFile: handleWorkspaceFileDropped,
    },
    { disabled: isSubmitLoadingVisible },
  );

  const messageInputAutoFocus = autoFocus && isDesktopWebBreakpoint;
  const submitLoadingPressHandler = isAgentRunning ? handleCancelAgent : undefined;
  const sendErrorNode = useMemo(
    () => (sendError ? <Text style={styles.sendErrorText}>{sendError}</Text> : null),
    [sendError],
  );
  const githubEmptyText = githubSearchResultsQuery.isFetching
    ? t("composer.github.searching")
    : t("composer.github.noResults");
  const folderEmptyText = folderSearchResultsQuery.isFetching
    ? t("composer.folder.searching")
    : t("composer.folder.noResults");
  const autocompleteVisible = autocomplete.isVisible && isPaneFocused && mode.showAutocomplete;
  const renderAttachmentLightbox = useCallback(
    () => <AttachmentLightbox metadata={lightboxMetadata} onClose={handleLightboxClose} />,
    [handleLightboxClose, lightboxMetadata],
  );

  return (
    <ComposerKeyboardScopeProvider isActiveComposer={isPaneFocused}>
      <ComposerFrame
        externalKeyboardShift={externalKeyboardShift}
        footer={renderComposerFooter(footer, null)}
        isLocked={isComposerLocked}
        renderOverlay={renderAttachmentLightbox}
      >
        {queueList}
        {sendErrorNode}

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
            isSubmitDisabled={isSubmitDisabled}
            isSubmitLoading={isSubmitLoadingVisible}
            preserveHeightOnSubmit={submitBehavior === "preserve-and-lock"}
            attachments={selectedAttachments}
            cwd={cwd}
            attachmentMenuItems={attachmentMenuItems}
            onAttachButtonRef={handleAttachButtonRef}
            onAddImages={addImages}
            client={client}
            isReadyForDictation={isDictationReady}
            placeholder={
              appSettings.promptSuggestionsEnabled && promptSuggestion && userInput.length === 0
                ? promptSuggestion
                : messagePlaceholder
            }
            autoFocus={messageInputAutoFocus}
            autoFocusKey={`${serverId}:${agentId}:${autoFocusKey ?? ""}`}
            disabled={isSubmitLoading}
            isPaneFocused={isPaneFocused}
            autoStartDictation={autoStartDictation}
            onAutoStartDictationConsumed={onAutoStartDictationConsumed}
            leadingContent={mode.showUsageMeter ? contextWindowMeter : null}
            showAutoSpeechButton={mode.showAutoSpeechButton}
            leftContent={leftContent}
            rightContent={rightContent}
            activeActionContent={activeActionContent}
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
            viewportHeight={viewportHeight}
            inputWrapperStyle={inputWrapperStyle}
            attachmentSlot={attachmentTray}
            inputMode={inputMode}
            readOnly={readOnly}
            submitLabel={submitLabel}
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
      </ComposerFrame>
    </ComposerKeyboardScopeProvider>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
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
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutDiscoveryAnchor: {
    position: "relative",
  },
  shortcutDiscoveryHint: {
    position: "absolute",
    top: -theme.spacing[2],
    right: -theme.spacing[2],
    zIndex: 1,
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
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  // Leads the row. Sized to sit under the text's baseline weight so it reads as
  // a marker on the message, not a control competing with edit/send.
  queueAttachmentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  queueAttachmentCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  // 15 + 2 + 15 stacks to the same 32 as the round action buttons beside it, so
  // adding the move control does not change the row's height.
  queueMoveColumn: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: compactUp(2),
  },
  queueMoveButton: {
    width: compactUp(20),
    height: compactUp(15),
    borderRadius: theme.borderRadius.base,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueMoveButtonDisabled: {
    backgroundColor: "transparent",
  },
  queueSendAllButton: {
    height: 32,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
  },
  queueSendAllText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  queueSendButton: {
    backgroundColor: theme.colors.accent,
  },
  sendErrorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
})) as unknown as Record<string, object>;

const QUEUE_SEND_BUTTON_STYLE = [styles.queueActionButton, styles.queueSendButton];
const QUEUE_MOVE_DISABLED_STATE = { disabled: true } as const;
const QUEUE_MOVE_BUTTON_DISABLED_STYLE = [styles.queueMoveButton, styles.queueMoveButtonDisabled];
// Slop only points away from the pair, so the two stacked targets cannot overlap.
const QUEUE_MOVE_UP_HIT_SLOP = { top: 6, bottom: 0, left: 6, right: 6 } as const;
const QUEUE_MOVE_DOWN_HIT_SLOP = { top: 0, bottom: 6, left: 6, right: 6 } as const;

const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedAudioLines = withUnistyles(AudioLines);
const ThemedUploadFile = withUnistyles(UploadFile);
const ThemedFolder = withUnistyles(Folder);
const ThemedImageIcon = withUnistyles(ImageIcon);
const ThemedClipboardPaste = withUnistyles(ClipboardPaste);
const ThemedFileText = withUnistyles(FileText);
const ThemedGithub = withUnistyles(Github);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
