import {
  View,
  Text,
  Image,
  Pressable,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  StyleProp,
  ViewStyle,
  type TextStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MarkdownParagraphView, MarkdownTextSpan } from "@/components/markdown-text";
import { MarkdownTableCellText } from "@/components/markdown-text-selection";
import * as React from "react";
import {
  useState,
  useEffect,
  useRef,
  memo,
  useMemo,
  useCallback,
  createContext,
  useContext,
} from "react";
import type { ComponentType, ReactNode } from "react";
import { MarkdownIt, type ASTNode, type RenderRules } from "react-native-markdown-display";
import { useQuery } from "@tanstack/react-query";
import MaskedView from "@react-native-masked-view/masked-view";
import {
  Circle,
  Info,
  CheckCircle,
  XCircle,
  FileText,
  ChevronRight,
  ChevronDown,
  Check,
  CheckSquare,
  Copy,
  TriangleAlertIcon,
  Summarize,
  MicVocal,
  FileSymlink,
} from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { compactUp, SPACING, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor, MAX_CONTENT_WIDTH } from "@/constants/layout";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import {
  getTextEffectSpec,
  type GlyphTextEffectSpec,
  type SweepTextEffectSpec,
  type TextEffectActivity,
} from "@/styles/text-effects";
import { TextEffectRain } from "@/components/text-effect-rain";
import { useTextEffectThemeId } from "@/hooks/use-text-effect-theme";
import { textEffectActivityForToolName } from "@/agent-stream/action-grouping";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { BubbleCornerSheen } from "@/components/bubble-corner-sheen";
import { ChatThemeScope } from "@/components/chat-theme-scope";
import {
  createSharedMarkdownRules,
  MarkdownRenderer,
  type MarkdownStyles,
} from "@/components/markdown/renderer";
import { createMarkdownFindRules } from "@/components/markdown/find-rules";
import { collectRenderedTextRuns } from "@/components/markdown/find-text-runs";
import { buildRenderedFindIndex, type PreviewFindQuery } from "@/components/file-preview-find";
import { isLastMarkdownTableChild } from "@/components/markdown/table-layout";
import { colorMarkdownLinkChildren } from "@/components/markdown/link-children";
import { createAssistantMarkdownParser } from "@/components/markdown/assistant-parser";
import { applyMath, MATH_BLOCK_TOKEN, MATH_INLINE_TOKEN } from "@/components/markdown/math";
import { MathFormula } from "@/components/markdown/math-formula";
import type { TaskActivity, TodoEntry, UserMessageImageAttachment } from "@/types/stream";
import { TodoTaskList, useTodoCounts } from "@/components/todo-task-list";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import type { AgentUsage, ToolCallDetail } from "@otto-code/protocol/agent-types";
import { readWidgetPayload } from "@otto-code/protocol/widgets/types";
import { buildToolCallPresentation } from "@/tool-calls/presentation";
import { resolveToolCallTextLayout } from "@/tool-calls/text-layout";
import { WidgetCard } from "@/widgets/widget-card";
import { isTightGlyphToolIcon, resolveToolCallIcon } from "@/utils/tool-call-icon";
import { getMarkdownListMarker, getMarkdownListSpacing } from "@/utils/markdown-list";
import { markdownNodeContainsType } from "@/utils/markdown-ast";
import { useStableEvent } from "@/hooks/use-stable-event";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownFenceBlock } from "@/components/markdown/fence/index";
import type { MarkdownPhase } from "@/components/markdown/fence/types";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { formatDuration } from "@/utils/time";
// Re-exported so existing importers (turn-footer) keep resolving it from here;
// the implementation now lives in its own module for lighter reuse.
export { LiveElapsed } from "@/components/live-elapsed";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { useChatTimestampLabel } from "@/hooks/use-chat-timestamp";
import { useAppSettingValue, type AppSettings } from "@/hooks/use-settings";
import { sliceAtSafeBoundary } from "@/agent-stream/turn-reveal";
import { ExpandCollapseControls } from "@/components/expand-collapse-controls";

// Module-level selectors for useAppSettingValue so memoized message components
// subscribe narrowly: they re-render when these specific values change, not on
// every settings write.
const selectChatBubbleGradient = (settings: AppSettings) => settings.chatBubbleGradient;
const selectHideChatMessageDetails = (settings: AppSettings) => settings.hideChatMessageDetails;
const selectAnimationsEnabled = (settings: AppSettings) => settings.animationsEnabled;
const selectWrapToolCallText = (settings: AppSettings) => settings.wrapToolCallText;
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import {
  getAssistantImageLoadStateFromMetadata,
  getAssistantImageMetadata,
  setAssistantImageMetadata,
  type AssistantImageLoadState,
} from "@/utils/assistant-image-metadata";
import {
  hasAssistantMarkdownBlockHeight,
  setAssistantMarkdownBlockHeight,
} from "@/utils/assistant-message-height-estimate";
import {
  reportBubbleSegmentHeight,
  useBubbleGroupOffset,
} from "@/agent-stream/bubble-group-offsets";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import {
  createPreviewAttachmentId,
  getFileNameFromPath,
  parseImageDataUrl,
} from "@/attachments/utils";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import { PlanCard } from "./plan-card";
import { useToolCallSheet } from "./tool-call-sheet";
import { ToolCallDetailsContent } from "./tool-call-details";
import {
  AssistantInlineCodePathLink,
  type AssistantFileLinkSource,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
  type InlinePathTarget,
  useAssistantFileLinkActions,
  useAssistantLinkPress,
} from "@/assistant-file-links";
import { getCompactionMarkerLabel } from "./message-compaction-label";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes, persistAttachmentFromDataUrl } from "@/attachments/service";
import {
  AttachmentFrame,
  AttachmentLabel,
  AttachmentThumbnail,
} from "@/components/attachment-pill";
import { AttachmentLightbox } from "@/components/attachment-lightbox";
import { ChatImageContextMenuTarget } from "@/chat/image-context-menu";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { isWeb, isNative } from "@/constants/platform";
import type { AgentCapabilityFlags } from "@otto-code/protocol/agent-types";
import { RewindMenu, type RewindMode } from "@/components/rewind/rewind-menu";
import { useRewindAgentMutation } from "@/components/rewind/use-rewind-agent-mutation";
import { AssistantForkMenu, type AssistantForkTarget } from "@/components/assistant-fork-menu";
import { MessagePlaybackButton, useTtsSpeakFeature } from "@/components/message-playback-button";
import {
  getAssistantBubbleText,
  reportAssistantBubbleText,
  useAssistantBubbleHasText,
} from "@/agent-stream/assistant-bubble-text";
import { useIsMessagePlaybackActive } from "@/agent-stream/message-playback-activity";
import { useIsAutoSpeechSpeaking } from "@/voice/auto-speech-queue";
import {
  markdownCopyDataSet,
  markdownCopyOrderedListDataSet,
  markdownCopyTableCellDataSet,
  type MarkdownCopyInlineTag,
} from "@/assistant-selection-copy/markup";
import type { IconSizeProp } from "@/components/icons/icon-size";
export type { InlinePathTarget } from "@/assistant-file-links";
export type { AssistantForkTarget };

interface UserMessageProps {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  message: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  timestamp: number;
  capabilities?: AgentCapabilityFlags;
  client?: DaemonClient | null;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  isPending?: boolean;
  disableOuterSpacing?: boolean;
  findQuery?: PreviewFindQuery | null;
  findActiveMatchIndex?: number;
}

const MessageOuterSpacingContext = createContext(false);

export function MessageOuterSpacingProvider({
  disableOuterSpacing,
  children,
}: {
  disableOuterSpacing: boolean;
  children: ReactNode;
}) {
  return (
    <MessageOuterSpacingContext.Provider value={disableOuterSpacing}>
      {children}
    </MessageOuterSpacingContext.Provider>
  );
}

function useDisableOuterSpacing(disableOuterSpacing: boolean | undefined) {
  const contextValue = useContext(MessageOuterSpacingContext);
  return disableOuterSpacing ?? contextValue;
}

const WEB_TOOLCALL_SHIMMER_KEYFRAME_ID = "otto-toolcall-shimmer-keyframes";
const WEB_TOOLCALL_SHIMMER_ANIMATION_NAME = "otto-toolcall-shimmer";
const MARKDOWN_ALLOWED_IMAGE_HANDLERS = [
  "data:image/png;base64",
  "data:image/gif;base64",
  "data:image/jpeg;base64",
  "https://",
  "http://",
] as const;
const MARKDOWN_TOP_LEVEL_MAX_EXCEEDED_ITEM = <Text key="dotdotdot">...</Text>;

const ThemedMicVocal = withUnistyles(MicVocal);
const ThemedTodoHeaderIcon = withUnistyles(CheckSquare);
const ThemedFileSymlinkIcon = withUnistyles(FileSymlink);
const ThemedTriangleAlertIcon = withUnistyles(TriangleAlertIcon);
const ThemedChevronRightIcon = withUnistyles(ChevronRight);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const mutedForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.mutedForeground,
});
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS = `
  @keyframes ${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} {
    0% {
      background-position: var(--otto-shimmer-start, -200px) 0;
    }
    100% {
      background-position: var(--otto-shimmer-end, 200px) 0;
    }
  }
`;
let webToolCallShimmerRegistered = false;
const SCROLL_EDGE_EPSILON = 0.5;

type ScrollAxis = "x" | "y";

function ensureWebToolCallShimmerKeyframes() {
  if (isNative) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(WEB_TOOLCALL_SHIMMER_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS) {
      existing.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
    }
    webToolCallShimmerRegistered = true;
    return;
  }
  if (webToolCallShimmerRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_TOOLCALL_SHIMMER_KEYFRAME_ID;
  styleElement.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webToolCallShimmerRegistered = true;
}

function getWheelEventElementTarget(event: WheelEvent, fallback: HTMLElement): HTMLElement {
  const { target } = event;
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target instanceof Node && target.parentElement) {
    return target.parentElement;
  }
  return fallback;
}

function canElementScrollInDirection(
  element: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  const computedStyle = window.getComputedStyle(element);
  const overflow = axis === "x" ? computedStyle.overflowX : computedStyle.overflowY;
  const isScrollableOverflow =
    overflow === "auto" || overflow === "scroll" || overflow === "overlay";
  if (!isScrollableOverflow) {
    return false;
  }

  const scrollPosition = axis === "x" ? element.scrollLeft : element.scrollTop;
  const scrollSize =
    axis === "x"
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
  if (scrollSize <= SCROLL_EDGE_EPSILON) {
    return false;
  }

  if (delta > 0) {
    return scrollPosition < scrollSize - SCROLL_EDGE_EPSILON;
  }
  return scrollPosition > SCROLL_EDGE_EPSILON;
}

function canScrollInsideDetailFromTarget(
  detailRoot: HTMLElement,
  startElement: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  let current: HTMLElement | null = startElement;
  while (current) {
    if (canElementScrollInDirection(current, axis, delta)) {
      return true;
    }
    if (current === detailRoot) {
      break;
    }
    current = current.parentElement;
  }
  return false;
}

function shouldStopDetailWheelPropagation(detailRoot: HTMLElement, event: WheelEvent): boolean {
  const startElement = getWheelEventElementTarget(event, detailRoot);
  const verticalDelta = event.deltaY;
  let horizontalDelta: number;
  if (event.deltaX !== 0) horizontalDelta = event.deltaX;
  else if (event.shiftKey) horizontalDelta = event.deltaY;
  else horizontalDelta = 0;

  const hasVerticalIntent = Math.abs(verticalDelta) > SCROLL_EDGE_EPSILON;
  const hasHorizontalIntent = Math.abs(horizontalDelta) > SCROLL_EDGE_EPSILON;
  if (!hasVerticalIntent && !hasHorizontalIntent) {
    return false;
  }

  const canScrollVertically = hasVerticalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "y", verticalDelta)
    : false;
  const canScrollHorizontally = hasHorizontalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "x", horizontalDelta)
    : false;

  if (hasVerticalIntent && hasHorizontalIntent) {
    const isVerticalDominant = Math.abs(verticalDelta) >= Math.abs(horizontalDelta);
    return isVerticalDominant
      ? canScrollVertically || canScrollHorizontally
      : canScrollHorizontally || canScrollVertically;
  }

  if (hasVerticalIntent) {
    return canScrollVertically;
  }
  return canScrollHorizontally;
}

const userMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    justifyContent: "flex-end",
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  content: {
    alignItems: "flex-end",
    maxWidth: "100%",
    cursor: "auto",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  containerFirstInGroup: {
    marginTop: theme.spacing[4],
  },
  containerLastInGroup: {
    marginBottom: theme.spacing[2],
  },
  imagePreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  attachmentPreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  imagePreviewSpacing: {
    marginBottom: theme.spacing[2],
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginRight: -theme.spacing[1],
  },
  trailingRow: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  trailingRowHidden: {
    opacity: 0,
  },
  trailingRowVisible: {
    opacity: 1,
  },
  timestampText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

export type ChatMessageBubbleSide = "incoming" | "outgoing";

/**
 * The shared visual frame for participant messages. AssistantMessage keeps its
 * markdown-specific vertical rhythm, while this frame owns the geometry both
 * user messages and Communications participant messages have in common.
 */
export const chatMessageBubbleStylesheet = StyleSheet.create((theme) => ({
  bubble: {
    borderRadius: theme.borderRadius["2xl"],
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  incoming: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceAssistantBubble,
    borderTopLeftRadius: theme.borderRadius.sm,
  },
  outgoing: {
    alignSelf: "flex-end",
    backgroundColor: theme.colors.surfaceUserBubble,
    borderTopRightRadius: theme.borderRadius.sm,
  },
}));

export function ChatMessageBubble({
  side,
  children,
  style,
  accessibilityLabel,
}: {
  side: ChatMessageBubbleSide;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const showBubbleGradient = useAppSettingValue(selectChatBubbleGradient);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        chatMessageBubbleStylesheet.bubble,
        side === "incoming"
          ? chatMessageBubbleStylesheet.incoming
          : chatMessageBubbleStylesheet.outgoing,
        style,
      ]}
    >
      {showBubbleGradient ? (
        <BubbleCornerSheen corner={side === "incoming" ? "left" : "right"} />
      ) : null}
      {children}
    </View>
  );
}

interface UserMessageImagePillProps {
  image: UserMessageImageAttachment;
  onOpen: (image: UserMessageImageAttachment) => void;
  accessibilityLabel: string;
}

function UserMessageImagePill({ image, onOpen, accessibilityLabel }: UserMessageImagePillProps) {
  const previewUrl = useAttachmentPreviewUrl(image);
  const handlePress = useCallback(() => {
    onOpen(image);
  }, [onOpen, image]);
  return (
    <ChatImageContextMenuTarget attachment={image} previewUrl={previewUrl}>
      <AttachmentFrame onPress={handlePress} accessibilityLabel={accessibilityLabel}>
        <AttachmentThumbnail metadata={image} />
      </AttachmentFrame>
    </ChatImageContextMenuTarget>
  );
}

/**
 * User prompts render through the same Markdown pipeline as assistant text, so
 * a pasted fence is a real highlighted code block instead of literal backticks.
 * The parser is deliberately barer than the assistant's: `typographer` stays
 * OFF so quotes, dashes and apostrophes render exactly as typed. The composer
 * inserts file mentions as quoted, backslash-escaped paths
 * (`formatQuotedFileMentionPath`), and smart quotes would show the user
 * something they did not write.
 *
 * Math is the one plugin it does take, because a formula you send should look
 * the way it will look coming back. Its currency guards are what make that
 * safe in a prompt: "it cost $5 and $10" stays prose. Footnotes, task lists
 * and alerts stay off - prompts don't use them, and each is parse cost per
 * bubble. The render rules for math are already in
 * `createSharedMarkdownRules()`.
 *
 * Display is not the sent text. `TurnCopyButton` and `RewindMenu` read the raw
 * `message` string, so copy, rewind and the agent all keep byte fidelity no
 * matter what this renders - a formula reaches the model as the TeX that was
 * typed.
 */
