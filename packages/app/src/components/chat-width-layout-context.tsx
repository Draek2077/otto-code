import { createContext, useContext, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useChatOutlineLayout } from "@/agent-stream/chat-outline/layout";
import { resolveChatMaxWidth } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { resolveChatOutlinePadding } from "./chat-width-layout";

interface ChatWidthLayoutState {
  chatMaxWidth: number | undefined;
  outlinePadding: number;
}

const ChatWidthLayoutContext = createContext<ChatWidthLayoutState>({
  chatMaxWidth: resolveChatMaxWidth("default"),
  outlinePadding: 0,
});

/**
 * Measures the chat pane once and gives every transcript and composer track
 * the same responsive width geometry. Local measurements drift because the
 * stream and composer each have their own harmless structural padding.
 */
interface ChatWidthLayoutProviderProps {
  children: ReactNode;
  chatMaxWidth?: number;
}

function ChatWidthLayoutProviderBase({ children, chatMaxWidth }: ChatWidthLayoutProviderProps) {
  const { isRailVisible } = useChatOutlineLayout();
  const value = useMemo(
    () => ({
      chatMaxWidth,
      outlinePadding: resolveChatOutlinePadding({ railVisible: isRailVisible }),
    }),
    [chatMaxWidth, isRailVisible],
  );

  return (
    <ChatWidthLayoutContext value={value}>
      <View style={styles.container}>{children}</View>
    </ChatWidthLayoutContext>
  );
}

const chatWidthLayoutMapping = (theme: Theme): Partial<ChatWidthLayoutProviderProps> => ({
  chatMaxWidth: theme.layout.chatMaxWidth,
});
const ThemedChatWidthLayoutProvider = withUnistyles(ChatWidthLayoutProviderBase);

export function ChatWidthLayoutProvider({ children }: { children: ReactNode }) {
  return (
    <ThemedChatWidthLayoutProvider uniProps={chatWidthLayoutMapping}>
      {children}
    </ThemedChatWidthLayoutProvider>
  );
}

export function useChatWidthLayout(): ChatWidthLayoutState {
  return useContext(ChatWidthLayoutContext);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
  },
});
