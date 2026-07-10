# Text editor

**Status:** Charter agreed (2026-07-09). **Phases 1–4 implemented and verified (2026-07-09).** Phase 4 delta: fuzzy file finder (client-side match over a daemon `code.list_files`) and document outline (daemon `code.outline` via a new `extractSymbols` in `@otto-code/highlight` that reuses the highlighter's Lezer trees) both shipped and e2e-verified, under one `features.codeIndex` flag; the daemon symbol index (`code.symbols`) is built lazily per workspace, cached with a 30s TTL, and invalidated on writes/replaces. **Go-to-definition is the one deferred nav item** — its daemon+client (`findCodeSymbols`) is shipped and tested, but the editor word-under-cursor bridge + multi-hit picker UI is not wired (charter's lowest-ranked nav feature, riskiest cross-platform piece).

**Phase 5 (AI Refactor) — safe core implemented (2026-07-09).** Deliberately does **not** spawn agents directly (that would touch the central agent-creation path while unattended — the explicit "safe operations" constraint). Instead the editor's "Refactor with AI" (Sparkles) action reads the current selection via a new editor `getSelection` command, opens a small JetBrains-style dialog (scope preview + instruction + scope-guard note), and on confirm composes a scope-guarded prompt (pure, unit-tested `refactor-prompt.ts`) into a **pre-filled draft tab** via the draft store — so the change flows through the proven composer/agent path where the user reviews provider/model and hits send. BlobLoader progress + "view agent log" then come for free from the existing agent tab. **Deferred (need the user's eyes, touch central/risky paths):** direct agent auto-spawn that skips the composer; the read-only viewer entry + **gutter line-range touch selection** (the charter's hard mobile requirement — deep CM6/viewer work); completion → diff auto-open (already covered indirectly by Phase 2's watcher reloading open editors). Mechanical rename is already shipped by Phase 3's whole-word replace.

Phase 5 (AI Refactor) status above.

**Earlier phases:** **Phases 1–3 implemented and verified (2026-07-09).** See the Status block in [phase-1-editor-core.md](./phase-1-editor-core.md) for Phase 1 deltas. Phase 2 deltas: the save-conflict banner kept its one-click Overwrite (still a conditional write) instead of merging into the three-way; "Show diff" is deferred until a two-string diff surface exists; deleted files auto-arm save-re-create (banner is informational); both editor and viewer share the daemon watch subscription through a refcounted client API. Phase 3 deltas: search + replace shipped together under one `features.projectSearch` flag; the daemon uses a pure-JS gitignore matcher (`gitignore.ts`, covers the common grammar — not every exotic corner) and a size-capped/binary-sniffing/event-loop-yielding walker with a 2000-match cap; one search per session supersedes the previous; replace is a desktop-only checklist (mobile gets read-only results), excludes dirty editor buffers and reports them, and every file preconditions on its preview hash. Phases 1+2 ship under `features.textEditor`, Phase 3 under `features.projectSearch`. Phase 4 (navigation) next.

Extend Otto with IDE-grade text editing as a companion to the AI tooling — enough that you never feel locked down and need to escape to an IDE, without becoming one. Bare-minimum configuration for the user, no external processes, no unbundleable dependencies.

Read [docs/architecture.md](../../docs/architecture.md) and [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md) first. The observed-subagents project ([projects/observed-subagents/observed-subagents.md](../observed-subagents/observed-subagents.md)) is the shape reference for how a charter folds into docs/ when done.

---

## Ground rules

### The daemon owns everything file-shaped

The deployment reality: the daemon may run in WSL while the client runs on Windows, or the client is a phone on the other side of the relay. The client **never** touches its local filesystem for workspace files. The editor is a **remote-buffer editor**:

- Read, write, watch, search, and symbol indexing are all daemon-side, addressed by `(workspaceRoot, relativePath)` exactly like the existing `file_explorer_request`.
- Path normalization is daemon-side and POSIX-first. The client treats paths as opaque keys.
- Line endings are detected on read (`crlf` | `lf`) and preserved verbatim on save — a Windows client must not silently rewrite LF files in a WSL checkout.
- Encoding is UTF-8 only in v1; non-UTF-8 files stay viewer-only.
- File watching uses daemon `fs.watch` with a polling fallback — the proven pattern in [artifact-watcher.ts](../../packages/server/src/server/artifact/artifact-watcher.ts). inotify inside WSL is the daemon's problem, invisible to the client.

### Editor engine: CodeMirror 6

