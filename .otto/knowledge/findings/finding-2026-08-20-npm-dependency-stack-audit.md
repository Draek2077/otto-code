---
id: "finding-2026-08-20-npm-dependency-stack-audit"
kind: "finding"
title: "npm dependency stack audit: Expo 54 dominates production audit debt"
status: "proposed"
tags: ["npm","dependencies","security","expo","electron","maintenance"]
created_at: "2026-08-20T07:04:48.336Z"
updated_at: "2026-08-20T07:04:48.336Z"
---
# npm dependency stack audit: Expo 54 dominates production audit debt

<!-- compiled_truth -->

A 2026-08-20 npm dependency-stack audit found that install deprecation warnings do not prove an Otto memory leak: the sole `inflight@1.0.6` leak warning is entirely transitive through Expo/React Native development and generation, Electron packaging, test, or optional EAS tooling. `npm audit --omit=dev` nevertheless reports 45 package-level findings (18 high, 22 moderate, 5 low), primarily driven by the Expo SDK 54 / Metro toolchain; the available broad remediation is a planned major Expo 57 upgrade. Independently actionable maintenance items are Electron Builder 26.15.3, Electron Updater 6.8.9, server Express/UUID updates, and Cloudflare Vite/Wrangler alignment. `npm audit fix --force` is unsuitable because it proposes major transitions and an invalid EAS downgrade.

## Timeline

- time: "2026-08-20T07:04:48.336Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-20T07:04:48.336Z"
  kind: "evidence"
  summary: "Measured in the shared checkout on 2026-08-20 with Node 24.17.0 / npm 11.13.0. Commands: `npm audit --json`, `npm audit --omit=dev --json`, `npm outdated --workspaces --include-workspace-root --json`, `npm explain`, and package-lock v3 parent inspection. Full transient report: `.tmp/npm-stack-audit-2026-08-20.md`. User report initiated the audit after npm install warnings."
