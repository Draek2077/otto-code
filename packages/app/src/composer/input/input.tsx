import {
  View,
  Text,
  TextInput,
  useWindowDimensions,
  type PressableStateCallbackType,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTranslation } from "react-i18next";
import { compactUp, type Theme } from "@/styles/theme";
import {
  ArrowUp,
  Split,
  Mic,
  MicOff,
  CornerDownLeft,
  Paperclip,
  Square,
} from "@/components/icons/material-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  type AnimatedStyle,
} from "react-native-reanimated";
import { useDictation } from "@/hooks/use-dictation";
import { useWakeWordListening } from "@/hooks/use-wake-word-listening";
import { shouldStartWakeWordListening } from "@/voice/wake-word-control-state";
import { useAppSettings } from "@/hooks/use-settings";
import { DictationOverlay } from "@/components/dictation-controls";
import { RealtimeVoiceOverlay } from "@/components/realtime-voice-overlay";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { useVoiceOptional, useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { resolveVoiceUnavailableMessage } from "@/utils/server-info-capabilities";
import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment, MessagePayload } from "@/composer/types";
import { focusWithRetries } from "@/utils/web-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { ShortcutDiscoveryHint } from "@/components/shortcut-discovery-overlay";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useShowShortcutDiscovery } from "@/hooks/use-show-shortcut-badges";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useIosHardwareKeyboardSubmit } from "@/hooks/use-ios-hardware-keyboard-submit";
import { formatShortcut } from "@/utils/format-shortcut";
import { mergeRefs } from "@/utils/merge-refs";
import { useTutorialAnchor } from "@/tutorial/use-tutorial-anchor";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { AutoSpeechButton } from "./auto-speech-button";
import { useComposerHeightMirror } from "./height-mirror";
import { MIN_INPUT_HEIGHT, resolveMaxInputHeight } from "./max-height";
import { resolveComposerInputMode, type ComposerInputMode } from "@/composer/input-mode";
import {
  resolveSendTooltipLabel,
  resolveSendButtonIcon,
  resolvePreviewActionQueues,
  resolveUsesAlternateSendAction,
  resolveSubmitAccessibilityLabel,
  resolveVoiceAccessibilityLabel,
  resolveVoiceTooltipText,
} from "./labels";
import { computeCanStartDictation, runAlternateSendAction, runDefaultSendAction } from "./state";
import { ComposerToolbarProvider } from "./toolbar-provider";
import { TOOLBAR_GROUP_GAP, useComposerToolbarLayout } from "./toolbar-stage";
import { applyDictationTranscript } from "./dictation-delivery";
import { playDictationStartCue } from "@/voice/dictation-start-cue";
import type { IconSizeProp, IconSizeToken } from "@/components/icons/icon-size";
import { COMPOSER_ICON_SIZE } from "@/composer/composer-icon-size";
import { usePasteImagesEffect, type TextAreaHandle } from "./paste-images";
const COMPOSER_INPUT_DATASET = { composerInput: "" } as const;

export interface AttachmentMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  icon?: React.ReactElement | null;
}

/**
 * Submit handler result: a `false` resolution means the submit was vetoed
 * downstream (e.g. the interrupt-a-running-agent confirm was cancelled) and
 * the composer text stayed put - callers must not collapse the input height.
 * `void`/`true` (sync or async) means the message is on its way.
 */
export type SubmitMessageHandler = (
  payload: MessagePayload,
) => void | boolean | Promise<boolean | void>;

export interface MessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: SubmitMessageHandler;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the submit button stays visible and can submit even with no content. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  /** Optional testID for the primary submit button. */
  submitButtonTestID?: string;
  submitIcon?: "arrow" | "return";
  isSubmitDisabled?: boolean;
  isSubmitLoading?: boolean;
  /** When true, keep the grown input height after submit (text is preserved, not cleared). */
  preserveHeightOnSubmit?: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  /** Hide agent-only attachment controls while retaining the composer chrome and control slots. */
  showAttachmentButton?: boolean;
  /** Hide the per-chat auto-speech toggle when this is a secondary composer. */
  showAutoSpeechButton?: boolean;
  onAttachButtonRef?: (node: View | null) => void;
  onAddImages?: (images: ImageAttachment[]) => void;
  client: DaemonClient | null;
  /** Dictation start gate from host runtime (socket connected + directory ready). */
  isReadyForDictation?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string;
  disabled?: boolean;
  /** True when this composer's pane is focused. Used to gate global hotkeys and stop dictation when hidden. */
  isPaneFocused?: boolean;
  /** When set, this composer starts dictation itself once ready - used when a
   * chat was just opened by "Hey Otto" triggering with no chat previously
   * focused (see WakeWordEmptyStateListener). Consumed once via
   * onAutoStartDictationConsumed so it never refires on re-render. */
  autoStartDictation?: {
    autoSend: boolean;
    preRollPcm?: string;
    speechAlreadyDetected?: boolean;
  } | null;
  onAutoStartDictationConsumed?: () => void;
  /** Content rendered immediately after the attach button, before leftContent (e.g., usage ring). */
  leadingContent?: React.ReactNode;
  /** Content to render on the left side of the composer toolbar (e.g., AgentControls) */
  leftContent?: React.ReactNode;
  /** Content to render on the right side after voice button (e.g., realtime button, cancel button) */
  /** Content to render on the right side before the voice button (e.g., context window meter) */
  beforeVoiceContent?: React.ReactNode;
  /** Auxiliary content to render on the right side after the voice button. */
  rightContent?: React.ReactNode;
  /** Primary action to render when the agent is active and the composer has no sendable content. */
  activeActionContent?: React.ReactNode;
  voiceServerId?: string;
  voiceAgentId?: string;
  /** When true and there's sendable content, calls onQueue instead of onSubmit */
  isAgentRunning?: boolean;
  /** An in-flight context compaction accepts queued prompts only. */
  isCompacting?: boolean;
  /** Controls what the default send action (Enter, send button, dictation) does
   *  when the agent is running. "interrupt" and "steer" send immediately, "queue" queues. */
  defaultSendBehavior?: "interrupt" | "steer" | "queue";
  /** Callback for queue button when agent is running */
  onQueue?: (payload: MessagePayload) => void;
  /** Optional handler used when submit button is in loading state. */
  onSubmitLoadingPress?: () => void;
  /** Changes when the draft's text is replaced programmatically. Used as a
   *  remount key so a rewrite does not fight the caret. */
  textReplacementKey?: string;
  /** Intercept key press events before default handling. Return true to prevent default. */
  onKeyPress?: (event: ComposerKeyPressEvent) => boolean;
  /** Reports cursor selection updates from the underlying input. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  onHeightChange?: (height: number) => void;
  /**
   * Height of the box the composer must fit inside, when the host measures one.
   * The input's growth cap is a share of this. Falls back to the window height,
   * which is wrong for a composer in a short split pane.
   */
  viewportHeight?: number;
  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Content rendered inside the bordered input surface, above the text input (e.g. attachment pills). */
  attachmentSlot?: React.ReactNode;
  /** What this composer is for. See `@/composer/input-mode` for what each mode implies. */
  inputMode?: ComposerInputMode;
  /** Renders `value` as static text on the same surface, for content there is nothing to type into. */
  readOnly?: boolean;
  /** Replaces the submit icon with this label, still inside the composer's own toolbar row. */
  submitLabel?: string;
}

export interface MessageInputRef {
  focus: () => void;
  blur: () => void;
  runKeyboardAction: (action: MessageInputKeyboardActionKind) => boolean;
  /**
   * Collapse the caret to the end of the current text. Callers that swap the
   * value programmatically (history recall, ghost-text accept) need this: a
   * controlled value change does not reposition the caret on every platform.
   */
  moveCaretToEnd: () => void;
  /**
   * Web-only: return the underlying DOM element for focus assertions/retries.
   * May return null if not mounted or on native.
   */
  getNativeElement?: () => HTMLElement | null;
}

type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    // Web-only: present on DOM KeyboardEvent during IME composition (CJK input).
    isComposing?: boolean;
    keyCode?: number;
  }
>;

function canUseAlternateSendAction(
  isAgentRunning: boolean,
  isCompacting: boolean,
  onQueue: ((payload: MessagePayload) => void) | undefined,
): boolean {
  return isAgentRunning && !isCompacting && Boolean(onQueue);
}