const userMessageMarkdownParser = applyMath(MarkdownIt({ linkify: true }));

const userMessageMarkdownStylesheet = StyleSheet.create((theme) => ({
  // Every block owns its bottom margin, so the last one stacks on the bubble's
  // own padding: a trailing paragraph or fence leaves 12 + 8 under the text
  // against 8 above it. Pulling the body up by that block margin restores the
  // bubble's symmetric inset.
  body: {
    marginBottom: -theme.spacing[3],
  },
}));

const userMessageMarkdownRules: RenderRules = {
  ...createSharedMarkdownRules(),
  body: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
    <View key={node.key} style={[styles.body, userMessageMarkdownStylesheet.body]}>
      {children}
    </View>
  ),
};

function useMessageFindRules(
  baseRules: RenderRules,
  message: string,
  findQuery: PreviewFindQuery | null | undefined,
  activeMatchIndex: number | undefined,
): RenderRules {
  return useMemo(() => {
    if (!findQuery?.search) return baseRules;
    const { byContent } = buildRenderedFindIndex(
      collectRenderedTextRuns({ text: message, enableHtmlish: false }),
      findQuery,
      activeMatchIndex ?? -1,
    );
    if (byContent.size === 0) return baseRules;
    // The shared helper's inline-code rule is right for a generic document,
    // but an assistant code span can be a file link. Keep that interaction and
    // apply Find only to the ordinary message text runs.
    return { ...createMarkdownFindRules(baseRules, byContent), code_inline: baseRules.code_inline };
  }, [activeMatchIndex, baseRules, findQuery, message]);
}

export const UserMessage = memo(function UserMessage({
  serverId,
  agentId,
  messageId,
  message,
  images = [],
  attachments = [],
  timestamp,
  capabilities,
  client,
  isFirstInGroup = true,
  isLastInGroup = true,
  isPending = false,
  disableOuterSpacing,
  findQuery,
  findActiveMatchIndex,
}: UserMessageProps) {
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [lightboxMetadata, setLightboxMetadata] = useState<UserMessageImageAttachment | null>(null);
  const handleLightboxClose = useCallback(() => setLightboxMetadata(null), []);
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const hasText = message.trim().length > 0;
  const hasImages = images.length > 0;
  const hasAttachments = attachments.length > 0;
  // Hover-to-reveal is an appearance preference; with it off, details are
  // always visible. Hover doesn't exist on native/compact, so those always
  // show the row either way.
  const hideMessageDetails = useAppSettingValue(selectHideChatMessageDetails);
  const showTrailingRow = hasText && (!hideMessageDetails || isCompact || isNative || isHovered);
  const formattedTimestamp = useChatTimestampLabel(timestamp);
  const rewindMutation = useRewindAgentMutation({ serverId, agentId, client, messageId });

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const getMessageContent = useCallback(() => message, [message]);
  const handleRewind = useCallback(
    (input: { mode: RewindMode; rewoundText: string }) => {
      return rewindMutation.rewindAgent(input);
    },
    [rewindMutation],
  );
  const markdownRules = useMessageFindRules(
    userMessageMarkdownRules,
    message,
    findQuery,
    findActiveMatchIndex,
  );

  const containerStyle = useMemo(
    () => [
      userMessageStylesheet.container,
      !resolvedDisableOuterSpacing && [
        isFirstInGroup ? userMessageStylesheet.containerFirstInGroup : null,
        isLastInGroup ? userMessageStylesheet.containerLastInGroup : null,
        !isFirstInGroup || !isLastInGroup ? userMessageStylesheet.containerSpacing : null,
      ],
    ],
    [resolvedDisableOuterSpacing, isFirstInGroup, isLastInGroup],
  );
  const imagePreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.imagePreviewContainer,
      hasText || hasAttachments ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasAttachments, hasText],
  );
  const attachmentPreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.attachmentPreviewContainer,
      hasText ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasText],
  );
  const trailingRowStyle = useMemo(
    () => [
      userMessageStylesheet.trailingRow,
      showTrailingRow
        ? userMessageStylesheet.trailingRowVisible
        : userMessageStylesheet.trailingRowHidden,
    ],
    [showTrailingRow],
  );

  return (
    <ChatThemeScope>
      <View style={containerStyle} testID="user-message" aria-busy={isPending}>
        <View
          style={userMessageStylesheet.content}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          <ChatMessageBubble side="outgoing">
            {hasImages ? (
              <View style={imagePreviewContainerStyle}>
                {images.map((image) => (
                  <UserMessageImagePill
                    key={image.id}
                    image={image}
                    onOpen={setLightboxMetadata}
                    accessibilityLabel={t("composer.attachments.openImage")}
                  />
                ))}
              </View>
            ) : null}
            {hasAttachments ? (
              <View style={attachmentPreviewContainerStyle}>
                {attachments.map((attachment, index) => {
                  const content = getAgentAttachmentPillContent(attachment, t);
                  return (
                    <AttachmentFrame
                      key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
                    >
                      <AttachmentLabel
                        icon={content.icon}
                        title={content.title}
                        subtitle={content.subtitle}
                      />
                    </AttachmentFrame>
                  );
                })}
              </View>
            ) : null}
            {hasText ? (
              <MarkdownRenderer
                text={message}
                markdownit={userMessageMarkdownParser}
                rules={markdownRules}
                enableHtmlish={false}
                remoteImages="altText"
              />
            ) : null}
          </ChatMessageBubble>
          {hasText ? (
            <View style={trailingRowStyle} pointerEvents={showTrailingRow ? "auto" : "none"}>
              <Text style={userMessageStylesheet.timestampText}>{formattedTimestamp}</Text>
              {capabilities ? (
                <RewindMenu
                  capabilities={capabilities}
                  isPending={rewindMutation.isPending}
                  rewoundText={message}
                  onRewind={handleRewind}
                />
              ) : null}
              <TurnCopyButton
                getContent={getMessageContent}
                containerStyle={userMessageStylesheet.copyButton}
                accessibilityLabel={t("message.actions.copyMessage")}
              />
            </View>
          ) : null}
        </View>
        <AttachmentLightbox metadata={lightboxMetadata} onClose={handleLightboxClose} />
      </View>
    </ChatThemeScope>
  );
});

interface MessageFooterProps {
  getContent: () => string;
  completedAt?: Date;
  durationMs?: number;
  usage?: AgentUsage;
  /** Provider-neutral controls that sit between Copy and message details. */
  leadingActions?: ReactNode;
  /** Provider-neutral controls that trail message details on the shared baseline. */
  trailingActions?: ReactNode;
  // Already bound to this turn's fork boundary by the caller; absent when the
  // turn has no forkable boundary at all.
  onFork?: (target: AssistantForkTarget) => Promise<void> | void;
}
// Playback deliberately does NOT live here. A turn's footer only knows the turn,
// and `collectAssistantTurnContent` joins every assistant message in it - so a
// button here read the whole turn aloud. It is now one button per visual bubble,
// on the bubble itself (AssistantBubblePlayback).

/**
 * Total tokens the turn consumed (fresh input + cache reads + output).
 * Empty when the turn has no usage snapshot - only turns whose completion
 * was observed live carry one; timeline backfill can't recover it.
 */
function formatTurnTokensLabel(usage: AgentUsage | undefined): string {
  if (!usage) {
    return "";
  }
  const total =
    (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    return "";
  }
  return `${formatTokenCount(total)} tokens`;
}

const assistantTurnFooterStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 24,
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginLeft: -theme.spacing[1],
  },
  detailsLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // Absorbs the slack between the left cluster and the right-pinned playback
  // button. When the message is narrower than the footer's own content the
  // container grows past its minWidth and this collapses to zero, so the
  // button lands right after the details ("on the end").
  spacer: {
    flex: 1,
  },
  iconAction: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: theme.borderRadius.md,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  iconActionPressed: {
    opacity: 0.7,
  },
}));

/**
 * Footer rendered next to the copy button at the end of an assistant turn.
 * Shows every detail at once - end time, turn duration, and token usage,
 * bullet-separated - instead of swapping content on hover. Whether the whole footer is hidden
 * until hover is decided by its container (see CompletedTurnFooterRow).
 */
export const MessageFooter = memo(function MessageFooter({
  getContent,
  completedAt,
  durationMs,
  usage,
  onFork,
  leadingActions,
  trailingActions,
}: MessageFooterProps) {
  const timestampLabel = useChatTimestampLabel(completedAt?.getTime());
  const detailsLabel = useMemo(() => {
    const durationLabel = durationMs !== undefined ? formatDuration(durationMs) : "";
    return [timestampLabel, durationLabel, formatTurnTokensLabel(usage)]
      .filter(Boolean)
      .join(" • ");
  }, [durationMs, timestampLabel, usage]);
  const handleFork = useCallback(
    (target: AssistantForkTarget) => {
      return onFork?.(target);
    },
    [onFork],
  );
  const canFork = Boolean(onFork);
  // Speak-this-message is available whenever the host can stream speech on
  // demand (the ttsSpeak capability); no live voice session required.
  return (
    <View style={assistantTurnFooterStylesheet.container}>
      <TurnCopyButton
        getContent={getContent}
        containerStyle={assistantTurnFooterStylesheet.copyButton}
      />
      {canFork ? <AssistantForkMenu onFork={handleFork} /> : null}
      {leadingActions}
      {detailsLabel ? (
        <Text style={assistantTurnFooterStylesheet.detailsLabel}>{detailsLabel}</Text>
      ) : null}
      {trailingActions}
    </View>
  );
});

/** @deprecated Use the provider-neutral MessageFooter. */
export const AssistantTurnFooter = MessageFooter;

/** A bare glyph action that shares Copy's fixed message-footer baseline. */
export const MessageFooterIconAction = memo(function MessageFooterIconAction({
  onPress,
  accessibilityLabel,
  renderIcon,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  renderIcon: (state: { active: boolean }) => ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);
  const actionStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      assistantTurnFooterStylesheet.iconAction,
      pressed && assistantTurnFooterStylesheet.iconActionPressed,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPress={onPress}
      style={actionStyle}
    >
      {({ hovered, pressed }) => renderIcon({ active: Boolean(hovered) || pressed || focused })}
    </Pressable>
  );
});

interface AssistantMessageProps {
  message: string;
  timestamp: number;
  workspaceRoot?: string;
  serverId?: string;
  client?: DaemonClient | null;
  /**
   * The stream item id. Used as the bubble-group key fallback for a standalone
   * (ungrouped) reply, keying the text registry the per-bubble playback button
   * reads (agent-stream/assistant-bubble-text.ts).
   */
  id?: string;
  spacing?: "default" | "compactTop" | "compactBottom" | "compactBoth";
  /** Controls streaming-safe Markdown fence presentation. */
  phase: MarkdownPhase;
  /**
   * How many characters of the message the live-turn typewriter reveal has
   * reached (see agent-stream/turn-reveal.ts). Undefined (or >= length)
   * renders the full text; 0 renders nothing - the item appears once the
   * reveal reaches it. Display-only: store text, copy content, and turn
   * timing stay full-fidelity.
   */
  revealBudget?: number;
  /**
   * Identity of this segment within a split streamed reply (see
   * agent-stream/spacing.ts). Grouped segments report their bubble height and
   * read the summed height of the segments above them so the corner sheen
   * paints once across the whole visual bubble instead of per segment.
   */
  blockGroupId?: string;
  blockIndex?: number;
  /** Agent whose personality voice reads this bubble aloud. */
  agentId?: string;
  /**
   * This item is the growing end of a running turn - the model may still append
   * to it. Everything that reads a message as a finished thing (the playback
   * button's visibility, the auto-speech queue) waits for this to go false.
   */
  isTurnTail?: boolean;
  findQuery?: PreviewFindQuery | null;
  findActiveMatchIndex?: number;
}

export const assistantMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[2],
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  containerCompactTop: {
    paddingTop: 0,
  },
  containerCompactBottom: {
    paddingBottom: 0,
  },
  // Mirror of the user bubble (surface3, top-right corner): assistant prose
  // gets a flat surface2 bubble one elevation step below, corner pointing
  // left, so the two sides of the conversation read distinctly in every theme.
  // alignSelf flex-start + maxWidth lets a short reply hug its content; long
  // prose hits the chat column width and grows in height from there.
  bubble: {
    // 75%-alpha surface2 - same derived-token treatment as the user bubble so
    // both sides sit softly on the chat background (and the black chat scope).
    backgroundColor: theme.colors.surfaceAssistantBubble,
    borderRadius: theme.borderRadius["2xl"],
    borderTopLeftRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    // No paddingBottom: the last markdown block's own marginBottom already
    // leaves the bottom inset (see markdown-styles vertical rhythm).
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: 0,
    // Clips the BubbleCornerSheen square to the rounded corners.
    overflow: "hidden",
  },
  // A streamed reply is split into several assistant_message items sharing a
  // blockGroupId. Continuation segments square off their joining corners and
  // stretch to the full column so the group paints as one continuous bubble
  // (segments sizing independently would give the "one" bubble ragged edges).
  bubbleCompactTop: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
    alignSelf: "stretch",
  },
  bubbleCompactBottom: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    // The inter-segment stream gap (see getGapBetweenStreamItems) is painted
    // here, inside the bubble, instead of as transparent margin between items.
    paddingBottom: theme.spacing[3],
    alignSelf: "stretch",
  },
  imageFrame: {
    width: "100%",
    minHeight: 160,
    marginHorizontal: -theme.spacing[1],
  },
  imageSurface: {
    width: "100%",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    gap: theme.spacing[2],
  },
  imageErrorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

const ASSISTANT_IMAGE_MIN_HEIGHT = 160;
// Preview cap for block images in chat (e.g. browser_screenshot). A tall portrait shot scaled to
// fit content width alone would still be enormous, so we also bound the height and let the user
// open the attachment to see it full size.
const ASSISTANT_IMAGE_MAX_HEIGHT = 400;

// The live content width of the message bubble, measured by AssistantMessage and read by block
// images. The message view width is variable (window size, split panes, sidebar, phone vs desktop),
// so images size against this rather than any constant - they must never exceed the message view,
// exactly like text. `null` until the first layout; images fall back to the content-width constant.
const AssistantImageWidthContext = createContext<number | null>(null);
const ASSISTANT_IMAGE_MEASURE_STYLE: ViewStyle = { alignSelf: "stretch" };
// Mirrors assistantMessageStylesheet.bubble's `paddingHorizontal: theme.spacing[3]`, both sides.
// The image width is measured on the container outside the bubble (see handleContentLayout), so
// the padding has to come off by hand; keep these two in step.
const ASSISTANT_BUBBLE_HORIZONTAL_INSET = SPACING[3] * 2;

