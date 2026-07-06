import type { ReactNode } from "react";
import { ScopedTheme } from "react-native-unistyles";

interface BlackChatScopeProps {
  enabled: boolean;
  children: ReactNode;
}

/**
 * Black tab background setting: renders the chat pane under the scoped
 * `black` theme — the user's dark-variant colors on pure black — regardless
 * of the app-wide light/dark mode. Native ScopedTheme registers each node's
 * styles with the scoped theme, so this is all that is needed here; the web
 * variant (`black-chat-scope.web.tsx`) additionally re-declares the theme's
 * CSS variables on a wrapper element.
 */
export function BlackChatScope({ enabled, children }: BlackChatScopeProps) {
  if (!enabled) {
    return children;
  }
  return <ScopedTheme name="black">{children}</ScopedTheme>;
}
