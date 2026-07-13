# Interface modes — User & Developer

**Status:** Charter — not yet started. Drafted 2026-07-11. **Absorbed into the [first-time wizard](first-time-wizard.md) project on 2026-07-12:** the first-run picker described below ships as **wizard step 1** (Mode is chosen first, ahead of Providers — the standalone `choose-interface` route is superseded), and this plan's build phases are executed as first-time-wizard Phases 1 (plumbing) and 5 (surface gating). **Phase 1 storage layer landed 2026-07-12** — see the first-time-wizard build sequence. Everything else here — the binding constraints, surface inventory, gate architecture — remains the authoritative spec.

Give Otto two display depths, chosen on first launch and switchable anytime: **Developer** (everything Otto is today — git, diffs, files, search, terminals, full technical detail) and **User** (the same AI platform — projects, workspaces, chat, personalities, artifacts, schedules, voice — with the developer machinery hidden and a friendlier, less technical presentation). One product, two lenses.

**Naming (glossary-critical):** the glossary already reserves **Mode** for provider operational modes (plan / default / full-access). This feature is the **Interface mode** — that exact two-word label in all UI copy, settings, and code comments; never bare "mode". Values are **User** and **Developer**. Code: `interfaceMode: "user" | "developer"`. Add a glossary entry when Phase 1 lands. Forbidden: "Simple mode", "Basic mode", "Pro mode", "UI depth".

---

## The UX north star

1. **First launch, once ever (per device):** after the app connects to a host and before the open-project screen, a full-screen picker asks how you want to use Otto — **User** ("Chat with AI agents, organize projects, get things done — without the technical details") or **Developer** ("The full development environment: git, terminals, files, diffs"). One tap, never asked again on that device.
2. **Switch anytime:** Settings → General has an **Interface mode** segmented control (User / Developer), and the sidebar display-preferences menu carries a quick toggle. Switching is instant — no restart, no data loss, no closed agents.
3. **In User mode** the workspace is chat-first: agent tabs, the composer, personalities, artifacts, and the browser pane. No tab-strip terminal/preview catalog, no git buttons, no diff badges, no file tabs, no keyboard shortcuts into hidden surfaces. Copy leans plain-language. **Exception (shipped 2026-07-13):** the explorer sidebar returns as a **Files-only** browser — useful for non-coding project types too. Changes / Search / PR stay hidden (Search may return later as a simpler variant); the toggle is the plain Explore icon with no diff badge, and `sidebar.open.files` stays live while the other explorer shortcuts remain gated.
4. **In Developer mode** the app is byte-identical to today. A developer who never touches the picker (chooses Developer) must see zero difference from the current product.
5. **Switching back to Developer restores everything** — terminals still running, file tabs still open, pins still pinned. User mode hides; it never destroys.

---

## Binding constraints (review-rejection criteria, not aspirations)

### 1. A lens, not a lock

Interface mode is **presentation only**. It changes what the client renders — never what the daemon does, what agents can do, or what rides the wire. Agents in User mode still run git, terminals, and file edits through their own tools; the user just doesn't get IDE panes for them. Concretely:

- **Zero protocol changes.** No new fields, no new RPCs, no `features.*` flag. The daemon never learns the client's interface mode.
- **Zero daemon changes.** `rg -i interfacemode packages/server packages/protocol packages/cli` returns nothing, ever.
- **No capability gating.** Tool availability, permission flows, MCP, personalities, schedules — all identical in both modes.
- **State survives the switch.** Workspace-owned state (tabs, terminals, panes, explorer memory, pins, review drafts) is never mutated by a mode switch. User mode filters what renders; the stores keep everything. Switch to Developer and it's all still there, including terminals that kept running.

### 2. One gate, enumerated touchpoints

