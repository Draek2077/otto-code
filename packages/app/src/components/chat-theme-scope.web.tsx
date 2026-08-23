import type { ReactNode } from "react";

/**
 * Web variant of `ChatThemeScope` (see `chat-theme-scope.tsx`): a no-op.
 *
 * On web the black chat palette is carried by the descendant CSS-variable
 * class that `components/black-chat-scope.web.tsx` puts on the pane wrapper,
 * which wins by plain cascading no matter how often descendants re-render.
 * Re-asserting `ScopedTheme` here would buy nothing and would re-introduce
 * the mount-timing capture that variant deliberately avoids.
 */
export function ChatThemeScope({ children }: { children: ReactNode }) {
  return children;
}
