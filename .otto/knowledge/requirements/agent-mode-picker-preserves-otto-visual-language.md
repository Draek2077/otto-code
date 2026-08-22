---
id: "agent-mode-picker-preserves-otto-visual-language"
kind: "requirement"
title: "Agent mode picker preserves Otto visual language"
status: "confirmed"
tags: ["app","composer","agent-controls","modes","visual-language","paseo"]
created_at: "2026-08-21T22:35:43.183Z"
updated_at: "2026-08-21T22:35:43.183Z"
---
# Agent mode picker preserves Otto visual language

<!-- compiled_truth -->

The agent mode picker preserves Otto's pre-Paseo visual contract even when its control behavior evolves: established mode names remain unchanged, the existing Material Symbols metadata drives each mode icon, and the existing theme color tiers continue to tint mode labels, icons, and the selected chip. Unknown dynamic mode metadata uses a neutral shield-question fallback rather than a robot icon.

## Timeline

- time: "2026-08-21T22:35:43.183Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T22:35:43.183Z"
  kind: "evidence"
  summary: "User requirement on 2026-08-21. Verified in `packages/protocol/src/provider-manifest.ts`, `packages/app/src/composer/agent-controls/mode-control.tsx`, and `packages/app/src/agent-controls/icons.ts`. The Paseo v0.4.0 merge introduced a Lucide-only registry missing Otto's `LocalPolice`, `PrivacyTip`, `ShieldPerson`, and `ShieldToggle` names, causing the picker to fall back to `Bot`; the registry now maps the original Material Symbols and has focused regression coverage in `packages/app/src/agent-controls/icons.test.ts`. App typecheck, targeted lint, and 14 focused mode/icon tests pass."