const AssistantMarkdownResolvedImage = memo(function AssistantMarkdownResolvedImage({
  uri,
  alt,
  containerStyle,
  source,
  workspaceRoot,
  serverId,
  attachment,
}: {
  uri: string;
  alt?: string;
  containerStyle?: StyleProp<ViewStyle>;
  source: string;
  workspaceRoot?: string;
  serverId?: string;
  attachment?: UserMessageImageAttachment | null;
}) {
  const cachedMetadata = useMemo(
    () => getAssistantImageMetadata({ source, workspaceRoot, serverId }),
    [serverId, source, workspaceRoot],
  );
  const [loadState, setLoadState] = useState<AssistantImageLoadState>(() =>
    getAssistantImageLoadStateFromMetadata(cachedMetadata),
  );

  useEffect(() => {
    if (cachedMetadata) {
      setLoadState(getAssistantImageLoadStateFromMetadata(cachedMetadata));
      return () => {};
    }

    setLoadState({ status: "loading" });
    let cancelled = false;

    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled) {
          return;
        }
        if (width > 0 && height > 0) {
          const metadata = setAssistantImageMetadata(
            { source, workspaceRoot, serverId },
            { width, height },
          );
          setLoadState({
            status: "ready",
            aspectRatio: metadata?.aspectRatio ?? width / height,
            width,
          });
        }
      },
      () => {
        if (cancelled) {
          return;
        }
        setLoadState({ status: "error" });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [cachedMetadata, serverId, source, uri, workspaceRoot]);

  const handleImageError = useCallback(() => {
    setLoadState({ status: "error" });
  }, []);
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const measuredContentWidth = useContext(AssistantImageWidthContext);
  // A markdown image has no intrinsic width, and `width:"100%"` never resolves through the
  // content-sized flex ancestors of an image-only message - the whole column collapses to 0 and the
  // image renders at 0×0 even though it loaded. So we give the frame an explicit pixel size, which
  // both sizes the image and gives the collapsed ancestors an intrinsic width to grow to. Scale the
  // natural size down to fit the box (real message content width × ASSISTANT_IMAGE_MAX_HEIGHT),
  // never upscaling, so a screenshot is a preview that never exceeds the (variable) message view.
  const displaySize = useMemo(() => {
    if (loadState.status !== "ready") {
      return null;
    }
    const naturalWidth = loadState.width;
    const naturalHeight = loadState.width / loadState.aspectRatio;
    const boxWidth =
      measuredContentWidth && measuredContentWidth > 0
        ? measuredContentWidth
        : Math.min(MAX_CONTENT_WIDTH, windowWidth > 0 ? windowWidth - 24 : MAX_CONTENT_WIDTH);
    const scale = Math.min(1, boxWidth / naturalWidth, ASSISTANT_IMAGE_MAX_HEIGHT / naturalHeight);
    return { width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) };
  }, [loadState, measuredContentWidth, windowWidth]);
  const surfaceStyle = useMemo<StyleProp<ViewStyle>>(() => {
    if (displaySize === null) {
      return [assistantMessageStylesheet.imageSurface, { height: ASSISTANT_IMAGE_MIN_HEIGHT }];
    }
    return [
      assistantMessageStylesheet.imageSurface,
      { width: displaySize.width, height: displaySize.height },
    ];
  }, [displaySize]);
  const frameStyle = useMemo<StyleProp<ViewStyle>>(() => {
    if (displaySize === null) {
      return [assistantMessageStylesheet.imageFrame, containerStyle];
    }
    return [
      assistantMessageStylesheet.imageFrame,
      containerStyle,
      { width: displaySize.width, alignSelf: "flex-start" as const },
    ];
  }, [containerStyle, displaySize]);
  const stateSurfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [surfaceStyle, assistantMessageStylesheet.imageState],
    [surfaceStyle],
  );
  const imageSource = useMemo(() => ({ uri }), [uri]);

  if (loadState.status !== "ready") {
    return (
      <View style={frameStyle}>
        <View style={stateSurfaceStyle}>
          {loadState.status === "loading" ? <LoadingSpinner size="small" /> : null}
          {loadState.status === "error" ? (
            <Text style={assistantMessageStylesheet.imageErrorText}>
              {t("message.attachments.imageUnavailable")}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  const image = (
    <View style={frameStyle}>
      <View style={surfaceStyle}>
        <Image
          source={imageSource}
          style={assistantMessageStylesheet.image}
          resizeMode="contain"
          accessibilityLabel={alt}
          onError={handleImageError}
        />
      </View>
    </View>
  );
  return attachment ? (
    <ChatImageContextMenuTarget attachment={attachment} previewUrl={uri}>
      {image}
    </ChatImageContextMenuTarget>
  ) : (
    image
  );
});

function AssistantMarkdownImage({
  source,
  alt,
  hasLeadingContent,
  client,
  workspaceRoot,
  serverId,
}: {
  source: string;
  alt?: string;
  hasLeadingContent: boolean;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
}) {
  const { t } = useTranslation();
  const resolution = useMemo(
    () => resolveAssistantImageSource({ source, workspaceRoot }),
    [source, workspaceRoot],
  );
  const dataImage = useMemo(() => parseImageDataUrl(source), [source]);
  const containerStyle = useMemo<StyleProp<ViewStyle>>(
    () => ({
      marginTop: hasLeadingContent ? 16 : 0,
      marginBottom: 0,
    }),
    [hasLeadingContent],
  );

  const query = useQuery({
    queryKey: [
      "assistantMarkdownImage",
      serverId ?? "unknown-server",
      resolution?.kind === "file_rpc" ? resolution.cwd : null,
      resolution?.kind === "file_rpc" ? resolution.path : null,
    ],
    enabled: Boolean(client && resolution?.kind === "file_rpc"),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client || !resolution || resolution.kind !== "file_rpc") {
        return null;
      }

      const file = await client.readFile(resolution.cwd, resolution.path);
      if (file.kind !== "image") {
        throw new Error(t("message.attachments.imagePreviewUnavailable"));
      }

      return await persistAttachmentFromBytes({
        id: createPreviewAttachmentId({
          mimeType: file.mime,
          path: file.path || resolution.path,
          size: file.size,
          modifiedAt: file.modifiedAt,
          contentLength: file.bytes.byteLength,
        }),
        bytes: file.bytes,
        mimeType: file.mime,
        fileName: getFileNameFromPath(file.path || resolution.path),
      });
    },
  });
  const dataImageQuery = useQuery({
    queryKey: ["assistantMarkdownDataImage", dataImage?.cacheKey ?? null],
    enabled: dataImage !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (!dataImage) {
        return null;
      }

      return await persistAttachmentFromDataUrl({
        id: createPreviewAttachmentId({
          mimeType: dataImage.mimeType,
          contentLength: dataImage.base64.length,
        }),
        dataUrl: source,
        mimeType: dataImage.mimeType,
      });
    },
  });

  const fileAssetUri = useAttachmentPreviewUrl(query.data);
  const dataImageAssetUri = useAttachmentPreviewUrl(dataImageQuery.data);
  const directUri = resolution?.kind === "direct" && !dataImage ? resolution.uri : null;
  const resolvedUri = directUri ?? dataImageAssetUri ?? fileAssetUri ?? null;

  const stateFrameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      assistantMessageStylesheet.imageFrame,
      containerStyle,
      { height: ASSISTANT_IMAGE_MIN_HEIGHT },
      assistantMessageStylesheet.imageState,
    ],
    [containerStyle],
  );

  if (resolvedUri) {
    return (
      <AssistantMarkdownResolvedImage
        uri={resolvedUri}
        alt={alt}
        containerStyle={containerStyle}
        source={source}
        workspaceRoot={workspaceRoot}
        serverId={serverId}
        attachment={query.data ?? dataImageQuery.data}
      />
    );
  }

  if (query.isLoading || dataImageQuery.isLoading) {
    return (
      <View style={stateFrameStyle}>
        <LoadingSpinner size="small" />
      </View>
    );
  }

  const errorText = resolveAssistantImageErrorText(
    query.error,
    dataImageQuery.error,
    t("message.attachments.imagePreviewLoadFailed"),
  );

  return (
    <View style={stateFrameStyle}>
      <Text style={assistantMessageStylesheet.imageErrorText}>{errorText}</Text>
    </View>
  );
}

function resolveAssistantImageErrorText(
  fileError: unknown,
  dataError: unknown,
  fallbackText: string,
): string {
  if (fileError instanceof Error) return fileError.message;
  if (dataError instanceof Error) return dataError.message;
  return fallbackText;
}

function getInlineCodeAutoLinkUrl(
  markdownParser: ReturnType<typeof MarkdownIt>,
  content: string,
): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const matches:
    | {
        index: number;
        lastIndex: number;
        url: string;
      }[]
    | null = markdownParser.linkify.match(trimmed);
  if (!matches || matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  if (!match || match.index !== 0 || match.lastIndex !== trimmed.length) {
    return null;
  }

  return match.url;
}

function getInlineCodeAutoLinkSource(input: {
  href: string;
  content: string;
}): AssistantFileLinkSource {
  return {
    href: input.href,
    text: input.content,
    markup: "linkify",
    sourceInfo: "auto",
  };
}

interface AssistantMarkdownAstNode extends ASTNode {
  sourceInfo?: string;
}

function getMarkdownLinkSource(node: AssistantMarkdownAstNode): AssistantFileLinkSource {
  return {
    href: typeof node.attributes?.href === "string" ? node.attributes.href : "",
    text: getMarkdownNodeText(node),
    markup: node.markup,
    sourceInfo: node.sourceInfo,
    sourceType: node.sourceType === "inline-code" ? "inline-code" : undefined,
  };
}

function getMarkdownNodeText(node: ASTNode): string {
  if (!node.children.length) {
    return node.content ?? "";
  }

  return node.children.map(getMarkdownNodeText).join("");
}

function nodeHasParentType(parent: unknown, type: string): boolean {
  if (Array.isArray(parent)) {
    return parent.some((entry) => entry?.type === type);
  }

  return (
    typeof parent === "object" &&
    parent !== null &&
    "type" in parent &&
    (parent as Record<"type", unknown>)["type"] === type
  );
}

const turnCopyButtonStylesheet = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "flex-start",
    padding: theme.spacing[2],
    paddingTop: 0,
    marginTop: theme.spacing[2],
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));

interface TurnCopyButtonProps {
  getContent: () => string;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  copiedAccessibilityLabel?: string;
}

export const TurnCopyButton = memo(function TurnCopyButton({
  getContent,
  containerStyle,
  accessibilityLabel,
  copiedAccessibilityLabel,
}: TurnCopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    const content = getContent();
    if (!content) {
      return;
    }

    await writeMarkdownToRichClipboard(content, getDefaultMarkdownClipboardEnvironment());
    setCopied(true);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }, [getContent]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const pressableStyle = useMemo(
    () => [turnCopyButtonStylesheet.container, containerStyle],
    [containerStyle],
  );

  return (
    <Pressable
      onPress={handleCopy}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={
        copied
          ? (copiedAccessibilityLabel ?? t("message.actions.copied"))
          : (accessibilityLabel ?? t("message.actions.copyTurn"))
      }
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? turnCopyButtonStylesheet.iconHoveredColor.color
          : turnCopyButtonStylesheet.iconColor.color;
        // `chromeMd`, not `md`: a per-turn action that sits under dense transcript text
        // stays on the chrome ladder, so it grows by half on compact rather than
        // doubling. Desktop pixels are unchanged.
        return copied ? (
          <Check size="chromeMd" color={iconColor} />
        ) : (
          <Copy size="chromeMd" color={iconColor} />
        );
      }}
    </Pressable>
  );
});

const expandableBadgeStylesheet = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: -13,
  },
  containerSpacing: {
    marginBottom: theme.spacing[0],
  },
  containerLastInSequence: {
    marginBottom: theme.spacing[1],
  },
  // An expanded row renders a visible bordered box (pressableExpanded +
  // detailWrapper below). Collapsed rows are borderless, so they can sit
  // nearly flush - but an expanded row needs real breathing room, or its
  // border touches the next row's border and the two tool calls read as one
  // merged box.
  containerExpandedSpacing: {
    marginBottom: theme.spacing[3],
  },
  pressable: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    overflow: "hidden",
  },
  pressablePressed: {
    opacity: 0.9,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerRowWrapped: {
    alignItems: "flex-start",
  },
  labelRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  labelRowWrapped: {
    alignItems: "flex-start",
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
    backgroundColor: "transparent",
  },
  // The glyph is vertically centred in a fixed 22px slot while a multiline
  // summary aligns its first text baseline at the row top. A tiny optical lift
  // makes the icon read as belonging to that first line.
  iconBadgeMultiLine: {
    marginTop: -2,
  },
  label: {
    color: theme.colors.foregroundMuted,
    // Matches assistant prose (theme.fontSize.sm) - chat is a working
    // surface, not a document. See createMarkdownStyles' `body`/`text`.
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 0,
  },
  labelWrapped: {
    flexShrink: 1,
    minWidth: 0,
    ...(isWeb ? { overflowWrap: "anywhere" as const } : null),
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  labelLoading: {
    color: theme.colors.foreground,
    opacity: 0.72,
  },
  secondaryLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    marginLeft: theme.spacing[2],
  },
  secondaryLabelWrapped: {
    // Keep the short tool name in its left column. The summary owns the
    // remaining width, so every continuation line starts under the summary,
    // rather than becoming a new row below the name.
    flex: 1,
    ...(isWeb ? { overflowWrap: "anywhere" as const } : null),
  },
  secondaryLabelActive: {
    color: theme.colors.foreground,
  },
  shimmerText: {
    color: "transparent",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  spacer: {
    flex: 1,
  },
  chevron: {
    flexShrink: 0,
    transform: [{ scale: 1.3 }],
  },
  openFileButton: {
    marginLeft: theme.spacing[1],
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  openFileButtonPlaceholderIcon: {
    width: 14,
    height: 14,
  },
  chevronExpanded: {
    transform: [{ scale: 1.3 }, { rotate: "90deg" }],
  },
  detailWrapper: {
    borderBottomLeftRadius: theme.borderRadius.lg,
    borderBottomRightRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderTopWidth: 0,
    borderColor: theme.colors.border,
    padding: 0,
    gap: 0,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    ...(isWeb ? { cursor: "auto" as const, userSelect: "text" as const } : {}),
  },
  pressableExpanded: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  shimmerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  shimmerOverlayWrapped: {
    alignItems: "flex-start",
  },
  shimmerMaskRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  shimmerMaskRowWrapped: {
    alignItems: "flex-start",
  },
  nativeShimmerTrack: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  nativeShimmerPeak: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
}));

interface NativeExpandableBadgeShimmerProps {
  label: string;
  secondaryLabel?: string;
  rowWidth: number;
  rowHeight: number;
  peakWidth: number;
  durationSeconds: number;
  gradientId: string;
  effect: SweepTextEffectSpec;
  textLayout: ReturnType<typeof resolveToolCallTextLayout>;
}

const NativeExpandableBadgeShimmer = memo(function NativeExpandableBadgeShimmer({
  label,
  secondaryLabel,
  rowWidth,
  rowHeight,
  peakWidth,
  durationSeconds,
  gradientId,
  effect,
  textLayout,
}: NativeExpandableBadgeShimmerProps) {
  const shimmerTranslateX = useSharedValue(0);
  const { bounce, easing } = effect;

  useEffect(() => {
    const startPosition = -peakWidth;
    const endPosition = rowWidth + peakWidth;
    shimmerTranslateX.value = startPosition;
    shimmerTranslateX.value = withRepeat(
      withTiming(endPosition, {
        duration: durationSeconds * 1000,
        easing: easing === "ease-in-out" ? Easing.inOut(Easing.ease) : Easing.linear,
      }),
      -1,
      // Bounce themes (Night Rider) reverse each cycle instead of restarting.
      bounce,
    );
    return () => {
      cancelAnimation(shimmerTranslateX);
    };
  }, [bounce, durationSeconds, easing, peakWidth, rowWidth, shimmerTranslateX]);

  const nativeShimmerPeakStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerTranslateX.value }],
  }));

  const nativeShimmerTrackStyle = useMemo(
    () => [expandableBadgeStylesheet.nativeShimmerTrack, { width: rowWidth, height: rowHeight }],
    [rowHeight, rowWidth],
  );

  const nativeShimmerMaskStyle = useMemo(
    () => [
      expandableBadgeStylesheet.shimmerMaskRow,
      textLayout.wrap && expandableBadgeStylesheet.shimmerMaskRowWrapped,
      { width: rowWidth, height: rowHeight },
    ],
    [rowHeight, rowWidth, textLayout.wrap],
  );

  const nativeLabelMaskStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      textLayout.wrap && expandableBadgeStylesheet.labelWrapped,
      { color: "#000000", opacity: 1 },
    ],
    [textLayout.wrap],
  );

  const nativeSecondaryMaskStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      textLayout.wrap && expandableBadgeStylesheet.secondaryLabelWrapped,
      { color: "#000000", opacity: 1 },
    ],
    [textLayout.wrap],
  );

  const nativeShimmerPeakCombinedStyle = useMemo(
    () => [
      expandableBadgeStylesheet.nativeShimmerPeak,
      nativeShimmerPeakStyle,
      { width: peakWidth, height: rowHeight },
    ],
    [nativeShimmerPeakStyle, peakWidth, rowHeight],
  );

  const maskElement = useMemo(
    () => (
      <View pointerEvents="none" style={nativeShimmerMaskStyle}>
        <Text style={nativeLabelMaskStyle} numberOfLines={textLayout.numberOfLines}>
          {label}
        </Text>
        {secondaryLabel ? (
          <Text style={nativeSecondaryMaskStyle} numberOfLines={textLayout.numberOfLines}>
            {secondaryLabel}
          </Text>
        ) : (
          <View style={expandableBadgeStylesheet.spacer} />
        )}
      </View>
    ),
    [
      nativeShimmerMaskStyle,
      nativeLabelMaskStyle,
      nativeSecondaryMaskStyle,
      label,
      secondaryLabel,
      textLayout.numberOfLines,
    ],
  );

  return (
    <View style={expandableBadgeStylesheet.shimmerOverlay} pointerEvents="none">
      <MaskedView pointerEvents="none" style={nativeShimmerTrackStyle} maskElement={maskElement}>
        <View pointerEvents="none" style={nativeShimmerTrackStyle}>
          <Animated.View pointerEvents="none" style={nativeShimmerPeakCombinedStyle}>
            <NativeShimmerPeakSvg gradientId={gradientId} stops={effect.nativeStops} />
          </Animated.View>
        </View>
      </MaskedView>
    </View>
  );
});

