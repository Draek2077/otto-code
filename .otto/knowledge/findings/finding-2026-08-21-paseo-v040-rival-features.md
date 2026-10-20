---
id: "finding-2026-08-21-paseo-v040-rival-features"
kind: "finding"
title: "Rival-feature audit: what Paseo v0.3.0 to v0.4.0 duplicates that Otto already ships"
status: "confirmed"
tags: ["upstream","paseo","v0-4-0","rival-abstraction","merge"]
created_at: "2026-08-21T13:40:04.698Z"
updated_at: "2026-08-21T13:40:04.698Z"
---
# Rival-feature audit: what Paseo v0.3.0 to v0.4.0 duplicates that Otto already ships

<!-- compiled_truth -->

A code-level head-to-head of every Paseo v0.3.0 to v0.4.0 capability against Otto's existing implementation, run before the v0.4.0 merge. The controlling result is that rival implementations sit at *different paths* on the two sides, so they never conflict, never surface in a merge diff, and ship as silent duplicates unless one is actively deleted.

**Mermaid (#2306).** Both sides ship a complete renderer: Otto `packages/app/src/components/markdown/mermaid/` (~1,229 lines), Paseo `packages/app/src/components/markdown/fence/mermaid/` (~2,000 lines). Reach is identical, since both dispatch from the Markdown fence renderer, so both cover chat, the file viewer, and Otto's pull-request panel. Paseo is ahead on interactivity (pan and zoom, 0.25x to 8x, plus fit), a per-diagram read-only source toggle rendering the fence body through `HighlightedCodeBlock`, `source-policy.ts` rejecting `@import`, `url()`, `themeCSS` and raw HTML injection, explicit streaming-prefix detection in `render-model.ts`, and a self-contained offline runtime built by `build-runtime.mjs`. Otto is ahead only on `mermaid-theme.ts`, which avoids `themeColorRef` because mermaid runs khroma color math that leaks the app theme into the scope, and on a single documented mount point. Merge mechanic: Otto's `markdown/fence.tsx` is a file, Paseo's `markdown/fence/` is a directory, which git cannot auto-resolve.

**Agent profiles (#3208, 4 commits) versus Otto personalities.** Not synonymous, and both live in the same architectural home: Paseo at `MutableDaemonConfig.agentProfiles[]`, Otto at `MutableDaemonConfig.agentPersonalities.personalities[]`. Shared fields: `id`, `name`, `provider`, `model`, `modeId`. Paseo-only: `icon`, `color`, `thinkingOptionId`, `featureValues`, `notes` (the last surfaced to orchestrators via a `list_profiles` MCP tool). Otto-only: `personalityPrompt`, `respectGlobalAppendPrompt`, `roles`, `spinner`, `voice`, `voiceCues`, `memoryEnabled`, plus `effortLevel` resolved with exact-id/level/nearest matching and an `effortDegraded` flag. Paseo's schema carries no system prompt *by design*, documented in the schema comment: `AgentSessionConfig.systemPrompt` is creation-only, so a prompt-bearing profile would apply to a new agent and silently no-op on a running one. Otto solved that problem rather than avoiding it: `agent.personality.set` re-resolves against the roster and the agent's cwd provider snapshot, applies prompt, identity and brain live, and restarts the provider query, with providers that cannot apply a prompt mid-session rejecting. Paseo's genuine advantages are `featureValues` with the `capabilities.ts` and `materialize-profile.ts` machinery that probes provider-scoped features and prunes them as provider/model/mode/thinking change (hardened by #3331), the `notes` field, and an `AgentProfileApplyTarget` abstraction whose picker exposes a flat row view model plus one `applyProfile(id)` callback against either a draft or a running agent.

**HTML preview (#2712).** The pre-merge concern that this would introduce a parallel browser stack is unfounded. Paseo's is a sandboxed `srcDoc` iframe inside the file pane for viewing agent-written HTML, orthogonal to Otto's Preview subsystem (dev servers plus browser-tools verification against the Otto browser pane). The real finding is inverted: Otto already ships `html-file-preview.{tsx,web,native}` and Otto's is the less safe of the two. Otto grants `sandbox="allow-forms allow-modals allow-popups allow-scripts"` with no CSP wrapper and no referrer policy in 26 lines. Paseo grants `allow-scripts` only, injects a CSP wrapper (`html-preview-csp.ts`), sets `referrerPolicy="no-referrer"`, analyses the residual self-navigation hole in `html-preview-navigation.ts`, and documents it in SECURITY.md. Paseo's rationale is explicit: a preview is a viewer, not a browser, and agent-written HTML is untrusted markup.

**Command Center (#2274, #2749, #3063, #3059).** Otto is behind, not divergent: 10 files against Paseo's 20, sharing the same core (`command-center.tsx`, `contributions.ts`, `provider.tsx`, `registry.ts`, `results.ts`). Otto's `model-contributions.ts` is the older upstream file that Paseo renamed and grew into `agent-control-contributions.ts`, adding reasoning, mode, plan and fast switching; that rename is why the file appears on the delete/modify hazard list. Paseo further added `root-contributions.ts` and `workspace-contributions.ts` with registration components (sidebar grouping, git and workspace actions) and `workspace-file-search.ts` with its model, which Otto lacks entirely.

**File and folder actions (#3027).** Paseo is a strict superset. Otto's menu: open file, copy path, download, add to chat, plus create/rename/delete behind `features.fileMutations`. Paseo's menu: all of those plus copy relative path, duplicate, reveal in, revert and collapse folder, backed by server operations `createExplorerEntry`, `duplicateExplorerEntry`, `renameExplorerEntry` and `deleteExplorerEntry`, and extended to the Changes pane, with 417 lines of explorer e2e and 278 lines of changes-pane e2e. Both sides independently created a file at the same path, `packages/app/src/hooks/use-file-explorer-actions.ts`.

**Pure black theme (#3012).** Not a duplicate. Otto's `blackTheme` is a Unistyles scoped key used only for `ScopedTheme name="black"` around chat panes, and adaptive mode never selects it, so Otto has no user-selectable black variant. Paseo's is additive.

Still unevaluated, deferred to head-to-heads inside the merge branch: live task progress (#3227) against `todo-task-list.tsx`, history search (#2995), the mobile terminal (#1607), orchestration skill selection (#2680), and the Markdown centered reading layout (#3240) against Otto's Text Editor canvas.

## Timeline

- time: "2026-08-21T13:40:04.698Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["paseo-v031-upstream-integration"]
- time: "2026-08-21T13:40:04.698Z"
  kind: "evidence"
  summary: "Method: read both trees at Otto `main` (0.8.12) and Paseo `b44bb63cf` (v0.4.0), comparing file inventories, line counts, protocol schemas, and capability markers. Commands of record: `git ls-tree -r --name-only b44bb63cf <path>`, `git show b44bb63cf:<file>`, `git show --stat <sha>`, and grep passes for capability keywords across both implementations. Field lists taken from `AgentProfileSchema` in Paseo `packages/protocol/src/messages.ts` (lines 146-164) and `AgentPersonalitySchema` in Otto `packages/protocol/src/personality-schemas.ts`. Sandbox attributes read directly from Otto `packages/app/src/components/html-file-preview.web.tsx` and Paseo `packages/app/src/file-pane/html-preview.web.tsx`. Rival-path invisibility confirmed by `node scripts/upstream-status.mjs --at v0.4.0`, whose watchlist reported neither mermaid nor agent profiles until the watchlist was repaired in commit 6576ab46a."