One hook — `useInterfaceMode()` / `useIsDeveloperMode()` in `packages/app/src/hooks/use-interface-mode.ts`, a thin selector over the settings store (mirroring `useIsCompactFormFactor()`) — and gating applied only at the surface list in this charter. No `interfaceMode` reads scattered through leaf components; if a leaf needs to know, the gate belongs at its mount site instead. Grep is the test: every consumer of the hook maps to a row in the surface inventory below, and any new import outside it is a defect.

### 3. Developer mode is today's app, exactly

Every gate must be shaped `isDeveloperMode ? <today's render> : <user render>` with the developer branch untouched. No shared-component "simplification" that also changes Developer mode. E2E specs run in Developer mode unchanged.

### 4. Safety surfaces never hide

Permission request cards, the Stop button, error banners, destructive-action confirmations, and the personality-switch warning all render identically in User mode. Hiding the permission **mode control chip** (a technical selector) is allowed; hiding a permission **prompt** (a consent gate) is not.

### 5. Device-local, per-person

The mode is a per-device client preference in `AppSettings` (AsyncStorage) — you can run Developer on the desktop and User on your phone against the same host. It is never synced to the daemon, never per-workspace, never per-host.

---

## What already exists (the rails we reuse)

| Capability                                             | Where                                                                                                                                                                  | Reuse                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Device-local typed settings with validation + defaults | `AppSettings` in [storage.ts](../../packages/app/src/hooks/use-settings/storage.ts) — AsyncStorage `@otto:app-settings`, `pick*` validators, `DEFAULT_CLIENT_SETTINGS` | `interfaceMode` field + `VALID_INTERFACE_MODES` set; absent ⇒ unchosen                  |
| Reactive read with narrow re-renders                   | `useSettings(selector)` / `useAppSettings()` ([use-settings/index.ts](../../packages/app/src/hooks/use-settings/index.ts)); imperative `persistAppSettings()`          | `useInterfaceMode()` wraps a selector; picker screen writes via `persistAppSettings`    |
| Cross-tree boolean gate pattern                        | `useIsCompactFormFactor()` (`constants/layout.ts`), `focusModeEnabled` (`stores/panel-store`), `workspaceToolsPlacement` / `hidePinnedToolbarOptions` (settings)       | `useIsDeveloperMode()` follows the same idiom                                           |
| A mode flag already hiding a whole dev surface         | `shouldShowWorkspaceExplorerSidebar({ isFocusModeEnabled, … })` in [workspace-screen.tsx](../../packages/app/src/screens/workspace/workspace-screen.tsx) (~L1732)      | Add `isDeveloperMode` to the same predicate                                             |
| Explorer tab downgrade when a tab is unavailable       | `resolveActiveExplorerTab` in [explorer-sidebar.tsx](../../packages/app/src/components/explorer-sidebar.tsx) (search→files when unsupported)                           | Same coercion machinery if User mode ever shows a reduced sidebar                       |
| Startup routing as a pure, tested resolver             | `resolveStartupRoute` in `navigation/host-runtime-bootstrap.ts`; protected routes in [app/\_layout.tsx](../../packages/app/src/app/_layout.tsx)                        | First-run picker is a new protected route the resolver gates on `interfaceMode == null` |
| Settings UI rows                                       | `GeneralSection` in [settings-screen.tsx](../../packages/app/src/screens/settings-screen.tsx) — `SegmentedControl` rows like `sendBehavior`                            | Interface mode row, copied verbatim from that shape                                     |
| Chat detail reduction already built                    | `hideChatMessageDetails`, `groupConsecutiveActions` settings; action grouping in `agent-stream/`                                                                       | User mode composes these as forced defaults instead of inventing new stream rendering   |
| Keyboard action registry                               | `keyboard/keyboard-shortcuts.ts` (`sidebar.open.search`, `workspace.terminal.new`, `workspace.pane.split.*`)                                                           | Gate action execution centrally, not per-listener                                       |
| Pin defaults                                           | `DEFAULT_PINNED_TARGETS = [preview, terminal]` in [workspace-pins/store.ts](../../packages/app/src/workspace-pins/store.ts)                                            | User mode suppresses rendering of dev pins (store untouched)                            |

