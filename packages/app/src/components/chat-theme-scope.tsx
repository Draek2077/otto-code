import type { ReactNode } from "react";
import { ScopedTheme } from "react-native-unistyles";
import { useBlackChatScope } from "@/components/black-chat-scope-context";

/**
 * Re-asserts the black chat palette for one component's own render pass.
 *
 * `ScopedTheme` is a marker-scoped registry operation, not a descendant
 * context: styles are computed against the scoped theme only while a render
 * passes *between* its two markers (docs/unistyles.md). The single wrap in
 * `BlackChatScope` therefore only covers the pane's first mount pass. Every
 * chat surface that re-renders on its own afterwards - the composer on each
 * keystroke, the queue when a message is added, a stream child mounting from
 * a deep store update - re-registers its styles with no scope and silently
 * flips back to the app palette. On a pure-black canvas that reads as
 * lighter-than-intended chrome sitting on black.
 *
 * Wrapping a component's *own returned tree* fixes that for the whole
 * subtree it renders: the markers are part of its output, so they run again
 * on every one of its re-renders. Place this inside components that
 * re-render independently and own visible chrome, not around them.
 *
 * No-op when the Black tab background setting is off, and a no-op file on
 * web (`chat-theme-scope.web.tsx`), where the descendant CSS-variable class
 * in `styles/black-chat-scope.ts` already survives re-renders.
 */
export function ChatThemeScope({ children }: { children: ReactNode }) {
  const isBlackChat = useBlackChatScope();
  if (!isBlackChat) {
    return children;
  }
  return <ScopedTheme name="black">{children}</ScopedTheme>;
}
