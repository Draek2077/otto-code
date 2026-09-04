/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- message identity is intentionally bound to its room actions. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  CommunicationConversationSummary,
  CommunicationMessage,
  CommunicationRoom,
} from "@otto-code/protocol/communications";
import type { DaemonClient } from "@otto-code/client";
import type { ComposerAttachment } from "@/attachments/types";
import { BlackChatScope } from "@/components/black-chat-scope";
import {
  resolveBlackChatCanvasStyle,
  useBlackChatScope,
} from "@/components/black-chat-scope-context";
import { ChatSeamFade } from "@/components/chat-seam-fade";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import {
  CornerDownLeft,
  ChevronDown,
  ListChevronsDownUp,
  ListChevronsUpDown,
} from "@/components/icons/material-icons";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { MessagePlaybackButton } from "@/components/message-playback-button";
import { ChatMessageBubble, MessageFooter, MessageFooterIconAction } from "@/components/message";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ComposerFrame } from "@/composer/composer-frame";
import { MessageInput, type MessageInputRef } from "@/composer/input/input";
import { useMessageInputKeyboardScope } from "@/composer/message-input-keyboard";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useAppSettingValue, type AppSettings } from "@/hooks/use-settings";
import { useRetainedScrollOffset } from "@/hooks/use-retained-scroll-offset";
import type { Theme } from "@/styles/theme";
import { autoSpeechQueue } from "@/voice/auto-speech-queue";
import {
  canPlayRoomMessage,
  shouldRevealRoomMessageControls,
} from "./communications-room-message-utils";
import { adaptCommunicationsMessageContent } from "./communications-message-content";
import { mergeRoomMessages } from "./communications-room-message-merge";
import {
  appendConfirmedReply,
  collapseReplyThread,
  emptyReplyThreadState,
  expandReplyThread,
  openReplyThread,
  recordReplyThreadLoadFailure,
  replyComposerAutoFocusKey,
  storeReplyThread,
  type ReplyThreadState,
} from "./communications-room-thread-state";
import { layoutCommunicationsTimeline } from "./communications-message-layout";
import {
  deriveCommunicationsRoomScrollMode,
  isCommunicationsRoomNearBottom,
  readCommunicationsRoomScrollMode,
  retainCommunicationsRoomScrollMode,
  shouldAnchorCommunicationsRoomChange,
  type CommunicationsRoomScrollChange,
  type CommunicationsRoomScrollMode,
} from "./communications-room-scroll";

const QUICK_REACTIONS = ["👍", "❤️", "😂"];
// The provider read model has no push channel for new messages, so an open
// room is kept live by polling while it is mounted, focused, and visible.
const ROOM_POLL_INTERVAL_MS = 10_000;
const EMPTY_ATTACHMENTS: ComposerAttachment[] = [];
const EMPTY_ATTACHMENT_MENU_ITEMS: [] = [];
const selectBlackTabBackground = (settings: AppSettings) => settings.blackTabBackground;
const selectHideChatMessageDetails = (settings: AppSettings) => settings.hideChatMessageDetails;
const ThemedCornerDownLeft = withUnistyles(CornerDownLeft);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export function CommunicationsRoom({
  client,
  serverId,
  conversation,
  compact = false,
  isPaneFocused = false,
}: {
  client: DaemonClient | null;
  serverId: string;
  conversation: CommunicationConversationSummary;
  compact?: boolean;
  isPaneFocused?: boolean;
}): ReactElement {
  const blackTabBackground = useAppSettingValue(selectBlackTabBackground);
  return (
    <BlackChatScope enabled={blackTabBackground}>
      <CommunicationsRoomContent
        key={`${serverId}:${conversation.providerId}:${conversation.conversationId}`}
        client={client}
        serverId={serverId}
        conversation={conversation}
        compact={compact}
        isPaneFocused={isPaneFocused}
      />
    </BlackChatScope>
  );
}

