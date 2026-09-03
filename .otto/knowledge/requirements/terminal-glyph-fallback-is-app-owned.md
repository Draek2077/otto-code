---
id: "terminal-glyph-fallback-is-app-owned"
kind: "requirement"
title: "Terminal glyph fallback is app-owned"
status: "proposed"
tags: ["terminal","fonts","desktop","compatibility"]
created_at: "2026-09-03T14:26:01.642Z"
updated_at: "2026-09-03T14:31:35.395Z"
---
# Terminal glyph fallback is app-owned

<!-- compiled_truth -->

Otto's terminal renderers must render standard Unicode terminal glyphs and Nerd Font symbol/private-use glyphs emitted by external CLIs and TUIs without requiring users to install or configure a host font. Otto preserves a user-selected text face while using its bundled symbol fallback only for missing desktop glyphs and native private-use cells. The desktop software-rendering path must retain this guarantee when GPU glyph synthesis is unavailable.

## Timeline

- time: "2026-09-03T14:26:01.642Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["developer-native-terminal-and-structural-diff"]
- time: "2026-09-03T14:26:01.642Z"
  kind: "evidence"
  summary: "User requirement, 2026-09-03: terminal rendering must be invisible to the user even when it needs an app-level fix. Implemented in `packages/app/src/terminal/runtime/terminal-font.ts` with Expo-loaded `assets/fonts/SymbolsNerdFontMono-Regular.ttf` (Nerd Fonts v3.5.1, MIT; SHA-256 FE471E538392F51910FAAB985FA8E192A39DD3426125EDD15B71B3680DF0E749). The installed Otto profile's `disable-hardware-acceleration` marker contained `crashed`, which forces the xterm software path where the WebGL renderer's synthetic box/block/Braille glyphs are unavailable. Focused terminal-font/runtime tests, app typecheck, and targeted lint passed."
- time: "2026-09-03T14:31:26.677Z"
  kind: "decision"
  summary: "The user required cross-platform terminal glyph rendering. The native terminal grid now isolates Nerd Font private-use cells into a bundled-symbol-font run, while preserving the configured native monospace face for normal terminal text. Status returned to proposed for review."
  affects: ["developer-native-terminal-and-structural-diff"]
- time: "2026-09-03T14:31:35.395Z"
  kind: "evidence"
  summary: "Native support is implemented in `packages/app/src/terminal/native-renderer/terminal-row-model.ts` and `terminal-grid-view.native.tsx`: U+E000–U+F8FF private-use cells use the Expo-registered `OttoNerdSymbols` face, whereas normal text remains on the configured native monospace face. Focused native row-model/custom-glyph and desktop runtime/font tests passed (32 tests)."
  source: "implementation verification, 2026-09-03"
  affects: ["developer-native-terminal-and-structural-diff"]