function NativeShimmerPeakSvg({
  gradientId,
  stops,
}: {
  gradientId: string;
  stops: SweepTextEffectSpec["nativeStops"];
}) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {stops.map((stop) => (
            <Stop
              key={stop.offset}
              offset={`${stop.offset * 100}%`}
              stopColor={stop.color}
              stopOpacity={stop.opacity}
            />
          ))}
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

interface AssistantMessageBlockContainerProps {
  block: string;
  children: ReactNode;
}

// No spacing of its own: the markdown styles inside each block already carry
// the vertical rhythm (every block element leaves its own marginBottom), so a
// container margin here would double every gap that splitMarkdownBlocks
// creates. This keeps split rendering identical to rendering the same
// markdown unsplit.
function AssistantMessageBlockContainer({ block, children }: AssistantMessageBlockContainerProps) {
  // Measure once per (block, column width), then drop the observer.
  //
  // On web `onLayout` is a ResizeObserver, so leaving it attached meant every mounted
  // message kept one live observer per markdown block, firing through every scroll-driven
  // layout pass to write a height the cache already had. The measurement exists only to
  // feed the virtualizer's size estimate, and that number does not change until either the
  // text or the column width does - both of which re-arm this below.
  const contentWidth = useContext(AssistantImageWidthContext);
  const columnWidth = contentWidth === null ? null : Math.round(contentWidth);
  const [measured, setMeasured] = useState<{ block: string; columnWidth: number | null } | null>(
    null,
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setAssistantMarkdownBlockHeight({ block, width, height });
      setMeasured({ block, columnWidth: Math.round(width) });
    },
    [block],
  );

  // `columnWidth` is the bubble's content width and the block stretches to fill it, so the
  // two agree; comparing against what we recorded (rather than assuming equality) is what
  // makes a window resize re-arm the measurement.
  const alreadyMeasured =
    measured !== null &&
    measured.block === block &&
    (measured.columnWidth === columnWidth ||
      (columnWidth !== null && hasAssistantMarkdownBlockHeight({ block, width: columnWidth })));

  return <View onLayout={isWeb && !alreadyMeasured ? handleLayout : undefined}>{children}</View>;
}

interface MemoizedMarkdownBlockProps {
  text: string;
  rules: RenderRules;
  parser: ReturnType<typeof MarkdownIt>;
  onLinkPress: (url: string) => boolean;
}

const MemoizedMarkdownBlock = React.memo(function MemoizedMarkdownBlock({
  text,
  rules,
  parser,
  onLinkPress,
}: MemoizedMarkdownBlockProps) {
  return (
    <MarkdownRenderer
      text={text}
      enableHtmlish={false}
      rules={rules}
      markdownit={parser}
      onLinkPress={onLinkPress}
      allowedImageHandlers={MARKDOWN_ALLOWED_IMAGE_HANDLERS}
      topLevelMaxExceededItem={MARKDOWN_TOP_LEVEL_MAX_EXCEEDED_ITEM}
    />
  );
});

interface MarkdownInheritedTextProps {
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  style?: StyleProp<TextStyle>;
  monoSurface?: boolean;
  copyTag?: MarkdownCopyInlineTag;
  children: ReactNode;
}

function MarkdownInheritedText({
  inheritedStyles,
  textStyle,
  style: overrideStyle,
  monoSurface,
  copyTag,
  children,
}: MarkdownInheritedTextProps) {
  const style = useMemo(
    () => [inheritedStyles, textStyle, overrideStyle],
    [inheritedStyles, textStyle, overrideStyle],
  );
  // When this span renders link label text on iOS, pick up the link's press
  // handler from context and hand it to MarkdownTextSpan, which forwards it to
  // the leaf string children react-native-uitextview makes tappable. Null
  // outside a link (and on every other platform, where no provider mounts), so
  // ordinary text is unaffected. See assistant-file-links/link-press-context.
  const linkPress = useAssistantLinkPress();
  return (
    <MarkdownTextSpan
      monoSurface={monoSurface}
      copyTag={copyTag}
      style={style}
      onPress={linkPress?.onPress}
      accessibilityRole={linkPress?.accessibilityRole}
    >
      {children}
    </MarkdownTextSpan>
  );
}

interface MarkdownListItemContentProps {
  contentStyle: ViewStyle;
  children: ReactNode;
}

const MARKDOWN_LIST_ITEM_CONTENT_FLEX: ViewStyle = { flex: 1, flexShrink: 1, minWidth: 0 };

function MarkdownListItemContent({ contentStyle, children }: MarkdownListItemContentProps) {
  const style = useMemo(() => [contentStyle, MARKDOWN_LIST_ITEM_CONTENT_FLEX], [contentStyle]);
  return <View style={style}>{children}</View>;
}

interface MarkdownListViewProps {
  baseStyle: ViewStyle;
  copyTag: "ol" | "ul";
  orderedStart?: unknown;
  spacing: { marginTop: number; marginBottom: number };
  children: ReactNode;
}

