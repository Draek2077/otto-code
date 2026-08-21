---
id: "theme-aware-ui-state-gallery"
kind: "requirement"
title: "Theme-aware UI state gallery"
status: "confirmed"
tags: ["ui","design-system","theme","visual-audit","accessibility","developer-tools"]
created_at: "2026-08-21T16:33:33.252Z"
updated_at: "2026-08-21T17:37:51.768Z"
---
# Theme-aware UI state gallery

<!-- compiled_truth -->

# Requirement

Otto provides a single in-app UI state gallery for auditing the production design system. The gallery is available only in development builds and when Developer interface mode is active. It selects any Otto theme variant and presents every shared UI element in every visually enforced state that applies to it, including rest, hover, pressed, keyboard focus, selected, checked on and off, disabled, loading, open, validation, and semantic-status variants.

The gallery renders production primitives and production state-style paths rather than maintaining lookalike demo components. States are labeled and shown side by side so theme and interaction inconsistencies can be audited from one surface.

## Timeline

- time: "2026-08-21T16:33:33.252Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["keyboard-focus-rings-hug-control-borders","daylight-outlined-controls-match-structural-borders","selected-tab-labels-use-accent-foreground"]
- time: "2026-08-21T16:33:33.252Z"
  kind: "evidence"
  summary: "Explicit user direction on 2026-08-21: create a single UI page available in-app for each theme, containing every UI element in every enforced state so the complete interface can be audited instantly."
- time: "2026-08-21T17:13:54.725Z"
  kind: "evidence"
  summary: "Gallery hardening on 2026-08-21 corrected three production defects tied to the UI Gallery entry in Settings > Appearance: temporary theme preview now restores only on close or unmount rather than on intermediate OS scheme changes; deterministic preview state can target specific segmented-control and split-button subparts so hover, pressed, focus, and open fixtures no longer bleed across sibling controls; and the Appearance section no longer materializes a module-scope Unistyles style array in the gallery entry path, avoiding stale theme chrome after theme changes. Verification: `npm run test --workspace=@otto-code/app -- src/components/ui/control-state-preview.test.ts src/components/ui/ui-state-gallery-coverage.test.ts`, targeted `npm run lint -- ...`, and full `npm run typecheck` all passed."
  source: "UI Gallery hardening task on 2026-08-21"
  affects: ["interactive-state-colors-use-one-theme-accent-ladder"]
- time: "2026-08-21T17:21:30.989Z"
  kind: "evidence"
  summary: "Delivery verification completed after the bounded hardening loop. The gallery is exposed in Developer mode at Settings > Appearance > UI Gallery, includes all 13 authored light and dark theme variants, and renders shared production controls through deterministic state-preview plumbing. A recursive inventory test requires every shared `components/ui/**/*.tsx` file to be represented or explicitly exempted with a concrete reason. Final checks passed: 2 focused Vitest files / 4 tests, targeted oxlint with 0 warnings and 0 errors, full workspace `npm run typecheck`, `git diff --check`, and the production Expo web export (`npm run build --workspace=@otto-code/app`, 7,254 modules)."
  source: "Completed UI Gallery implementation and verification on 2026-08-21"
- time: "2026-08-21T17:31:46.029Z"
  kind: "evidence"
  summary: "Replaced the UI Gallery dialog's popup theme picker with an inline two-level segmented control in the sheet sub-header. The first control selects Light or Dark; the second shows only the theme variants for the selected spectrum, wrapping/stretching within the dialog instead of opening a nested overlay. Existing temporary preview and restore behavior remains unchanged. Verification: focused `ui-state-gallery-coverage.test.ts` passed (2 tests), targeted lint passed with 0 warnings/errors, full workspace typecheck passed, formatting passed, and `git diff --check` passed."
  source: "UI Gallery inline theme selector change on 2026-08-21"
  affects: ["interactive-state-colors-use-one-theme-accent-ladder"]
- time: "2026-08-21T17:36:01.001Z"
  kind: "evidence"
  summary: "Hardened gallery modal safety after the live `Open menu` dropdown could launch a nested DropdownMenu modal and freeze the dialog. Gallery StateCell fixtures are inert by default, and the dropdown, tooltip, and editable picker overlay examples are explicitly static; only self-contained controls opt into interaction. Verification: focused gallery coverage test passed (2 tests), targeted lint passed with 0 warnings/errors, full workspace typecheck passed, formatting passed, and `git diff --check` passed."
  source: "UI Gallery nested-overlay safety fix on 2026-08-21"
  affects: ["interactive-state-colors-use-one-theme-accent-ladder"]
- time: "2026-08-21T17:37:51.768Z"
  kind: "decision"
  summary: "The user clarified that the Settings UI Gallery must be visible only in development builds. The Appearance section now gates both its entry row and mounted dialog with the build-time `isDev` gate in addition to Developer interface mode."
  source: "UI Gallery development-build visibility requirement on 2026-08-21"
