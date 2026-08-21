import React, { createContext, type ReactNode, useContext } from "react";
import { StyleSheet as RNStyleSheet } from "react-native";

const BlackChatScopeContext = createContext(false);

export function BlackChatScopeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <BlackChatScopeContext value={enabled}>{children}</BlackChatScopeContext>;
}

export function useBlackChatScope(): boolean {
  return useContext(BlackChatScopeContext);
}

// The chat canvas cannot rely exclusively on Unistyles' native scoped-theme
// registry. Retained Android views can detach and reattach, and stream children
// can mount from a deep store update without rendering through ScopedTheme's
// marker pair. This core RN style is therefore the authoritative pure-black
// canvas; ScopedTheme still supplies the richer dark palette inside it.
const blackChatCanvasStyle = RNStyleSheet.create({
  enabled: { backgroundColor: "#000000" },
}).enabled;

export function resolveBlackChatCanvasStyle(enabled: boolean) {
  return enabled ? blackChatCanvasStyle : undefined;
}