The highlight package ([packages/highlight/src/parsers.ts](../../packages/highlight/src/parsers.ts)) is already built on Lezer — CM6's parser system — and already depends on `@codemirror/language` and `@codemirror/legacy-modes`. CM6 is the last step into an ecosystem we already ship: MIT, pure JS, no processes, no workers required, viewport-virtualized for large files, and `@codemirror/search` provides the exact JetBrains find/replace feature set. Monaco is rejected (size, worker architecture, discards the Lezer investment). Extending the RN token renderer into an editor is rejected (reimplementing selection/undo/IME/search from scratch).

**Platform strategy** (per CLAUDE.md Metro-extension rule):

- `code-editor.web.tsx` — CM6 mounted directly in a DOM node (web + Electron).
- `code-editor.native.tsx` — the same CM6 bundle hosted in `react-native-webview` with a message bridge, exactly the terminal's pattern ([terminal-emulator-webview-html.ts](../../packages/app/src/terminal/webview/terminal-emulator-webview-html.ts)).
- One engine, four platforms, no `if (isWeb)` sprawl.

CM6 theme maps from Otto theme tokens ([docs/design.md](../../docs/design.md)); the token classes in `highlighter.ts` are the same Lezer highlight tags CM6 consumes.

### Text viewer vs. Text editor

**Superseded (2026-07-09) by the unified file tab.** The original design shipped two tab kinds (`file` viewer, `editor` buffer) that retargeted in place; they have since been folded into a single `file` tab kind hosting three views behind an icon mode bar (`FileViewModeBar`): **Editor**, **Editor+preview split** (web/desktop only; draggable `ResizeHandle` ratio, proportional scroll sync, click-to-align via `file-split-sync.ts`), and **Preview**. The view mode is remembered per file in `file-view-store.ts`, with a path-derived default (`defaultFileViewMode`): rendered formats (markdown, images, binaries) open in preview, plain text/code opens straight in the editor. The editor buffer survives mode switches (preview renders the live draft) and the discard guard runs only on tab close. Persisted `editor` tab targets coerce to `file` targets — see `COMPAT(unifiedFileTab)` in the workspace-tabs store.

### Protocol and compat

- All new RPCs use dotted namespaces with `.request`/`.response` suffixes.
- Each phase gets one capability flag in `server_info.features.*` with a `COMPAT(...)` comment: `textEditor`, `projectSearch`, `codeIndex`, `aiRefactor`.
- No fallback paths: an old daemon means the client shows "Update the host to use this."
- Wire schemas stay pure structural declarations (no transforms); new fields optional.

### UI feel

JetBrains-familiar: the find/replace strip anchored at the top of the editor, project search results grouped by file, refactor as a small focused dialog. Familiar enough that a coder's hands already know it — but every affordance ultimately exists to produce a well-scoped prompt or a safe mechanical edit, not to clone an IDE.

### Mobile: limited by design

Mobile gets a deliberately **strategic subset**, not a shrunken desktop IDE. The daemon side is identical everywhere — mobile scoping is purely client UI, gated with `useIsCompactFormFactor()` (layout) per the platform-gating rules; the CM6-in-webview engine already targets native.

The mobile theory of use: **read → navigate → small direct edit → delegate the rest to an agent.** A phone user fixes a config value, tweaks a string, bumps a version, unblocks an agent — and for anything bigger, describes the change and lets AI Refactor do it. Ranked by mobile value:

| Ships on mobile                                                                                                                                                                                                                                                                 | Desktop/tablet only (at least v1)                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Editor with save/revert/dirty-guard, line numbers, syntax highlighting                                                                                                                                                                                                          | Multi-toggle find/replace strip (mobile gets **find + next/prev + match case**; replace via "Replace all in file" action sheet) |
| Disk-sync banners (clean auto-reload especially — agents change files constantly while you watch from a phone)                                                                                                                                                                  | Keyboard-shortcut-driven flows (mod+S, mod+P, mod+B) — mobile uses buttons and long-press menus                                 |
| Fuzzy file finder (a top bar action — faster than tree-walking on touch)                                                                                                                                                                                                        | Project-wide **replace** with per-match checkboxes (search results are mobile-friendly; the checklist UI is not)                |
| Project **search** (read-only results list, tap to open at line)                                                                                                                                                                                                                | Document outline side panel (mobile: outline as a bottom sheet, later)                                                          |
| **AI Refactor — first-class on mobile.** Works from the read-only **viewer**, not just the editor: see the file → select lines via the gutter → describe → agent does it. Arguably more valuable on a phone than on desktop. BlobLoader progress + "View agent" work unchanged. | Go-to-definition v1 (desktop ctrl-click first; mobile follows via long-press → "Go to definition" once the picker UI is proven) |

