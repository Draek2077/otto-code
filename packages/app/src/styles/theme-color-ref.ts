import { isWeb } from "@/constants/platform";
import type { Theme } from "./theme";

// Flat string color tokens only — nested palettes (syntax, terminal) are not
// addressable through a single CSS variable name.
type FlatColorKey = {
  [K in keyof Theme["colors"]]: Theme["colors"][K] extends string ? K : never;
}[keyof Theme["colors"]];

// Matches Unistyles' web variable naming (`hyphenate` in its web utils):
// camelCase → kebab-case, digits untouched (`foregroundMuted` →
// `--colors-foreground-muted`, `surface2` → `--colors-surface2`).
const hyphenate = (key: string) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/**
 * A theme color as a cascade-following reference.
 *
 * On web this returns `var(--colors-<token>)` instead of the resolved hex.
 * Styles that are computed in JS and passed as concrete values (withUnistyles
 * `uniProps` mappings, color props) escape Unistyles' generated-class + CSS
 * variable pipeline, so scoped-theme wrappers like the black chat scope
 * (`styles/black-chat-scope.ts`) can't recolor them — a chat pane in a light
 * app theme ends up with light-theme text on the black background. Emitting a
 * `var()` reference keeps the value resolving against the nearest ancestor's
 * variables: the black scope wrapper inside chat panes, `:root`'s active
 * theme everywhere else.
 *
 * On native the concrete theme value is returned — `ScopedTheme` re-registers
 * node styles there, so JS-resolved values are already scope-correct, and
 * native styling has no `var()` support anyway.
 *
 * Only for plain color slots that reach the DOM as CSS (style colors, color
 * props on DOM-rendered components). Never do math on the returned value.
 */
export function themeColorRef(theme: Theme, key: FlatColorKey): string {
  return isWeb ? `var(--colors-${hyphenate(key)})` : theme.colors[key];
}
