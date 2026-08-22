---
id: "contextual-shortcut-discovery"
kind: "requirement"
title: "Contextual shortcut discovery reveals currently available commands"
status: "confirmed"
tags: ["keyboard","shortcuts","discoverability","focus","ux"]
created_at: "2026-08-14T00:44:23.691Z"
updated_at: "2026-08-22T19:19:27.305Z"
---
# Contextual shortcut discovery reveals currently available commands

<!-- compiled_truth -->

Holding any shortcut modifier reveals contextually available keyboard commands.

- Shortcut overlays are a persisted device-local preference: **Off** renders none; **Workspaces** preserves only the original workspace-index badges; **On-Screen** renders only visible revealer badges; **Full** combines workspace badges and on-screen revealers with the centered unanchored-command fallback.
- The discovery set is derived from the same effective binding registry and focus-scope precedence that resolves key events. User overrides, runtime platform, command-center state, and focused editor/terminal/input scope apply before a shortcut is shown.
- Holding Ctrl/Cmd, Alt, or Shift reveals the matching bindings’ remaining keys. Additional held modifiers narrow the set and disappear from the displayed remaining key, for example Ctrl → `Shift+P`, then Ctrl+Shift → `P`; Shift alone reveals `Shift+Tab` as `Tab`.
- Every on-screen shortcut, including workspace rows, anchored revealers, and centered fallback commands, uses the same bordered workspace shortcut-badge visual treatment. Tooltip keycaps remain only for hover tooltip content.
- Workspace index navigation remains anchored to workspace rows. Other unanchored commands currently appear in a centered, non-interactive command sheet.
- The implementation is web/Electron only; native/mobile does not show shortcut discovery.
- The remaining rollout is to register visible revealers for buttons, tabs, and page-specific controls, and to include any keyboard affordances that are intentionally outside the rebindable registry.

This requirement is confirmed. The first vertical slice is built; broad UI anchoring remains future work.

## Timeline

- time: "2026-08-14T00:44:23.691Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T00:44:23.691Z"
  kind: "evidence"
  summary: "User request, 2026-08-13. Repository inspection: packages/app/src/keyboard/keyboard-shortcuts.ts has a focus-aware, override-aware effective binding registry; packages/app/src/hooks/use-keyboard-shortcuts.ts and stores/keyboard-shortcuts-store.ts already track a held modifier and reveal workspace-only badges after 150ms; packages/app/src/components/workspace-shortcut-targets-subscriber.tsx supplies the existing workspace targets."
- time: "2026-08-14T00:46:09.388Z"
  kind: "note"
  summary: "User explicitly agreed to begin implementation on 2026-08-13. New status: confirmed."
- time: "2026-08-14T00:54:12.265Z"
  kind: "decision"
  summary: "The user approved the requirement and the initial vertical slice is implemented and verified on 2026-08-13."
- time: "2026-08-14T00:54:17.942Z"
  kind: "evidence"
  summary: "Initial vertical slice implemented in `packages/app`: `buildShortcutDiscoveryEntries` resolves effective bindings using existing focus precedence; the keyboard store tracks held Alt/Ctrl/Meta/Shift prefixes after the established 150 ms reveal delay; workspace badges now consume that generic state only when their actual modifier is held; `ShortcutDiscoveryOverlay` presents unanchored commands at the view center. Focused unit tests passed (103 tests across `keyboard-shortcuts.test.ts` and `keyboard-shortcuts-store.test.ts`); app typecheck and targeted lint/format passed."
  source: "Implementation and targeted verification, 2026-08-13"
  affects: ["contextual-shortcut-discovery"]