function MarkdownListView({
  baseStyle,
  copyTag,
  orderedStart,
  spacing,
  children,
}: MarkdownListViewProps) {
  const style = useMemo(() => [baseStyle, spacing], [baseStyle, spacing]);
  const copyDataSet =
    copyTag === "ol" ? markdownCopyOrderedListDataSet(orderedStart) : markdownCopyDataSet.ul;
  return (
    <View style={style} dataSet={copyDataSet}>
      {children}
    </View>
  );
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  timestamp: _timestamp,
  workspaceRoot,
  serverId,
  client,
  id,
  spacing = "default",
  phase,
  revealBudget,
  blockGroupId,
  blockIndex,
  agentId,
  isTurnTail,
  findQuery,
  findActiveMatchIndex,
}: AssistantMessageProps) {
  const showBubbleGradient = useAppSettingValue(selectChatBubbleGradient);
  const displayMessage =
    revealBudget === undefined || revealBudget >= message.length
      ? message
      : sliceAtSafeBoundary(message, revealBudget);
  const markdownParser = useMemo(() => createAssistantMarkdownParser(), []);

  const fileLinkActions = useAssistantFileLinkActions();
  const handleMarkdownLinkPress = useStableEvent((url: string) => {
    fileLinkActions.open({ href: url }, "main");
    // react-native-markdown-display opens the link itself when this returns true.
    // We already handled it above, so return false to avoid duplicate opens.
    return false;
  });

  const baseMarkdownRules = useMemo<RenderRules>(() => {
    return {
      heading1: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_heading1} dataSet={markdownCopyDataSet.h1}>
          {children}
        </View>
      ),
      heading2: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_heading2} dataSet={markdownCopyDataSet.h2}>
          {children}
        </View>
      ),
      heading3: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_heading3} dataSet={markdownCopyDataSet.h3}>
          {children}
        </View>
      ),
      heading4: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_heading4} dataSet={markdownCopyDataSet.h4}>
          {children}
        </View>
      ),
      heading5: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_heading5} dataSet={markdownCopyDataSet.h5}>
          {children}
        </View>
      ),
      heading6: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_heading6} dataSet={markdownCopyDataSet.h6}>
          {children}
        </View>
      ),
      blockquote: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View
          key={node.key}
          style={styles._VIEW_SAFE_blockquote}
          dataSet={markdownCopyDataSet.blockquote}
        >
          {children}
        </View>
      ),
      hr: (node: ASTNode, _children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <View key={node.key} style={styles._VIEW_SAFE_hr} dataSet={markdownCopyDataSet.hr} />
      ),
      table: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <View key={node.key} style={styles._VIEW_SAFE_table} dataSet={markdownCopyDataSet.table}>
          {children}
        </View>
      ),
      thead: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <View key={node.key} style={styles._VIEW_SAFE_thead} dataSet={markdownCopyDataSet.thead}>
          {children}
        </View>
      ),
      tbody: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <View key={node.key} style={styles._VIEW_SAFE_tbody} dataSet={markdownCopyDataSet.tbody}>
          {children}
        </View>
      ),
      tr: (node: ASTNode, children: ReactNode[], parent: ASTNode[], styles: MarkdownStyles) => (
        <View
          key={node.key}
          style={[
            styles._VIEW_SAFE_tr,
            isLastMarkdownTableChild(node, parent, "tbody") && styles._VIEW_SAFE_tableLastRow,
          ]}
          dataSet={markdownCopyDataSet.tr}
        >
          {children}
        </View>
      ),
      text: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.text}
        >
          {node.content}
        </MarkdownInheritedText>
      ),
      textgroup: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.textgroup}
        >
          {children}
        </MarkdownInheritedText>
      ),
      // strong/em/s have no custom rule in react-native-markdown-display's
      // defaults beyond wrapping children in a plain RN <Text>. On iOS the
      // paragraph/textgroup are native UITextViews (see markdown-text.ios.tsx),
      // and a plain <Text> nested inside one is not hoisted into a
      // UITextViewChild, so its content renders invisibly. Route these inline
      // marks through MarkdownTextSpan (same path as text/textgroup) so the
      // styled content composes and stays visible + selectable on iOS.
      strong: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          copyTag="strong"
          inheritedStyles={inheritedStyles}
          textStyle={styles.strong}
        >
          {children}
        </MarkdownInheritedText>
      ),
      em: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          copyTag="em"
          inheritedStyles={inheritedStyles}
          textStyle={styles.em}
        >
          {children}
        </MarkdownInheritedText>
      ),
      s: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          copyTag="s"
          inheritedStyles={inheritedStyles}
          textStyle={styles.s}
        >
          {children}
        </MarkdownInheritedText>
      ),
      // Preserve the renderer's resolved break styles. Android relies on the
      // hardbreak width, while native text selection needs the custom span.
      hardbreak: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownTextSpan key={node.key} style={styles.hardbreak} copyTag="br">
          {"\n"}
        </MarkdownTextSpan>
      ),
      softbreak: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownTextSpan key={node.key} style={styles.softbreak}>
          {"\n"}
        </MarkdownTextSpan>
      ),
      code_block: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <HighlightedCodeBlock
          key={node.key}
          code={node.content}
          language={null}
          inheritedStyles={inheritedStyles}
          textStyle={styles.code_block}
        />
      ),
      fence: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownFenceBlock
          key={node.key}
          code={node.content}
          info={node.sourceInfo}
          phase={phase}
          inheritedStyles={inheritedStyles}
          textStyle={styles.fence}
        />
      ),
      code_inline: (
        node: ASTNode,
        _children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => {
        const content = node.content ?? "";
        const isLinkedInlineCode = nodeHasParentType(parent, "link");
        const inlineCodeSource: AssistantFileLinkSource = {
          href: content,
          text: content,
          sourceType: "inline-code",
        };
        const shouldResolveInlinePath =
          !isLinkedInlineCode && fileLinkActions.canResolveFile(inlineCodeSource);

        if (shouldResolveInlinePath) {
          return (
            <AssistantInlineCodePathLink
              key={node.key}
              content={content}
              inheritedStyles={inheritedStyles}
              codeInlineStyle={styles.code_inline}
              linkStyle={styles.link}
            />
          );
        }

        const inlineCodeLinkUrl = getInlineCodeAutoLinkUrl(markdownParser, content);
        if (inlineCodeLinkUrl) {
          const source = getInlineCodeAutoLinkSource({
            href: inlineCodeLinkUrl,
            content,
          });
          return (
            <AssistantMarkdownCodeLink
              key={node.key}
              source={source}
              inheritedStyles={inheritedStyles}
              codeInlineStyle={styles.code_inline}
              linkStyle={styles.link}
            >
              {content}
            </AssistantMarkdownCodeLink>
          );
        }

        return (
          <MarkdownInheritedText
            key={node.key}
            copyTag="code"
            inheritedStyles={inheritedStyles}
            textStyle={styles.code_inline}
            monoSurface
          >
            {content}
          </MarkdownInheritedText>
        );
      },
      bullet_list: (
        node: ASTNode,
        children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownListView
          key={node.key}
          baseStyle={styles.bullet_list}
          copyTag="ul"
          spacing={getMarkdownListSpacing(node, parent)}
        >
          {children}
        </MarkdownListView>
      ),
      ordered_list: (
        node: ASTNode,
        children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownListView
          key={node.key}
          baseStyle={styles.ordered_list}
          copyTag="ol"
          orderedStart={node.attributes?.start}
          spacing={getMarkdownListSpacing(node, parent)}
        >
          {children}
        </MarkdownListView>
      ),
      list_item: (
        node: ASTNode,
        children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
      ) => {
        const { isOrdered, marker } = getMarkdownListMarker(node, parent);
        const iconStyle = isOrdered ? styles.ordered_list_icon : styles.bullet_list_icon;
        const contentStyle = isOrdered ? styles.ordered_list_content : styles.bullet_list_content;

        return (
          <View key={node.key} style={styles.list_item} dataSet={markdownCopyDataSet.li}>
            <Text style={iconStyle} dataSet={markdownCopyDataSet.listMarker}>
              {marker}
            </Text>
            <MarkdownListItemContent contentStyle={contentStyle}>
              {children}
            </MarkdownListItemContent>
          </View>
        );
      },
      th: (node: ASTNode, children: ReactNode[], parent: ASTNode[], styles: MarkdownStyles) => (
        <MarkdownTableCellText key={node.key}>
          <View
            style={[
              styles._VIEW_SAFE_th,
              isLastMarkdownTableChild(node, parent, "tr") && styles._VIEW_SAFE_tableLastCell,
            ]}
            dataSet={markdownCopyTableCellDataSet("th", node.attributes?.style)}
          >
            {children}
          </View>
        </MarkdownTableCellText>
      ),
      td: (node: ASTNode, children: ReactNode[], parent: ASTNode[], styles: MarkdownStyles) => (
        <MarkdownTableCellText key={node.key}>
          <View
            style={[
              styles._VIEW_SAFE_td,
              isLastMarkdownTableChild(node, parent, "tr") && styles._VIEW_SAFE_tableLastCell,
            ]}
            dataSet={markdownCopyTableCellDataSet("td", node.attributes?.style)}
          >
            {children}
          </View>
        </MarkdownTableCellText>
      ),
      paragraph: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownParagraphView
          key={node.key}
          paragraphStyle={styles.paragraph}
          containsImage={markdownNodeContainsType(node, "image")}
        >
          {children}
        </MarkdownParagraphView>
      ),
      // Math is the one extension that needs a render rule as well as a parse
      // rule; these mirror the shared renderer's so a formula looks the same in
      // a reply as it does in the file viewer. Inline math on native still
      // shows its TeX source (see docs/markdown-rendering.md) - a webview
      // cannot live inside a <Text>.
      [MATH_INLINE_TOKEN]: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MathFormula key={node.key} tex={node.content ?? ""} display={false} style={styles.text} />
      ),
      [MATH_BLOCK_TOKEN]: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <View key={node.key} style={styles._VIEW_SAFE_paragraph}>
          <MathFormula tex={node.content ?? ""} display style={styles.text} />
        </View>
      ),
      link: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <AssistantMarkdownLink
          key={node.key}
          source={getMarkdownLinkSource(node)}
          style={styles.link}
        >
          {colorMarkdownLinkChildren(children, styles.link.color)}
        </AssistantMarkdownLink>
      ),
      image: (
        node: ASTNode,
        _children: ReactNode[],
        parent: ASTNode[],
        _styles: MarkdownStyles,
      ) => {
        const paragraphNode = Array.isArray(parent)
          ? parent.find((ancestor) => ancestor?.type === "paragraph")
          : null;
        const paragraphChildren = Array.isArray(paragraphNode?.children)
          ? paragraphNode.children
          : [];
        const imageIndex = paragraphChildren.findIndex((child: ASTNode) => child?.key === node.key);
        const hasLeadingContent = imageIndex > 0;

        return (
          <AssistantMarkdownImage
            key={node.key}
            source={String(node.attributes?.src ?? "")}
            alt={typeof node.attributes?.alt === "string" ? node.attributes.alt : undefined}
            hasLeadingContent={hasLeadingContent}
            client={client}
            workspaceRoot={workspaceRoot}
            serverId={serverId}
          />
        );
      },
    };
  }, [client, fileLinkActions, markdownParser, phase, serverId, workspaceRoot]);
  const markdownRules = useMessageFindRules(
    baseMarkdownRules,
    displayMessage,
    findQuery,
    findActiveMatchIndex,
  );

  const blocks = useMemo(() => splitMarkdownBlocks(displayMessage), [displayMessage]);
  // Index-only keys: block boundaries are append-only while a message streams
  // (splitMarkdownBlocks is a forward scan, so appended text never reshapes
  // earlier blocks). A content-derived key churns on every flush while the
  // tail block streams in, remounting its native views each time.
  const keyedBlocks = useMemo(
    () => blocks.map((block, index) => ({ key: String(index), block })),
    [blocks],
  );

  const assistantContainerStyle = useMemo(
    () => [
      assistantMessageStylesheet.container,
      (spacing === "compactTop" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactTop,
      (spacing === "compactBottom" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactBottom,
    ],
    [spacing],
  );
  const bubbleStyle = useMemo(
    () => [
      assistantMessageStylesheet.bubble,
      (spacing === "compactTop" || spacing === "compactBoth") &&
        assistantMessageStylesheet.bubbleCompactTop,
      (spacing === "compactBottom" || spacing === "compactBoth") &&
        assistantMessageStylesheet.bubbleCompactBottom,
    ],
    [spacing],
  );

  // Every grouped segment paints its slice of one sheen anchored at the
  // group's top edge, shifted up by the measured height of the segments above
  // it (agent-stream/bubble-group-offsets.ts).
  const bubbleRef = useRef<View>(null);
  // The width available to block images, so they never exceed the message view.
  //
  // Measured on the *outer* container, not inside the bubble. The bubble is content-sized
  // (`alignSelf: "flex-start"`), so its width is whatever its widest child is - and a block
  // image sets an explicit pixel width from this number. Measuring inside the bubble therefore
  // closed a loop: image width fed the bubble, the bubble fed the measurement, and the
  // measurement fed the image, ratcheting a screenshot down a little on every layout pass until
  // it was invisible. The outer container is laid out by the chat column and cannot be widened
  // or narrowed by its own content, which is what makes the number stable.
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
    // The container is outside the bubble's padding box, so take the padding off here.
    const width = event.nativeEvent.layout.width - ASSISTANT_BUBBLE_HORIZONTAL_INSET;
    setContentWidth((prev) =>
      width > 0 && (prev === null || Math.abs(width - prev) > 0.5) ? width : prev,
    );
  }, []);
  const groupOffsetTop = useBubbleGroupOffset(blockGroupId, blockIndex);
  // The visual bubble's identity: a standalone reply is its own group, a split
  // streamed reply shares one across its segments. Keys both the text registry
  // and the playback button (agent-stream/assistant-bubble-text.ts).
  const bubbleGroupId = blockGroupId ?? id;
  const bubbleBlockIndex = blockIndex ?? 0;
  const handleBubbleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (blockGroupId === undefined || blockIndex === undefined) {
        return;
      }
      reportBubbleSegmentHeight({
        groupId: blockGroupId,
        blockIndex,
        height: event.nativeEvent.layout.height,
      });
    },
    [blockGroupId, blockIndex],
  );
  // RN-web fires onLayout only on mount/window-resize, so a segment that
  // grows after mount (the live-turn reveal typing into it) would report a
  // stale height to the registry; re-measure whenever the displayed text
  // changes. Native onLayout re-fires on every layout change already.
  useEffect(() => {
    if (!isWeb || blockGroupId === undefined || blockIndex === undefined) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const node = bubbleRef.current as unknown as HTMLElement | null;
      const rect = node?.getBoundingClientRect?.();
      if (!rect) {
        return;
      }
      reportBubbleSegmentHeight({ groupId: blockGroupId, blockIndex, height: rect.height });
    });
    return () => cancelAnimationFrame(frame);
  }, [blockGroupId, blockIndex, displayMessage]);

  const playback = useAssistantBubblePlaybackState({
    serverId,
    spacing,
    groupId: bubbleGroupId,
    blockIndex: bubbleBlockIndex,
    message,
    displayedLength: displayMessage.length,
    isTurnTail,
  });
  const {
    showPlayback,
    visible: playbackVisible,
    dimmed: playbackDimmed,
    handlePointerEnter,
    handlePointerLeave,
  } = playback;

  // Not yet reached by the live-turn reveal: take no space (not even the
  // container padding) until the typewriter arrives at this item.
  if (message.length > 0 && displayMessage.length === 0) {
    return null;
  }

  // Continuation segments join mid-bubble: until the heights of the segments
  // above are known (offset 0) they render no sheen rather than restarting it
  // at their own top edge.
  const isContinuationSegment = spacing === "compactTop" || spacing === "compactBoth";
  let sheen: ReactNode = null;
  if (!showBubbleGradient) {
    sheen = null;
  } else if (!isContinuationSegment) {
    sheen = <BubbleCornerSheen corner="left" />;
  } else if (groupOffsetTop > 0) {
    sheen = <BubbleCornerSheen corner="left" offsetTop={groupOffsetTop} />;
  }

  // Plain View owns hover per docs/hover.md; the playback button is a separate
  // inner Pressable.
  return (
    <ChatThemeScope>
      <View
        testID="assistant-message"
        style={assistantContainerStyle}
        onLayout={handleContentLayout}
        onPointerEnter={isWeb ? handlePointerEnter : undefined}
        onPointerLeave={isWeb ? handlePointerLeave : undefined}
      >
        {keyedBlocks.length > 0 ? (
          <View
            ref={bubbleRef}
            style={bubbleStyle}
            onLayout={blockGroupId !== undefined ? handleBubbleLayout : undefined}
          >
            {sheen}
            <AssistantImageWidthContext.Provider value={contentWidth}>
              <View style={ASSISTANT_IMAGE_MEASURE_STYLE}>
                {keyedBlocks.map(({ key, block }) => (
                  <AssistantMessageBlockContainer key={key} block={block}>
                    <MemoizedMarkdownBlock
                      text={block}
                      rules={markdownRules}
                      parser={markdownParser}
                      onLinkPress={handleMarkdownLinkPress}
                    />
                  </AssistantMessageBlockContainer>
                ))}
              </View>
            </AssistantImageWidthContext.Provider>
            {showPlayback && serverId !== undefined && bubbleGroupId !== undefined ? (
              <AssistantBubblePlayback
                serverId={serverId}
                agentId={agentId}
                groupId={bubbleGroupId}
                visible={playbackVisible}
                dimmed={playbackDimmed}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </ChatThemeScope>
  );
});

/**
 * Everything the bubble needs to decide whether - and when - to show its
 * playback button. Extracted from AssistantMessage purely to keep that
 * component under the complexity ceiling; it holds no state the bubble's
 * rendering depends on beyond hover.
 */
function useAssistantBubblePlaybackState(input: {
  serverId?: string;
  spacing: AssistantMessageProps["spacing"];
  groupId: string | undefined;
  blockIndex: number;
  message: string;
  /** How much of `message` the typewriter reveal has laid out so far. */
  displayedLength: number;
  isTurnTail: boolean | undefined;
}): {
  showPlayback: boolean;
  visible: boolean;
  dimmed: boolean;
  handlePointerEnter: () => void;
  handlePointerLeave: () => void;
} {
  const { serverId, spacing, groupId, blockIndex, message } = input;
  // A bubble is only ready for its visible Play control after the model has
  // moved on AND the typewriter has drawn its full text. Starting an action
  // closes the preceding bubble even while the turn itself remains running.
  const isSettled = input.isTurnTail !== true && input.displayedLength >= message.length;
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const isCompact = useIsCompactFormFactor();
  const canPlay = useTtsSpeakFeature(serverId ?? "");

  // Report the FULL message (not the typewriter-revealed slice) so playback
  // reads the whole block even mid-reveal; the button resolves the group's
  // joined text on press.
  useEffect(() => {
    if (groupId === undefined) {
      return;
    }
    reportAssistantBubbleText({ groupId, blockIndex, text: message });
  }, [groupId, blockIndex, message]);

  // Auto-speech deliberately does NOT feed itself from here. A row lives only
  // while its chat is on screen, which made switching chats silence the chat you
  // walked away from; the queue is fed from the store instead, by one headless
  // source per enabled chat (voice/auto-speech-source.tsx). What this row still
  // owns is the Play affordance below.

  // One button per *visual* bubble, so it goes on the segment that ends the
  // group: "default" is a standalone reply and "compactTop" is the last segment
  // of a split one, while "compactBottom"/"compactBoth" still have a segment
  // below them and would each add a redundant button mid-bubble.
  const isLastSegment = spacing === "default" || spacing === "compactTop";
  return {
    // Not while the bubble is still growing: a Play affordance on a message
    // that is not finished being written offers something that does not exist
    // yet, and the icon riding the bubble's expanding edge looks broken.
    showPlayback: canPlay && isLastSegment && isSettled,
    // Hover is web-only (docs/hover.md), so native and compact keep it visible.
    visible: hovered || isNative || isCompact,
    // The permanently-visible case only. A hover-revealed button appears over
    // text the reader has already moved past, but one that is always there sits
    // on the tail of the last line of every bubble in the transcript - so it
    // rides at half opacity there, and goes solid again while it is speaking.
    dimmed: !hovered && (isNative || isCompact),
    handlePointerEnter,
    handlePointerLeave,
  };
}

interface AssistantBubblePlaybackProps {
  serverId: string;
  agentId?: string;
  groupId: string;
  visible: boolean;
  /**
   * The button is visible because the surface cannot hover, not because the
   * reader pointed at it. It then reads at half opacity so the line of text
   * underneath stays legible - see the styles below.
   */
  dimmed: boolean;
}

/**
 * The per-bubble playback control: one button per visual message, reading that
 * message and nothing else.
 *
 * It used to live in the turn footer, where `collectAssistantTurnContent` walked
 * the whole turn and joined every assistant message in it - so one press read a
 * turn's entire output aloud, which for a long turn is a lot of speech you did
 * not ask for. A turn that writes, calls a tool, then writes again now offers
 * two buttons, one per bubble.
 *
 * Absolutely positioned at the bubble's bottom-right rather than laid out in a
 * row of its own: a row would add its height to every bubble forever, whereas
 * this occupies no layout at all and only appears on hover. The circular chrome
 * is what keeps it legible where it overlaps the tail of the last line.
 */
function AssistantBubblePlayback({
  serverId,
  agentId,
  groupId,
  visible,
  dimmed,
}: AssistantBubblePlaybackProps) {
  const hasText = useAssistantBubbleHasText(groupId);
  // A speaking bubble keeps its button on screen regardless of hover - the
  // Stop control must never be the thing you have to hunt for. The claim is
  // taken from the first press, so this covers the loading state too.
  const isSpeaking = useIsMessagePlaybackActive(groupId);
  // Auto-speech reads bubbles without any press at all; its Stop button has to
  // stand out just as much.
  const isAutoSpeaking = useIsAutoSpeechSpeaking(groupId);
  const getContent = useCallback(() => getAssistantBubbleText(groupId), [groupId]);

  if (!hasText) {
    return null;
  }
  const isActive = isSpeaking || isAutoSpeaking;
  const shown = visible || isActive;
  const slotStyle = pickAssistantBubblePlaybackSlotStyle({ shown, dimmed, isActive });
  return (
    <View style={slotStyle} pointerEvents={shown ? "auto" : "none"}>
      <MessagePlaybackButton
        serverId={serverId}
        agentId={agentId}
        turnKey={groupId}
        getContent={getContent}
        testID={`assistant-bubble-playback-${groupId}`}
      />
    </View>
  );
}

/** Hidden, half-visible (permanent, at rest) or solid - one of the three slots. */
function pickAssistantBubblePlaybackSlotStyle(input: {
  shown: boolean;
  dimmed: boolean;
  isActive: boolean;
}) {
  if (!input.shown) {
    return assistantBubblePlaybackStyles.slot;
  }
  if (input.dimmed && !input.isActive) {
    return assistantBubblePlaybackStyles.slotDimmed;
  }
  return assistantBubblePlaybackStyles.slotVisible;
}

const assistantBubblePlaybackStyles = StyleSheet.create((theme) => ({
  slot: {
    position: "absolute",
    right: theme.spacing[1],
    bottom: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    opacity: theme.opacity[0],
  },
  slotVisible: {
    position: "absolute",
    right: theme.spacing[1],
    bottom: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    opacity: theme.opacity[100],
  },
  // Where hover cannot reveal the button it is on screen for every bubble at
  // once, sitting over the tail of each last line. Fading the whole slot -
  // chrome, border and glyph together - keeps the text underneath readable
  // while the target stays big enough to hit; a press restores full opacity by
  // switching to slotVisible.
  slotDimmed: {
    position: "absolute",
    right: theme.spacing[1],
    bottom: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    opacity: theme.opacity[50],
  },
}));

interface SpeakMessageProps {
  message: string;
  timestamp: number;
  disableOuterSpacing?: boolean;
}

const speakMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[3],
  },
  containerSpacing: {
    marginBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  headerLabel: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
    color: theme.colors.foreground,
  },
}));

export const SpeakMessage = memo(function SpeakMessage({
  message,
  timestamp: _timestamp,
  disableOuterSpacing,
}: SpeakMessageProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const containerStyle = useMemo(
    () => [
      speakMessageStylesheet.container,
      !resolvedDisableOuterSpacing && speakMessageStylesheet.containerSpacing,
    ],
    [resolvedDisableOuterSpacing],
  );

  return (
    <View testID="speak-message" style={containerStyle}>
      <View style={speakMessageStylesheet.header}>
        <ThemedMicVocal size="chromeXs" uniProps={foregroundMutedColorMapping} />
        <Text style={speakMessageStylesheet.headerLabel}>{t("message.speak.header")}</Text>
      </View>
      <Text style={speakMessageStylesheet.text}>{message}</Text>
    </View>
  );
});

interface ActivityLogProps {
  type: "system" | "info" | "success" | "error" | "artifact";
  message: string;
  details?: readonly string[];
  timestamp: number;
  metadata?: Record<string, unknown>;
  artifactId?: string;
  artifactType?: string;
  title?: string;
  onArtifactClick?: (artifactId: string) => void;
  disableOuterSpacing?: boolean;
}

