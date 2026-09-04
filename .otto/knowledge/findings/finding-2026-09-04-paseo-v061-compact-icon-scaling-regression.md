---
id: "finding-2026-09-04-paseo-v061-compact-icon-scaling-regression"
kind: "finding"
title: "Paseo v0.6.1 appearance convergence dropped compact icon scaling"
status: "proposed"
tags: ["paseo-v061","appearance","mobile","icons","regression"]
created_at: "2026-09-04T13:23:12.272Z"
updated_at: "2026-09-04T13:23:12.272Z"
---
# Paseo v0.6.1 appearance convergence dropped compact icon scaling

<!-- compiled_truth -->

The v0.6.1 appearance convergence replaced Otto's compact-aware appearance updater with `appearance/apply.ts` and `appearance/provider.tsx`, but omitted the `isCompact` input and the icon-ladder update. Tokenized icons therefore remained at their desktop size on compact form factors, while the surviving `useIconSize()` hook still returned the compact ladder, producing mixed icon sizing. Stage 1 restores only named icon token resolution: ordinary tokens use the 2× compact ladder and `chrome*` tokens retain the 1.5× compact ladder. The historic global +2pt font bump remains deliberately deferred because existing local compact `+2` styles would otherwise create mixed or doubled typography.

## Timeline

- time: "2026-09-04T13:23:12.272Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-04T13:23:12.272Z"
  kind: "evidence"
  summary: "Verified from `pre-paseo-v0.6.1-merge:packages/app/src/screens/settings/appearance/apply-appearance.ts`, which passed `isCompact` from `app/_layout.tsx`, scaled ordinary icon tokens 2× and chrome tokens 1.5×. Commit `a42956c06` introduced `packages/app/src/appearance/apply.ts` and `provider.tsx` without that path. Stage 1 restored it in `appearance/apply.ts` and `appearance/provider.tsx`; `npx vitest run packages/app/src/appearance/apply.test.ts --bail=1`, workspace typecheck, and targeted lint passed on 2026-09-04."
