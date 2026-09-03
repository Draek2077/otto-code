const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** The family registered by Expo when the application starts. */
export const BUNDLED_TERMINAL_FONT_FAMILY = "JetBrainsMono_400Regular";

/**
 * A compact symbol-only Nerd Font shipped with Otto.
 *
 * This must stay after the user's text font so it supplies only missing PUA
 * glyphs, without changing their terminal's ordinary text face.
 */
export const BUNDLED_NERD_SYMBOLS_FONT_FAMILY = "OttoNerdSymbols";

const SYSTEM_TERMINAL_FONT_FALLBACKS = [
  // Prefer user-installed developer fonts after Otto's bundled fallback.
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono NF",
  "MesloLGM Nerd Font",
  "MesloLGM NF",
  "Hack Nerd Font",
  "FiraCode Nerd Font",
  // PUA-only fallback (many Nerd glyphs live here on some systems).
  "Symbols Nerd Font",
  // System fallbacks.
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "'Liberation Mono'",
  "monospace",
];

export const DEFAULT_TERMINAL_FONT_FAMILY = [
  BUNDLED_TERMINAL_FONT_FAMILY,
  BUNDLED_NERD_SYMBOLS_FONT_FAMILY,
  ...SYSTEM_TERMINAL_FONT_FALLBACKS,
].join(", ");

export function resolveTerminalFontFamily(fontFamily: string | undefined): string {
  const trimmed = fontFamily?.trim();
  if (!trimmed) {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }

  // A custom code font is a visual preference, not an opt-out from the terminal
  // being able to render the PUA symbols emitted by modern CLIs and TUIs.
  return [trimmed, BUNDLED_NERD_SYMBOLS_FONT_FAMILY, ...SYSTEM_TERMINAL_FONT_FALLBACKS].join(", ");
}

export function resolveTerminalFontSize(fontSize: number | undefined): number {
  return typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_TERMINAL_FONT_SIZE;
}