- time: "2026-08-14T01:33:50.744Z"
  kind: "evidence"
  summary: "The initial anchored-control rollout adds `ShortcutDiscoveryProvider` / `ShortcutDiscoveryHint`. Anchored commands are removed from the centered fallback while their remaining-key badge is rendered over the actual trigger. The first anchors are Add project and Command Center in `left-sidebar.tsx`, and the pinned Split right / Split down controls in `workspace-desktop-tabs-row.tsx`. The provider registration uses stable anchor callbacks so mounted hints do not churn registrations. Focused unit tests (103), app typecheck, targeted lint, and formatting passed."
  source: "Anchored-control rollout, 2026-08-13"
  affects: ["contextual-shortcut-discovery"]
- time: "2026-08-14T01:58:52.155Z"
  kind: "evidence"
  summary: "Implemented focused workspace-tab anchors for `workspace.tab.navigate.index`: only the focused pane’s first nine tabs render a concrete numeric hint. The generic `1-9` registry placeholder is replaced at the trigger, and the web path progressively reveals `Shift+1–9` after Alt, then the final digit after Shift. Verified with targeted Vitest (104 tests), app lint, and app typecheck."
  source: "implementation"
- time: "2026-08-14T02:10:31.121Z"
  kind: "evidence"
  summary: "Expanded anchored rollout to focused-tab close controls and pinned workspace draft/terminal launchers. Added an `enabled` contract to `ShortcutDiscoveryHint`: a trigger hidden by the hover-revealed toolbar no longer registers as an anchor, so its shortcut correctly returns to the centered fallback. Verified with app lint, app typecheck, and the focused 104-test shortcut suite."
  source: "implementation"
- time: "2026-08-14T02:13:11.768Z"
  kind: "evidence"
  summary: "Expanded discovery to file-editor controls: the shared icon-toolbar component now accepts a registered shortcut action, with Save and Find opt-in; the Markdown toolbar maps its shortcut-backed formatting commands (bold, italic, code, strikethrough, link, lists, task list, blockquote) to their own visible buttons. Verified with app lint, app typecheck, and the focused 104-test shortcut suite."
  source: "implementation"
- time: "2026-08-14T02:29:52.516Z"
  kind: "evidence"
  summary: "Made the centered discovery fallback bounded and vertically scrollable in dense contexts while retaining non-blocking surrounding UI. Anchored Files, Search, and Changes to their explorer-tab revealers, with anchors disabled while the sidebar is closing/closed so the centered fallback remains truthful. Verified with app lint, app typecheck, and the focused 104-test shortcut suite."
  source: "implementation"
- time: "2026-08-14T02:48:44.527Z"
  kind: "evidence"
  summary: "Extended the contextual discovery rollout to the concrete left and right sidebar toggle revealers. The shared HeaderToggleButton now opts into a registered action and positions the hint over its icon; SidebarMenuToggle maps to sidebar.toggle.left and every workspace Explorer header variant maps to sidebar.toggle.right. Hints expose stable test IDs, while a new Playwright interaction spec remains deferred because its required coverage-matrix entry is in the repository's read-only legacy projects/ tree. Targeted formatting, lint, app typecheck, and 104 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-components-headers-header-toggle-button-tsx","packages-app-src-components-headers-menu-header-tsx","packages-app-src-screens-workspace-workspace-screen-tsx","packages-app-src-components-shortcut-discovery-overlay-tsx"]
- time: "2026-08-14T02:50:14.143Z"
  kind: "evidence"
  summary: "Verified that the Workspaces folder-plus control opens the same project picker as agent.new (the existing tooltip already exposed this shortcut); it now registers as that action's revealer. Formatting, targeted lint, and scoped diff checking passed. A subsequent app typecheck attempt was blocked only by an unrelated untracked Zoom settings file whose union-narrowing error is at zoom-team-chat-section.tsx:142; the prior app typecheck for the shared sidebar-toggle rollout was green."
  source: "implementation"
  affects: ["packages-app-src-components-left-sidebar-tsx"]
