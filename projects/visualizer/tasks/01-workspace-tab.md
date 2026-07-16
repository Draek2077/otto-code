# Task 01 — `visualizer` workspace tab kind

Add a new workspace tab kind `{ kind: "visualizer" }` (one per workspace), following the Git Log tab precedent exactly. Client-only; no protocol or daemon changes.

## Read first

- [projects/visualizer/visualizer.md](../visualizer.md) — charter, risks
- The Git Log precedent: `packages/app/src/panels/git-log-panel.tsx`, `packages/app/src/git/open-git-log-tab.ts`

## Steps

1. **Target union** — `packages/app/src/stores/workspace-tabs-store/state.ts`:
   - Add `| { kind: "visualizer" }` to `WorkspaceTabTarget` (~line 19-29). No payload fields needed — the tab is workspace-scoped; the page's own session tabs cover per-agent switching.
   - Persistence rehydration: handle the new kind in `coerceWorkspaceTabTarget()` (~line 502-534) so restored layouts survive reload.
2. **Identity fns** — `packages/app/src/workspace-tabs/identity.ts` (all four):
   - `normalizeWorkspaceTabTarget()` (~line 9): pass-through (no fields to trim).
   - `workspaceTabTargetsEqual()` (~line 77): two visualizer targets are always equal (single instance per workspace).
   - `buildDeterministicWorkspaceTabId()` (~line 144): return `"visualizer"`.
3. **Panel registration**:
   - New `packages/app/src/panels/visualizer-panel.tsx` exporting `visualizerPanelRegistration: PanelRegistration<"visualizer">` (see `packages/app/src/panels/panel-registry.ts` for the interface). Component can be a placeholder until task 02 lands; `useDescriptor` returns label **"Visualizer"** (i18n key, see below) + an icon (pick a Material Symbols graph/hub icon per docs/ui-icons.md).
   - Register in `packages/app/src/panels/register-panels.ts` (`ensurePanelsRegistered`).
   - The component reads context via `usePaneContext()` from `packages/app/src/panels/pane-context.tsx` (`{ serverId, workspaceId, tabId, target, openFileInWorkspace, ... }`).
4. **Opener** — new `packages/app/src/visualizer/open-visualizer-tab.ts` modeled on `packages/app/src/git/open-git-log-tab.ts`: `useWorkspaceLayoutStore.getState().openTabFocused(workspaceKey, { kind: "visualizer" }, { insertAfterFocusedTab: true })`.
5. **Entry point** — add a "Visualizer" action where the Git Log opener lives (workspace header/actions area). Gate visibility behind Developer interface mode if the surface is mode-gated (check `useIsDeveloperMode()` usage nearby). It's fine for the entry point to ship hidden/flagged until task 03 makes the tab useful.
6. **i18n** — add the label to `packages/app/src/i18n/resources/en.ts` (+ typed parity in other locale files; English-only wording per "build first, translate last", but the keys must exist everywhere — `packages/app/src/i18n/resources.test.ts` enforces parity).

## Rules

- No layout-store changes needed — it's kind-agnostic once target + registration exist.
- Never name anything user-facing "Agent Flow" (trademark). Internal identifiers use `visualizer`.
- Run `npm run typecheck`, `npm run lint`, `npm run format` after changes. Test file to run if you touch identity logic near existing tests: whatever covers `workspace-tabs` (search for existing `identity`/tab tests and run only those files with `npx vitest run <file> --bail=1`).