function AttachButtonIcon({
  hovered,
  onAttachButtonRef,
  buttonIconSize,
}: {
  hovered: boolean;
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  buttonIconSize: IconSizeProp;
}) {
  const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
  return (
    <View ref={onAttachButtonRef} collapsable={false} style={styles.attachButtonAnchor}>
      <ThemedPaperclip size={buttonIconSize} uniProps={colorMapping} />
    </View>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          testID={`message-input-attachment-menu-item-${item.id}`}
          disabled={item.disabled}
          onSelect={item.onSelect}
          leading={item.icon ?? null}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function AutoSpeechControl({
  show,
  serverId,
  agentId,
  buttonIconSize,
}: {
  show: boolean;
  serverId: string | undefined;
  agentId: string | undefined;
  buttonIconSize: IconSizeToken;
}) {
  if (!show) return null;
  return <AutoSpeechButton serverId={serverId} agentId={agentId} buttonIconSize={buttonIconSize} />;
}
function AttachmentDropdown({
  visible,
  isConnected,
  disabled,
  attachButtonStyle,
  renderAttachButtonIcon,
  attachmentMenuItems,
  addAttachmentLabel,
  addAttachmentTooltipLabel,
}: {
  visible: boolean;
  isConnected: boolean;
  disabled: boolean;
  attachButtonStyle: React.ComponentProps<typeof DropdownMenuTrigger>["style"];
  renderAttachButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
  addAttachmentLabel: string;
  addAttachmentTooltipLabel: string;
}) {
  const isButtonDisabled = !isConnected || disabled;
  if (!visible) return null;
  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={isButtonDisabled}
            accessibilityLabel={addAttachmentLabel}
            accessibilityRole="button"
            testID="message-input-attach-button"
            style={attachButtonStyle}
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{addAttachmentTooltipLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        minWidth={220}
        testID="message-input-attachment-menu"
        sheetTitle={addAttachmentLabel}
      >
        <AttachmentMenuList items={attachmentMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VoiceButtonIcon({
  hovered,
  isDictating,
  isMutedRealtime,
  buttonIconSize,
}: {
  hovered: boolean;
  isDictating: boolean;
  isMutedRealtime: boolean;
  buttonIconSize: IconSizeProp;
}) {
  if (isDictating) {
    return <Square size={buttonIconSize} color="white" />;
  }
  const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
  if (isMutedRealtime) {
    return <ThemedMicOff size={buttonIconSize} uniProps={colorMapping} />;
  }
  return <ThemedMic size={buttonIconSize} uniProps={colorMapping} />;
}

type ShortcutChord = NonNullable<React.ComponentProps<typeof Shortcut>["chord"]>;

function VoiceTooltipBody({
  voiceTooltipText,
  shortcut,
}: {
  voiceTooltipText: string;
  shortcut: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{voiceTooltipText}</Text>
      {shortcut ? <Shortcut chord={shortcut} /> : null}
    </View>
  );
}

function SendTooltipBody({ label }: { label: string }) {
  return <Text style={styles.tooltipText}>{label}</Text>;
}

function SendButtonContent({
  isSubmitLoading,
  submitIcon,
  submitLabel,
  buttonIconSize,
}: {
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return" | "steer" | "interrupt";
  submitLabel: string | undefined;
  buttonIconSize: IconSizeProp;
}) {
  if (isSubmitLoading) {
    return <ThemedActivityIndicator size="small" uniProps={iconAccentMapping} />;
  }
  if (submitLabel) {
    return <Text style={styles.sendButtonLabel}>{submitLabel}</Text>;
  }
  if (submitIcon === "return") {
    return <ThemedCornerDownLeft size={buttonIconSize} uniProps={iconAccentMapping} />;
  }
  if (submitIcon === "steer") {
    return <ThemedSplit size={buttonIconSize} uniProps={iconWarningMapping} />;
  }
  if (submitIcon === "interrupt") {
    return <ThemedArrowUp size={buttonIconSize} uniProps={iconDestructiveMapping} />;
  }
  return <ThemedArrowUp size={buttonIconSize} uniProps={iconAccentMapping} />;
}

export interface ComposerInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

export interface ComposerKeyPressEvent {
  key: string;
  preventDefault: () => void;
  /** Text and caret as they were when the key landed - the autocomplete reads
   *  this rather than a value prop that may be a render behind. */
  input: ComposerInputSnapshot;
}

interface DesktopKeyPressContext {
  onKeyPressCallback: ((event: ComposerKeyPressEvent) => boolean) | undefined;
  input: ComposerInputSnapshot;
  submitOnEnter: boolean;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  disabled: boolean;
  handleAlternateSendAction: () => void;
  handleDefaultSendAction: () => void;
}

function handleDesktopKeyPressImpl(
  event: WebTextInputKeyPressEvent,
  ctx: DesktopKeyPressContext,
): void {
  if (isImeComposingKeyboardEvent(event.nativeEvent)) return;

  if (ctx.onKeyPressCallback) {
    const handled = ctx.onKeyPressCallback({
      key: event.nativeEvent.key,
      preventDefault: () => event.preventDefault(),
      input: ctx.input,
    });
    if (handled) return;
  }

  const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;

  if (event.nativeEvent.key !== "Enter") return;
  if (!ctx.submitOnEnter) return;
  if (shiftKey) return;

  if ((metaKey || ctrlKey) && ctx.isAgentRunning && ctx.onQueue) {
    if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
    event.preventDefault();
    ctx.handleAlternateSendAction();
    return;
  }

  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  event.preventDefault();
  ctx.handleDefaultSendAction();
}

interface KeyboardActionHandlers {
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >;
  isDictatingRef: React.MutableRefObject<boolean>;
  sendAfterTranscriptRef: React.MutableRefObject<boolean>;
  confirmDictation: () => void | Promise<void>;
  cancelDictation: () => void | Promise<void>;
  startDictationIfAvailable: () => Promise<void>;
  handleToggleRealtimeVoiceShortcut: () => void;
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
}

function runKeyboardActionImpl(
  action: MessageInputKeyboardActionKind,
  h: KeyboardActionHandlers,
): boolean {
  if (action === "focus") {
    h.textInputRef.current?.focus();
    return true;
  }
  if (action === "send" || action === "dictation-confirm") {
    if (h.isDictatingRef.current) {
      h.sendAfterTranscriptRef.current = true;
      void h.confirmDictation();
      return true;
    }
    return false;
  }
  if (action === "voice-toggle") {
    h.handleToggleRealtimeVoiceShortcut();
    return true;
  }
  if (action === "voice-mute-toggle") {
    if (h.isRealtimeVoiceForCurrentAgent) {
      h.voice?.toggleMute();
    }
    return true;
  }
  if (action === "dictation-cancel") {
    if (h.isDictatingRef.current) {
      void h.cancelDictation();
      return true;
    }
    return false;
  }
  if (action === "dictation-toggle") {
    if (h.isDictatingRef.current) {
      h.sendAfterTranscriptRef.current = true;
      void h.confirmDictation();
    } else {
      void h.startDictationIfAvailable();
    }
    return true;
  }
  return false;
}

function getTextInputNativeElement(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): HTMLElement | null {
  if (!current) return null;
  const handle = current as TextInput & { getNativeRef?: () => unknown };
  const native = typeof handle.getNativeRef === "function" ? handle.getNativeRef() : current;
  return native instanceof HTMLElement ? native : null;
}

function useAutoFocusOnWebEffect(
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >,
  autoFocus: boolean,
  autoFocusKey: string | undefined,
): void {
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    return focusWithRetries({
      focus: () => textInputRef.current?.focus(),
      isFocused: () => {
        const element = getTextInputNativeElement(textInputRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return Boolean(element) && active === element;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusKey]);
}

function MessageInputOverlay({
  showDictationOverlay,
  showRealtimeOverlay,
  voice,
  dictationVolume,
  dictationDuration,
  isDictating,
  isDictationProcessing,
  dictationStatus,
  dictationError,
  onCancelRecording,
  onAcceptRecording,
  onAcceptAndSendRecording,
  onRetryFailedRecording,
  onDiscardFailedRecording,
  cleanUp,
  onToggleCleanUp,
  onRealtimeVoiceStop,
}: {
  showDictationOverlay: boolean;
  showRealtimeOverlay: boolean;
  voice:
    | {
        isMuted: boolean;
        isVoiceSwitching: boolean;
        toggleMute: () => void;
      }
    | null
    | undefined;
  dictationVolume: number;
  dictationDuration: number;
  isDictating: boolean;
  isDictationProcessing: boolean;
  dictationStatus: React.ComponentProps<typeof DictationOverlay>["status"];
  dictationError: string | null;
  onCancelRecording: () => Promise<void>;
  onAcceptRecording: () => Promise<void>;
  onAcceptAndSendRecording: () => Promise<void>;
  onRetryFailedRecording: () => void;
  onDiscardFailedRecording: () => void;
  cleanUp: boolean;
  onToggleCleanUp: () => void;
  onRealtimeVoiceStop: () => void;
}) {
  if (showDictationOverlay) {
    return (
      <DictationOverlay
        volume={dictationVolume}
        duration={dictationDuration}
        isRecording={isDictating}
        isProcessing={isDictationProcessing}
        status={dictationStatus}
        errorText={dictationStatus === "failed" ? (dictationError ?? undefined) : undefined}
        onCancel={onCancelRecording}
        onAccept={onAcceptRecording}
        onAcceptAndSend={onAcceptAndSendRecording}
        onRetry={dictationStatus === "failed" ? onRetryFailedRecording : undefined}
        onDiscard={dictationStatus === "failed" ? onDiscardFailedRecording : undefined}
        cleanUp={cleanUp}
        onToggleCleanUp={onToggleCleanUp}
      />
    );
  }
  if (showRealtimeOverlay && voice) {
    return (
      <RealtimeVoiceOverlay
        isMuted={voice.isMuted}
        isSwitching={voice.isVoiceSwitching}
        onToggleMute={voice.toggleMute}
        onStop={onRealtimeVoiceStop}
      />
    );
  }
  return null;
}

function FocusHint({
  visible,
  focusInputKeys,
  label,
}: {
  visible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  label: string;
}) {
  const shortcutDiscoveryVisible = useShowShortcutDiscovery();
  if (!visible || !focusInputKeys || !label.trim()) return null;
  if (shortcutDiscoveryVisible) {
    return (
      <ShortcutDiscoveryHint
        action="message-input.action"
        bindingIds={["message-input-focus-cmd-l-mac", "message-input-focus-ctrl-l-non-mac"]}
        style={styles.focusHintDiscovery}
      />
    );
  }
  return (
    <Text style={styles.focusHintText} pointerEvents="none">
      {label}
    </Text>
  );
}

interface ComposerTextSurfaceProps {
  textReplacementKey: string | undefined;
  readOnly: boolean;
  value: string;
  textInputRef: React.Ref<TextInput>;
  textInputStyle: React.ComponentProps<typeof ThemedTextInput>["style"];
  readOnlyTextStyle: React.ComponentProps<typeof Text>["style"];
  placeholder: string;
  accessibilityLabel: string;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  editable: boolean;
  scrollEnabled: boolean;
  autoFocus: boolean;
  onContentSizeChange: (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => void;
  onKeyPress: ((event: WebTextInputKeyPressEvent) => void) | undefined;
  onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  focusHintVisible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  focusHintLabel: string;
  inputScrollbar: React.ReactNode;
}

/**
 * The composer's content: an editable input, or static text when there is
 * nothing to type. Both sit in the same bordered surface, so read-only is a
 * state of this composer rather than a second one.
 */
function ComposerTextSurface(props: ComposerTextSurfaceProps): React.ReactElement {
  if (props.readOnly) {
    return (
      <View style={styles.textInputScrollWrapper}>
        <Text style={props.readOnlyTextStyle} testID="composer-readonly-content">
          {props.value}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.textInputScrollWrapper}>
      <ThemedTextInput
        key={props.textReplacementKey}
        ref={props.textInputRef}
        {...({ dataSet: COMPOSER_INPUT_DATASET } as Record<string, unknown>)}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        uniProps={textInputPlaceholderColorMapping}
        accessibilityLabel={props.accessibilityLabel}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        style={props.textInputStyle}
        multiline
        scrollEnabled={props.scrollEnabled}
        onContentSizeChange={props.onContentSizeChange}
        editable={props.editable}
        onKeyPress={props.onKeyPress}
        onSelectionChange={props.onSelectionChange}
        autoFocus={props.autoFocus}
        spellCheck
      />
      {props.inputScrollbar}
      <FocusHint
        visible={props.focusHintVisible}
        focusInputKeys={props.focusInputKeys}
        label={props.focusHintLabel}
      />
    </View>
  );
}

function VoiceButtonTooltip({
  visible,
  onVoicePress,
  isDictationStartEnabled,
  voiceButtonAccessibilityLabel,
  voiceButtonStyle,
  renderVoiceButtonIcon,
  voiceTooltipText,
  isRealtimeVoiceForCurrentAgent,
  voiceMuteToggleKeys,
  dictationToggleKeys,
}: {
  visible: boolean;
  onVoicePress: () => void;
  isDictationStartEnabled: boolean;
  voiceButtonAccessibilityLabel: string;
  voiceButtonStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  renderVoiceButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  voiceTooltipText: string;
  isRealtimeVoiceForCurrentAgent: boolean;
  voiceMuteToggleKeys: ShortcutChord | null | undefined;
  dictationToggleKeys: ShortcutChord | null | undefined;
}) {
  const shortcut = isRealtimeVoiceForCurrentAgent ? voiceMuteToggleKeys : dictationToggleKeys;
  if (!visible) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onVoicePress}
        disabled={!isDictationStartEnabled}
        accessibilityRole="button"
        accessibilityLabel={voiceButtonAccessibilityLabel}
        style={voiceButtonStyle}
      >
        {(state) => (
          <View style={styles.shortcutDiscoveryAnchor}>
            {renderVoiceButtonIcon({
              hovered: "hovered" in state && Boolean(state.hovered),
            })}
            {!isRealtimeVoiceForCurrentAgent ? (
              <ShortcutDiscoveryHint
                action="message-input.action"
                bindingIds={[
                  "message-input-dictation-toggle-cmd-d-mac",
                  "message-input-dictation-toggle-ctrl-d-non-mac",
                ]}
                style={styles.dictationShortcutDiscoveryHint}
              />
            ) : null}
          </View>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <VoiceTooltipBody voiceTooltipText={voiceTooltipText} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

function SendButtonTooltip({
  shouldShow,
  canPressLoadingButton,
  onSubmitLoadingPress,
  onSendButtonPress,
  isSendButtonDisabled,
  submitAccessibilityLabel,
  sendButtonCombinedStyle,
  isSubmitLoading,
  submitIcon,
  submitLabel,
  submitButtonTestID,
  buttonIconSize,
  sendTooltipLabel,
}: {
  shouldShow: boolean;
  canPressLoadingButton: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  onSendButtonPress: () => void;
  isSendButtonDisabled: boolean;
  submitAccessibilityLabel: string;
  sendButtonCombinedStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return" | "steer" | "interrupt";
  submitLabel: string | undefined;
  submitButtonTestID: string | undefined;
  buttonIconSize: IconSizeProp;
  sendTooltipLabel: string;
}) {
  if (!shouldShow) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={canPressLoadingButton ? onSubmitLoadingPress : onSendButtonPress}
        disabled={isSendButtonDisabled}
        accessibilityLabel={submitAccessibilityLabel}
        accessibilityRole="button"
        testID={submitButtonTestID}
        style={sendButtonCombinedStyle}
      >
        <SendButtonContent
          isSubmitLoading={isSubmitLoading}
          submitIcon={submitIcon}
          submitLabel={submitLabel}
          buttonIconSize={buttonIconSize}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <SendTooltipBody label={sendTooltipLabel} />
      </TooltipContent>
    </Tooltip>
  );
}

type PrimaryActionKind = "send" | "active" | "none";

function hasSendableComposerContent(input: {
  value: string;
  attachments: readonly ComposerAttachment[];
  hasExternalContent: boolean;
}): boolean {
  return input.value.trim().length > 0 || input.attachments.length > 0 || input.hasExternalContent;
}

function resolvePrimaryActionKind(input: {
  hasSendableContent: boolean;
  allowEmptySubmit: boolean;
  isAgentRunning: boolean;
  isCompacting: boolean;
  isSubmitLoading: boolean;
}): PrimaryActionKind {
  if (input.hasSendableContent || input.allowEmptySubmit) return "send";
  if (input.isAgentRunning && !input.isCompacting) return "active";
  if (input.isSubmitLoading) return "send";
  return "none";
}

function PrimaryAction({
  kind,
  activeActionContent,
  ...sendButtonProps
}: {
  kind: PrimaryActionKind;
  activeActionContent: React.ReactNode;
} & React.ComponentProps<typeof SendButtonTooltip>) {
  if (kind === "active") return activeActionContent;
  if (kind === "send") return <SendButtonTooltip {...sendButtonProps} />;
  return null;
}
interface ToggleRealtimeVoiceContext {
  voice:
    | {
        isVoiceSwitching: boolean;
        isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
        startVoice: (serverId: string, agentId: string) => Promise<unknown>;
      }
    | null
    | undefined;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isConnected: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  handleStopRealtimeVoice: () => Promise<unknown> | void;
  toast: { error: (msg: string) => void };
  interruptBeforeVoiceMessage: string;
}

function toggleRealtimeVoiceImpl(ctx: ToggleRealtimeVoiceContext): void {
  if (!ctx.voice || !ctx.voiceServerId || !ctx.voiceAgentId || !ctx.isConnected || ctx.disabled) {
    return;
  }
  if (ctx.voice.isVoiceSwitching) return;
  if (ctx.voice.isVoiceModeForAgent(ctx.voiceServerId, ctx.voiceAgentId)) {
    void ctx.handleStopRealtimeVoice();
    return;
  }
  if (ctx.isAgentRunning) {
    ctx.toast.error(ctx.interruptBeforeVoiceMessage);
    return;
  }
  void ctx.voice.startVoice(ctx.voiceServerId, ctx.voiceAgentId).catch((error) => {
    console.error("[MessageInput] Failed to start realtime voice", error);
    const message = extractErrorMessage(error);
    if (message && message.trim().length > 0) {
      ctx.toast.error(message);
    }
  });
}

interface StartDictationContext {
  dictationUnavailableMessage: string | null | undefined;
  canStartDictation: () => boolean;
  isDictatingRef: React.MutableRefObject<boolean>;
  toast: { error: (msg: string) => void };
  startDictation: () => Promise<void>;
  onStart?: () => void;
}

async function startDictationIfAvailableImpl(ctx: StartDictationContext): Promise<void> {
  if (ctx.dictationUnavailableMessage) {
    ctx.isDictatingRef.current = false;
    ctx.toast.error(ctx.dictationUnavailableMessage);
    return;
  }
  if (!ctx.canStartDictation()) {
    ctx.isDictatingRef.current = false;
    return;
  }
  ctx.isDictatingRef.current = true;
  ctx.onStart?.();
  await ctx.startDictation();
}

interface StopRealtimeVoiceContext {
  voice: { stopVoice: () => Promise<unknown> } | null | undefined;
  isRealtimeVoiceForCurrentAgent: boolean;
  isAgentRunning: boolean;
  client: { cancelAgent: (agentId: string) => Promise<unknown> } | null;
  voiceAgentId: string | undefined;
}

async function stopRealtimeVoiceImpl(ctx: StopRealtimeVoiceContext): Promise<void> {
  if (!ctx.voice || !ctx.isRealtimeVoiceForCurrentAgent) return;

  const tasks: Promise<unknown>[] = [];
  if (ctx.isAgentRunning && ctx.client && ctx.voiceAgentId) {
    tasks.push(ctx.client.cancelAgent(ctx.voiceAgentId));
  }
  tasks.push(ctx.voice.stopVoice());

  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("[MessageInput] Failed to stop realtime voice", result.reason);
    }
  });
}

interface VoicePressContext {
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
  isDictating: boolean;
  cancelDictation: () => Promise<void> | void;
  startDictationIfAvailable: () => Promise<void>;
}

async function handleVoicePressImpl(ctx: VoicePressContext): Promise<void> {
  if (ctx.isRealtimeVoiceForCurrentAgent && ctx.voice) {
    ctx.voice.toggleMute();
    return;
  }
  if (ctx.isDictating) {
    await ctx.cancelDictation();
    return;
  }
  await ctx.startDictationIfAvailable();
}

interface SendMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  cwd: string;
  isAgentRunning: boolean;
  isCompacting: boolean;
  onSubmit: SubmitMessageHandler;
  onMinimizeHeight: () => void;
  preserveHeightOnSubmit: boolean;
}

function sendMessageImpl(ctx: SendMessageContext): void {
  const trimmed = ctx.value.trim();
  if (
    !trimmed &&
    ctx.attachments.length === 0 &&
    !ctx.hasExternalContent &&
    !ctx.allowEmptySubmit
  ) {
    return;
  }
  const result = ctx.onSubmit({
    text: trimmed,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning && !ctx.isCompacting ? true : undefined,
  });
  // When the host preserves and locks the composer (e.g. new-workspace creation),
  // the text stays put - collapsing the height would clip it. Keep it grown.
  if (ctx.preserveHeightOnSubmit) {
    return;
  }
  // A submit can be vetoed downstream (interrupt-confirm cancelled) - in that
  // case the text is still in the box, so collapsing would clip it.
  void (async () => {
    const committed = await result;
    if (committed !== false) {
      ctx.onMinimizeHeight();
    }
  })();
}

interface QueueMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  cwd: string;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onChangeText: (text: string) => void;
  onMinimizeHeight: () => void;
}

function queueMessageImpl(ctx: QueueMessageContext): void {
  if (!ctx.onQueue) return;
  const trimmed = ctx.value.trim();
  if (!trimmed && ctx.attachments.length === 0) return;
  ctx.onQueue({ text: trimmed, attachments: ctx.attachments, cwd: ctx.cwd });
  ctx.onChangeText("");
  ctx.onMinimizeHeight();
}

function computeIsRealtimeVoiceForAgent(
  voice: { isVoiceModeForAgent: (serverId: string, agentId: string) => boolean } | null | undefined,
  voiceServerId: string | undefined,
  voiceAgentId: string | undefined,
): boolean {
  if (!voice || !voiceServerId || !voiceAgentId) return false;
  return voice.isVoiceModeForAgent(voiceServerId, voiceAgentId);
}

function computeShouldShowDictationOverlay(
  isDictating: boolean,
  isDictationProcessing: boolean,
  dictationStatus: string,
): boolean {
  return isDictating || isDictationProcessing || dictationStatus === "failed";
}

function computeIsDictationStartEnabled(
  isReadyForDictation: boolean | undefined,
  isConnected: boolean,
  disabled: boolean,
): boolean {
  return (isReadyForDictation ?? isConnected) && !disabled;
}

/** The toolbar row's content box: width compensation plus the uniform shrink. */
function ToolbarContentBox({
  style,
  children,
}: {
  style: AnimatedStyle<import("react-native").ViewStyle>;
  children: React.ReactNode;
}) {
  return <Animated.View style={[styles.buttonRowContent, style]}>{children}</Animated.View>;
}

function computeFocusHintVisible(input: {
  isPaneFocused: boolean;
  isInputFocused: boolean;
  isCompact: boolean;
  value: string;
}): boolean {
  return isWeb && !input.isCompact && input.isPaneFocused && !input.isInputFocused && !input.value;
}

// Uniform-shrink fallback: once labels are already dropped (compact/icon-only
// stage) and the icon row still can't fit, scale the whole button row down so
// every button and icon shrinks together instead of clipping or wrapping.
// Runs on native too: native panes don't resize post-mount, but the available
// width still depends on device size and how much dynamic left-side content
// (agent controls, features) renders, so overflow can already be present on
// the first layout pass rather than only appearing from a window resize.
function computeTextInputHeightStyle(inputHeight: number, maxInputHeight: number) {
  if (isWeb) {
    return {
      height: inputHeight,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
    };
  }
  return {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: maxInputHeight,
  };
}

function isTextAreaLike(v: unknown): v is TextAreaHandle {
  return typeof v === "object" && v !== null && "scrollHeight" in v;
}

function getWebTextAreaImpl(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): TextAreaHandle | null {
  if (!current) return null;
  const candidate = current as { getNativeRef?: () => unknown };
  if (typeof candidate.getNativeRef === "function") {
    const native = candidate.getNativeRef();
    if (isTextAreaLike(native)) return native;
  }
  if (isTextAreaLike(current)) return current;
  return null;
}

interface SendButtonStateInput {
  disabled: boolean;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  isAgentRunning: boolean;
  isCompacting: boolean;
}

interface SendButtonStateOutput {
  canPressLoadingButton: boolean;
  isSendButtonDisabled: boolean;
  defaultActionQueues: boolean;
}

function computeSendButtonState(input: SendButtonStateInput): SendButtonStateOutput {
  const canPressLoadingButton =
    input.isSubmitLoading && typeof input.onSubmitLoadingPress === "function";
  const isSendButtonDisabled =
    input.disabled || (!canPressLoadingButton && (input.isSubmitDisabled || input.isSubmitLoading));
  const defaultActionQueues =
    input.isAgentRunning && (input.isCompacting || input.defaultSendBehavior === "queue");
  return { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues };
}

function resolveSendButtonPress(input: {
  usesAlternateSendAction: boolean;
  onDefaultSendAction: () => void;
  onAlternateSendAction: () => void;
}): () => void {
  return input.usesAlternateSendAction ? input.onAlternateSendAction : input.onDefaultSendAction;
}

interface ResolvedMessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: SubmitMessageHandler;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitButtonAccessibilityLabel: string | undefined;
  submitButtonTestID: string | undefined;
  submitIcon: "arrow" | "return";
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  preserveHeightOnSubmit: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  showAttachmentButton: boolean;
  showAutoSpeechButton: boolean;
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  placeholder: string | undefined;
  autoFocus: boolean;
  autoFocusKey: string | undefined;
  disabled: boolean;
  isPaneFocused: boolean;
  autoStartDictation:
    | { autoSend: boolean; preRollPcm?: string; speechAlreadyDetected?: boolean }
    | null
    | undefined;
  onAutoStartDictationConsumed: (() => void) | undefined;
  leadingContent: React.ReactNode;
  leftContent: React.ReactNode;
  beforeVoiceContent: React.ReactNode;
  rightContent: React.ReactNode;
  activeActionContent: React.ReactNode;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isAgentRunning: boolean;
  isCompacting: boolean;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmitLoadingPress: (() => void) | undefined;
  onKeyPressCallback: ((event: ComposerKeyPressEvent) => boolean) | undefined;
  onSelectionChangeCallback: ((selection: { start: number; end: number }) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;
  onHeightChange: ((height: number) => void) | undefined;
  viewportHeight: number | undefined;
  inputWrapperStyle: import("react-native").ViewStyle | undefined;
  attachmentSlot: React.ReactNode;
  inputMode: ComposerInputMode;
  readOnly: boolean;
  textReplacementKey: string | undefined;
  submitLabel: string | undefined;
}

function resolveMessageInputProps(props: MessageInputProps): ResolvedMessageInputProps {
  return {
    value: props.value,
    onChangeText: props.onChangeText,
    onSubmit: props.onSubmit,
    hasExternalContent: props.hasExternalContent ?? false,
    allowEmptySubmit: props.allowEmptySubmit ?? false,
    submitButtonAccessibilityLabel: props.submitButtonAccessibilityLabel,
    submitButtonTestID: props.submitButtonTestID,
    submitIcon: props.submitIcon ?? "arrow",
    isSubmitDisabled: props.isSubmitDisabled ?? false,
    isSubmitLoading: props.isSubmitLoading ?? false,
    preserveHeightOnSubmit: props.preserveHeightOnSubmit ?? false,
    attachments: props.attachments,
    cwd: props.cwd,
    attachmentMenuItems: props.attachmentMenuItems,
    showAttachmentButton: props.showAttachmentButton ?? true,
    showAutoSpeechButton: props.showAutoSpeechButton ?? true,
    onAttachButtonRef: props.onAttachButtonRef,
    onAddImages: props.onAddImages,
    client: props.client,
    isReadyForDictation: props.isReadyForDictation,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus ?? false,
    autoFocusKey: props.autoFocusKey,
    disabled: props.disabled ?? false,
    isPaneFocused: props.isPaneFocused ?? true,
    autoStartDictation: props.autoStartDictation,
    onAutoStartDictationConsumed: props.onAutoStartDictationConsumed,
    leadingContent: props.leadingContent,
    leftContent: props.leftContent,
    beforeVoiceContent: props.beforeVoiceContent,
    rightContent: props.rightContent,
    activeActionContent: props.activeActionContent,
    voiceServerId: props.voiceServerId,
    voiceAgentId: props.voiceAgentId,
    isAgentRunning: props.isAgentRunning ?? false,
    isCompacting: props.isCompacting ?? false,
    defaultSendBehavior: props.defaultSendBehavior ?? "interrupt",
    onQueue: props.onQueue,
    onSubmitLoadingPress: props.onSubmitLoadingPress,
    onKeyPressCallback: props.onKeyPress,
    onSelectionChangeCallback: props.onSelectionChange,
    onFocusChange: props.onFocusChange,
    onHeightChange: props.onHeightChange,
    viewportHeight: props.viewportHeight,
    inputWrapperStyle: props.inputWrapperStyle,
    attachmentSlot: props.attachmentSlot,
    inputMode: props.inputMode ?? "chat",
    readOnly: props.readOnly ?? false,
    textReplacementKey: props.textReplacementKey,
    submitLabel: props.submitLabel,
  };
}

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(props, ref) {
    const {
      value,
      onChangeText,
      onSubmit,
      hasExternalContent,
      allowEmptySubmit,
      submitButtonAccessibilityLabel,
      submitButtonTestID,
      submitIcon,
      isSubmitDisabled,
      isSubmitLoading,
      preserveHeightOnSubmit,
      attachments,
      cwd,
      attachmentMenuItems,
      showAttachmentButton,
      showAutoSpeechButton,
      onAttachButtonRef,
      onAddImages,
      client,
      isReadyForDictation,
      placeholder,
      autoFocus,
      autoFocusKey,
      disabled,
      isPaneFocused,
      autoStartDictation,
      onAutoStartDictationConsumed,
      leadingContent,
      leftContent,
      beforeVoiceContent,
      rightContent,
      activeActionContent,
      voiceServerId,
      voiceAgentId,
      isAgentRunning,
      isCompacting,
      defaultSendBehavior,
      onQueue,
      onSubmitLoadingPress,
      onKeyPressCallback,
      onSelectionChangeCallback,
      onFocusChange,
      onHeightChange,
      viewportHeight,
      inputWrapperStyle,
      attachmentSlot,
      inputMode,
      readOnly,
      textReplacementKey,
      submitLabel,
    } = resolveMessageInputProps(props);
    const mode = resolveComposerInputMode(inputMode);
    const { t } = useTranslation();
    const isCompact = useIsCompactFormFactor();
    const { height: windowHeight } = useWindowDimensions();
    // The window is the fallback, not the truth: a composer in a short split
    // pane has far less room than the window suggests.
    const maxInputHeight = resolveMaxInputHeight({
      viewportHeight: viewportHeight && viewportHeight > 0 ? viewportHeight : windowHeight,
      isCompact,
    });
    const buttonIconSize = COMPOSER_ICON_SIZE;
    const toast = useToast();
    const { settings: appSettings } = useAppSettings();
    const voice = useVoiceOptional();
    const voiceAudioEngine = useVoiceAudioEngineOptional();
    const voiceMuteToggleKeys = useShortcutKeys("voice-mute-toggle");
    const dictationToggleKeys = useShortcutKeys("dictation-toggle");
    const focusInputKeys = useShortcutKeys("focus-message-input");
    const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const isAlternateSendModifierHeld = useKeyboardShortcutsStore(
      (state) => state.shortcutDiscoveryModifiers.ctrl || state.shortcutDiscoveryModifiers.meta,
    );
    const rootRef = useRef<View | null>(null);
    const tutorialAnchorRef = useTutorialAnchor("chat-input");
    const rootMergedRef = useMemo(() => mergeRefs(rootRef, tutorialAnchorRef), [tutorialAnchorRef]);
    const inputWrapperRef = useRef<View | null>(null);
    const textInputRef = useRef<TextInput | (TextInput & { getNativeRef?: () => unknown }) | null>(
      null,
    );
    const isInputFocusedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      focus: () => {
        textInputRef.current?.focus();
      },
      blur: () => {
        textInputRef.current?.blur?.();
      },
      runKeyboardAction: (action) =>
        runKeyboardActionImpl(action, {
          textInputRef,
          isDictatingRef,
          sendAfterTranscriptRef,
          confirmDictation,
          cancelDictation,
          startDictationIfAvailable,
          handleToggleRealtimeVoiceShortcut,
          isRealtimeVoiceForCurrentAgent,
          voice,
        }),
      moveCaretToEnd: () => {
        const end = valueRef.current.length;
        if (isWeb) {
          const element = getTextInputNativeElement(textInputRef.current);
          if (element && "setSelectionRange" in element) {
            (element as HTMLTextAreaElement).setSelectionRange(end, end);
          }
          return;
        }
        const handle = textInputRef.current as
          | (TextInput & { setSelection?: (start: number, end: number) => void })
          | null;
        handle?.setSelection?.(end, end);
      },
      getNativeElement: () => (isWeb ? getTextInputNativeElement(textInputRef.current) : null),
    }));
    const inputHeightRef = useRef(MIN_INPUT_HEIGHT);
    const overlayTransition = useSharedValue(0);
    const sendAfterTranscriptRef = useRef(false);
    const [cleanDictation, setCleanDictation] = useState(false);
    const valueRef = useRef(value);
    const serverInfo = useSessionStore(
      useCallback(
        (state) => {
          if (!voiceServerId) {
            return null;
          }
          return state.sessions[voiceServerId]?.serverInfo ?? null;
        },
        [voiceServerId],
      ),
    );

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    useEffect(() => {
      return () => {
        onFocusChange?.(false);
      };
    }, [onFocusChange]);

    useAutoFocusOnWebEffect(textInputRef, autoFocus, autoFocusKey);

    const handleDictationTranscript = useCallback(
      (text: string, _meta: { requestId: string }) => {
        // Delivery is captured when dictation starts. Reading live settings
        // here makes a completed wake utterance race with settings renders and
        // loses the one-shot auto-send intent.
        const autoSend = sendAfterTranscriptRef.current;
        console.info("[MessageInput] dictation transcript delivery mode", {
          autoSend,
          agentRunning: isAgentRunning,
        });
        sendAfterTranscriptRef.current = false;
        applyDictationTranscript(text, {
          value: valueRef.current,
          defaultSendBehavior,
          isAgentRunning,
          isCompacting,
          onQueue,
          onSubmit,
          onChangeText,
          attachments,
          cwd,
          autoSend,
        });
        setCleanDictation(false);
      },
      [
        onChangeText,
        onSubmit,
        onQueue,
        attachments,
        cwd,
        isAgentRunning,
        isCompacting,
        defaultSendBehavior,
      ],
    );

    const handleDictationError = useCallback(
      (error: Error) => {
        console.error("[MessageInput] Dictation error:", error);
        toast.error(error.message);
      },
      [toast],
    );

    const dictationUnavailableMessage = resolveVoiceUnavailableMessage({
      serverInfo,
      mode: "dictation",
    });

    const canStartDictation = useCallback(
      () =>
        computeCanStartDictation({
          client,
          isReadyForDictation,
          disabled,
          dictationUnavailableMessage,
        }),
      [client, disabled, dictationUnavailableMessage, isReadyForDictation],
    );

    const canConfirmDictation = useCallback(() => client?.isConnected ?? false, [client]);
    const isConnected = client?.isConnected ?? false;
    const isDictationStartEnabled = computeIsDictationStartEnabled(
      isReadyForDictation,
      isConnected,
      disabled,
    );

    const {
      isRecording: isDictating,
      isProcessing: isDictationProcessing,
      partialTranscript: _dictationPartialTranscript,
      volume: dictationVolume,
      duration: dictationDuration,
      error: dictationError,
      status: dictationStatus,
      startDictation,
      cancelDictation,
      confirmDictation,
      retryFailedDictation,
      discardFailedDictation,
    } = useDictation({
      client,
      onTranscript: handleDictationTranscript,
      onError: handleDictationError,
      canStart: canStartDictation,
      canConfirm: canConfirmDictation,
      enableDuration: true,
      silenceTimeoutMs: appSettings.wakeWordSilenceTimeoutMs,
      cleanUp: cleanDictation,
    });

    const startWakeWordDictation = useCallback(
      (
        autoSend = appSettings.wakeWordAutoSend,
        preRollPcm?: string,
        speechAlreadyDetected?: boolean,
      ) => {
        sendAfterTranscriptRef.current = autoSend;
        playDictationStartCue(voiceAudioEngine);
        return startDictation({
          preRollPcm,
          finishOnSilence: true,
          speechAlreadyDetected,
        });
      },
      [appSettings.wakeWordAutoSend, startDictation, voiceAudioEngine],
    );

    useWakeWordListening({
      settings: {
        enabled: shouldStartWakeWordListening({
          featureEnabled: appSettings.wakeWordEnabled,
          listeningPaused: appSettings.wakeWordListeningPaused,
          isPaneFocused,
        }),
        phrase: appSettings.wakeWordPhrase,
        sensitivity: appSettings.wakeWordSensitivity,
        silenceTimeoutMs: appSettings.wakeWordSilenceTimeoutMs,
        autoSend: appSettings.wakeWordAutoSend,
      },
      startDictation: startWakeWordDictation,
      cancelDictation,
      isRecording: isDictating,
      isProcessing: isDictationProcessing,
      onError: (error) => toast.error(error.message),
    });

    const autoStartDictationConsumedRef = useRef(false);
    useEffect(() => {
      if (!autoStartDictation || autoStartDictationConsumedRef.current) return;
      if (!isDictationStartEnabled) return;
      autoStartDictationConsumedRef.current = true;
      void startWakeWordDictation(
        autoStartDictation.autoSend,
        autoStartDictation.preRollPcm,
        autoStartDictation.speechAlreadyDetected,
      );
      onAutoStartDictationConsumed?.();
    }, [
      autoStartDictation,
      isDictationStartEnabled,
      onAutoStartDictationConsumed,
      startWakeWordDictation,
    ]);

    const isDictatingRef = useRef(isDictating);
    useEffect(() => {
      isDictatingRef.current = isDictating;
    }, [isDictating]);

    const isRealtimeVoiceForCurrentAgent = computeIsRealtimeVoiceForAgent(
      voice,
      voiceServerId,
      voiceAgentId,
    );
    const showDictationOverlay = computeShouldShowDictationOverlay(
      isDictating,
      isDictationProcessing,
      dictationStatus,
    );
    const showRealtimeOverlay = isRealtimeVoiceForCurrentAgent;
    const showOverlay = showDictationOverlay || showRealtimeOverlay;

    const startDictationIfAvailable = useCallback(() => {
      // Only the wake-word entry point may request automatic submission.
      sendAfterTranscriptRef.current = false;
      return startDictationIfAvailableImpl({
        dictationUnavailableMessage,
        canStartDictation,
        isDictatingRef,
        toast,
        startDictation,
        onStart: () => playDictationStartCue(voiceAudioEngine),
      });
    }, [canStartDictation, dictationUnavailableMessage, startDictation, toast, voiceAudioEngine]);

    // Animate overlay
    useEffect(() => {
      overlayTransition.value = withTiming(showOverlay ? 1 : 0, {
        duration: 200,
      });
    }, [overlayTransition, showOverlay]);

    const overlayAnimatedStyle = useAnimatedStyle(() => ({
      opacity: overlayTransition.value,
      pointerEvents: overlayTransition.value > 0.5 ? "auto" : "none",
    }));

    const inputAnimatedStyle = useAnimatedStyle(() => ({
      opacity: 1 - overlayTransition.value,
    }));

    const {
      canFitFeatures,
      toolbarStage,
      toolbarContentStyle,
      handleToolbarRowLayout,
      handleToolbarLeftLayout,
      handleToolbarRightLayout,
    } = useComposerToolbarLayout({ isCompact });

    const handleVoicePress = useCallback(
      () =>
        handleVoicePressImpl({
          isRealtimeVoiceForCurrentAgent,
          voice,
          isDictating,
          cancelDictation,
          startDictationIfAvailable,
        }),
      [
        cancelDictation,
        isDictating,
        isRealtimeVoiceForCurrentAgent,
        startDictationIfAvailable,
        voice,
      ],
    );

    const handleCancelRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = false;
      await cancelDictation();
      setCleanDictation(false);
    }, [cancelDictation]);

    const handleAcceptRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = false;
      await confirmDictation();
      setCleanDictation(false);
    }, [confirmDictation]);

    const handleAcceptAndSendRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = true;
      await confirmDictation();
      setCleanDictation(false);
    }, [confirmDictation]);

    const handleRetryFailedRecording = useCallback(() => {
      void retryFailedDictation();
    }, [retryFailedDictation]);

    const handleDiscardFailedRecording = useCallback(() => {
      discardFailedDictation();
    }, [discardFailedDictation]);

    const handleToggleCleanUp = useCallback(() => {
      setCleanDictation((previous) => !previous);
    }, []);

    const handleStopRealtimeVoice = useCallback(
      () =>
        stopRealtimeVoiceImpl({
          voice,
          isRealtimeVoiceForCurrentAgent,
          isAgentRunning,
          client,
          voiceAgentId,
        }),
      [client, isAgentRunning, isRealtimeVoiceForCurrentAgent, voice, voiceAgentId],
    );

    const handleToggleRealtimeVoiceShortcut = useCallback(() => {
      toggleRealtimeVoiceImpl({
        voice,
        voiceServerId,
        voiceAgentId,
        isConnected,
        disabled,
        isAgentRunning,
        handleStopRealtimeVoice,
        toast,
        interruptBeforeVoiceMessage: t("composer.voice.interruptBeforeVoice"),
      });
    }, [
      disabled,
      handleStopRealtimeVoice,
      isAgentRunning,
      isConnected,
      t,
      toast,
      voice,
      voiceAgentId,
      voiceServerId,
    ]);

    const getWebTextArea = useCallback(
      (): TextAreaHandle | null => getWebTextAreaImpl(textInputRef.current),
      [],
    );
    const handlePasteImageError = useCallback(() => {
      toast.error(t("errors.pasteImageFailed"));
    }, [t, toast]);

    const isPastingImages = usePasteImagesEffect({
      getWebTextArea,
      inputReplacementKey: textReplacementKey,
      isConnected,
      disabled,
      isDictating,
      isRealtimeVoiceForCurrentAgent,
      onAddImages,
      onPasteError: handlePasteImageError,
    });

    const minimizeInputHeight = useCallback(() => {
      inputHeightRef.current = MIN_INPUT_HEIGHT;
      setInputHeight(MIN_INPUT_HEIGHT);
      onHeightChange?.(MIN_INPUT_HEIGHT);
    }, [onHeightChange]);

    const handleSendMessage = useCallback(
      () =>
        sendMessageImpl({
          value: valueRef.current,
          attachments,
          hasExternalContent,
          allowEmptySubmit,
          cwd,
          isAgentRunning,
          isCompacting,
          onSubmit,
          onMinimizeHeight: minimizeInputHeight,
          preserveHeightOnSubmit,
        }),
      [
        allowEmptySubmit,
        attachments,
        cwd,
        onSubmit,
        isAgentRunning,
        isCompacting,
        hasExternalContent,
        minimizeInputHeight,
        preserveHeightOnSubmit,
      ],
    );

    const handleQueueMessage = useCallback(
      () =>
        queueMessageImpl({
          value: valueRef.current,
          attachments,
          cwd,
          onQueue,
          onChangeText,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [attachments, cwd, onQueue, onChangeText, minimizeInputHeight],
    );

    const handleDefaultSendAction = useCallback(() => {
      if (isPastingImages) return;
      runDefaultSendAction({
        defaultSendBehavior,
        isAgentRunning,
        isCompacting,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [
      defaultSendBehavior,
      isAgentRunning,
      isCompacting,
      isPastingImages,
      onQueue,
      handleQueueMessage,
      handleSendMessage,
    ]);

    const handleAlternateSendAction = useCallback(() => {
      if (isPastingImages) return;
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning,
        isCompacting,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [
      defaultSendBehavior,
      isAgentRunning,
      isCompacting,
      isPastingImages,
      handleSendMessage,
      handleQueueMessage,
      onQueue,
    ]);

    const webTextareaRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
      if (isWeb) {
        webTextareaRef.current = getWebTextArea() as HTMLElement | null;
      }
    }, [getWebTextArea, textReplacementKey]);

    const inputScrollbar = useWebElementScrollbar(webTextareaRef, {
      enabled: isWeb,
    });

    const setBoundedInputHeight = useCallback(
      (nextHeight: number) => {
        const bounded = Math.max(MIN_INPUT_HEIGHT, Math.min(maxInputHeight, nextHeight));
        if (Math.abs(inputHeightRef.current - bounded) < 1) return;
        inputHeightRef.current = bounded;
        setInputHeight(bounded);
        onHeightChange?.(bounded);
      },
      [maxInputHeight, onHeightChange],
    );

    useEffect(() => {
      setBoundedInputHeight(inputHeightRef.current);
    }, [setBoundedInputHeight]);

    useComposerHeightMirror({
      value,
      textareaRef: webTextareaRef,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
      onHeight: setBoundedInputHeight,
    });

    const handleContentSizeChange = useCallback(
      (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
        if (isWeb) return;
        setBoundedInputHeight(event.nativeEvent.contentSize.height);
      },
      [setBoundedInputHeight],
    );

    const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
    const handleSelectionChange = useCallback(
      (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const start = event.nativeEvent.selection?.start ?? 0;
        const end = event.nativeEvent.selection?.end ?? start;
        selectionRef.current = { start, end };
        onSelectionChangeCallback?.({ start, end });
      },
      [onSelectionChangeCallback],
    );

    const shouldHandleWebKeyPress = isWeb;
    const shouldSubmitOnEnter = isWeb && !isCompact;

    function handleDesktopKeyPress(event: WebTextInputKeyPressEvent) {
      if (!shouldHandleWebKeyPress) return;
      handleDesktopKeyPressImpl(event, {
        onKeyPressCallback,
        input: { text: value, selection: selectionRef.current },
        submitOnEnter: shouldSubmitOnEnter,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled: disabled || isPastingImages,
        handleAlternateSendAction,
        handleDefaultSendAction,
      });
    }

    const primaryActionKind = resolvePrimaryActionKind({
      hasSendableContent: hasSendableComposerContent({
        value,
        attachments,
        hasExternalContent,
      }),
      allowEmptySubmit,
      isAgentRunning,
      isCompacting,
      isSubmitLoading,
    });
    const { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues } =
      computeSendButtonState({
        disabled: disabled || isPastingImages,
        isSubmitDisabled,
        isSubmitLoading,
        onSubmitLoadingPress,
        defaultSendBehavior,
        isAgentRunning,
        isCompacting,
      });
    const alternateActionAvailable = canUseAlternateSendAction(
      isAgentRunning,
      isCompacting,
      onQueue,
    );
    const previewActionQueues = resolvePreviewActionQueues({
      defaultActionQueues,
      alternateModifierHeld: isAlternateSendModifierHeld,
      canUseAlternateAction: alternateActionAvailable,
    });
    const usesAlternateSendAction = resolveUsesAlternateSendAction({
      alternateModifierHeld: isAlternateSendModifierHeld,
      canUseAlternateAction: alternateActionAvailable,
    });
    const handleSendButtonPress = resolveSendButtonPress({
      usesAlternateSendAction,
      onDefaultSendAction: handleDefaultSendAction,
      onAlternateSendAction: handleAlternateSendAction,
    });
    useIosHardwareKeyboardSubmit({
      isEnabled: isInputFocused && !isSendButtonDisabled,
      onSubmit: handleDefaultSendAction,
    });
    const submitAccessibilityLabel = resolveSubmitAccessibilityLabel({
      submitButtonAccessibilityLabel,
      canPressLoadingButton,
      defaultActionQueues: previewActionQueues,
      defaultSendBehavior,
      isAgentRunning,
      t,
    });

    const voiceButtonAccessibilityLabel = resolveVoiceAccessibilityLabel({
      isRealtimeVoiceForCurrentAgent,
      isMuted: Boolean(voice?.isMuted),
      isDictating,
      t,
    });

    const voiceTooltipText = resolveVoiceTooltipText({
      isRealtimeVoiceForCurrentAgent,
      isMuted: Boolean(voice?.isMuted),
      t,
    });

    const sendTooltipLabel = resolveSendTooltipLabel({
      submitButtonAccessibilityLabel,
      defaultActionQueues: previewActionQueues,
      defaultSendBehavior,
      isAgentRunning,
      t,
    });
    const actionSubmitIcon = resolveSendButtonIcon({
      canPressLoadingButton,
      defaultActionQueues,
      alternateModifierHeld: isAlternateSendModifierHeld,
      canUseAlternateAction: alternateActionAvailable,
      isAgentRunning,
      defaultSendBehavior,
      submitIcon,
    });

    const handleInputChange = useCallback(
      (nextValue: string) => {
        valueRef.current = nextValue;
        onChangeText(nextValue);
      },
      [onChangeText],
    );

    const handleInputFocus = useCallback(() => {
      isInputFocusedRef.current = true;
      setIsInputFocused(true);
      onFocusChange?.(true);
    }, [onFocusChange]);

    const handleInputBlur = useCallback(() => {
      isInputFocusedRef.current = false;
      setIsInputFocused(false);
      onFocusChange?.(false);
    }, [onFocusChange]);

    const attachButtonStyle = useCallback(
      (state: PressableStateCallbackType) => {
        const hovered = "hovered" in state && Boolean(state.hovered);
        return [
          styles.attachButton,
          hovered && styles.iconButtonHovered,
          (!isConnected || disabled) && styles.buttonDisabled,
        ];
      },
      [isConnected, disabled],
    );

    const voiceButtonStyle = useCallback(
      (state: PressableStateCallbackType) => {
        const hovered = "hovered" in state && Boolean(state.hovered);
        return [
          styles.voiceButton,
          hovered && !isDictating && styles.iconButtonHovered,
          !isDictationStartEnabled && styles.buttonDisabled,
          isDictating && styles.voiceButtonRecording,
        ];
      },
      [isDictating, isDictationStartEnabled],
    );

    const handleRealtimeVoiceStop = useCallback(() => {
      void handleStopRealtimeVoice();
    }, [handleStopRealtimeVoice]);

    const inputWrapperCombinedStyle = useMemo(
      () => [
        styles.inputWrapper,
        readOnly && styles.inputWrapperReadOnly,
        inputWrapperStyle,
        inputAnimatedStyle,
      ],
      [inputAnimatedStyle, inputWrapperStyle, readOnly],
    );
    // `withUnistyles` maps this component's `style` into a `.hash > *` child
    // rule, which ties on specificity with react-native-web's own
    // `.css-textinput-*` class and loses on source order — so a themed
    // `fontFamily` here is silently dropped while every other property lands.
    // An inline style outranks both classes. See docs/unistyles.md.
    const textInputStyle = useMemo(
      () => [
        styles.textInput,
        mode.isMonospace && styles.textInputMonospace,
        computeTextInputHeightStyle(inputHeight, maxInputHeight),
      ],
      [inputHeight, maxInputHeight, mode.isMonospace],
    );
    // Static content has no textarea to mirror, so it grows with its own text
    // instead of the measured input height.
    const readOnlyTextStyle = useMemo(
      () => [styles.textInput, mode.isMonospace && styles.textInputMonospace, styles.readOnlyText],
      [mode.isMonospace],
    );
    const sendButtonCombinedStyle = useCallback(
      (state: PressableStateCallbackType) => {
        const hovered = "hovered" in state && Boolean(state.hovered);
        return [
          styles.sendButton,
          submitLabel ? styles.sendButtonLabeled : undefined,
          hovered && !isSendButtonDisabled && styles.iconButtonHovered,
          isSendButtonDisabled && styles.buttonDisabled,
        ];
      },
      [isSendButtonDisabled, submitLabel],
    );
    const overlayContainerStyle = useMemo(
      () => [styles.overlayContainer, overlayAnimatedStyle],
      [overlayAnimatedStyle],
    );

    const renderAttachButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <AttachButtonIcon
          hovered={Boolean(hovered)}
          onAttachButtonRef={onAttachButtonRef}
          buttonIconSize={buttonIconSize}
        />
      ),
      [onAttachButtonRef, buttonIconSize],
    );

    const renderVoiceButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <VoiceButtonIcon
          hovered={Boolean(hovered)}
          isDictating={isDictating}
          isMutedRealtime={Boolean(isRealtimeVoiceForCurrentAgent && voice?.isMuted)}
          buttonIconSize={buttonIconSize}
        />
      ),
      [isDictating, isRealtimeVoiceForCurrentAgent, voice?.isMuted, buttonIconSize],
    );

    return (
      <View ref={rootMergedRef} style={styles.container} testID="message-input-root">
        {/* Regular input */}
        <Animated.View ref={inputWrapperRef} style={inputWrapperCombinedStyle}>
          {attachmentSlot}
          {/* Text input */}
          <ComposerTextSurface
            textReplacementKey={textReplacementKey}
            readOnly={readOnly}
            value={value}
            textInputRef={textInputRef}
            textInputStyle={textInputStyle}
            readOnlyTextStyle={readOnlyTextStyle}
            placeholder={placeholder ?? t("composer.placeholders.fallback")}
            accessibilityLabel={t(mode.accessibilityLabelKey)}
            onChangeText={handleInputChange}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            editable={!isDictating && !isRealtimeVoiceForCurrentAgent && !disabled}
            scrollEnabled={isWeb ? inputHeight >= maxInputHeight : true}
            autoFocus={isWeb && autoFocus}
            onContentSizeChange={handleContentSizeChange}
            onKeyPress={shouldHandleWebKeyPress ? handleDesktopKeyPress : undefined}
            onSelectionChange={handleSelectionChange}
            focusHintVisible={computeFocusHintVisible({
              isPaneFocused,
              isInputFocused,
              isCompact,
              value,
            })}
            focusInputKeys={focusInputKeys}
            inputScrollbar={inputScrollbar}
            focusHintLabel={t("composer.input.focusHint", {
              shortcut: focusInputKeys ? formatShortcut(focusInputKeys[0], getShortcutOs()) : "",
            })}
          />

          {/* Button row */}
          <View style={styles.buttonRow} onLayout={handleToolbarRowLayout}>
            <ComposerToolbarProvider canFitFeatures={canFitFeatures} stage={toolbarStage}>
              <ToolbarContentBox style={toolbarContentStyle}>
                {/* Toolbar left: attachment button + usage ring + agent controls */}
                <View style={styles.leftButtonGroup} onLayout={handleToolbarLeftLayout}>
                  {showAttachmentButton ? (
                    <AttachmentDropdown
                      visible={mode.showAttachments}
                      isConnected={isConnected}
                      disabled={disabled}
                      attachButtonStyle={attachButtonStyle}
                      renderAttachButtonIcon={renderAttachButtonIcon}
                      attachmentMenuItems={attachmentMenuItems}
                      addAttachmentLabel={t("composer.input.addAttachment")}
                      addAttachmentTooltipLabel={t("composer.input.add")}
                    />
                  ) : null}
                  {leadingContent}
                  {leftContent}
                </View>

                {/* Right: auto-speech toggle, voice button, contextual button
                  (realtime/send/cancel) */}
                <View style={styles.rightButtonGroup} onLayout={handleToolbarRightLayout}>
                  {beforeVoiceContent}
                  <AutoSpeechControl
                    show={showAutoSpeechButton}
                    serverId={voiceServerId}
                    agentId={voiceAgentId}
                    buttonIconSize={buttonIconSize}
                  />
                  <VoiceButtonTooltip
                    visible={mode.showVoice}
                    onVoicePress={handleVoicePress}
                    isDictationStartEnabled={isDictationStartEnabled}
                    voiceButtonAccessibilityLabel={voiceButtonAccessibilityLabel}
                    voiceButtonStyle={voiceButtonStyle}
                    renderVoiceButtonIcon={renderVoiceButtonIcon}
                    voiceTooltipText={voiceTooltipText}
                    isRealtimeVoiceForCurrentAgent={isRealtimeVoiceForCurrentAgent}
                    voiceMuteToggleKeys={voiceMuteToggleKeys}
                    dictationToggleKeys={dictationToggleKeys}
                  />
                  {rightContent}
                  <PrimaryAction
                    kind={primaryActionKind}
                    activeActionContent={activeActionContent}
                    shouldShow
                    canPressLoadingButton={canPressLoadingButton}
                    onSubmitLoadingPress={onSubmitLoadingPress}
                    onSendButtonPress={handleSendButtonPress}
                    isSendButtonDisabled={isSendButtonDisabled}
                    submitAccessibilityLabel={submitAccessibilityLabel}
                    sendButtonCombinedStyle={sendButtonCombinedStyle}
                    isSubmitLoading={isSubmitLoading}
                    submitIcon={actionSubmitIcon}
                    submitLabel={submitLabel}
                    submitButtonTestID={submitButtonTestID}
                    buttonIconSize={buttonIconSize}
                    sendTooltipLabel={sendTooltipLabel}
                  />
                </View>
              </ToolbarContentBox>
            </ComposerToolbarProvider>
          </View>
        </Animated.View>

        <Animated.View style={overlayContainerStyle}>
          <MessageInputOverlay
            showDictationOverlay={showDictationOverlay}
            showRealtimeOverlay={showRealtimeOverlay}
            voice={voice}
            dictationVolume={dictationVolume}
            dictationDuration={dictationDuration}
            isDictating={isDictating}
            isDictationProcessing={isDictationProcessing}
            dictationStatus={dictationStatus}
            dictationError={dictationError}
            onCancelRecording={handleCancelRecording}
            onAcceptRecording={handleAcceptRecording}
            onAcceptAndSendRecording={handleAcceptAndSendRecording}
            onRetryFailedRecording={handleRetryFailedRecording}
            onDiscardFailedRecording={handleDiscardFailedRecording}
            cleanUp={cleanDictation}
            onToggleCleanUp={handleToggleCleanUp}
            onRealtimeVoiceStop={handleRealtimeVoiceStop}
          />
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    position: "relative",
  },
  inputWrapper: {
    flexDirection: "column",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    paddingVertical: {
      xs: theme.spacing[2],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    ...(isWeb
      ? {
          transitionProperty: "border-color",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  // Dotted says "this surface is the same box, but there is nothing to type
  // into it" without swapping the border colour, which reads as an error state.
  inputWrapperReadOnly: {
    borderStyle: "dotted",
  },
  textInputScrollWrapper: {
    position: "relative",
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
  // Dictation and Live Mode sit next to one another in the composer toolbar.
  // Place Dictation's badge below its trigger while Live Mode remains above,
  // so Ctrl/Cmd+D and Ctrl/Cmd+Shift+D can never cover each other.
  dictationShortcutDiscoveryHint: {
    position: "absolute",
    top: theme.spacing[3],
    right: -theme.spacing[2],
    zIndex: 1,
  },
  focusHintText: {
    position: "absolute",
    top: 0,
    right: 0,
    fontSize: theme.fontSize.xs,
    // Match the textInput's line-height so this sits on the same baseline as
    // the placeholder text instead of centering in its own (smaller) line box.
    lineHeight: theme.fontSize.base * 1.4,
    color: theme.colors.foregroundMuted,
    opacity: 0.5,
  },
  focusHintDiscovery: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 1,
  },
  textInput: {
    width: "100%",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: theme.fontSize.base * 1.4,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  textInputMonospace: {
    fontFamily: theme.fontFamily.mono,
  },
  readOnlyText: {
    minHeight: MIN_INPUT_HEIGHT,
    color: theme.colors.foregroundMuted,
  },
  buttonRow: {
    marginHorizontal: -6,
    marginBottom: -6,
    overflow: "hidden",
  },
  buttonRowContent: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    alignSelf: "flex-start",
    gap: TOOLBAR_GROUP_GAP,
    // Deliberately no `transformOrigin`. The scaled row's left-edge pivot is
    // baked into the animated transform itself (composer/input/toolbar-stage.ts),
    // and it has to be the only pivot in play: declaring both compensates
    // twice and pushes the row off the row's left edge, under a parent that
    // clips. It also cannot be made to work here. Web never receives it
    // (unistyles mangles the array into junk CSS and reanimated's web update
    // path drops it), and on Android Fabric the origin offset is derived from
    // the view's measured width at the moment the transform prop lands - a
    // width this row animates - so the pivot resolves against a stale size and
    // the row settles off-center. The transform-baked pivot is immune: it
    // rides the same worklet as the width it compensates for.
    // If it ever comes back, array form only, never a CSS string: the native
    // RCTView setter casts to ReadableArray, so "left center" throws
    // ClassCastException on Android.
  },
  leftButtonGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  rightButtonGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  attachButton: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonAnchor: {
    width: compactUp(28),
    height: compactUp(28),
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButton: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButtonRecording: {
    backgroundColor: theme.colors.destructive,
  },
  sendButton: {
    width: compactUp(28),
    height: compactUp(28),
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonLabeled: {
    width: "auto",
    minWidth: 28,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
  },
  sendButtonLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accentForeground,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
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
  overlayContainer: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    right: 0,
    bottom: 0,
  },
})) as unknown as Record<string, object>;

const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedMic = withUnistyles(Mic);
const ThemedMicOff = withUnistyles(MicOff);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedCornerDownLeft = withUnistyles(CornerDownLeft);
const ThemedSplit = withUnistyles(Split);
const ThemedActivityIndicator = withUnistyles(LoadingSpinner);
const ThemedTextInput = withUnistyles(TextInput);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// The send button has no background fill (a "normal" icon button), so its icon
// is colored with the accent itself rather than the accent's contrast color.
const iconAccentMapping = (theme: Theme) => ({ color: theme.colors.accent });
const iconWarningMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const iconDestructiveMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const textInputPlaceholderColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.surface4,
});