- time: "2026-08-14T02:55:43.139Z"
  kind: "evidence"
  summary: "Discovery anchors now support optional binding-ID narrowing for controls served by a shared dispatcher action, so an anchored control only removes its own available binding from the centered fallback. The composer Voice Mode control uses that mechanism to reveal Ctrl/Cmd+Shift+D without hiding Mode Cycle or other message-input actions. Targeted format/lint, app typecheck, and the 104 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-components-shortcut-discovery-overlay-tsx","packages-app-src-composer-index-tsx"]
- time: "2026-08-14T02:56:56.584Z"
  kind: "evidence"
  summary: "Added regression coverage for the exact focused Voice Mode binding: with Ctrl/Cmd held discovery displays Shift+D, and after Shift it displays D. The focused shortcut/store suite now passes 105 tests; targeted format/lint, app typecheck, and scoped diff checking also pass."
  source: "implementation"
  affects: ["packages-app-src-keyboard-keyboard-shortcuts-test-ts"]
- time: "2026-08-14T03:00:51.740Z"
  kind: "evidence"
  summary: "The composer microphone button now reveals the exact dictation binding (Ctrl/Cmd+D) whenever it controls dictation; live voice mute remains unanchored because it is Space-only and outside modifier-first discovery. Regression coverage confirms Dictation and Voice Mode's shared message-input dispatcher bindings coexist distinctly. Targeted format/lint, app typecheck, scoped diff checking, and 106 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-composer-input-input-tsx","packages-app-src-keyboard-keyboard-shortcuts-test-ts"]
- time: "2026-08-14T03:01:52.164Z"
  kind: "evidence"
  summary: "The existing inactive-composer Focus Input instruction now swaps to the contextual discovery badge while Ctrl/Cmd is held, revealing only Ctrl/Cmd+L and avoiding duplicate prose. Added binding coverage. Targeted format/lint, app typecheck, scoped diff checking, and 107 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-composer-input-input-tsx","packages-app-src-keyboard-keyboard-shortcuts-test-ts"]
- time: "2026-08-14T03:03:36.521Z"
  kind: "evidence"
  summary: "The New Workspace project picker now anchors workspace.project.pick (Ctrl/Cmd+P) on its visible selected-project trigger, only while that trigger is enabled. Added discovery regression coverage. Targeted format/lint, app typecheck, scoped diff checking, and 108 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-screens-new-workspace-screen-tsx","packages-app-src-keyboard-keyboard-shortcuts-test-ts"]
- time: "2026-08-14T03:04:58.145Z"
  kind: "evidence"
  summary: "The Open Project home tile now anchors agent.new (Ctrl/Cmd+O), complementing the existing sidebar folder-plus revealer. The shared HomeTile primitive accepts an explicit registered shortcut action so unrelated tiles do not participate. Targeted format/lint, app typecheck, scoped diff checking, and 109 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-screens-open-project-screen-tsx","packages-app-src-keyboard-keyboard-shortcuts-test-ts"]
- time: "2026-08-14T03:07:40.985Z"
  kind: "decision"
  summary: "The user clarified that discovery must begin from any held modifier, including Shift, rather than treating Ctrl/Cmd/Alt as the only first-pass triggers."
  source: "user decision"
  affects: ["packages-app-src-stores-keyboard-shortcuts-store-ts","packages-app-src-keyboard-keyboard-shortcuts-ts"]
- time: "2026-08-14T03:07:46.957Z"
  kind: "evidence"
  summary: "User clarified that any modifier key is a valid first discovery pass. Shift alone now starts the 150 ms discovery reveal and Shift-only bindings such as Mode Cycle (`Shift+Tab`) appear with their remaining key (`Tab`). Resolver and store regressions cover this behavior. Targeted format/lint, app typecheck, scoped diff checking, and 111 focused keyboard/store tests passed."
  source: "implementation"
  affects: ["packages-app-src-stores-keyboard-shortcuts-store-ts","packages-app-src-stores-keyboard-shortcuts-store-test-ts","packages-app-src-keyboard-keyboard-shortcuts-ts","packages-app-src-keyboard-keyboard-shortcuts-test-ts"]
