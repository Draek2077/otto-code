import type { CSSProperties, ReactNode } from "react";
import { BLACK_CHAT_SCOPE_CLASS } from "@/styles/black-chat-scope";

interface BlackChatScopeProps {
  enabled: boolean;
  children: ReactNode;
}

// Keeps the wrapper out of flex layout; CSS variables still cascade through.
const SCOPE_WRAPPER_STYLE: CSSProperties = { display: "contents" };

/**
 * Web variant of the Black tab background scope: a raw DOM wrapper that
 * re-declares the `black` theme's CSS variables (kept in sync by
 * `styles/black-chat-scope.ts`), so every Unistyles class inside — which all
 * reference `var(--...)` on web — resolves to black-theme values no matter
 * how often descendants re-render. `display: contents` keeps the wrapper out
 * of flex layout while variables still cascade through it.
 *
 * Deliberately does NOT use `ScopedTheme` here. `ScopedTheme` drives style
 * resolution (including plain `StyleSheet.create` classes, not just
 * `withUnistyles`/`uniProps`) off a single global scope stack — push before
 * children, pop after — rather than React context. In a chat pane with async,
 * streaming re-renders, that push/pop can desync: the pop can lose the race
 * against an unrelated component (header, tab row) mounting or re-rendering
 * elsewhere in the tree while the stack is still pushed to "black". Once that
 * happens the wrong scope gets captured and cached, painting parts of the app
 * outside the chat pane pure black until a full reload. The DOM-scoped CSS
 * variable class above has no such race — it only affects real descendants —
 * so it's the only mechanism used here. The cost: `withUnistyles`/`uniProps`
 * consumers (icon color props) inside the chat pane won't pick up the black
 * variant's colors; every `StyleSheet.create`-based color still does.
 */
export function BlackChatScope({ enabled, children }: BlackChatScopeProps) {
  if (!enabled) {
    return children;
  }
  return (
    <div className={BLACK_CHAT_SCOPE_CLASS} style={SCOPE_WRAPPER_STYLE}>
      {children}
    </div>
  );
}
