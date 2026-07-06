import type { CSSProperties, ReactNode } from "react";
import { ScopedTheme } from "react-native-unistyles";
import { BLACK_CHAT_SCOPE_CLASS } from "@/styles/black-chat-scope";

interface BlackChatScopeProps {
  enabled: boolean;
  children: ReactNode;
}

// Keeps the wrapper out of flex layout; CSS variables still cascade through.
const SCOPE_WRAPPER_STYLE: CSSProperties = { display: "contents" };

/**
 * Web variant of the Black tab background scope. Two mechanisms, both needed:
 *
 * - The raw DOM wrapper re-declares the `black` theme's CSS variables (kept in
 *   sync by `styles/black-chat-scope.ts`), so every Unistyles class inside —
 *   which all reference `var(--...)` on web — resolves to black-theme values
 *   no matter how often descendants re-render. `display: contents` keeps the
 *   wrapper out of flex layout while variables still cascade through it.
 * - ScopedTheme covers the non-class paths (`withUnistyles`/`uniProps`
 *   consumers such as icon colors), which capture their scoped theme at mount.
 *
 * ScopedTheme alone is NOT enough on web: it only affects styles registered
 * during renders that pass through its markers, and deep chat-stream children
 * re-render on their own, flipping their classes back to the app theme.
 */
export function BlackChatScope({ enabled, children }: BlackChatScopeProps) {
  if (!enabled) {
    return children;
  }
  return (
    <div className={BLACK_CHAT_SCOPE_CLASS} style={SCOPE_WRAPPER_STYLE}>
      <ScopedTheme name="black">{children}</ScopedTheme>
    </div>
  );
}