const activityLogStylesheet = StyleSheet.create((theme) => ({
  pressable: {
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  pressableSpacing: {
    marginBottom: theme.spacing[1],
  },
  pressableActive: {
    opacity: 0.7,
  },
  systemBg: {
    backgroundColor: "rgba(39, 39, 42, 0.5)",
  },
  infoBg: {
    backgroundColor: "rgba(30, 58, 138, 0.3)",
  },
  successBg: {
    backgroundColor: "rgba(20, 83, 45, 0.3)",
  },
  errorBg: {},
  artifactBg: {
    backgroundColor: "rgba(30, 58, 138, 0.4)",
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconContainer: {
    flexShrink: 0,
    // Matches the chrome ladder the glyph inside it rides (x1.5 on compact); a fixed
    // 20 clipped the scaled icon.
    height: compactUp(20, 1.5),
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
  },
  messageText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: theme.spacing[1],
  },
  diagnosticList: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  diagnosticText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  detailsText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginRight: theme.spacing[1],
  },
  metadataContainer: {
    marginTop: theme.spacing[2],
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  metadataText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
    lineHeight: 16,
  },
}));

export const ActivityLog = memo(function ActivityLog({
  type,
  message,
  details,
  timestamp: _timestamp,
  metadata,
  artifactId,
  artifactType,
  title,
  onArtifactClick,
  disableOuterSpacing,
}: ActivityLogProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [isExpanded, setIsExpanded] = useState(false);

  const typeConfig = {
    system: {
      bg: activityLogStylesheet.systemBg,
      color: "#a1a1aa",
      Icon: Circle,
    },
    info: { bg: activityLogStylesheet.infoBg, color: "#60a5fa", Icon: Info },
    success: {
      bg: activityLogStylesheet.successBg,
      color: "#4ade80",
      Icon: CheckCircle,
    },
    error: {
      bg: activityLogStylesheet.errorBg,
      color: "#f87171",
      Icon: XCircle,
    },
    artifact: {
      bg: activityLogStylesheet.artifactBg,
      color: "#93c5fd",
      Icon: FileText,
    },
  };

  const config = typeConfig[type];
  const IconComponent = config.Icon;

  const hasDetails = (details?.length ?? 0) > 0;

  const handlePress = useCallback(() => {
    if (type === "artifact" && artifactId && onArtifactClick) {
      onArtifactClick(artifactId);
    } else if (metadata || hasDetails) {
      setIsExpanded((prev) => !prev);
    }
  }, [type, artifactId, onArtifactClick, metadata, hasDetails]);

  const displayMessage =
    type === "artifact" && artifactType && title ? `${artifactType}: ${title}` : message;

  const isInteractive = type === "artifact" || metadata || hasDetails;
  const pressableStyle = useMemo(
    () => [
      activityLogStylesheet.pressable,
      !resolvedDisableOuterSpacing && activityLogStylesheet.pressableSpacing,
      config.bg,
      isInteractive && activityLogStylesheet.pressableActive,
    ],
    [resolvedDisableOuterSpacing, config.bg, isInteractive],
  );
  const messageTextStyle = useMemo(
    () => [activityLogStylesheet.messageText, { color: config.color }],
    [config.color],
  );

  return (
    <Pressable onPress={handlePress} disabled={!isInteractive} style={pressableStyle}>
      <View style={activityLogStylesheet.content}>
        <View style={activityLogStylesheet.row}>
          <View style={activityLogStylesheet.iconContainer}>
            <IconComponent size="chromeMd" color={config.color} />
          </View>
          <View style={activityLogStylesheet.textContainer}>
            <Text style={messageTextStyle} selectable>
              {displayMessage}
            </Text>
            {(metadata || hasDetails) && (
              <View style={activityLogStylesheet.detailsRow}>
                <Text style={activityLogStylesheet.detailsText}>
                  {t("message.activity.details")}
                </Text>
                {isExpanded ? (
                  <ChevronDown size="chromeXs" color="#71717a" />
                ) : (
                  <ChevronRight size="chromeXs" color="#71717a" />
                )}
              </View>
            )}
          </View>
        </View>
        {isExpanded && metadata && (
          <View style={activityLogStylesheet.metadataContainer} dataSet={CODE_SURFACE_DATASET}>
            <Text style={activityLogStylesheet.metadataText}>
              {JSON.stringify(metadata, null, 2)}
            </Text>
          </View>
        )}
        {isExpanded && hasDetails && (
          <View style={activityLogStylesheet.diagnosticList}>
            {details?.map((detail) => (
              <Text key={detail} selectable style={activityLogStylesheet.diagnosticText}>
                {detail}
              </Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
});

interface CompactionMarkerProps {
  status: "loading" | "completed" | "failed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

const compactionStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));

export const CompactionMarker = memo(function CompactionMarker({
  status,
  trigger,
  preTokens,
}: CompactionMarkerProps) {
  const label = getCompactionMarkerLabel({ status, trigger, preTokens });

  return (
    <View testID="compaction-marker" style={compactionStylesheet.container}>
      <View style={compactionStylesheet.line} />
      <View style={compactionStylesheet.label}>
        {status === "completed" && <Summarize size="chromeXs" color="#a1a1aa" />}
        <Text style={compactionStylesheet.text}>{label}</Text>
      </View>
      <View style={compactionStylesheet.line} />
    </View>
  );
});

interface TodoListCardProps {
  items: TodoEntry[];
  activity: TaskActivity;
  disableOuterSpacing?: boolean;
}

/**
 * Prominent, always-open task list - the chat-native counterpart to the Claude
 * terminal's todo list. It checks itself off in place as the agent works (one
 * evolving card, not a snapshot per update; see appendTodoList), highlights the
 * task in flight, and shows a running done/total with a progress bar. The
 * checkable body is shared with the pinned overlay (components/todo-task-list).
 * Motion is gated by the Appearance → Animations switch.
 */
export const TodoListCard = memo(function TodoListCard({
  items,
  activity,
  disableOuterSpacing,
}: TodoListCardProps) {
  const { t } = useTranslation();
  const animationsEnabled = useAppSettingValue(selectAnimationsEnabled);
  const { completedCount, total } = useTodoCounts(items);
  const activityLabel = useMemo(() => {
    if (activity.type === "created") {
      return t("message.todo.activity.created", { count: activity.count });
    }
    return activity.task
      ? `${t(`message.todo.activity.${activity.type}`)}: ${activity.task}`
      : t(`message.todo.activity.${activity.type}`);
  }, [activity, t]);

  const cardStyle = useMemo(
    () => [
      todoListCardStylesheet.card,
      disableOuterSpacing && todoListCardStylesheet.cardNoOuterSpacing,
    ],
    [disableOuterSpacing],
  );

  return (
    <View style={cardStyle}>
      <View style={todoListCardStylesheet.header}>
        <ThemedTodoHeaderIcon size="chromeSm" uniProps={foregroundColorMapping} />
        <Text style={todoListCardStylesheet.headerTitle} numberOfLines={1}>
          {t("message.todo.title")}
        </Text>
        <Text style={todoListCardStylesheet.headerActivity} numberOfLines={1}>
          {activityLabel}
        </Text>
        {total > 0 ? (
          <Text style={todoListCardStylesheet.headerCount}>
            {t("message.todo.progress", { completed: completedCount, total })}
          </Text>
        ) : null}
      </View>
      <TodoTaskList
        items={items}
        animationsEnabled={animationsEnabled}
        emptyLabel={t("message.todo.empty")}
      />
    </View>
  );
});

const todoListCardStylesheet = StyleSheet.create((theme) => ({
  card: {
    marginVertical: theme.spacing[1],
    // Green (success-tone) ring at the same 1px weight as the usage-alert band,
    // matching the pinned overlay and the green progress bar - one task-list
    // identity whether it renders inline or floated.
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusSuccess,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  cardNoOuterSpacing: {
    marginVertical: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  headerTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  headerCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  headerActivity: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));

export type ExpandableBadgeErrorLevel = "error" | "warning";

interface ExpandableBadgeProps {
  label: string;
  secondaryLabel?: string;
  icon?: ComponentType<{ size?: IconSizeProp; color?: string }>;
  isExpanded: boolean;
  style?: StyleProp<ViewStyle>;
  onToggle?: () => void;
  onOpenFile?: () => void;
  onDetailHoverChange?: (hovered: boolean) => void;
  renderDetails?: () => ReactNode;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  isLoading?: boolean;
  // How loudly the badge reports failure. "error" is a red triangle: the action
  // itself failed, or every action in a group did. "warning" is amber: some but
  // not all of a group's actions failed, which is an alert about a run that
  // mostly worked - not a failed run. Undefined means nothing failed.
  errorLevel?: ExpandableBadgeErrorLevel;
  isLastInSequence?: boolean;
  /** Drops the attached-border treatment while expanded. */
  borderlessWhenExpanded?: boolean;
  disableOuterSpacing?: boolean;
  // Grouped contexts (ActionGroup) space rows with a parent `gap` instead of
  // per-row margins, so they also opt out of the expanded bottom margin.
  disableExpandedSpacing?: boolean;
  // What the loading label represents, for text-effect themes that color per
  // activity (see styles/text-effects.ts). Defaults to "other".
  effectActivity?: TextEffectActivity;
  testID?: string;
}

function renderExpandCollapseControls(
  onExpandAll: (() => void) | undefined,
  onCollapseAll: (() => void) | undefined,
  visible: boolean,
): ReactNode {
  if (!onExpandAll || !onCollapseAll) {
    return null;
  }
  return (
    <ExpandCollapseControls onExpand={onExpandAll} onCollapse={onCollapseAll} visible={visible} />
  );
}

function shouldShowExpandCollapseControls(isHovered: boolean, isCompact: boolean): boolean {
  return isHovered || isNative || isCompact;
}

interface ExpandableBadgeSecondaryLabelProps {
  secondaryLabel?: string;
  secondaryLabelStyle: StyleProp<TextStyle>;
  shouldMeasureTextSpan: boolean;
  onSecondaryLayout: (event: LayoutChangeEvent) => void;
  numberOfLines: number | undefined;
  onWrappedHeightChange?: (height: number) => void;
}

function ExpandableBadgeSecondaryLabel({
  secondaryLabel,
  secondaryLabelStyle,
  shouldMeasureTextSpan,
  onSecondaryLayout,
  numberOfLines,
  onWrappedHeightChange,
}: ExpandableBadgeSecondaryLabelProps) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (shouldMeasureTextSpan) {
        onSecondaryLayout(event);
      }
      onWrappedHeightChange?.(event.nativeEvent.layout.height);
    },
    [onSecondaryLayout, onWrappedHeightChange, shouldMeasureTextSpan],
  );
  if (!secondaryLabel) {
    return null;
  }
  return (
    <Text
      style={secondaryLabelStyle}
      numberOfLines={numberOfLines}
      onLayout={shouldMeasureTextSpan || onWrappedHeightChange ? handleLayout : undefined}
    >
      {secondaryLabel}
    </Text>
  );
}

interface ExpandableBadgeWebShimmerOverlayProps {
  label: string;
  secondaryLabel?: string;
  shimmerLabelTextStyle: StyleProp<TextStyle>;
  shimmerSecondaryTextStyle: StyleProp<TextStyle>;
  showOpenFileButton: boolean;
  numberOfLines: number | undefined;
  wrap: boolean;
}

function ExpandableBadgeWebShimmerOverlay({
  label,
  secondaryLabel,
  shimmerLabelTextStyle,
  shimmerSecondaryTextStyle,
  showOpenFileButton,
  numberOfLines,
  wrap,
}: ExpandableBadgeWebShimmerOverlayProps) {
  return (
    <View
      style={[
        expandableBadgeStylesheet.shimmerOverlay,
        wrap && expandableBadgeStylesheet.shimmerOverlayWrapped,
      ]}
      pointerEvents="none"
    >
      <Text style={shimmerLabelTextStyle} numberOfLines={numberOfLines}>
        {label}
      </Text>
      {secondaryLabel ? (
        <Text style={shimmerSecondaryTextStyle} numberOfLines={numberOfLines}>
          {secondaryLabel}
        </Text>
      ) : null}
      {showOpenFileButton ? (
        <View style={expandableBadgeStylesheet.openFileButton}>
          <View style={expandableBadgeStylesheet.openFileButtonPlaceholderIcon} />
        </View>
      ) : null}
      {!secondaryLabel && !showOpenFileButton ? (
        <View style={expandableBadgeStylesheet.spacer} />
      ) : null}
    </View>
  );
}

interface ExpandableBadgeLabelRowProps {
  label: string;
  labelStyle: StyleProp<TextStyle>;
  secondaryLabel?: string;
  secondaryLabelStyle: StyleProp<TextStyle>;
  shouldMeasureTextSpan: boolean;
  shouldMeasureNativeShimmer: boolean;
  isWebShimmer: boolean;
  isNativeShimmer: boolean;
  shimmerLabelTextStyle: StyleProp<TextStyle>;
  shimmerSecondaryTextStyle: StyleProp<TextStyle>;
  labelRowWidth: number;
  labelRowHeight: number;
  nativeShimmerPeakWidth: number;
  shimmerDuration: number;
  nativeGradientId: string;
  sweepEffect: SweepTextEffectSpec | null;
  glyphEffect: GlyphTextEffectSpec | null;
  textSpanStartX: number;
  textSpanWidth: number;
  onLabelRowLayout: (event: LayoutChangeEvent) => void;
  onLabelLayout: (event: LayoutChangeEvent) => void;
  onSecondaryLayout: (event: LayoutChangeEvent) => void;
  showOpenFileButton: boolean;
  isOpenFileHovered: boolean;
  onOpenFilePress: (event: GestureResponderEvent) => void;
  onOpenFileHoverIn: () => void;
  onOpenFileHoverOut: () => void;
  textLayout: ReturnType<typeof resolveToolCallTextLayout>;
  onWrappedSummaryMultiLineChange: (multiLine: boolean) => void;
}

function ExpandableBadgeLabelRow({
  label,
  labelStyle,
  secondaryLabel,
  secondaryLabelStyle,
  shouldMeasureTextSpan,
  shouldMeasureNativeShimmer,
  isWebShimmer,
  isNativeShimmer,
  shimmerLabelTextStyle,
  shimmerSecondaryTextStyle,
  labelRowWidth,
  labelRowHeight,
  nativeShimmerPeakWidth,
  shimmerDuration,
  nativeGradientId,
  sweepEffect,
  glyphEffect,
  textSpanStartX,
  textSpanWidth,
  onLabelRowLayout,
  onLabelLayout,
  onSecondaryLayout,
  showOpenFileButton,
  isOpenFileHovered,
  onOpenFilePress,
  onOpenFileHoverIn,
  onOpenFileHoverOut,
  textLayout,
  onWrappedSummaryMultiLineChange,
}: ExpandableBadgeLabelRowProps) {
  const { t } = useTranslation();
  const [labelHeight, setLabelHeight] = useState(0);
  const [summaryHeight, setSummaryHeight] = useState(0);
  const handleLabelLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLabelLayout(event);
      if (textLayout.wrap) {
        setLabelHeight((height) =>
          Math.abs(height - event.nativeEvent.layout.height) > 0.5
            ? event.nativeEvent.layout.height
            : height,
        );
      }
    },
    [onLabelLayout, textLayout.wrap],
  );
  const handleSummaryHeightChange = useCallback(
    (height: number) => {
      if (!textLayout.wrap) return;
      setSummaryHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
    },
    [textLayout.wrap],
  );
  useEffect(() => {
    onWrappedSummaryMultiLineChange(textLayout.wrap && summaryHeight > labelHeight + 0.5);
  }, [labelHeight, onWrappedSummaryMultiLineChange, summaryHeight, textLayout.wrap]);
  return (
    <View
      style={[
        expandableBadgeStylesheet.labelRow,
        textLayout.wrap && expandableBadgeStylesheet.labelRowWrapped,
      ]}
      onLayout={shouldMeasureNativeShimmer ? onLabelRowLayout : undefined}
    >
      <Text
        style={[labelStyle, textLayout.wrap && expandableBadgeStylesheet.labelWrapped]}
        numberOfLines={textLayout.numberOfLines}
        onLayout={shouldMeasureTextSpan || textLayout.wrap ? handleLabelLayout : undefined}
      >
        {label}
      </Text>
      <ExpandableBadgeSecondaryLabel
        secondaryLabel={secondaryLabel}
        secondaryLabelStyle={[
          secondaryLabelStyle,
          textLayout.wrap && expandableBadgeStylesheet.secondaryLabelWrapped,
        ]}
        shouldMeasureTextSpan={shouldMeasureTextSpan}
        onSecondaryLayout={onSecondaryLayout}
        numberOfLines={textLayout.numberOfLines}
        onWrappedHeightChange={textLayout.wrap ? handleSummaryHeightChange : undefined}
      />
      {showOpenFileButton ? (
        <Pressable
          onPress={onOpenFilePress}
          onHoverIn={onOpenFileHoverIn}
          onHoverOut={onOpenFileHoverOut}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={t("message.actions.openFile")}
          testID="tool-call-open-file"
          style={expandableBadgeStylesheet.openFileButton}
          hitSlop={6}
        >
          <ThemedFileSymlinkIcon
            size="chromeSm"
            uniProps={isOpenFileHovered ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        </Pressable>
      ) : null}
      {isWebShimmer ? (
        <ExpandableBadgeWebShimmerOverlay
          label={label}
          secondaryLabel={secondaryLabel}
          shimmerLabelTextStyle={[
            shimmerLabelTextStyle,
            textLayout.wrap && expandableBadgeStylesheet.labelWrapped,
          ]}
          shimmerSecondaryTextStyle={[
            shimmerSecondaryTextStyle,
            textLayout.wrap && expandableBadgeStylesheet.secondaryLabelWrapped,
          ]}
          showOpenFileButton={showOpenFileButton}
          numberOfLines={textLayout.numberOfLines}
          wrap={textLayout.wrap}
        />
      ) : null}
      {/* Pure decoration over the untouched label: the rain never reads,
          splits, or replaces the text - it just travels across the measured
          text span, clipped to this single-line row. */}
      {glyphEffect && textSpanWidth > 0 ? (
        <TextEffectRain
          effect={glyphEffect}
          offsetX={textSpanStartX}
          width={textSpanWidth}
          seed={label}
        />
      ) : null}
      {isNativeShimmer && sweepEffect ? (
        <NativeExpandableBadgeShimmer
          label={label}
          secondaryLabel={secondaryLabel}
          rowWidth={labelRowWidth}
          rowHeight={labelRowHeight}
          peakWidth={nativeShimmerPeakWidth}
          durationSeconds={shimmerDuration}
          gradientId={nativeGradientId}
          effect={sweepEffect}
          textLayout={textLayout}
        />
      ) : null}
    </View>
  );
}

// HACK: lucide ships every icon inside a 24×24 viewBox where the path
// doesn't touch the edges - there's per-icon internal padding. The layout
// already places the SVG element's box on the rail, but the visible glyph
// inside the SVG sits inset by a few pixels (and the inset amount differs
// per icon - chevron-right paints only in the right half of its viewBox,
// regular tool icons paint roughly the full viewBox minus ~1 unit margin).
//
// Lucide has no viewBox knob, so the only way to nudge the visible glyph
// flush with the rail is a per-icon negative margin. Cosmetic; not exact -
// every lucide icon has slightly different padding and we're not measuring
// each one. Two buckets is the compromise:
//   - LUCIDE_TOOL_ICON_NUDGE_LEFT: regular tool icons (path mostly fills
//     the viewBox); needs ~1px left shift.
//   - LUCIDE_CHEVRON_NUDGE_LEFT: chevron-right (path in right half of
//     viewBox, and we scale it 1.3×); needs ~4px left shift.
// If we ever want this exact, the principled fix is a custom <Svg> wrapper
// with a tight viewBox per icon - see option (2) in the design discussion.
const LUCIDE_TOOL_ICON_NUDGE_LEFT: ViewStyle = { marginLeft: -1 };
const LUCIDE_CHEVRON_NUDGE_LEFT: ViewStyle = { marginLeft: -4 };
const TRIANGLE_ALERT_ICON_OPACITY: ViewStyle = { opacity: 0.8 };

// The Otto face crops its viewBox to the ink, so it needs neither the lucide
// nudge nor the regular square wrapper. Keep its width equal to the standard
// action-glyph size, though: the face is wider than it is tall and the old 18px
// treatment made Otto actions visibly larger than their neighboring icons.
const OTTO_FACE_ICON_WIDTH = 12;

function renderExpandableBadgeIcon({
  errorLevel,
  isActive,
  isRunning,
  isTightGlyph,
  ThemedIcon,
}: {
  errorLevel: ExpandableBadgeErrorLevel | undefined;
  isActive: boolean;
  isRunning: boolean;
  isTightGlyph: boolean;
  ThemedIcon: ComponentType<{
    size?: IconSizeProp;
    isActive?: boolean;
    uniProps?: typeof foregroundColorMapping;
  }> | null;
}): ReactNode {
  if (errorLevel) {
    return (
      <View style={LUCIDE_TOOL_ICON_NUDGE_LEFT}>
        <ThemedTriangleAlertIcon
          size="chromeXs"
          style={TRIANGLE_ALERT_ICON_OPACITY}
          uniProps={errorLevel === "warning" ? warningColorMapping : destructiveColorMapping}
        />
      </View>
    );
  }
  if (ThemedIcon) {
    if (isTightGlyph) {
      return (
        <ThemedIcon
          size={OTTO_FACE_ICON_WIDTH}
          isActive={isRunning}
          uniProps={isActive ? foregroundColorMapping : mutedForegroundColorMapping}
        />
      );
    }
    return (
      <View style={LUCIDE_TOOL_ICON_NUDGE_LEFT}>
        <ThemedIcon
          size="chromeXs"
          uniProps={isActive ? foregroundColorMapping : mutedForegroundColorMapping}
        />
      </View>
    );
  }
  return null;
}

function renderExpandableBadgeIconSlot({
  showChevron,
  chevronStyle,
  iconNode,
}: {
  showChevron: boolean;
  chevronStyle: StyleProp<ViewStyle>;
  iconNode: ReactNode;
}): ReactNode {
  if (showChevron) {
    return (
      <ThemedChevronRightIcon
        size="chromeXs"
        style={chevronStyle}
        uniProps={foregroundColorMapping}
      />
    );
  }
  return iconNode;
}

function computeShimmerMetrics(input: {
  label: string;
  secondaryLabel: string | undefined;
  isLoading: boolean;
  labelRowWidth: number;
  labelRowHeight: number;
  labelOffsetX: number;
  labelWidth: number;
  secondaryOffsetX: number;
  secondaryWidth: number;
  // Null when the active theme is a glyph theme: nothing here sweeps, so all
  // the peak/duration math falls back to neutral scales.
  effect: SweepTextEffectSpec | null;
  hasGlyphEffect: boolean;
}) {
  const totalShimmerChars = input.label.trim().length + (input.secondaryLabel?.trim().length ?? 0);
  const shortTextDurationAdjustment = totalShimmerChars <= 12 ? 0.25 : 0;
  // The effect theme scales the text-length-derived duration and the measured
  // peak width (Professional is 1/1, i.e. exactly the historical values).
  const shimmerDuration =
    Math.max(1, Math.min(2.3, 1.25 + totalShimmerChars * 0.008 - shortTextDurationAdjustment)) *
    (input.effect?.durationScale ?? 1);
  const nativeShimmerPeakWidth =
    Math.max(32, Math.min(120, input.labelRowWidth > 0 ? input.labelRowWidth * 0.28 : 0)) *
    (input.effect?.peakScale ?? 1);
  const isWebShimmer = input.isLoading && isWeb && input.effect !== null;
  const shouldMeasureNativeShimmer = input.isLoading && isNative && input.effect !== null;
  const isNativeShimmer =
    shouldMeasureNativeShimmer && input.labelRowWidth > 0 && input.labelRowHeight > 0;
  // The web sweep needs the text span to place its track; the rain needs it to
  // know how wide to be - and the rain runs on both platforms, so this
  // measurement is no longer web-only.
  const shouldMeasureTextSpan = isWebShimmer || input.hasGlyphEffect;
  const textSpanStartX = input.labelOffsetX;
  const textSpanEndX = input.secondaryLabel
    ? input.secondaryOffsetX + input.secondaryWidth
    : input.labelOffsetX + input.labelWidth;
  const webShimmerSpanWidth = Math.max(1, textSpanEndX - textSpanStartX);
  const webShimmerPeakWidth =
    Math.max(42, Math.min(120, webShimmerSpanWidth * 0.22)) * (input.effect?.peakScale ?? 1);
  const webShimmerTrackStart = textSpanStartX - webShimmerPeakWidth;
  const webShimmerTrackEnd = textSpanEndX;
  return {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureTextSpan,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
    textSpanStartX,
    textSpanWidth: Math.max(0, textSpanEndX - textSpanStartX),
  };
}

function useDetailWheelPropagationBlocker(input: {
  detailWrapperRef: React.RefObject<View | null>;
  enabled: boolean;
}): void {
  const { detailWrapperRef, enabled } = input;
  useEffect(() => {
    if (!enabled) {
      return () => {};
    }
    const rawRef: unknown = detailWrapperRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const node = rawRef;
    const stopWheelPropagation = (event: WheelEvent) => {
      if (shouldStopDetailWheelPropagation(node, event)) {
        event.stopPropagation();
      }
    };
    node.addEventListener("wheel", stopWheelPropagation, { passive: true });
    return () => {
      node.removeEventListener("wheel", stopWheelPropagation);
    };
  }, [detailWrapperRef, enabled]);
}

function buildShimmerTextStyle(input: {
  isWebShimmer: boolean;
  webShimmerPeakWidth: number;
  shimmerDuration: number;
  webShimmerTrackStart: number;
  webShimmerTrackEnd: number;
  offsetX: number;
  effect: SweepTextEffectSpec | null;
}): object | null {
  if (!input.isWebShimmer || !input.effect) return null;
  // The shared @keyframes animate background-position between the per-element
  // CSS vars, so every effect theme rides the same registered keyframes - the
  // theme only varies the gradient, timing function, and direction here.
  const timingFunction = input.effect.easing === "ease-in-out" ? "ease-in-out" : "linear";
  const direction = input.effect.bounce ? "alternate" : "normal";
  return {
    opacity: 1,
    color: "transparent",
    backgroundImage: input.effect.webGradient,
    backgroundSize: `${input.webShimmerPeakWidth}px 100%`,
    backgroundRepeat: "no-repeat",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    animation: `${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} ${input.shimmerDuration}s ${timingFunction} infinite ${direction}`,
    "--otto-shimmer-start": `${input.webShimmerTrackStart - input.offsetX}px`,
    "--otto-shimmer-end": `${input.webShimmerTrackEnd - input.offsetX}px`,
  };
}

// Splits a resolved spec into the branch each renderer understands. Registry
// specs are module-level constants, so both results are stable references per
// (theme, activity) and the downstream memos never churn while streaming.
function resolveTextEffectBranches(
  effect: SweepTextEffectSpec | GlyphTextEffectSpec,
  isLoading: boolean,
): { sweepEffect: SweepTextEffectSpec | null; glyphEffect: GlyphTextEffectSpec | null } {
  if (effect.kind === "glyph") {
    return { sweepEffect: null, glyphEffect: isLoading ? effect : null };
  }
  return { sweepEffect: effect, glyphEffect: null };
}

function getExpandableBadgeHeaderStyle(wrap: boolean): StyleProp<ViewStyle> {
  return wrap
    ? [expandableBadgeStylesheet.headerRow, expandableBadgeStylesheet.headerRowWrapped]
    : expandableBadgeStylesheet.headerRow;
}

function shouldTopAlignToolCallHeader(wrap: boolean, summaryIsMultiLine: boolean): boolean {
  return wrap && summaryIsMultiLine;
}

function getToolCallIconBadgeStyle(topAligned: boolean): StyleProp<ViewStyle> {
  return topAligned
    ? [expandableBadgeStylesheet.iconBadge, expandableBadgeStylesheet.iconBadgeMultiLine]
    : expandableBadgeStylesheet.iconBadge;
}

export const ExpandableBadge = memo(function ExpandableBadge({
  label,
  style,
  secondaryLabel,
  icon,
  isExpanded,
  onToggle,
  onOpenFile,
  onDetailHoverChange,
  renderDetails,
  onExpandAll,
  onCollapseAll,
  isLoading = false,
  errorLevel,
  isLastInSequence = false,
  borderlessWhenExpanded = false,
  disableOuterSpacing,
  disableExpandedSpacing = false,
  effectActivity = "other",
  testID,
}: ExpandableBadgeProps) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const wrapToolCallText = useAppSettingValue(selectWrapToolCallText);
  const textLayout = resolveToolCallTextLayout(wrapToolCallText);
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [isOpenFileHovered, setIsOpenFileHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isSummaryMultiLine, setIsSummaryMultiLine] = useState(false);
  const isInteractive = Boolean(onToggle);
  const hasDetailContent = Boolean(renderDetails);
  const detailContent = hasDetailContent && isExpanded ? renderDetails?.() : null;
  const detailWrapperRef = useRef<View | null>(null);

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => {
    setIsHovered(false);
    setIsPressed(false);
  }, []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);
  const handleDetailHoverIn = useCallback(() => onDetailHoverChange?.(true), [onDetailHoverChange]);
  const handleDetailHoverOut = useCallback(
    () => onDetailHoverChange?.(false),
    [onDetailHoverChange],
  );
  const handleOpenFilePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation?.();
      onOpenFile?.();
    },
    [onOpenFile],
  );
  const handleOpenFileHoverIn = useCallback(() => setIsOpenFileHovered(true), []);
  const handleOpenFileHoverOut = useCallback(() => setIsOpenFileHovered(false), []);
  const handleWrappedSummaryMultiLineChange = useCallback((multiLine: boolean) => {
    setIsSummaryMultiLine((current) => (current === multiLine ? current : multiLine));
  }, []);
  const topAlignHeader = shouldTopAlignToolCallHeader(textLayout.wrap, isSummaryMultiLine);

  const nativeGradientIdRef = useRef(
    `shimmer-gradient-${Math.random().toString(36).substring(2, 9)}`,
  );
  const textEffectThemeId = useTextEffectThemeId();
  const { sweepEffect, glyphEffect } = resolveTextEffectBranches(
    getTextEffectSpec(textEffectThemeId, effectActivity),
    isLoading,
  );
  const [labelRowWidth, setLabelRowWidth] = useState(0);
  const [labelRowHeight, setLabelRowHeight] = useState(0);
  const [labelOffsetX, setLabelOffsetX] = useState(0);
  const [labelWidth, setLabelWidth] = useState(0);
  const [secondaryOffsetX, setSecondaryOffsetX] = useState(0);
  const [secondaryWidth, setSecondaryWidth] = useState(0);

  const {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureTextSpan,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
    textSpanStartX,
    textSpanWidth,
  } = computeShimmerMetrics({
    label,
    secondaryLabel,
    isLoading,
    labelRowWidth,
    labelRowHeight,
    labelOffsetX,
    labelWidth,
    secondaryOffsetX,
    secondaryWidth,
    effect: sweepEffect,
    hasGlyphEffect: glyphEffect !== null,
  });

  const handleLabelRowLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureNativeShimmer) {
        return;
      }
      const { width, height } = event.nativeEvent.layout;
      setLabelRowWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
      setLabelRowHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
    },
    [shouldMeasureNativeShimmer],
  );

  const handleLabelLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureTextSpan) {
        return;
      }
      const { x, width } = event.nativeEvent.layout;
      setLabelOffsetX((previous) => (Math.abs(previous - x) > 0.5 ? x : previous));
      setLabelWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
    },
    [shouldMeasureTextSpan],
  );

  const handleSecondaryLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureTextSpan || !secondaryLabel) {
        return;
      }
      const { x, width } = event.nativeEvent.layout;
      setSecondaryOffsetX((previous) => (Math.abs(previous - x) > 0.5 ? x : previous));
      setSecondaryWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
    },
    [shouldMeasureTextSpan, secondaryLabel],
  );

  useEffect(() => {
    if (!isWebShimmer) {
      return;
    }
    ensureWebToolCallShimmerKeyframes();
  }, [isWebShimmer]);

  useDetailWheelPropagationBlocker({
    detailWrapperRef,
    enabled: !isNative && isExpanded && hasDetailContent,
  });

  const shimmerLabelStyle = useMemo<StyleProp<TextStyle>>(
    () =>
      buildShimmerTextStyle({
        isWebShimmer,
        webShimmerPeakWidth,
        shimmerDuration,
        webShimmerTrackStart,
        webShimmerTrackEnd,
        offsetX: labelOffsetX,
        effect: sweepEffect,
      }),
    [
      isWebShimmer,
      webShimmerPeakWidth,
      shimmerDuration,
      webShimmerTrackStart,
      webShimmerTrackEnd,
      labelOffsetX,
      sweepEffect,
    ],
  );

  const shimmerSecondaryStyle = useMemo<StyleProp<TextStyle>>(
    () =>
      buildShimmerTextStyle({
        isWebShimmer,
        webShimmerPeakWidth,
        shimmerDuration,
        webShimmerTrackStart,
        webShimmerTrackEnd,
        offsetX: secondaryOffsetX,
        effect: sweepEffect,
      }),
    [
      isWebShimmer,
      webShimmerPeakWidth,
      shimmerDuration,
      webShimmerTrackStart,
      webShimmerTrackEnd,
      secondaryOffsetX,
      sweepEffect,
    ],
  );

  const containerSpacingStyle = useMemo(() => {
    // Expanded rows always need breathing room from their neighbors, even in
    // contexts (the main chat stream) that disable outer spacing to keep
    // collapsed tool-call pills tight - disableOuterSpacing predates the
    // bordered expanded state and was never meant to gate it. The exception
    // is grouped contexts, where the parent spaces rows with `gap` and a
    // per-row margin would double it (disableExpandedSpacing).
    if (isExpanded && !disableExpandedSpacing) {
      return expandableBadgeStylesheet.containerExpandedSpacing;
    }
    if (resolvedDisableOuterSpacing || disableExpandedSpacing) {
      return null;
    }
    if (isLastInSequence) {
      return expandableBadgeStylesheet.containerLastInSequence;
    }
    return expandableBadgeStylesheet.containerSpacing;
  }, [disableExpandedSpacing, isExpanded, isLastInSequence, resolvedDisableOuterSpacing]);

  const containerStyle = useMemo(
    () => [expandableBadgeStylesheet.container, containerSpacingStyle, style],
    [containerSpacingStyle, style],
  );

  const pressableStyle = useMemo(
    () => [
      expandableBadgeStylesheet.pressable,
      isPressed && isInteractive ? expandableBadgeStylesheet.pressablePressed : null,
      isExpanded && !borderlessWhenExpanded && expandableBadgeStylesheet.pressableExpanded,
    ],
    [borderlessWhenExpanded, isExpanded, isInteractive, isPressed],
  );

  const accessibilityState = useMemo(
    () => (isInteractive ? { expanded: isExpanded } : undefined),
    [isExpanded, isInteractive],
  );

  const isActive = isHovered || isExpanded;

  const labelStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      isActive && expandableBadgeStylesheet.labelActive,
      isLoading && expandableBadgeStylesheet.labelLoading,
    ],
    [isActive, isLoading],
  );

  const secondaryLabelStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      isActive && expandableBadgeStylesheet.secondaryLabelActive,
    ],
    [isActive],
  );

  const shimmerLabelTextStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      isLoading && expandableBadgeStylesheet.labelLoading,
      expandableBadgeStylesheet.shimmerText,
      shimmerLabelStyle,
    ],
    [isLoading, shimmerLabelStyle],
  );

  const shimmerSecondaryTextStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      expandableBadgeStylesheet.shimmerText,
      shimmerSecondaryStyle,
    ],
    [shimmerSecondaryStyle],
  );

  const chevronStyle = useMemo(
    () => [
      expandableBadgeStylesheet.chevron,
      isExpanded && expandableBadgeStylesheet.chevronExpanded,
      LUCIDE_CHEVRON_NUDGE_LEFT,
    ],
    [isExpanded],
  );

  const ThemedIcon = useMemo(() => (icon ? withUnistyles(icon) : null), [icon]);
  const iconNode = renderExpandableBadgeIcon({
    errorLevel,
    isActive,
    isRunning: isLoading,
    isTightGlyph: icon ? isTightGlyphToolIcon(icon) : false,
    ThemedIcon,
  });
  const iconSlotNode = renderExpandableBadgeIconSlot({
    showChevron: isInteractive && isHovered,
    chevronStyle,
    iconNode,
  });

  const pressHandlers = isInteractive
    ? {
        onPress: onToggle,
        onPressIn: handlePressIn,
        onPressOut: handlePressOut,
        accessibilityRole: "button" as const,
      }
    : {};

  return (
    <ChatThemeScope>
      <View
        style={containerStyle}
        testID={testID}
        onPointerEnter={isWeb ? handleHoverIn : undefined}
        onPointerLeave={isWeb ? handleHoverOut : undefined}
      >
        <Pressable
          {...pressHandlers}
          disabled={!isInteractive}
          accessibilityState={accessibilityState}
          style={pressableStyle}
        >
          <View style={getExpandableBadgeHeaderStyle(topAlignHeader)}>
            <View style={getToolCallIconBadgeStyle(topAlignHeader)}>{iconSlotNode}</View>
            <ExpandableBadgeLabelRow
              label={label}
              labelStyle={labelStyle}
              secondaryLabel={secondaryLabel}
              secondaryLabelStyle={secondaryLabelStyle}
              shouldMeasureTextSpan={shouldMeasureTextSpan}
              shouldMeasureNativeShimmer={shouldMeasureNativeShimmer}
              isWebShimmer={isWebShimmer}
              isNativeShimmer={isNativeShimmer}
              shimmerLabelTextStyle={shimmerLabelTextStyle}
              shimmerSecondaryTextStyle={shimmerSecondaryTextStyle}
              labelRowWidth={labelRowWidth}
              labelRowHeight={labelRowHeight}
              nativeShimmerPeakWidth={nativeShimmerPeakWidth}
              shimmerDuration={shimmerDuration}
              nativeGradientId={nativeGradientIdRef.current}
              sweepEffect={sweepEffect}
              glyphEffect={glyphEffect}
              textSpanStartX={textSpanStartX}
              textSpanWidth={textSpanWidth}
              onLabelRowLayout={handleLabelRowLayout}
              onLabelLayout={handleLabelLayout}
              onSecondaryLayout={handleSecondaryLayout}
              showOpenFileButton={Boolean(onOpenFile && isHovered)}
              isOpenFileHovered={isOpenFileHovered}
              onOpenFilePress={handleOpenFilePress}
              onOpenFileHoverIn={handleOpenFileHoverIn}
              onOpenFileHoverOut={handleOpenFileHoverOut}
              textLayout={textLayout}
              onWrappedSummaryMultiLineChange={handleWrappedSummaryMultiLineChange}
            />
            {renderExpandCollapseControls(
              onExpandAll,
              onCollapseAll,
              shouldShowExpandCollapseControls(isHovered, isCompact),
            )}
          </View>
        </Pressable>
        {detailContent ? (
          <Pressable
            ref={detailWrapperRef}
            style={expandableBadgeStylesheet.detailWrapper}
            onHoverIn={handleDetailHoverIn}
            onHoverOut={handleDetailHoverOut}
          >
            {detailContent}
          </Pressable>
        ) : null}
      </View>
    </ChatThemeScope>
  );
}, areExpandableBadgePropsEqual);

