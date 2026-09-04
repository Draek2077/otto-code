import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAppSettingValue, type ChatTimestampDisplay } from "@/hooks/use-settings";

interface ChatRenderSettings {
  blackTabBackground: boolean;
  chatBubbleGradient: boolean;
  chatTimestampDisplay: ChatTimestampDisplay;
  hideChatMessageDetails: boolean;
  animationsEnabled: boolean;
  wrapToolCallText: boolean;
}

const defaultChatRenderSettings: ChatRenderSettings = {
  blackTabBackground: false,
  chatBubbleGradient: true,
  chatTimestampDisplay: "absolute",
  hideChatMessageDetails: true,
  animationsEnabled: true,
  wrapToolCallText: false,
};

const ChatRenderSettingsContext = createContext<ChatRenderSettings>(defaultChatRenderSettings);

const selectBlackTabBackground = (settings: ChatRenderSettings) => settings.blackTabBackground;
const selectChatBubbleGradient = (settings: ChatRenderSettings) => settings.chatBubbleGradient;
const selectChatTimestampDisplay = (settings: ChatRenderSettings) => settings.chatTimestampDisplay;
const selectHideChatMessageDetails = (settings: ChatRenderSettings) =>
  settings.hideChatMessageDetails;
const selectAnimationsEnabled = (settings: ChatRenderSettings) => settings.animationsEnabled;
const selectWrapToolCallText = (settings: ChatRenderSettings) => settings.wrapToolCallText;

/**
 * Shared appearance values used by transcript rows. Keeping the subscriptions
 * at the app boundary avoids a React Query observer for every retained message
 * and tool row when a chat is hydrated.
 */
export function ChatRenderSettingsProvider({ children }: { children: ReactNode }) {
  const blackTabBackground = useAppSettingValue(selectBlackTabBackground);
  const chatBubbleGradient = useAppSettingValue(selectChatBubbleGradient);
  const chatTimestampDisplay = useAppSettingValue(selectChatTimestampDisplay);
  const hideChatMessageDetails = useAppSettingValue(selectHideChatMessageDetails);
  const animationsEnabled = useAppSettingValue(selectAnimationsEnabled);
  const wrapToolCallText = useAppSettingValue(selectWrapToolCallText);
  const value = useMemo(
    () => ({
      blackTabBackground,
      chatBubbleGradient,
      chatTimestampDisplay,
      hideChatMessageDetails,
      animationsEnabled,
      wrapToolCallText,
    }),
    [
      animationsEnabled,
      blackTabBackground,
      chatBubbleGradient,
      chatTimestampDisplay,
      hideChatMessageDetails,
      wrapToolCallText,
    ],
  );

  return (
    <ChatRenderSettingsContext.Provider value={value}>
      {children}
    </ChatRenderSettingsContext.Provider>
  );
}

export function useChatRenderSettings(): ChatRenderSettings {
  return useContext(ChatRenderSettingsContext);
}