**What does NOT exist:** any persisted "onboarding completed" flag (completion is inferred from host presence today — the nullable `interfaceMode` becomes the first one); any precedent for a client-preference gate this broad (focus mode is the nearest, much smaller, cousin).

---

## Surface inventory — what User mode hides

The complete gating list. Each row is a touchpoint under binding constraint 2. "Hide" always means _don't render_; underlying stores and daemon state are untouched (constraint 1).

### Hidden outright

| Surface                                                                                                                                                                                                                 | Where                                                                                                                                                                        | Gate                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explorer sidebar — Changes / Search / PR tabs only (**Files returns in User mode**, shipped 2026-07-13)                                                                                                                 | `components/explorer-sidebar.tsx`, `compact-explorer-sidebar-host.tsx`, mounted in `workspace-screen.tsx` (`showExplorerSidebar`)                                            | The sidebar shows in both modes; `ExplorerSidebarContent` filters tabDefs to Files-only when `!isDeveloperMode` (`resolveActiveExplorerTab` coerces). User-mode toggle is the plain `PlainExplorerToggle` (no `DiffStat`, no `GitCheckoutExplorerToggle`). Source-control buttons + diff badge stay dev-only |
| Tab-strip dev catalog: New terminal, terminal profiles, Edit terminal profiles, Preview, Split right/down                                                                                                               | `workspace-desktop-tabs-row.tsx` catalog ▾ menu (`WorkspaceToolsCatalogMenuItems`)                                                                                           | Filter catalog items; keep New agent, Add artifact, New browser (see open decision 3)                                                                                                                                                                                                                        |
| Pinned tool strip (preview/terminal defaults + pinnable changes toolbar)                                                                                                                                                | `workspace-pins/` (`pinned-targets-row.tsx`), `git/changes-toolbar/`                                                                                                         | Don't render the row in User mode; pin store untouched                                                                                                                                                                                                                                                       |
| Terminal tabs                                                                                                                                                                                                           | `panels/terminal-panel.tsx`, tab kind `terminal`                                                                                                                             | Tab-strip filters dev-kind tabs from rendering (see "Existing tabs" below)                                                                                                                                                                                                                                   |
| File tabs, editor, file-view-mode bar                                                                                                                                                                                   | `panels/file-panel.tsx`, `components/file-tab-pane.tsx`, `file-view-mode-bar.tsx`, `editor/`                                                                                 | Same tab-kind filter; `workspace/file-open.ts` paths no-op to a toast ("Files are hidden in User interface mode")                                                                                                                                                                                            |
| Git actions (commit/pull/push), branch switcher                                                                                                                                                                         | `git/workspace-actions.tsx`, `git/actions-split-button.tsx`, `components/branch-switcher.tsx`, sidebar relocation in `sidebar-active-workspace-tools.tsx`                    | Gate at both placements (`workspaceToolsPlacement` header and sidebar)                                                                                                                                                                                                                                       |
| Diff viewer, review surface, PR panel                                                                                                                                                                                   | `git/diff-pane.tsx`, `review/surface.tsx`, `git/pull-request-panel/`                                                                                                         | Unreachable once the explorer sidebar and git buttons are gated; add a mount-site guard anyway so deep links can't resurrect them                                                                                                                                                                            |
| Scripts button                                                                                                                                                                                                          | `screens/workspace/workspace-scripts-button.tsx`                                                                                                                             | Hide (runs commands in terminals)                                                                                                                                                                                                                                                                            |
| Dev keyboard shortcuts: `sidebar.open.{search,changes}`, `workspace.terminal.new`, `workspace.pane.split.*` (`sidebar.open.files` now stays live in User mode)                                                          | `keyboard/keyboard-shortcuts.ts`                                                                                                                                             | Gate at action dispatch (one place), not per-binding; shortcuts screen greys them out                                                                                                                                                                                                                        |
| Git-providers settings card                                                                                                                                                                                             | `screens/settings/git-providers-settings-cards.tsx`                                                                                                                          | Hide the card (host config for a hidden feature family)                                                                                                                                                                                                                                                      |
| Per-tab dev context-menu items (copy agent id, copy resume command, copy file path, reload agent)                                                                                                                       | `workspace-desktop-tabs-row.tsx` tab context menu                                                                                                                            | Filter items                                                                                                                                                                                                                                                                                                 |
| Sidebar git details — project-row diff counts, workspace hover-card branch + diff, "Copy branch name" (shipped 2026-07-13)                                                                                              | `sidebar-workspace-list.tsx` (`ProjectHeaderRow` diffStat null in User mode; `canCopyBranchName` gated), `workspace-hover-card.tsx` (branch + diff rows gated; PR hint kept) | Gate on `useIsDeveloperMode()` at each mount site                                                                                                                                                                                                                                                            |
| Interface-mode quick toggle **removed** from the sidebar display-preferences menu (2026-07-13) — it's an app-wide preference, lives only in Settings → General now                                                      | `sidebar/sidebar-display-preferences-menu.tsx`                                                                                                                               | Deleted the Interface mode section; charter's "sidebar quick toggle" decision reversed                                                                                                                                                                                                                       |
| Project settings — the whole `otto.json` config form: Worktree lifecycle hooks, Scripts, Metadata-generation prompts (branch name / commit message / PR), Save button, stale/write-failed callouts (shipped 2026-07-13) | `screens/project-settings-screen.tsx` (`ProjectConfigForm`)                                                                                                                  | `ProjectConfigForm` wraps its whole return in `isDeveloperMode ? <>...</> : null`; header (project name/icon, host picker) stays in both modes — `otto.json` untouched, only the editor UI is hidden                                                                                                         |