function areExpandableBadgePropsEqual(previous: ExpandableBadgeProps, next: ExpandableBadgeProps) {
  if (previous.label !== next.label) return false;
  if (previous.secondaryLabel !== next.secondaryLabel) return false;
  if (previous.icon !== next.icon) return false;
  if (previous.isExpanded !== next.isExpanded) return false;
  if (previous.style !== next.style) return false;
  if (previous.isLoading !== next.isLoading) return false;
  if (previous.errorLevel !== next.errorLevel) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.disableExpandedSpacing !== next.disableExpandedSpacing) return false;
  if (previous.effectActivity !== next.effectActivity) return false;
  if (previous.testID !== next.testID) return false;
  if (previous.onToggle !== next.onToggle) return false;
  if (previous.onOpenFile !== next.onOpenFile) return false;
  if (previous.onDetailHoverChange !== next.onDetailHoverChange) return false;
  if (previous.renderDetails !== next.renderDetails) return false;
  if (previous.onExpandAll !== next.onExpandAll) return false;
  if (previous.onCollapseAll !== next.onCollapseAll) return false;
  return true;
}

interface ToolCallProps {
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  disableExpandedSpacing?: boolean;
  onInlineDetailsHoverChange?: (hovered: boolean) => void;
  onInlineDetailsExpandedChange?: (expanded: boolean) => void;
  onOpenFilePath?: (filePath: string) => void;
  defaultExpanded?: boolean;
  forceInline?: boolean;
  expandAllCommand?: { expanded: boolean; revision: number } | null;
  maxDetailHeight?: number;
}