Touch affordances replace pointer affordances: long-press an identifier or selection → context menu (Go to definition, Refactor with AI…); a prominent Save button instead of mod+S; the `isHovered || isNative || isCompact` rule for anything hover-revealed on desktop.

---

## Phase 1 — Editor core

The editable buffer with save/revert/close semantics and in-file find/replace.

**Daemon**

- `file.write.request` / `file.write.response`: `{ cwd, path, content, expectedModifiedAt, expectedHash? }`. The daemon compares mtime/hash before writing; mismatch returns a typed `conflict` result (never clobbers). Success returns fresh `modifiedAt` + hash. Atomic write per [docs/data-model.md](../../docs/data-model.md) conventions.
- Read side: reuse `file_explorer_request` mode `file` (already returns `content`, `modifiedAt`, `size`). Add optional `eol` detection to the response (optional field — protocol-safe).
- `features.textEditor` flag.

**Client**

- New tab target `{ kind: "editor"; path: string }` in the workspace-tabs store (+ persistence coercion).
- `editor-store` (zustand): per `(serverId, workspaceStateKey, path)` — baseline content, baseline `modifiedAt`/hash, current doc dirty flag, disk-changed flag, eol.
- Panel registration with **`confirmClose`** ([panel-registry.ts](../../packages/app/src/panels/panel-registry.ts) already has the hook) — dirty buffer prompts "Discard changes?" before the tab closes.
- CM6 pane (`.web.tsx` + `.native.tsx` webview host): line numbers, syntax highlighting via existing Lezer parsers, undo/redo, Otto theme.
- Toolbar: file name + dirty dot, Save (mod+S), Revert (re-fetch from daemon, reset baseline), and the **find/replace strip** — custom React toolbar driving the `@codemirror/search` API (not CM's stock panel): find field with match count, prev/next, match case, whole word, regex toggles; expandable replace row with Replace / Replace All. JetBrains layout.
- Editor tabs open from: file explorer context menu ("Edit"), viewer toolbar Edit button.
- i18n: English strings added across all locale files (type-enforced parity; translate after verification).

**Out of scope for this phase:** disk-change reactions (Phase 2) — a stale save simply returns `conflict` and shows a basic "file changed on disk, reload to continue" dialog.

## Phase 2 — Disk sync

React to the file changing under the editor.

- `file.watch.subscribe.request` / `.response`, `file.watch.unsubscribe.request` / `.response`, and a pushed `file.watch.event` (`changed` | `deleted` | `recreated`, with fresh `modifiedAt`/hash). Subscriptions exist only for paths open in tabs; daemon cleans up on socket close.
- Client policy:
  - Buffer **clean** → silently reload the buffer from disk (per the agreed requirement: if we hadn't edited it, just update).
  - Buffer **dirty** → non-modal banner in the editor: **Reload from disk** (discard mine) / **Keep my changes** (baseline updates to disk state so the next save is honest) / **Show diff** (reuse the existing diff viewer, disk vs. buffer).
  - File deleted → banner; keep the buffer so work isn't lost, save re-creates.
- Save conflict (Phase 1's typed `conflict`) upgrades to the same three-way choice.
- The viewer gets the clean-reload behavior too (it's always clean).

## Phase 3 — Project search, then replace

**Search**

- `file.search.request` → streamed `file.search.result` events + terminal `file.search.response` (JetBrains "Find in Files" semantics: press-enter search, not per-keystroke).
- Daemon implementation: pure-JS scan — `.gitignore`-aware, file-size cap, binary sniff, result cap, cancellation. No ripgrep binary in v1 (constraint: nothing spawned); revisit only with performance evidence.
- Flags: match case, whole word, regex; optional include/exclude glob.
- UI: new explorer-sidebar tab "Search" — query row with the same toggle set as the editor strip, results grouped by file with match highlights, click opens viewer/editor at line.

**Replace**

- Preview-first, JetBrains style: the result list becomes a checklist (per-match checkboxes, per-file toggle), "Replace selected".
- `file.replace.request`: per-file list of edits each carrying `expectedHash` — files changed since the preview are skipped and reported, never corrupted. Open dirty buffers are excluded from disk replace (replaced in-buffer instead) to avoid the two-writers problem.

## Phase 4 — Navigation (ctags-style, no LSP)

LSP means per-language external server processes — ruled out. The lightweight tier:

1. **Fuzzy file finder** (mod+P) — daemon RPC returning the workspace file listing (gitignore-aware, cached, invalidated by the watcher); client-side fuzzy match. Highest value-per-effort; ship first within the phase.
2. **Lezer symbol index** — the daemon walks the same Lezer parse trees the highlighter uses (the `highlight` package is already in the server build stack), extracting `definition(...)`-tagged nodes into a name → `[{file, line, kind}]` map. In-memory, built lazily per workspace, incrementally updated from watch events. `code.symbols.request` for lookup, `code.outline.request` for a single file (or client-side parse for the open buffer — decide at implementation).
3. **Go to definition** — ctrl/cmd-click (and mod+B) on an identifier: one hit jumps, multiple hits show a picker. Name-based, ctags-honest: no type resolution, never pretends otherwise.
4. **Document outline** — symbol list for the current editor/viewer file, click to jump.

This tier never forecloses LSP later; it would slot behind the same affordances as an opt-in upgrade.

## Phase 5 — AI Refactor

Refactoring is delegated to an agent, not a static analyzer — this is Otto's home-field advantage.

- **Entry points:** editor selection context menu / toolbar "Refactor…" (mod+alt+shift+T homage optional), file explorer context menu for file-scoped refactors, **and the read-only Text viewer** — the agent does the writing, so an editable buffer is never a prerequisite. Viewer + Refactor is the primary mobile path: see the file, select something, describe the change.
- **Selection scoping on touch:** the mobile-critical mechanism is **line-range selection via the line-number gutter** (tap a line number, drag or tap a second one to extend — same interaction family as the diff screen), available in both viewer and editor. Character-precise long-press selection also works, but gutter-range is the reliable way to scope a refactor one-handed. This makes touch selection a hard requirement of this phase, not a polish item.
- **Dialog** (JetBrains "Refactor This" spirit — small, focused): shows the scope (file + line range + selected-code preview), an instruction field ("Extract this into a helper", "Rename this concept across the file"), and a scope guard the prompt enforces: _change only within the stated scope, no unrelated reformatting, no dependency changes, no drive-by fixes_. The dialog's whole job is producing a tightly-scoped prompt that gets good results without exceeding what the user asked.
- **Execution:** spawns a **real Otto agent** in the workspace (existing agent-creation path; provider = the workspace default or a user-picked one). Because it's a real agent it lands in the existing track/tab machinery automatically — **"view agent log" is just opening its tab**, the same way observed subagents reused the pane. No new observation surface.
- **Progress:** the dialog (or an inline strip in the editor) shows the **BlobLoader** ([blob-loader.tsx](../../packages/app/src/components/blob-loader.tsx)) while the agent runs, with the agent's latest status line beneath and a "View agent" link.
- **Completion:** changed-files summary → diff viewer. Open editors pick the changes up through Phase 2's watcher (clean buffers auto-reload; dirty buffers get the conflict banner).
- **Mechanical rename** (no AI): project search/replace with whole-word matching — already shipped by Phase 3, surfaced as "Rename (text-based)…" next to the AI action so the honest cheap tool is one click away.

## Phase 6 — Parked: line comments in editor/viewer

The design is agreed but implementation is deliberately deferred until the editor core is stable.

**The "which agent?" problem, solved by decoupling collect from send:** comments on editor/viewer lines are **workspace-scoped drafts**, bound to no agent at creation (same model as the existing diff review draft store). Any agent composer in that workspace shows a "N code comments" pill — like an attachment — that the user includes at send time. The composer is inherently agent-scoped, so the user answers "which agent" by choosing where they hit send. Comments survive agent switches and can be split across agents.

---

## Cross-cutting

- **Testing:** daemon RPCs through the ad-hoc daemon harness ([docs/ad-hoc-daemon-testing.md](../../docs/ad-hoc-daemon-testing.md)); editor-store and conflict-policy logic as pure unit tests; run only changed test files.
- **Typecheck/lint/format** per CLAUDE.md after every change; `npm run build:server` before diagnosing cross-package type errors (protocol changes ripple).
- **Docs fold-in on completion:** editor architecture → a new `docs/text-editor.md`; glossary entries ("Text editor", "Text viewer", "Project search"); this folder is then deleted.
