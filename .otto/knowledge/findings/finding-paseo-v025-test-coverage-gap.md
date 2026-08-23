---
id: "finding-paseo-v025-test-coverage-gap"
kind: "finding"
title: "Upstream v0.2.5 test cases absent from Otto's versions of the same files"
status: "proposed"
tags: ["paseo-merge","testing","coverage","upstream","triage"]
created_at: "2026-08-23T03:15:54.199Z"
updated_at: "2026-08-23T03:15:54.199Z"
---
# Upstream v0.2.5 test cases absent from Otto's versions of the same files

<!-- compiled_truth -->

During the Paseo v0.2.5 merge, 70 test files were resolved in Otto's favour rather than upstream's, because Otto's versions cover Otto's own UI and behaviour. That resolution dropped **464 upstream test cases** that have no Otto counterpart in the same file. This page is the audit trail of exactly what was given up.

The gap is heavily concentrated in the daemon, not the client:

| Area | Missing cases |
| --- | --- |
| `packages/server/src` | 292 |
| `packages/app/src` | 106 |
| `packages/desktop/src` | 43 |
| `packages/app/e2e` | 14 |
| `packages/cli/src` | 9 |

The ten worst files account for 213 of the 464, roughly 46 percent:

- `packages/server/src/server/agent/agent-manager.test.ts` (32)
- `packages/server/src/server/session.workspaces.test.ts` (30)
- `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts` (28)
- `packages/server/src/utils/checkout-git.test.ts` (23)
- `packages/server/src/server/session.test.ts` (19)
- `packages/server/src/server/agent/providers/pi/agent.test.ts` (18)
- `packages/server/src/server/agent/mcp-server.test.ts` (17)
- `packages/server/src/services/github-service.test.ts` (14)
- `packages/server/src/server/session/checkout/checkout-session.test.ts` (13)
- `packages/app/src/runtime/host-runtime.test.ts` (13)

What this does and does not mean. A missing case is **not** automatically a coverage hole: many upstream cases assert upstream behaviour that Otto deliberately changed, so importing them verbatim would encode the wrong contract. The list is a triage queue, not a backlog of bugs. The useful read is that agent lifecycle, session and workspace handling, checkout/git plumbing, and the Codex and Pi provider adapters are where Otto is running on its own test assertions with the least upstream cross-check.

This is an unresolved observation. Nobody has walked the 464 cases to classify them as "upstream-only behaviour", "genuinely worth porting", or "already covered elsewhere in Otto under a different file". Until that pass happens, treat the concentration table as the prioritisation signal.

Related: [[paseo-v025-merge]], [[finding-2026-08-02-wholesale-ours-sizing]], [[finding-2026-07-31-deleted-file-audit]], [[finding-2026-07-25-paseo-merge-gap]], [[e2e-qa-coverage]].

## Timeline

- time: "2026-08-23T03:15:54.199Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-23T03:15:54.199Z"
  kind: "evidence"
  summary: "Migrated from `upstream-test-coverage-gap.txt`, a 467-line tab-separated file that had sat untracked-in-purpose at the repository root since the v0.2.5 merge commit `5e3cc1def`. It was removed from the root during the 2026-08-22 file-hygiene sweep because a plain-text merge note at repo root is not a documentation home. The raw file, with all 464 rows as `file<TAB>test name` pairs, remains retrievable at `git show 5e3cc1def:upstream-test-coverage-gap.txt` and in history up to `e79b3467e`.\n\nIts own header read: \"Upstream v0.2.5 test cases absent from Otto's versions of the same files. Captured during the v0.2.5 merge; ours were kept because they cover Otto's own UI.\"\n\nCounts computed 2026-08-22 from the file: 464 data rows across 70 distinct test files. Full per-file breakdown, descending:\n\npackages/server/src/server/agent/agent-manager.test.ts (32); session.workspaces.test.ts (30); agent/providers/codex-app-server-agent.test.ts (28); utils/checkout-git.test.ts (23); session.test.ts (19); agent/providers/pi/agent.test.ts (18); agent/mcp-server.test.ts (17); services/github-service.test.ts (14); session/checkout/checkout-session.test.ts (13); workspace-git-service.primitive.test.ts (9); agent/import-sessions.test.ts (9); worktree-core.posix.test.ts (7); checkout/status-projection.test.ts (7); agent/providers/claude/agent.test.ts (7); workspace-archive-service.test.ts (6); session/workspace-scripts/workspace-scripts-service.test.ts (6); agent/providers/claude/models.test.ts (6); utils/worktree.test.ts (4); workspace-registry-model.test.ts (4); workspace-registry-bootstrap.test.ts (4); daemon-config-store.test.ts (4); daemon-client.e2e.test.ts (4); wire-compat.test.ts (3); schedule/service.test.ts (3); loop-service.test.ts (3); agent/create-agent/create.test.ts (3); agent/agent-prompt.test.ts (3); auto-archive-on-merge/archive-if-safe.test.ts (2); workspace-create-worktree-source.e2e.test.ts (1); session/files/workspace-files-session.test.ts (1); daemon-e2e/open-project-worktree-reclassification.e2e.test.ts (1); cli-run-workspace-precedence.e2e.test.ts (1).\n\npackages/app: runtime/host-runtime.test.ts (13); git/pull-request-panel/data.test.ts (13); screens/new-workspace-picker-state.test.ts (9); utils/workspace-script-links.test.ts (7); screens/workspace/workspace-scripts-button.test.tsx (6); composer/actions.test.ts (6); utils/desktop-window.test.ts (5); hooks/sidebar-workspaces-view-model.test.ts (5); components/markdown/html-ish.test.ts (5); hooks/use-settings/storage.test.ts (4); git/checkout-status-cache.test.ts (4); composer/github/auto-attach.test.tsx (4); components/worktree-setup-callout-policy.test.ts (4); utils/review-attachments.test.ts (3); utils/projects.test.ts (3); utils/agent-directory-sync.test.ts (3); utils/host-routes.test.ts (2); subagents/select.test.ts (2); hooks/use-projects.test.ts (2); git/pull-request-panel/context-attachment.test.ts (2); components/browser-webview-resident.browser.test.ts (2); workspace/legacy-daemon-workspaces.test.ts (1); screens/new-workspace-picker-item.test.ts (1). E2E specs: assistant-fork-menu.spec.ts (4); workspace-multiplicity.spec.ts (2); provider-settings-refresh.spec.ts (2); project-picker-desktop.spec.ts (2); empty-project-persists.spec.ts (2); workspace-model-restart.spec.ts (1); projects-settings.spec.ts (1).\n\npackages/desktop: features/browser-webviews/window-open.test.ts (12); features/browser-webviews/registry.test.ts (12); features/browser-webviews/index.test.ts (7); daemon/quit-lifecycle.test.ts (7); window/window-manager.test.ts (2); daemon/daemon-manager.test.ts (2); daemon/desktop-packaging.test.ts (1).\n\npackages/cli: commands/agent/run.test.ts (9)."