### Simplified, not hidden

| Surface                        | Today                                                                                                                                                                          | User mode                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer agent controls        | Provider selector, model selector, effort, permission-mode chip, feature chips ([composer/agent-controls/index.tsx](../../packages/app/src/composer/agent-controls/index.tsx)) | Personality-first: the personality picker is the primary (or only) control; provider/model/effort/mode collapse behind it or disappear (open decision 1). Personalities are already "the ergonomic 'who does the work' pick" — User mode makes them the _whole_ pick |
| Agent stream technical detail  | Tool calls, action groups, compaction markers, turn footers (`agent-stream/view.tsx`)                                                                                          | Force-compose existing reducers: `hideChatMessageDetails` + `groupConsecutiveActions` semantics on by default; friendly action summaries stay, raw payloads stay one tap away (never lie about what the agent did)                                                   |
| New workspace / new agent flow | Isolation control (Local / New worktree), provider+model form                                                                                                                  | Isolation hidden (default per open decision 5); personality-led creation                                                                                                                                                                                             |
| Open-project screen            | Filesystem-flavored project list                                                                                                                                               | Same screen, friendlier framing/copy (Phase 3 design pass)                                                                                                                                                                                                           |

### Kept as-is in User mode

Chat + composer (input, attachments, voice, queue track, subagents track), personalities (including the running-agent personality switch and its warning dialog), **browser tabs and artifacts** (they're the user-facing _proof_ surfaces — an agent showing its work in a browser pane is exactly what User mode is for), sessions / schedules / artifacts screens, left sidebar with projects & workspaces, host management and pairing, permission prompts and Stop (constraint 4), settings (minus dev-only cards), split-pane _rendering_ (existing splits still render; creating new splits is hidden).

### Existing dev tabs when switching to User mode

Policy (locked, per constraint 1): the tab strip **filters** dev-kind tabs (`terminal`, `file`) from rendering, and if the focused tab is filtered, focus moves to the nearest surviving tab. Nothing is closed: `workspace-tabs-store` / `workspace-layout-store` state is untouched, terminals keep running (a terminal is daemon-side; hiding its pane kills nothing). Switching back restores the strip exactly. A workspace that ends up with zero visible tabs falls back to its draft/new-agent surface.

---

## Architecture

### The setting

`packages/app/src/hooks/use-settings/storage.ts`:

- `export type InterfaceMode = "user" | "developer"`
- `AppSettings.interfaceMode: InterfaceMode | null` — `null` = not yet chosen (drives the first-run picker). Default `null` in `DEFAULT_CLIENT_SETTINGS`.
- Validate via a `VALID_INTERFACE_MODES` set inside the `pick*` chain — an unvalidated enum is silently dropped on reload.
- Written via `useAppSettings().updateSettings` (settings row) and `persistAppSettings` (picker screen). If it's ever routed through `useSettings().updateSettings`, add it to that function's per-field allowlist in `use-settings/index.ts` (~L159).

### The gate

`packages/app/src/hooks/use-interface-mode.ts`:

- `useInterfaceMode(): InterfaceMode` — resolves `null` → `"developer"` so an undecided/legacy device behaves exactly like today (constraint 3; existing users must not wake up in User mode).
- `useIsDeveloperMode(): boolean` — the form 90% of call sites want.
- Non-React consumers (keyboard dispatch, file-open paths) read the same settings query cache imperatively — no second source of truth.

### First-run picker

- New protected route `app/choose-interface.tsx` registered in `RootStack`'s `<Stack.Protected>` (register in the layout that directly owns it — see [docs/expo-router.md](../../docs/expo-router.md); helpers live in `src/navigation`, never `src/app`).
- Extend the pure `resolveStartupRoute` in `navigation/host-runtime-bootstrap.ts`: when a host is ready and `interfaceMode == null`, route to `/choose-interface` before `/open-project`. Pure-function tests alongside the existing resolver tests.
- The picker writes `persistAppSettings({ interfaceMode })` then `router.replace(buildOpenProjectRoute())`. Two large cards, plain copy, no "you can change this later" anxiety — but the footnote says exactly where to change it.
- Sequencing: picker comes **after** welcome/pairing (a device with no host has nothing to show in either mode) and only fires once per device.

### Switch points

- Settings → General: `SegmentedControl` row "Interface mode" (User / Developer), the `sendBehavior` row copied verbatim.
- Sidebar `SidebarDisplayPreferencesMenu`: quick toggle entry.
- Switching is a settings write; every gate is reactive through the selector, so the UI reflows in place with no navigation reset.

### i18n

New keys (picker screen, settings row, hidden-feature toasts, glossary-consistent labels) go to **all eight** locale files — `resources.test.ts` enforces key parity. Per repo convention: build English-first, translate before merge (parity is type-enforced, so the translations land in the same PR).

---

## Build sequence

Each phase lands typecheck/lint/format green with its unit tests, independently shippable. Every phase re-verifies: (a) `rg -i interfacemode packages/server packages/protocol packages/cli` is empty; (b) in Developer mode the app renders identically to `main` (E2E suite green unchanged); (c) every `useInterfaceMode` / `useIsDeveloperMode` import maps to a surface-inventory row.

### Phase 1 — plumbing + picker (no gating yet)

1. `interfaceMode` field: type, default `null`, validator, storage tests (`use-settings/storage.test.ts` has the pattern).
2. `use-interface-mode.ts` hook pair with the `null → developer` resolution.
3. `choose-interface` route + `resolveStartupRoute` extension + pure resolver tests.
4. Settings → General row + sidebar quick toggle.
5. i18n keys across all eight locales; glossary entry ("Interface mode" + the Mode disambiguation).
6. **Acceptance:** fresh install (cleared AsyncStorage) → pair → picker → choice persists across restart; existing device with settings already present never sees the picker and stays in Developer behavior; switching in Settings flips the value live.

### Phase 2 — User mode hides developer surfaces

Work through the surface inventory top to bottom: explorer sidebar + toggle + diff badge; tab-strip catalog + pins + tab-kind filter + focus fallback; git actions both placements; keyboard dispatch gate; scripts button; settings cards; context-menu items; file-open toast.

- Tab-filtering logic and the focus-fallback rule land as pure functions with unit tests (the tab model already has test files to extend).
- **Acceptance:** in User mode, a workspace with running terminals and open file tabs shows only agent/browser/artifact tabs; `Ctrl+Shift+T` and `Cmd+S`-sidebar shortcuts do nothing; no git affordance is visible anywhere; switch to Developer → every hidden tab and pane is back, terminals never died. In Developer mode, E2E suite passes unchanged.

### Phase 3 — the friendly half (design-led)

Hiding is not the product; this phase is. Candidates, each its own product/design decision before code:

1. **Personality-first composer** — resolve open decision 1, then reshape the User-mode agent controls.
2. **Chat stream defaults** — force-compose `hideChatMessageDetails` + action grouping in User mode; audit action summary copy for plain language ("Edited 3 files" not tool names).
3. **Open-project / home framing** — friendlier copy and visual hierarchy on `open-project-screen.tsx`; possibly a User-mode home that leads with "start a conversation" over filesystem paths.
4. **New-agent flow** — personality-led creation; isolation control resolved per open decision 5.
5. **Plain-language sweep** — error toasts, empty states, and settings copy that leak git/terminal jargon into User mode.

Each candidate ships separately behind the (already-shipped) gate. **Acceptance:** a non-developer can pair a host, open a project, pick a personality, run an agent, watch it work, and view its artifact/browser output without encountering one filesystem path, git term, or model identifier they didn't ask for.

### Phase 4 — polish + fold-in

E2E specs for the User-mode journey (picker → chat → switch → restore); docs fold-in (below); revisit deferred items.

---

## Open decisions

1. **Composer depth in User mode** — personality-only (provider/model/effort fully hidden; a personality is mandatory), or personality-first with an "advanced" disclosure keeping the model selector reachable? Proposal: personality-first **with** disclosure — hiding model choice entirely fights the multi-provider soul of the product; needs a call before Phase 3.1.
2. **Permission-mode chip in User mode** — hide (it's the most technical composer chip) or keep (it's safety-adjacent)? Proposal: hide the chip, personalities carry the mode; prompts always show regardless (constraint 4).
3. **New browser tab in User mode** — keep in the catalog (browsing is not a developer act) or agent-opened only? Proposal: keep.
4. **Per-workspace escape hatch** — "show developer tools for this workspace once"? Proposal: no; the global toggle is two taps away. Revisit only if users ask.
5. **Isolation control in User mode** — hidden, but defaulting to what? Proposal: keep the existing remembered-preference default (`FormPreferences.isolation`) untouched; a User-mode device that never saw the control just uses the default (local checkout for the main workspace flow).
6. **First-run picker default focus** — which card is visually primary? Pure product/marketing call; charter has no opinion.

## Deferred (explicitly out of v1)

A third depth tier ("Advanced"?); per-host or synced mode; role-based restrictions (User mode as an _enforced_ lock for shared devices — that's a security feature, a different project with daemon involvement); User-mode-specific navigation redesign beyond copy/hierarchy (no new information architecture in v1); hiding the CLI/daemon concepts from settings entirely.

## Docs fold-in (when this ships)

Add "Interface mode", "User", "Developer" to [docs/glossary.md](../../docs/glossary.md) (with the Mode disambiguation); fold the gate pattern and surface-inventory rationale into [docs/architecture.md](../../docs/architecture.md) or a new `docs/interface-modes.md`; add the CLAUDE.md docs-table row; update [docs/product.md](../../docs/product.md)'s target-user section; then delete this folder.