- time: "2026-08-14T03:10:39.271Z"
  kind: "decision"
  summary: "The user clarified that every on-screen shortcut must use the established workspace shortcut badge visual treatment, rather than generic tooltip keycaps."
  source: "user decision"
  affects: ["packages-app-src-components-shortcut-discovery-badge-tsx","packages-app-src-components-shortcut-discovery-overlay-tsx","packages-app-src-components-sidebar-sidebar-workspace-row-content-tsx"]
- time: "2026-08-14T03:10:45.299Z"
  kind: "evidence"
  summary: "Replaced generic tooltip shortcut keycaps in contextual discovery with a shared ShortcutDiscoveryBadge extracted from the original workspace-row badge. Workspace rows, all anchored hints, and centered fallback keys now share the same bordered surface0 badge, surface2 border, and muted medium key label. Targeted format/lint, app typecheck, scoped diff checking, and 111 focused keyboard/store tests passed. Live browser visual verification was unavailable because no browser surface was connected in this environment."
  source: "implementation"
  affects: ["packages-app-src-components-shortcut-discovery-badge-tsx","packages-app-src-components-shortcut-discovery-overlay-tsx","packages-app-src-components-sidebar-sidebar-workspace-row-content-tsx"]
- time: "2026-08-14T03:16:51.869Z"
  kind: "decision"
  summary: "User explicitly defined the four shortcut overlay modes on 2026-08-13."
  source: "user decision"
- time: "2026-08-14T03:17:01.680Z"
  kind: "evidence"
  summary: "Implemented a persisted `shortcutOverlayMode` setting with Off, Workspaces, On-Screen, and Full options in Keyboard Settings. The rendering gates are distinct: workspace index badges render only for Workspaces/Full, anchored revealers only for On-Screen/Full, and the centered fallback only for Full. Default is Full to preserve the existing discovery behavior. Focused Vitest passed (230 tests across shortcut resolver/store and settings persistence/routing suites); targeted app lint, app typecheck, formatting, and scoped diff checking passed."
  source: "implementation"
  affects: ["contextual-shortcut-discovery"]
- time: "2026-08-14T05:01:58.405Z"
  kind: "evidence"
  summary: "Moved anchored shortcut badges into the existing floating-panel portal using a transparent local measurement anchor. This prevents badges from being clipped by a trigger's overflow boundary while tracking window resize and nested scrolling. Composer Dictation (`Ctrl/Cmd+D`) is deliberately placed below its trigger while adjacent Live Mode (`Ctrl/Cmd+Shift+D`) remains above, avoiding overlap. Targeted lint, app typecheck, formatting, scoped diff checking, and the 230-test focused shortcut/settings suite passed."
  source: "implementation"
  affects: ["contextual-shortcut-discovery"]
- time: "2026-08-14T05:09:32.391Z"
  kind: "evidence"
  summary: "User screenshot showed top-edge reveal badges positioned beyond the floating surface when a trigger used a negative local offset. Portal placement now clamps every badge coordinate to a 4px inset inside the floating host on all four edges. Added pure regression tests for top and trailing-edge clamping. Targeted lint, formatting, app typecheck, and 232 focused tests passed."
  source: "implementation"
  affects: ["contextual-shortcut-discovery"]
- time: "2026-08-22T19:19:27.305Z"
  kind: "evidence"
  summary: "Fixed the centered shortcut-discovery fallback when an Electron browser tab occupies a split pane. Browser webviews are mounted in a body-level browser plane; the sheet previously stayed in the React root and could be painted beneath the webview. `ShortcutDiscoveryOverlay` now portals to the shared overlay root, whose plane is above browser surfaces, so the sheet remains whole and centered across the workspace. Targeted lint, app typecheck, focused shortcut-overlay tests, and `git diff --check` passed."
  source: "Implementation and targeted verification, 2026-08-22"
  affects: ["contextual-shortcut-discovery"]
