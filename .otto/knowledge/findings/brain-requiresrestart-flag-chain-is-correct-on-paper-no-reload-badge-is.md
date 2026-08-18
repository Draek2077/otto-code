---
id: "brain-requiresrestart-flag-chain-is-correct-on-paper-no-reload-badge-is"
kind: "finding"
title: "Brain requiresRestart flag chain is correct on paper; no-Reload badge is unexplained by static tracing"
status: "proposed"
tags: ["brain", "model-settings", "requiresrestart", "sampler", "reload", "debounce"]
created_at: "2026-08-17T21:56:49.584Z"
updated_at: "2026-08-17T21:56:49.584Z"
---

# Brain requiresRestart flag chain is correct on paper; no-Reload badge is unexplained by static tracing

<!-- compiled_truth -->

For the "changing temp/top_p/top_k/min_p does not request a Reload" bug: sampler fields are launch-time llama-server CLI args (--temp/--top-p/--top-k/--min-p in runtime/args.ts), so they are genuinely NOT hot-swappable and a reload is required. The requiresRestart flag chain is correct end-to-end by static reading: (1) app debounced autosave (profile-editor.tsx, BUDGET_DEBOUNCE_MS=250) sends the full draft (minus unchanged hosting keys) via brainModelProfileSet; (2) daemon session.ts handleBrainModelProfileSetRequest forwards requiresRestart verbatim; (3) brain host-api.ts handleProfileSet computes requiresRestart = deps.supervisor.model?.id === model.id and sets store.pendingReloadModelIds[model.id]=true, returning it; (4) app onRequiresRestartChange(result.requiresRestart) sets local state; (5) LoadUnloadButton shows "Reload" when isLoaded && requiresRestart. pendingReloadModelIds is persisted in the store (schema.ts:188) and cleared ONLY at serve.ts:651 (after a successful supervisor.start) and serve.ts:993 (service start) — NOT by any status poll, so the previous agent's "concurrent poll clears it" hypothesis is dead. There is NO test coverage for requiresRestart in host-api.test.ts (grep returns nothing), which is consistent with the bug slipping through. The break is not found by static tracing; it requires either a live reproduction or adding the missing unit test to pin the residency comparison (deps.supervisor.model?.id === model.id).

## Timeline

- time: "2026-08-17T21:56:49.584Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-settings-preserve-reasoning"]
- time: "2026-08-17T21:56:49.584Z"
  kind: "evidence"
  summary: "Traced: packages/app/src/screens/brain/profile-editor.tsx (autosave effect + hostingKeysWhenChanged), packages/server/src/server/session.ts:4978-5010 (handleBrainModelProfileSetRequest), packages/brain/src/service/host-api.ts:643-720 (handleProfileGet/handleProfileSet), packages/brain/src/service/serve.ts:567/651/895/993 (store load + clear sites), packages/brain/src/service/supervisor.ts:185-190 (this.model=model in start()), packages/brain/src/config/store.ts (loadProfilesStore/saveProfilesStore), packages/brain/src/config/profile-edit.ts (SAMPLING_RANGES + descriptors, all available:true), packages/brain/src/runtime/args.ts (CLI arg emission). Prior session export fc2dabc2 (read-only, 37 tool calls, 0 edits) confirms the investigation was cut at the \"concurrent poll\" hypothesis."
