import { isWeb } from "@/constants/platform";

/**
 * CSS class that re-declares the `black` theme's CSS variables on a wrapper
 * element around chat panes (see `components/black-chat-scope.web.tsx`).
 *
 * Why this exists: on web, Unistyles emits every theme's variables under
 * `:root.<name>` and every generated style class references `var(--...)`.
 * `ScopedTheme` alone is not enough there — it only affects styles registered
 * during renders that pass through its markers, so any deep child that
 * re-renders on its own (the chat stream does, constantly) recomputes its
 * class against the app theme and the scope silently unwinds. Re-declaring
 * the black theme's variables on an ancestor element wins by plain CSS
 * cascading no matter how often descendants re-render.
 */
export const BLACK_CHAT_SCOPE_CLASS = "otto-black-chat-scope";

const SCOPE_STYLE_TAG_ID = "otto-black-chat-scope-vars";
// Unistyles' own generated stylesheet (`web/css/state.ts` hardcodes this id).
const UNISTYLES_STYLE_TAG_ID = "unistyles-web";

/**
 * Mirror the current `:root.black{...}` variable block from Unistyles'
 * generated stylesheet under `.otto-black-chat-scope{...}` in a style tag we
 * own. Copying the generated rule verbatim (rather than serializing the theme
 * ourselves) guarantees the variable names match whatever the installed
 * Unistyles version emits.
 *
 * Call after every repaint of the `black` theme key — `applyColorScheme` and
 * `applyAppearance` both do. No-op on native and during SSR.
 */
export function syncBlackChatScopeVars(): void {
  if (!isWeb || typeof document === "undefined") {
    return;
  }
  const generated = document.getElementById(UNISTYLES_STYLE_TAG_ID)?.textContent ?? "";
  const match = generated.match(/:root\.black\{([^}]*)\}/);
  if (!match) {
    return;
  }
  let tag = document.getElementById(SCOPE_STYLE_TAG_ID);
  if (!tag) {
    tag = document.createElement("style");
    tag.id = SCOPE_STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  const nextCss = `.${BLACK_CHAT_SCOPE_CLASS}{${match[1]}}`;
  if (tag.textContent !== nextCss) {
    tag.textContent = nextCss;
  }
}
