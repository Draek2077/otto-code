# Text editor

IDE-grade text editing inside Otto — a companion to the AI tooling, not a replacement for an IDE. The goal is that you never feel locked down and need to escape to a real editor for the small stuff: read a file, navigate a project, make a scoped edit, or describe a bigger change and let an agent do it. Bare-minimum configuration, no external processes, no unbundleable dependencies.

Shipped 0.4.4 (Phases 1–5). This doc is the durable architecture; the point-in-time build plan lived in `projects/text-editor/` and was folded in here on completion.

## The core principle: the daemon owns everything file-shaped

The deployment reality drives the whole design: the daemon may run in WSL while the client runs on Windows, or the client is a phone on the far side of the relay. **The client never touches its local filesystem for workspace files.** The editor is a _remote-buffer editor_ — read, write, watch, search, and symbol indexing are all daemon-side, addressed by `(workspaceRoot, relativePath)` exactly like the existing `file_explorer_request`.

Consequences that must survive future changes:

- **Path normalization is daemon-side and POSIX-first.** The client treats paths as opaque keys. Path containment under the workspace root is enforced on the daemon (reusing the explorer's normalization); files outside the workspace root and `~`-scoped paths are viewer-only by design.
- **Line endings are detected on read (`lf` | `crlf`) and preserved verbatim on save.** A Windows client must not silently rewrite LF files in a WSL checkout. Content travels LF-normalized on the wire; the daemon re-applies the file's detected EOL. Mixed-EOL files normalize to the dominant ending on save (documented majority rule).
- **Encoding is UTF-8 only.** Non-UTF-8 and binary files stay viewer-only (binary is rejected on the write path with a clear error).
- **File watching uses daemon `fs.watch` with a polling fallback** — the proven `artifact-watcher.ts` pattern. inotify-inside-WSL is the daemon's problem, invisible to the client.

All RPCs use dotted namespaces with `.request`/`.response` suffixes (see [rpc-namespacing.md](rpc-namespacing.md)). No fallback paths: an old daemon means the client shows "Update the host to use this."

## Feature flags

Three capability flags in `server_info.features.*` (`packages/protocol/src/messages.ts`), each `COMPAT(...)`-tagged, added in v0.4.4:

| Flag                     | Gates                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.textEditor`    | The editable buffer + save/revert/dirty guard, disk-sync watching, and the in-file find/replace strip (Phases 1–2). AI Refactor rides on this flag too — there is deliberately **no** separate `aiRefactor` flag; the refactor entry lives on the editor. |
| `features.projectSearch` | Project-wide search and replace (Phase 3). Search and replace shipped together under this one flag.                                                                                                                                                       |
| `features.codeIndex`     | Navigation (Phase 4): fuzzy file finder, document outline, and the symbol index behind `code.symbols` / `code.outline` / `code.list_files`.                                                                                                               |

## Daemon file RPCs

All live in `packages/server/src/server/session/files/workspace-files-session.ts` (dispatched from `session.ts`):

- **`file.write.request` / `.response`** — conditional write. Request carries `{ cwd, path, content, expectedModifiedAt, expectedHash? }`; the daemon compares mtime/hash before writing and **never clobbers** — a mismatch returns a typed `conflict` result (discriminated union: `ok` | `conflict` | `error`), success returns fresh `modifiedAt` + `sha256` + `size`. Atomic write via `writeFileAtomic` (which gained an optional `mode` so saved executables keep their permission bits). Reads reuse `file_explorer_request` mode `file`, extended with an optional `eol` field on the response.
- **`file.watch.subscribe.request` / `.response`**, **`file.watch.unsubscribe.request` / `.response`**, and a pushed **`file.watch.event`** (`changed` | `deleted` | `recreated`, with fresh `modifiedAt`/hash). Subscriptions exist only for paths open in tabs and are cleaned up on socket close. Editor and viewer share the subscription through a refcounted client API.
- **`file.search.request`** → streamed **`file.search.result`** events + a terminal **`file.search.response`** (JetBrains "Find in Files" semantics — press-enter, not per-keystroke).
- **`file.replace.request` / `.response`** — per-file edit list, each edit preconditioned on `expectedHash`.
- **`code.list_files.response`**, **`code.symbols.response`**, **`code.outline.response`** — the navigation trio (see below).

## Watch / save-conflict model

The client reacts to files changing under the editor by buffer state:

- **Buffer clean** → silently reload from disk. Agents change files constantly while you watch from a phone, so a file you haven't edited just updates. The viewer gets this behavior too (it's always clean).
- **Buffer dirty** → a non-modal inline banner: **Reload from disk** (discard mine) / **Overwrite** (a conditional write against the disk identity you were shown — not a blind clobber) / **Keep editing** (baseline updates to disk state so the next save is honest). A "Show diff" three-way is deferred until a two-string diff surface exists.
- **File deleted** → informational banner; the buffer is kept so work isn't lost, and save re-creates the file.
- A stale **save conflict** (`file.write` returning `conflict`) surfaces the same banner choice.

The buffer store keeps a debounced `draft` mirror of the live document so host remounts and native-webview crashes can't lose edits; saves still round-trip `getDoc` for the exact buffer. Editor buffers do **not** survive a full app reload (known gap). The dirty-guard `confirmClose` runs on single tab close; bulk closes ("close others/all") currently bypass it.

Client editor state lives in `packages/app/src/editor/` (`editor-buffer-store.ts`, `editor-buffer-state.ts`, `use-editor-buffer.ts`), keyed `(serverId, workspaceStateKey, path)`.

## Project search and replace (`features.projectSearch`)

Daemon-side pure-JS scan — no ripgrep or any spawned binary in v1 (the "nothing spawned" constraint; revisit only with performance evidence). The walker is gitignore-aware, size-capped, binary-sniffing, event-loop-yielding, with a **2000-match cap** and cancellation. One search per session supersedes the previous. Flags: match case, whole word, regex; optional include/exclude glob.

- **gitignore matching** is a pure-JS matcher (`gitignore.ts`) covering the common grammar — not every exotic corner.
- **Replace** is preview-first (JetBrains style): the result list becomes a per-match / per-file checklist. It is **desktop-only** — mobile gets read-only results (the checklist UI doesn't fit touch). Each file preconditions on its preview hash, so files changed since the preview are skipped and reported, never corrupted. Open dirty editor buffers are excluded from the disk replace (replaced in-buffer instead) to avoid the two-writers problem.

Client: `use-project-search-feature.ts`; a "Search" explorer-sidebar tab with results grouped by file, click-to-open at line.

## Navigation: code index, outline, fuzzy finder (`features.codeIndex`)

Deliberately ctags-style, **no LSP** (LSP means per-language external server processes — ruled out). Name-based and honest: no type resolution, so multiple hits are a picker, not a guess. Lives in `packages/server/src/server/file-explorer/code-index.ts`:

- **Fuzzy file finder** — `listWorkspaceFiles` returns the gitignore-aware workspace listing (cap 20,000 files); the client does the fuzzy match. Highest value-per-effort, and a top-bar action on mobile (faster than tree-walking on touch).
- **Symbol index** — a name → `[{ path, line, kind }]` map built by walking the same Lezer parse trees the highlighter uses, via **`extractSymbols` from `@otto-code/highlight`** (`packages/highlight/src/symbols.ts`), which reuses the highlighter's trees. Built **lazily per workspace**, cached with a **30 s TTL** (`INDEX_TTL_MS`) and **invalidated on writes/replaces** (`invalidate(root)`); indexing caps at 5,000 files / 1 MB each. Exposed as `code.symbols` (lookup) and the pure lookup helper `findCodeSymbols`.
- **Document outline** — `getFileOutline` parses a single file's current buffer per request (cheap, uncached) via the same `extractSymbols`, exposed as `code.outline`. Client outline UI: `editor-outline-sheet.tsx` (bottom sheet on mobile).

## Editor engine: CodeMirror 6 + platform split

CM6 was chosen because the `@otto-code/highlight` package is already built on Lezer — CM6's parser system — and already depends on `@codemirror/language` and `@codemirror/legacy-modes`. It is MIT, pure JS, no worker processes, viewport-virtualized for large files, and `@codemirror/search` provides the JetBrains find/replace feature set. Monaco was rejected (size, worker architecture, discards the Lezer investment); extending the RN token renderer into an editor was rejected (reimplementing selection/undo/IME/search).

One engine, four platforms, per the Metro-extension rule (no `if (isWeb)` sprawl):

- **`editor-core.ts`** — framework-agnostic setup: extensions (line numbers, history, language from `getParserForFile`, search), a theme built from Otto tokens (`editor-theme.ts`), and a typed command surface (`editor-contract.ts`: getDoc/setDoc, find/replace ops, `getSelection`, dirty events) that both hosts drive.
- **`code-editor.tsx`** — CM6 mounted directly in a DOM node (web + Electron).
- **`code-editor.native.tsx`** — the same CM6 bundle hosted in `react-native-webview` with a message bridge (the terminal's pattern). The webview HTML is generated from `editor/webview/editor-webview-entry.ts` via a build script (`build:editor-webview`) and ships minified inline in the app bundle.

CM6's highlight tags are the same Lezer tags the highlighter consumes, so themes map straight from Otto's design tokens ([design.md](design.md)).

## The unified file tab and view modes

Originally two tab kinds (a `file` viewer and an `editor` buffer) were planned; they were folded into a **single `file` tab kind** hosting three views behind an icon mode bar, **`FileViewModeBar`** (`packages/app/src/components/file-view-mode-bar.tsx`, hosted by `file-tab-pane.tsx`):

- **Editor**
- **Editor + preview split** — web/desktop only; a draggable `ResizeHandle` ratio with proportional scroll sync and click-to-align (`file-split-sync.ts`).
- **Preview**

The view mode is remembered per file in `file-view-store.ts`, with a path-derived default (`defaultFileViewMode`): rendered formats (markdown, images, binaries) open in preview; plain text/code opens straight in the editor. The editor buffer survives mode switches (preview renders the live draft); the discard guard runs only on tab close. Persisted legacy `editor` tab targets coerce to `file` targets — see **`COMPAT(unifiedFileTab)`** in the workspace-tabs store (`packages/app/src/stores/workspace-tabs-store/state.ts`).

## AI Refactor — the safe core

Refactoring is delegated to an agent, not a static analyzer — Otto's home-field advantage. The critical design decision, which must not be undone lightly: **AI Refactor deliberately does not spawn an agent directly.** A direct spawn would touch the central agent-creation path while potentially unattended, violating the "safe operations" constraint. Instead it routes through the proven composer/draft path where the user has final say.

The flow (`packages/app/src/editor/`):

1. The editor's "Refactor with AI" (Sparkles) action reads the current selection via the `getSelection` editor command for scope.
2. It opens a small JetBrains-style dialog (`refactor-dialog.tsx`) showing the scope (file + line range + selected-code preview), an instruction field, and a scope-guard note (_change only within scope; no unrelated reformatting, no dependency changes, no drive-by fixes_).
3. On confirm, it composes a scope-guarded prompt via the **pure, unit-tested `refactor-prompt.ts`** (`buildRefactorPrompt`) and opens a **pre-filled draft tab** through the draft store (`use-ai-refactor.ts`, using `buildDraftStoreKey` / `generateDraftId`).

From there the change flows through the ordinary composer/agent path: the user reviews provider/model and hits send, and BlobLoader progress plus "view agent log" come for free from the existing agent tab. There is no new observation surface and no auto-spawn. Mechanical rename is already covered by Phase 3's whole-word project replace, surfaced next to the AI action as the honest cheap option.

## Deferred / not yet built

Preserved here so nothing is lost — these were explicitly scoped out of the shipped Phases 1–5:

1. **Go-to-definition client bridge + multi-hit picker.** The daemon half is fully shipped and tested: `code.symbols` / `findCodeSymbols` under `features.codeIndex`. Only the editor client wiring is missing — a word-under-cursor command, the `code.symbols` call, and a multi-hit picker (single hit jumps, >1 shows a JetBrains-style picker). Small, client-side. Extracted as a pull-off task: **`projects/todos/editor-go-to-definition.md`**.
2. **Read-only viewer gutter line-range touch selection.** The charter's _hard mobile requirement_ — tap a line number, drag/tap a second to extend a line range, in both viewer and editor, so a refactor can be scoped one-handed. Deep CM6/viewer work; **not built**. Until it lands, mobile refactor scoping relies on character-precise selection.
3. **Direct agent auto-spawn that skips the composer.** Deliberately deferred, not merely unfinished: it touches the central agent-creation path, and the safe-core design routes through the composer/draft path on purpose. Any future version must preserve a user review step.

Also parked from the original charter: **line comments in editor/viewer** (Phase 6) — workspace-scoped drafts bound to no agent at creation, surfaced as an "N code comments" pill on any composer in that workspace, included at send time (same decouple-collect-from-send model as the diff-review draft store).

## Testing

Daemon RPCs go through the ad-hoc daemon harness ([ad-hoc-daemon-testing.md](ad-hoc-daemon-testing.md)); editor-buffer and conflict-policy logic and `refactor-prompt.ts` are pure unit tests (`editor-buffer-state.test.ts`, `refactor-prompt.test.ts`, `workspace-files-session.test.ts`, highlight `symbols.test.ts`). Run only changed test files.