export const ToolCall = memo(function ToolCall({
  toolName,
  args,
  result,
  error,
  status,
  detail,
  cwd,
  metadata,
  isLastInSequence = false,
  disableOuterSpacing,
  disableExpandedSpacing,
  onInlineDetailsHoverChange,
  onInlineDetailsExpandedChange,
  onOpenFilePath,
  defaultExpanded,
  forceInline = false,
  expandAllCommand,
  maxDetailHeight = 400,
}: ToolCallProps) {
  const { openToolCall } = useToolCallSheet();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false);

  useEffect(() => {
    if (expandAllCommand) {
      setIsExpanded(expandAllCommand.expanded);
    }
  }, [expandAllCommand]);

  const isMobile = useIsCompactFormFactor();
  const shouldRenderInline = !isMobile || forceInline;

  const effectiveDetail = useMemo<ToolCallDetail | undefined>(() => {
    if (detail) {
      return detail;
    }
    if (args !== undefined || result !== undefined) {
      return {
        type: "unknown",
        input: args ?? null,
        output: result ?? null,
      };
    }
    return undefined;
  }, [detail, args, result]);

  const widgetPayload = useMemo(() => readWidgetPayload(metadata), [metadata]);

  const presentation = useMemo(
    () =>
      buildToolCallPresentation({
        toolName,
        status,
        error: error ?? null,
        detail: effectiveDetail,
        metadata,
        cwd,
        resolveIcon: resolveToolCallIcon,
      }),
    [toolName, status, error, effectiveDetail, metadata, cwd],
  );
  // Drives per-activity text-effect themes (Vivid) - see styles/text-effects.ts.
  const effectActivity = useMemo(() => textEffectActivityForToolName(toolName), [toolName]);
  const handleOpenFile = useMemo(() => {
    const openFilePath = presentation.openFilePath;
    if (!openFilePath || !onOpenFilePath) {
      return undefined;
    }
    return () => onOpenFilePath(openFilePath);
  }, [presentation.openFilePath, onOpenFilePath]);

  const handleToggle = useCallback(() => {
    if (!shouldRenderInline) {
      openToolCall({
        displayName: presentation.displayName,
        summary: presentation.summary,
        detail: effectiveDetail,
        errorText: presentation.errorText,
        icon: presentation.icon,
        showLoadingSkeleton: presentation.isLoadingDetails,
      });
    } else {
      setIsExpanded((prev) => !prev);
    }
  }, [
    shouldRenderInline,
    openToolCall,
    presentation.displayName,
    presentation.summary,
    presentation.errorText,
    presentation.icon,
    presentation.isLoadingDetails,
    effectiveDetail,
  ]);

  useEffect(() => {
    if (!onInlineDetailsHoverChange || !shouldRenderInline || isExpanded) {
      return;
    }
    onInlineDetailsHoverChange(false);
  }, [isExpanded, shouldRenderInline, onInlineDetailsHoverChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return;
    }
    if (!shouldRenderInline) {
      onInlineDetailsExpandedChange(false);
      return;
    }
    onInlineDetailsExpandedChange(isExpanded);
  }, [isExpanded, shouldRenderInline, onInlineDetailsExpandedChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return () => {};
    }
    return () => {
      onInlineDetailsExpandedChange(false);
    };
  }, [onInlineDetailsExpandedChange]);

  // Render inline details for desktop
  const renderDetails = useCallback(() => {
    if (!shouldRenderInline) return null;
    return (
      <ToolCallDetailsContent
        detail={effectiveDetail}
        errorText={presentation.errorText}
        maxHeight={maxDetailHeight}
        showLoadingSkeleton={presentation.isLoadingDetails}
      />
    );
  }, [
    shouldRenderInline,
    effectiveDetail,
    presentation.errorText,
    presentation.isLoadingDetails,
    maxDetailHeight,
  ]);

  // A widget renders as its own content, not as an action row - same treatment
  // as a plan card, and for the same reason: the payload IS what the model is
  // saying, so it must not sit behind a badge the user has to open. The payload
  // rides in `metadata` rather than `detail`; see WIDGET_METADATA_KEY.
  if (widgetPayload) {
    return <WidgetCard payload={widgetPayload} />;
  }

  if (presentation.isPlan && effectiveDetail?.type === "plan") {
    return (
      <PlanCard
        text={effectiveDetail.text}
        testID="timeline-plan-card"
        disableOuterSpacing={disableOuterSpacing}
      />
    );
  }

  return (
    <ExpandableBadge
      testID="tool-call-badge"
      label={presentation.displayName}
      secondaryLabel={presentation.summary}
      icon={presentation.icon}
      isExpanded={shouldRenderInline && isExpanded}
      onToggle={presentation.canOpenDetails ? handleToggle : undefined}
      onOpenFile={handleOpenFile}
      renderDetails={presentation.canOpenDetails && shouldRenderInline ? renderDetails : undefined}
      isLoading={status === "running" || status === "executing"}
      // A single action that failed is always the loud red: there is no
      // surrounding set to soften it against.
      errorLevel={status === "failed" ? "error" : undefined}
      isLastInSequence={isLastInSequence}
      disableOuterSpacing={disableOuterSpacing}
      disableExpandedSpacing={disableExpandedSpacing}
      effectActivity={effectActivity}
      onDetailHoverChange={onInlineDetailsHoverChange}
    />
  );
}, areToolCallPropsEqual);

function areToolCallPropsEqual(previous: ToolCallProps, next: ToolCallProps) {
  if (previous.toolName !== next.toolName) return false;
  if (previous.args !== next.args) return false;
  if (previous.result !== next.result) return false;
  if (previous.error !== next.error) return false;
  if (previous.status !== next.status) return false;
  if (previous.detail !== next.detail) return false;
  if (previous.cwd !== next.cwd) return false;
  if (previous.metadata !== next.metadata) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.disableExpandedSpacing !== next.disableExpandedSpacing) return false;
  if (previous.onOpenFilePath !== next.onOpenFilePath) return false;
  if (previous.defaultExpanded !== next.defaultExpanded) return false;
  if (previous.forceInline !== next.forceInline) return false;
  if (previous.expandAllCommand !== next.expandAllCommand) return false;
  return true;
}