function CommunicationsRoomContent({
  client,
  serverId,
  conversation,
  compact,
  isPaneFocused,
}: {
  client: DaemonClient | null;
  serverId: string;
  conversation: CommunicationConversationSummary;
  compact: boolean;
  isPaneFocused: boolean;
}): ReactElement {
  const isBlackChat = useBlackChatScope();
  const roomScrollKey = `communications-room:${serverId}:${conversation.providerId}:${conversation.conversationId}`;
  const retainedScroll = useRetainedScrollOffset(roomScrollKey);
  const scrollModeRef = useRef<CommunicationsRoomScrollMode>(
    readCommunicationsRoomScrollMode(roomScrollKey),
  );
  const [scrollMode, setScrollMode] = useState<CommunicationsRoomScrollMode>(scrollModeRef.current);
  const pendingAnchorFrameRef = useRef<number | null>(null);
  const initialAnchorKeyRef = useRef<string | null>(null);
  const knownTopLevelMessagesRef = useRef<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const threadLoadIdsRef = useRef(new Set<string>());
  const [room, setRoom] = useState<CommunicationRoom | null>(null);
  const [threadState, setThreadState] = useState<ReplyThreadState>(emptyReplyThreadState);
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setRoomScrollMode = useCallback(
    (next: CommunicationsRoomScrollMode) => {
      if (scrollModeRef.current === next) return;
      scrollModeRef.current = next;
      retainCommunicationsRoomScrollMode(roomScrollKey, next);
      setScrollMode(next);
    },
    [roomScrollKey],
  );
  const cancelPendingAnchor = useCallback(() => {
    if (pendingAnchorFrameRef.current === null) return;
    cancelAnimationFrame(pendingAnchorFrameRef.current);
    pendingAnchorFrameRef.current = null;
  }, []);
  const anchorRoomEnd = useCallback(
    (change: CommunicationsRoomScrollChange) => {
      if (!shouldAnchorCommunicationsRoomChange({ mode: scrollModeRef.current, change })) {
        return;
      }
      cancelPendingAnchor();
      pendingAnchorFrameRef.current = requestAnimationFrame(() => {
        pendingAnchorFrameRef.current = null;
        if (!shouldAnchorCommunicationsRoomChange({ mode: scrollModeRef.current, change })) {
          return;
        }
        retainedScroll.ref.current?.scrollToEnd({ animated: false });
      });
    },
    [cancelPendingAnchor, retainedScroll.ref],
  );
  const resumeFollowing = useCallback(() => {
    scrollModeRef.current = "following";
    retainCommunicationsRoomScrollMode(roomScrollKey, "following");
    setScrollMode("following");
    anchorRoomEnd("new-message");
  }, [anchorRoomEnd, roomScrollKey]);
  const handleTimelineScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      retainedScroll.onScroll(event);
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const next = deriveCommunicationsRoomScrollMode({
        current: scrollModeRef.current,
        isNearBottom: isCommunicationsRoomNearBottom({
          contentHeight: contentSize.height,
          offsetY: contentOffset.y,
          viewportHeight: layoutMeasurement.height,
        }),
      });
      if (next === "detached") cancelPendingAnchor();
      setRoomScrollMode(next);
    },
    [cancelPendingAnchor, retainedScroll, setRoomScrollMode],
  );
  const handleTimelineContentSizeChange = useCallback(
    (width: number, height: number) => {
      retainedScroll.onContentSizeChange(width, height);
    },
    [retainedScroll],
  );
  const handleTimelineLayout = useCallback(() => {
    anchorRoomEnd("viewport-resize");
  }, [anchorRoomEnd]);

  useEffect(() => {
    const retainedMode = readCommunicationsRoomScrollMode(roomScrollKey);
    scrollModeRef.current = retainedMode;
    setScrollMode(retainedMode);
    initialAnchorKeyRef.current = null;
    return cancelPendingAnchor;
  }, [cancelPendingAnchor, roomScrollKey]);

  const refresh = useCallback(async () => {
    if (!client) return;
    setIsLoading(true);
    setError(null);
    try {
      setRoom(
        await client.communicationsRoomGet({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
        }),
      );
      setThreadState(emptyReplyThreadState);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load this chat room.");
    } finally {
      setIsLoading(false);
    }
  }, [client, conversation.conversationId, conversation.providerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pollRoom = useCallback(async () => {
    if (!client) return;
    try {
      const nextRoom = await client.communicationsRoomGet({
        providerId: conversation.providerId,
        conversationId: conversation.conversationId,
      });
      setRoom((current) => (current ? mergeRoomMessages(current, nextRoom) : nextRoom));
    } catch {
      // A transient background refresh failure must not interrupt the room
      // the user is already reading. The next interval tick retries.
    }
  }, [client, conversation.conversationId, conversation.providerId]);

  const isAppVisible = useAppVisible();
  useEffect(() => {
    if (!client || !isPaneFocused || !isAppVisible || isLoading) return;
    const intervalId = setInterval(() => void pollRoom(), ROOM_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [client, isAppVisible, isLoading, isPaneFocused, pollRoom]);

  useEffect(() => {
    if (isLoading || !room) return;
    const loadedRoomKey = `communications-room:${serverId}:${room.conversation.providerId}:${room.conversation.conversationId}`;
    if (loadedRoomKey !== roomScrollKey || initialAnchorKeyRef.current === roomScrollKey) return;
    initialAnchorKeyRef.current = roomScrollKey;
    anchorRoomEnd("opened");
  }, [anchorRoomEnd, isLoading, room, roomScrollKey, serverId]);

  useEffect(() => {
    if (isLoading || !room) return;
    const loadedRoomKey = `communications-room:${serverId}:${room.conversation.providerId}:${room.conversation.conversationId}`;
    if (loadedRoomKey !== roomScrollKey) return;
    const ids = new Set(room.messages.map((message) => message.messageId));
    const previous = knownTopLevelMessagesRef.current;
    if (previous?.key === roomScrollKey) {
      const hasNewMessage = [...ids].some((messageId) => !previous.ids.has(messageId));
      if (hasNewMessage) anchorRoomEnd("new-message");
    }
    knownTopLevelMessagesRef.current = { key: roomScrollKey, ids };
  }, [anchorRoomEnd, isLoading, room, roomScrollKey, serverId]);

  const timelineMessages = useMemo(
    () => layoutCommunicationsTimeline(room?.messages ?? []),
    [room?.messages],
  );
  const voiceAgentId = useMemo(
    () => `communications:${conversation.providerId}:${conversation.conversationId}`,
    [conversation.conversationId, conversation.providerId],
  );
  useRoomAutoSpeech({
    serverId,
    voiceAgentId,
    messages: timelineMessages.map(({ message }) => message),
    isLoading,
  });

  const loadThread = useCallback(
    async (messageId: string) => {
      if (
        !client ||
        !room?.capabilities.canRetrieveThreads ||
        threadState.messagesByParent[messageId] ||
        threadLoadIdsRef.current.has(messageId)
      ) {
        return;
      }
      threadLoadIdsRef.current.add(messageId);
      try {
        const messages = await client.communicationsRoomThreadGet({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
          parentMessageId: messageId,
        });
        setThreadState((current) => storeReplyThread(current, messageId, messages));
      } catch (nextError) {
        // Keep the reply composer mounted even if fetching historic children
        // fails. Sending a new provider-confirmed reply remains a separate
        // operation and must not flicker the user's input target away.
        setThreadState((current) => recordReplyThreadLoadFailure(current, messageId));
        setError(nextError instanceof Error ? nextError.message : "Could not load replies.");
      } finally {
        threadLoadIdsRef.current.delete(messageId);
      }
    },
    [
      client,
      conversation.conversationId,
      conversation.providerId,
      room?.capabilities,
      threadState.messagesByParent,
    ],
  );

  const openThread = useCallback(
    (messageId: string) => {
      if (!room?.capabilities.canReply) return;
      // Reply opens (and then keeps) the branch. It is never a collapse toggle:
      // users need to be able to click the message action again without losing
      // the composer they were about to type into.
      setThreadState((current) => openReplyThread(current, messageId));
      setError(null);
      void loadThread(messageId);
    },
    [loadThread, room?.capabilities],
  );

  const expandThread = useCallback(
    (messageId: string) => {
      if (!room?.capabilities.canRetrieveThreads) return;
      setThreadState((current) => expandReplyThread(current, messageId));
      setError(null);
      void loadThread(messageId);
    },
    [loadThread, room?.capabilities],
  );

  const collapseThread = useCallback((messageId: string) => {
    setThreadState((current) => collapseReplyThread(current, messageId));
  }, []);

  const send = useCallback(
    async (parentMessageId: string | null) => {
      const text = (parentMessageId ? replyDrafts[parentMessageId] : draft)?.trim();
      if (!client || !room?.capabilities.canCompose || !text || sendingTo) return;
      setSendingTo(parentMessageId ?? "room");
      setError(null);
      try {
        const message = await client.communicationsRoomMessageSend({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
          text,
          ...(parentMessageId ? { parentMessageId } : {}),
        });
        if (parentMessageId) {
          setThreadState((current) => appendConfirmedReply(current, parentMessageId, message));
          if (message.parentMessageId === parentMessageId) {
            setReplyDrafts((current) => ({ ...current, [parentMessageId]: "" }));
          } else {
            setError("Could not confirm which thread received that reply.");
          }
        } else {
          setRoom((current) =>
            current ? { ...current, messages: [...current.messages, message] } : current,
          );
          setDraft("");
        }
        // Sending is explicit ownership transfer. Both root and thread sends
        // reattach the reader; fetching or expanding historic replies does not.
        resumeFollowing();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not send that message.");
      } finally {
        setSendingTo(null);
      }
    },
    [
      client,
      conversation.conversationId,
      conversation.providerId,
      draft,
      replyDrafts,
      resumeFollowing,
      room?.capabilities,
      sendingTo,
    ],
  );

  const setReaction = useCallback(
    async (message: CommunicationMessage, emoji: string) => {
      if (!client || !room?.capabilities.canReact || sendingTo) return;
      const existing = message.reactions?.find((reaction) => reaction.emoji === emoji);
      setSendingTo(`reaction:${message.messageId}`);
      try {
        const updated = await client.communicationsRoomReactionSet({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
          messageId: message.messageId,
          emoji,
          active: !existing?.reactedByCurrentUser,
        });
        setRoom((current) => current && replaceMessage(current, updated));
        setThreadState((current) => replaceThreadMessage(current, updated));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not update reaction.");
      } finally {
        setSendingTo(null);
      }
    },
    [client, conversation.conversationId, conversation.providerId, room?.capabilities, sendingTo],
  );

  return (
    <View
      style={[styles.room, compact && styles.compactRoom, resolveBlackChatCanvasStyle(isBlackChat)]}
    >
      {room?.capabilities.unavailableReason ? (
        <Text style={styles.availability}>{room.capabilities.unavailableReason}</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.timelineFrame}>
        <ScrollView
          ref={retainedScroll.ref}
          style={styles.timeline}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={handleTimelineContentSizeChange}
          onLayout={handleTimelineLayout}
          onScroll={handleTimelineScroll}
          scrollEventThrottle={16}
        >
          <ChatWidthBounds style={styles.timelineContent}>
            {isLoading ? <LoadingSpinner /> : null}
            {!isLoading && timelineMessages.length === 0 ? (
              <Text style={styles.empty}>No messages in this room today.</Text>
            ) : null}
            {timelineMessages.map(({ message, isFirstInSenderGroup, isLastInSenderGroup }) => (
              <RoomMessage
                key={message.messageId}
                serverId={serverId}
                message={message}
                replies={threadState.messagesByParent[message.messageId] ?? []}
                expanded={threadState.expanded.has(message.messageId)}
                isReplyTarget={threadState.activeReplyId === message.messageId}
                replyFocusKey={replyComposerAutoFocusKey(threadState, message.messageId)}
                canReply={room?.capabilities.canReply === true}
                canRetrieveThreads={room?.capabilities.canRetrieveThreads === true}
                canReact={room?.capabilities.canReact === true}
                isBusy={sendingTo !== null}
                replyDraft={replyDrafts[message.messageId] ?? ""}
                onOpenThread={openThread}
                onExpandThread={expandThread}
                onCollapseThread={collapseThread}
                onReplyDraftChange={(value) =>
                  setReplyDrafts((current) => ({ ...current, [message.messageId]: value }))
                }
                onSendReply={() => void send(message.messageId)}
                onReact={setReaction}
                client={client}
                voiceAgentId={voiceAgentId}
                isFirstInSenderGroup={isFirstInSenderGroup}
                isLastInSenderGroup={isLastInSenderGroup}
              />
            ))}
          </ChatWidthBounds>
        </ScrollView>
        <ChatSeamFade edge="top" />
        <ChatSeamFade edge="bottom" />
        {scrollMode === "detached" ? (
          <Pressable
            accessibilityLabel="Jump to latest"
            accessibilityRole="button"
            onPress={resumeFollowing}
            style={styles.scrollToLatestButton}
            testID="communications-room-scroll-to-latest"
          >
            <ChevronDown size="lg" color={styles.scrollToLatestIcon.color} />
          </Pressable>
        ) : null}
      </View>
      <RoomComposer
        client={client}
        serverId={serverId}
        value={draft}
        onChangeText={setDraft}
        onSend={() => void send(null)}
        disabled={sendingTo !== null || room?.capabilities.canCompose !== true}
        loading={sendingTo === "room"}
        placeholder="Write a message"
        voiceAgentId={voiceAgentId}
        isPrimary
        isPaneFocused={isPaneFocused}
      />
    </View>
  );
}

function RoomMessage({
  serverId,
  message,
  replies,
  expanded,
  isReplyTarget,
  replyFocusKey,
  canReply,
  canRetrieveThreads,
  canReact,
  isBusy,
  replyDraft,
  onOpenThread,
  onExpandThread,
  onCollapseThread,
  onReplyDraftChange,
  onSendReply,
  onReact,
  client,
  voiceAgentId,
  isFirstInSenderGroup,
  isLastInSenderGroup,
}: {
  serverId: string;
  message: CommunicationMessage;
  replies: readonly CommunicationMessage[];
  expanded: boolean;
  /**
   * At most one branch per room hosts the inline reply composer. Reply moves
   * it here; reading a branch (expand) does not open a second composer.
   */
  isReplyTarget: boolean;
  replyFocusKey: string;
  canReply: boolean;
  canRetrieveThreads: boolean;
  canReact: boolean;
  isBusy: boolean;
  replyDraft: string;
  onOpenThread: (messageId: string) => void;
  onExpandThread: (messageId: string) => void;
  onCollapseThread: (messageId: string) => void;
  onReplyDraftChange: (value: string) => void;
  onSendReply: () => void;
  onReact: (message: CommunicationMessage, emoji: string) => void;
  client: DaemonClient | null;
  voiceAgentId: string;
  isFirstInSenderGroup: boolean;
  isLastInSenderGroup: boolean;
}): ReactElement {
  const hasReplies = replies.length > 0 || (message.replyCount ?? 0) > 0;
  return (
    <View
      style={[
        styles.messageGroup,
        isFirstInSenderGroup && styles.messageGroupFirstInSenderGroup,
        isLastInSenderGroup && styles.messageGroupLastInSenderGroup,
      ]}
    >
      <RoomMessageBubble
        serverId={serverId}
        message={message}
        canReply={canReply}
        canToggleReplies={canRetrieveThreads && (hasReplies || expanded)}
        repliesExpanded={expanded}
        canReact={canReact}
        replyLabel="Reply"
        onReply={() => onOpenThread(message.messageId)}
        onToggleReplies={() => {
          if (expanded) onCollapseThread(message.messageId);
          else onExpandThread(message.messageId);
        }}
        onReact={onReact}
      />
      {expanded ? (
        <View style={styles.thread}>
          {replies.map((reply) => (
            <RoomMessageBubble
              key={reply.messageId}
              serverId={serverId}
              message={reply}
              canReply={false}
              canToggleReplies={false}
              repliesExpanded={false}
              canReact={canReact}
              replyLabel="Reply"
              onReply={() => undefined}
              onToggleReplies={() => undefined}
              onReact={onReact}
            />
          ))}
          {isReplyTarget ? (
            <RoomComposer
              client={client}
              serverId={serverId}
              value={replyDraft}
              onChangeText={onReplyDraftChange}
              onSend={onSendReply}
              disabled={isBusy}
              loading={false}
              placeholder="Reply in thread"
              voiceAgentId={voiceAgentId}
              showAutoSpeechButton={false}
              autoFocus
              autoFocusKey={replyFocusKey}
              isPrimary={false}
              isPaneFocused={false}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function RoomMessageBubble({
  serverId,
  message,
  canReply,
  canToggleReplies,
  repliesExpanded,
  canReact,
  replyLabel,
  onReply,
  onToggleReplies,
  onReact,
}: {
  serverId: string;
  message: CommunicationMessage;
  canReply: boolean;
  canToggleReplies: boolean;
  repliesExpanded: boolean;
  canReact: boolean;
  replyLabel: string;
  onReply: () => void;
  onToggleReplies: () => void;
  onReact: (message: CommunicationMessage, emoji: string) => void;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const isCurrentUser = message.isFromCurrentUser === true;
  const hideMessageDetails = useAppSettingValue(selectHideChatMessageDetails);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFooterFocus, setHasFooterFocus] = useState(false);
  const blurFrameRef = useRef<number | null>(null);
  const getContent = useCallback(() => message.text, [message.text]);
  const sentAt = toDate(message.sentAt);
  const canPlay = canPlayRoomMessage(message);
  const showDetails = shouldRevealRoomMessageControls({
    hasFooterFocus,
    hideMessageDetails,
    isCompact,
    isHovered,
    isNative,
  });
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleFooterFocus = useCallback(() => {
    if (blurFrameRef.current !== null) {
      cancelAnimationFrame(blurFrameRef.current);
      blurFrameRef.current = null;
    }
    setHasFooterFocus(true);
  }, []);
  const handleFooterBlur = useCallback(() => {
    // Focus moves between the footer's nested Pressables as separate blur/focus
    // events. Defer hiding one frame so that move cannot collapse the target
    // under the keyboard cursor.
    blurFrameRef.current = requestAnimationFrame(() => {
      blurFrameRef.current = null;
      setHasFooterFocus(false);
    });
  }, []);
  useEffect(
    () => () => {
      if (blurFrameRef.current !== null) cancelAnimationFrame(blurFrameRef.current);
    },
    [],
  );
  const trailingActions = useMemo(
    () =>
      canReact ? (
        <>
          <Text style={styles.actionSeparator}>•</Text>
          <View style={styles.quickReactions}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onReact(message, emoji)}
                accessibilityLabel={`React ${emoji}`}
                style={styles.reactionAction}
              >
                <Text style={styles.reactionActionText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null,
    [canReact, message, onReact],
  );
  const renderReplyIcon = useCallback(
    ({ active }: { active: boolean }) => (
      <ThemedCornerDownLeft
        size="chromeXs"
        uniProps={active ? foregroundIconMapping : mutedIconMapping}
      />
    ),
    [],
  );
  const renderThreadToggleIcon = useCallback(
    ({ active }: { active: boolean }) => {
      const Icon = repliesExpanded ? ThemedListChevronsDownUp : ThemedListChevronsUpDown;
      return <Icon size="chromeXs" uniProps={active ? foregroundIconMapping : mutedIconMapping} />;
    },
    [repliesExpanded],
  );
  return (
    <View
      style={[styles.messageUnit, isCurrentUser && styles.messageUnitOutgoing]}
      onBlur={handleFooterBlur}
      onFocus={handleFooterFocus}
      // Mirrors UserMessage's message.tsx bubble: unconditional pointer events
      // are safe here only because `showDetails` above already short-circuits
      // on isNative/isCompact, so hover never gates visibility on native.
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Text style={[styles.sender, isCurrentUser && styles.senderOutgoing]}>
        {message.senderDisplayName ?? message.senderId ?? "Unknown sender"}
      </Text>
      <ChatMessageBubble
        accessibilityLabel={messageAccessibilityLabel(message)}
        side={isCurrentUser ? "outgoing" : "incoming"}
      >
        <MarkdownRenderer
          {...adaptCommunicationsMessageContent(message.text)}
          compact={isCompact}
        />
        {canPlay ? (
          <View
            style={showDetails ? styles.playbackSlotVisible : styles.playbackSlot}
            pointerEvents={showDetails ? "auto" : "none"}
          >
            <MessagePlaybackButton
              serverId={serverId}
              getContent={getContent}
              turnKey={`communications:${message.messageId}`}
            />
          </View>
        ) : null}
      </ChatMessageBubble>
      {message.reactions?.length ? (
        <View style={[styles.reactions, isCurrentUser && styles.reactionsOutgoing]}>
          {message.reactions.map((reaction) => (
            <Pressable
              key={reaction.emoji}
              onPress={canReact ? () => onReact(message, reaction.emoji) : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${reaction.emoji}, ${reaction.count} reactions`}
              style={[styles.reaction, reaction.reactedByCurrentUser && styles.reactionActive]}
            >
              <Text style={styles.reactionText}>
                {reaction.emoji} {reaction.count}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View
        style={[
          showDetails ? styles.messageFooterVisible : styles.messageFooter,
          isCurrentUser && styles.messageFooterOutgoing,
        ]}
      >
        <MessageFooter
          getContent={getContent}
          completedAt={sentAt}
          leadingActions={
            <>
              {canReply ? (
                <MessageFooterIconAction
                  accessibilityLabel={replyLabel}
                  onPress={onReply}
                  renderIcon={renderReplyIcon}
                />
              ) : null}
              {canToggleReplies ? (
                <MessageFooterIconAction
                  accessibilityLabel={repliesExpanded ? "Collapse replies" : "Expand replies"}
                  onPress={onToggleReplies}
                  renderIcon={renderThreadToggleIcon}
                />
              ) : null}
            </>
          }
          trailingActions={trailingActions}
        />
      </View>
    </View>
  );
}

function RoomComposer({
  client,
  serverId,
  value,
  onChangeText,
  onSend,
  disabled,
  loading,
  placeholder,
  voiceAgentId,
  showAutoSpeechButton = true,
  autoFocus = false,
  autoFocusKey,
  isPrimary,
  isPaneFocused,
}: {
  client: DaemonClient | null;
  serverId: string;
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  loading: boolean;
  placeholder: string;
  voiceAgentId: string;
  showAutoSpeechButton?: boolean;
  autoFocus?: boolean;
  autoFocusKey?: string;
  /** The room-level composer owns global keyboard commands and auto-speech. */
  isPrimary: boolean;
  isPaneFocused: boolean;
}): ReactElement {
  const messageInputRef = useRef<MessageInputRef>(null);
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const keyboardHandlerIdRef = useRef(
    `communications-message-input:${voiceAgentId}:${Math.random().toString(36).slice(2)}`,
  );
  useMessageInputKeyboardScope({
    handlerId: keyboardHandlerIdRef.current,
    isPaneFocused: isPrimary && isPaneFocused,
    isMessageInputFocused,
    messageInputRef,
  });
  const handleSubmit = useCallback(() => {
    onSend();
    return true;
  }, [onSend]);
  const input = (
    <MessageInput
      ref={messageInputRef}
      value={value}
      onChangeText={onChangeText}
      onSubmit={handleSubmit}
      attachments={EMPTY_ATTACHMENTS}
      cwd="/"
      attachmentMenuItems={EMPTY_ATTACHMENT_MENU_ITEMS}
      showAttachmentButton={false}
      client={client}
      voiceServerId={serverId}
      voiceAgentId={voiceAgentId}
      showAutoSpeechButton={showAutoSpeechButton}
      isReadyForDictation={client?.isConnected ?? false}
      autoFocus={autoFocus}
      autoFocusKey={autoFocusKey}
      placeholder={placeholder}
      disabled={disabled}
      isSubmitLoading={loading}
      isPaneFocused={isPrimary && isPaneFocused}
      onFocusChange={setIsMessageInputFocused}
    />
  );
  return isPrimary ? <ComposerFrame>{input}</ComposerFrame> : input;
}

function toDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function useRoomAutoSpeech({
  serverId,
  voiceAgentId,
  messages,
  isLoading,
}: {
  serverId: string;
  voiceAgentId: string;
  messages: readonly CommunicationMessage[];
  isLoading: boolean;
}): void {
  const sourceRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const knownMessageIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const source = `${serverId}:${voiceAgentId}`;
    if (sourceRef.current !== source) {
      sourceRef.current = source;
      initializedRef.current = false;
      knownMessageIdsRef.current = new Set();
    }
    // The first completed load is history, never a fresh incoming message.
    if (isLoading) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      knownMessageIdsRef.current = new Set(messages.map((message) => message.messageId));
      return;
    }
    for (const message of messages) {
      if (knownMessageIdsRef.current.has(message.messageId)) continue;
      knownMessageIdsRef.current.add(message.messageId);
      // Only the provider-confirmed incoming side is eligible. Unknown legacy
      // payloads intentionally stay silent rather than risk reading the user's text.
      if (message.isFromCurrentUser !== false || !message.text.trim()) continue;
      autoSpeechQueue.enqueue({
        groupId: `communications:${message.providerId}:${message.conversationId}:${message.messageId}`,
        serverId,
        agentId: voiceAgentId,
        text: message.text,
      });
    }
  }, [isLoading, messages, serverId, voiceAgentId]);
}

function replaceMessage(room: CommunicationRoom, message: CommunicationMessage): CommunicationRoom {
  return {
    ...room,
    messages: room.messages.map((current) =>
      current.messageId === message.messageId ? message : current,
    ),
  };
}
function replaceThreadMessage(
  state: ReplyThreadState,
  message: CommunicationMessage,
): ReplyThreadState {
  return {
    ...state,
    messagesByParent: Object.fromEntries(
      Object.entries(state.messagesByParent).map(([key, messages]) => [
        key,
        messages.map((current) => (current.messageId === message.messageId ? message : current)),
      ]),
    ),
  };
}
function messageAccessibilityLabel(message: CommunicationMessage): string {
  return `${message.senderDisplayName ?? message.senderId ?? "Unknown sender"}: ${message.text}`;
}

const styles = StyleSheet.create((theme) => ({
  room: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  compactRoom: { minHeight: 360 },
  timelineFrame: { flex: 1, minHeight: 0, position: "relative" },
  timeline: { flex: 1, minHeight: 0 },
  scrollToLatestButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
    borderRadius: 24,
    bottom: theme.spacing[4],
    height: 48,
    justifyContent: "center",
    left: "50%",
    marginLeft: -24,
    position: "absolute",
    width: 48,
    ...theme.shadow.sm,
  },
  scrollToLatestIcon: { color: theme.colors.foreground },
  timelineContent: {
    alignSelf: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    width: "100%",
  },
  messageGroup: { gap: theme.spacing[2] },
  messageGroupFirstInSenderGroup: { marginTop: theme.spacing[4] },
  messageGroupLastInSenderGroup: { marginBottom: theme.spacing[2] },
  messageUnit: { alignSelf: "flex-start", maxWidth: "100%", paddingBottom: theme.spacing[1] },
  messageUnitOutgoing: { alignSelf: "flex-end" },
  sender: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[1],
  },
  senderOutgoing: { alignSelf: "flex-end", textAlign: "right" },
  messageFooter: {
    marginTop: theme.spacing[1],
    opacity: 0,
  },
  messageFooterVisible: { marginTop: theme.spacing[1], opacity: 1 },
  messageFooterOutgoing: { alignSelf: "flex-end" },
  actionSeparator: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  quickReactions: { alignItems: "center", flexDirection: "row", gap: theme.spacing[1] },
  reactionAction: {
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  reactionActionText: { fontSize: theme.fontSize.base },
  reactions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  reactionsOutgoing: { alignSelf: "flex-end" },
  reaction: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  reactionActive: { borderColor: theme.colors.accent },
  reactionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  playbackSlot: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    bottom: theme.spacing[1],
    opacity: 0,
    position: "absolute",
    right: theme.spacing[1],
  },
  playbackSlotVisible: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    bottom: theme.spacing[1],
    opacity: 1,
    position: "absolute",
    right: theme.spacing[1],
  },
  thread: {
    borderLeftColor: theme.colors.borderAccent,
    borderLeftWidth: 2,
    gap: theme.spacing[3],
    marginLeft: theme.spacing[3],
    paddingLeft: theme.spacing[3],
  },
  availability: {
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[8],
    textAlign: "center",
  },
}));
