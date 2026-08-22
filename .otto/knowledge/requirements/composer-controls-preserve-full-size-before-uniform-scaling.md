---
id: "composer-controls-preserve-full-size-before-uniform-scaling"
kind: "requirement"
title: "Composer controls preserve full size before uniform scaling"
status: "confirmed"
tags: ["composer","responsive-layout","controls","sizing"]
created_at: "2026-08-21T22:22:32.195Z"
updated_at: "2026-08-21T23:01:02.907Z"
---
# Composer controls preserve full size before uniform scaling

<!-- compiled_truth -->

The message composer keeps all inline controls and their full intrinsic presentation while the toolbar fits. When the complete toolbar no longer fits, it scales the row uniformly as one unit; it must not hide controls, replace them with an aggregate control, or collapse labels as the first responsive step.

## Timeline

- time: "2026-08-21T22:22:32.195Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["paseo-v040-upstream-integration"]
- time: "2026-08-21T22:22:32.195Z"
  kind: "evidence"
  summary: "User decision during the Paseo v0.4.0 convergence repair on 2026-08-21: Paseo's density behavior was rejected because it removes or aggregates controls instead of scaling the complete toolbar. The implementation restores row-level intrinsic-width measurement and uniform scaling, with the agent-control density transition disabled for the composer toolbar."
- time: "2026-08-21T22:28:30.448Z"
  kind: "evidence"
  summary: "Follow-up diagnosis on 2026-08-21: the half-system came from two independent responsive layers. The chat hosts measured pane width against COMPACT_FORM_FACTOR_WIDTH (500px) and passed isCompactLayout into Composer, switching desktop panes into mobile agent-control surfaces before the toolbar scaler could act. That pane-width handoff was removed from the draft workspace tab and active agent panel. Desktop pane narrowing now remains on the desktop control branch; only the actual compact form factor selects the mobile branch."
  source: "code + user correction"
  affects: ["paseo-v040-upstream-integration"]
- time: "2026-08-21T22:34:28.572Z"
  kind: "evidence"
  summary: "The previous behavior must be restored from the old implementation's complete decision sequence, not approximated with new thresholds or newly invented collapse rules. Preserve the old control order, intrinsic/full-size phase, compact/icon-only transitions, feature-drop choice, uniform-scaling fallback, and their exact trigger conditions. Paseo convergence must not silently replace those choices."
  source: "User-confirmed behavioral constraint in composer responsive regression investigation"
  affects: ["paseo-v040-upstream-integration"]
- time: "2026-08-21T22:36:54.727Z"
  kind: "evidence"
  summary: "The old responsive contract includes a distinct whole-group compact gate: the chat host measures the composer pane with useContainerWidthBelow(COMPACT_FORM_FACTOR_WIDTH), where COMPACT_FORM_FACTOR_WIDTH is 500px, and passes isCompactLayout into Composer. Below that gate, the agent-control group switches to its icon-only/compact branch together; this is separate from the feature-specific drop threshold and separate from the outer uniform toolbar scale. Removing this host handoff was the missing transition."
  source: "Pre-Paseo composer source audit at f90e8c851"
  affects: ["paseo-v040-upstream-integration"]
- time: "2026-08-21T23:01:02.907Z"
  kind: "evidence"
  summary: "2026-08-21 responsive polish requirement: resizing must not visibly oscillate between two toolbar scales; the composer should retain its last applied scale until the current row measurements settle. On compact form factors, toolbar controls and glyphs must use the compact geometry instead of tiny desktop dimensions, and inline dropdown-like controls must use pill-shaped radii consistently. Implemented with stable toolbar measurement state, compactUp control geometry, compact glyph sizing, and full-radius toolbar triggers; targeted lint, typecheck, and composer layout tests pass."
  source: "user requirement + implementation verification"
  affects: ["paseo-v040-upstream-integration"]
