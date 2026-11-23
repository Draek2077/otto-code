import { MessageSquareText } from "lucide-react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";

export interface ChatMessageResult {
  kind: "message";
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
  run(): Promise<void>;
}

const MessageIcon = withUnistyles(MessageSquareText, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function ChatMessageSearchRow({
  result,
  query,
}: {
  result: ChatMessageResult;
  query: string;
}) {
  const ranges = useMemo(() => findHighlightRanges(query, result.snippet), [query, result.snippet]);
  return (
    <View style={styles.row} testID="command-center-chat-message">
      <View style={styles.icon}>
        <MessageIcon size={16} />
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.title}>
          {result.title} · {result.subtitle}
        </Text>
        <HighlightedText
          text={result.snippet}
          ranges={ranges}
          numberOfLines={1}
          style={styles.snippet}
        />
      </View>
    </View>
  );
}

export function ChatSearchStatus({ message }: { message: string }) {
  return message ? (
    <Text
      style={styles.status}
      accessibilityLiveRegion="polite"
      testID="command-center-chat-search-status"
    >
      {message}
    </Text>
  ) : null;
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flex: 1 },
  icon: { width: 16, justifyContent: "center", alignItems: "center" },
  body: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  snippet: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  status: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
