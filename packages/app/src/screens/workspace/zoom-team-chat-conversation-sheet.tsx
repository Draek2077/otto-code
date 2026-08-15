import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  CommunicationConversationSummary,
  CommunicationMessage,
} from "@otto-code/protocol/communications";
import type { DaemonClient } from "@otto-code/client";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export function ZoomTeamChatConversationSheet({
  client,
  conversation,
  onClose,
}: {
  client: DaemonClient | null;
  conversation: CommunicationConversationSummary | null;
  onClose: () => void;
}): ReactElement {
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const header = useMemo<SheetHeader>(
    () => ({ title: conversation?.title ?? "Zoom Team Chat" }),
    [conversation?.title],
  );

  const refresh = useCallback(async () => {
    if (!client || !conversation) return;
    setIsLoading(true);
    setError(null);
    try {
      setMessages(
        await client.communicationsInboxGetMessages({
          providerId: conversation.providerId,
          conversationId: conversation.conversationId,
        }),
      );
    } catch {
      setError("Could not load today’s Zoom messages.");
    } finally {
      setIsLoading(false);
    }
  }, [client, conversation]);

  useEffect(() => {
    if (!conversation) {
      setMessages([]);
      setDraft("");
      setError(null);
      return;
    }
    void refresh();
  }, [conversation, refresh]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!client || !conversation || !text || isSending) return;
    setIsSending(true);
    setError(null);
    try {
      const message = await client.communicationsInboxSendMessage({
        providerId: conversation.providerId,
        conversationId: conversation.conversationId,
        text,
      });
      setMessages((current) => [...current, message]);
      setDraft("");
    } catch {
      setError("Could not send that Zoom message.");
    } finally {
      setIsSending(false);
    }
  }, [client, conversation, draft, isSending]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const footer = useMemo(
    () =>
      conversation ? (
        <View style={styles.composer}>
          <AdaptiveTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            editable={!isSending}
            multiline
            style={styles.input}
            accessibilityLabel={`Message ${conversation.title}`}
            testID="zoom-team-chat-compose"
          />
          <Button
            size="sm"
            onPress={send}
            disabled={!draft.trim() || isSending}
            loading={isSending}
          >
            Send
          </Button>
        </View>
      ) : null,
    [conversation, draft, isSending, send],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={conversation !== null}
      onClose={onClose}
      footer={footer}
      scrollable={false}
      contentPadding={false}
      desktopMaxWidth={680}
      desktopHeight={680}
      testID="zoom-team-chat-conversation-sheet"
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.toolbar}>
          <Text style={styles.hint}>Today’s messages only</Text>
          <Button variant="ghost" size="sm" onPress={handleRefresh} disabled={isLoading}>
            Refresh
          </Button>
        </View>
        {isLoading ? (
          <View style={styles.centered}>
            <LoadingSpinner />
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!isLoading && !error && messages.length === 0 ? (
          <Text style={styles.empty}>No messages here today.</Text>
        ) : null}
        {messages.map((message) => (
          <View key={message.messageId} style={styles.message}>
            <Text style={styles.sender}>{message.senderId ?? "You"}</Text>
            <Text style={styles.messageText}>{message.text}</Text>
          </View>
        ))}
      </ScrollView>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing[4], gap: theme.spacing[3] },
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  hint: { fontSize: 12, color: theme.colors.foregroundMuted },
  centered: { paddingVertical: theme.spacing[8], alignItems: "center" },
  error: { fontSize: 13, color: theme.colors.statusDanger },
  empty: {
    paddingVertical: theme.spacing[8],
    textAlign: "center",
    color: theme.colors.foregroundMuted,
  },
  message: { gap: theme.spacing[1] },
  sender: { fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted },
  messageText: { fontSize: 14, lineHeight: 20, color: theme.colors.foreground },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: theme.spacing[2] },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
  },
}));
