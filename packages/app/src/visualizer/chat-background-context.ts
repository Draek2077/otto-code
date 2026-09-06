import { createContext, useContext } from "react";

// Changes only when the placement changes, never on animation frames or hover.
export const ChatVisualizerBackgroundContext = createContext(false);
export const useChatVisualizerBackground = () => useContext(ChatVisualizerBackgroundContext);
export const CHAT_VISUALIZER_CONTENT_DATA = { chatVisualizerContent: "true" };
