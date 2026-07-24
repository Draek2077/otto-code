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
| `features.codeIndex`     | Navigation (Phase 4): fuzzy file finder, document outline, go-to-definition, and the symbol index behind `code.symbols` / `code.outline` / `code.list_files`. Read it through `use-code-index-feature.ts` — every `code.*` caller shares that one gate.   |

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
- **Go to definition** — the editor toolbar action (and `Mod-B` / `F12`, both bound because muscle memory splits between JetBrains and VS Code) resolves the identifier under the caret and asks `code.symbols` for it. `use-go-to-definition.ts` turns the answer into one of three outcomes, and the three-way split is the whole design: **one hit jumps** (in-buffer via `goToLine` when the definition is in the open file, otherwise by opening the target file at that line), **several hits open a picker** (`definition-picker-dialog.tsx`, file + line per row) because a name-based index with no type resolution genuinely cannot choose, and **no hits is a plain toast, never an error tone** — the ctags-style walker only sees languages it has a Lezer grammar for, so "not found" is an ordinary answer.

  The identifier itself comes from `getWordAtCursor`, a pull command on `EditorController` alongside `getSelection`, backed by the pure, unit-tested `word-at-cursor.ts`. A caret touching a word on either side resolves to that word; a token starting with a digit resolves to nothing, since a number literal is never a definition. Nothing smarter belongs there — the lookup on the other end could not honour the extra precision.

  One path-shape trap worth keeping: `code.symbols` answers **relative to the workspace it indexed**, while `openFileInWorkspace` anchors a relative path to the **pane's** workspace. Those are the same root for an ordinary tab and different roots for a linked project's file (gated-multi-root), so `file-tab-pane.tsx` sends an absolute path when they diverge and lets the cross-project open gate re-derive the owner.

## Editor engine: CodeMirror 6 + platform split

CM6 was chosen because the `@otto-code/highlight` package is already built on Lezer — CM6's parser system — and already depends on `@codemirror/language` and `@codemirror/legacy-modes`. It is MIT, pure JS, no worker processes, viewport-virtualized for large files, and `@codemirror/search` provides the JetBrains find/replace feature set. Monaco was rejected (size, worker architecture, discards the Lezer investment); extending the RN token renderer into an editor was rejected (reimplementing selection/undo/IME/search).

One engine, four platforms, per the Metro-extension rule (no `if (isWeb)` sprawl):

- **`editor-core.ts`** — framework-agnostic setup: extensions (line numbers, history, language from `getParserForFile`, search), a theme built from Otto tokens (`editor-theme.ts`), and a typed command surface (`editor-contract.ts`: getDoc/setDoc, find/replace ops, `getSelection`, dirty events) that both hosts drive.
- **`code-editor.tsx`** — CM6 mounted directly in a DOM node (web + Electron).
- **`code-editor.native.tsx`** — the same CM6 bundle hosted in `react-native-webview` with a message bridge (the terminal's pattern). The webview HTML is generated from `editor/webview/editor-webview-entry.ts` via a build script (`build:editor-webview`) and ships minified inline in the app bundle.

CM6's highlight tags are the same Lezer tags the highlighter consumes, so themes map straight from Otto's design tokens ([design.md](design.md)).

Two appearance rules the spec exists to enforce, both learned the hard way:

- **`activeLineBackground` must stay translucent, and the stripe must stay a line
  decoration.** These are one rule, because each half is what makes the other survivable.

  `drawSelection` renders into `.cm-selectionLayer` at a _negative_ z-index — behind the
  content — so an **opaque** background on `.cm-line` hides the selection on the caret's
  line completely. That was the original bug; upstream never sees it because CM6's own
  default fill is `#cceeff44`. The fix is to match upstream and keep the fill translucent
  (currently the foreground at 6%, well under the selection's 15–20% so an overlap still
  reads as _selected_).

  The tempting alternative — move the stripe into its own `layer({above: false})`
  registered after `drawSelection()` so it stacks underneath — **was built twice and
  reverted twice.** It works in principle, but a layer's rectangle has to be _computed_ to
  match the row instead of _being_ the row, and it kept landing in the wrong place: layers
  mount on `view.scrollDOM` and position against CM6's `getBase()` (the scroller's rect
  minus its scroll offset), so marker `(0, 0)` is left of the **gutters** and above
  `.cm-content`'s padding, while `BlockInfo.top` — the only vertical coordinate CM6 gives
  you for a line — is in _document_ space. Even with that conversion right, the stripe,
  the row and the gutter each ended up a different height. A `.cm-line` background can't
  drift from the row it paints: it is the row's own box.

  So: don't reach for a layer, and don't make the fill opaque. If the current line needs
  more presence, raise the alpha.

- **Search matches must not reuse the selection color.** They did (both were
  `terminal.selectionBackground`), which made a hit invisible exactly when you were also
  selecting. Matches are amber — the semantic `statusWarning*` surfaces — with an
  `outline` (never a `border`: an inline mark must not reflow the line it sits on), and the
  active hit steps up to the stronger fill plus a 2px outline.

**`EditorThemeSpec` is the whole appearance surface.** Both hosts receive concrete values (never CSS variables — nested palettes like `colors.syntax` have no per-token variable on web), so anything the editor should render differently belongs in that struct rather than in host-specific code. Most fields come from the Unistyles theme via `buildEditorThemeSpec(theme)`; a field driven by device-local app settings instead (`rulerColumn`) is merged in by the host in `file-tab-pane.tsx`, because the `withUnistyles` mapping only ever sees the theme.

The **line-length ruler** (Settings → Appearance → Syntax; `rulerEnabled` / `rulerColumn`, default on at column 80, clamped to 80–240) is drawn as a 1px `linear-gradient` stripe on `.cm-content` — no decorations, no overlay element, and it paints behind the text. It uses the `ch` unit, so it tracks the code font size for free, and it needs no repeat on the active line: the active-line fill is translucent (see above), so the ruler shows straight through it. The stripe therefore spans the content box only — which is `max(longest line, viewport)`, so a column the ruler doesn't reach is also one the user could never scroll to.

## The status bar

`EditorStatusBar` (`packages/app/src/editor/editor-status-bar.tsx`) is the strip along the bottom of the file pane: **file type and size on the left, line endings + encoding + caret position on the right**. Read-only by design — every item reports state, so nothing in it is pressable (unlike VS Code's, where the same items are click targets). Items are icon + label at `iconSize.xs`/`fontSize.xs`, and the caret readout uses `tabular-nums` so the bar doesn't twitch sideways as the caret moves.

It renders in **all three view modes**, with items dropping out when the mode or the file genuinely has nothing to report:

| Mode                | Type | Size | EOL          | Encoding                | Caret            |
| ------------------- | ---- | ---- | ------------ | ----------------------- | ---------------- |
| Editor              | ✔    | ✔    | ✔            | ✔                       | ✔                |
| Split               | ✔    | ✔    | ✔            | ✔                       | ✔ (the editor's) |
| Preview (text)      | ✔    | ✔    | ✔            | ✔                       | — no editor      |
| Preview (image/bin) | ✔    | ✔    | — none exist | — never decoded as text | —                |

The two modes feed it from different sources — the editor from its buffer baseline, the preview from its own read — so `eol` and `isText` are props rather than something the bar derives. Preview-mode EOL required threading the daemon's detected value through `FileReadResult` → `ExplorerFile` → `FilePreviewFileInfo`; it stays optional the whole way because only the inline JSON read path reports it (the chunked binary transfer never does), and a null means "not reported", never "LF".

Where each value comes from — worth knowing before adding a fifth item, because none of them arrive the obvious way:

- **File type** — `getLanguageDisplayName(path)` from `@otto-code/highlight` (`language-names.ts`). Deliberately a _separate_ registry from `parsersByExtension`: the editor opens any text file, so the label has to name plenty of formats we have no grammar for. A missing grammar means no syntax colors, not an unnamed file. Unknown extensions fall back to the extension in caps, never to "Unknown".
- **Size** — in preview it is the daemon's reported `size`; in the editor it is computed from `baseline.content` (`useBufferByteSize`) rather than carried in the buffer state. The daemon's read result does include `size`, but `use-editor-buffer.ts` builds baselines at six sites and two of them (conflict reload, event rebaseline) have no daemon size to pass, so a required `size` field would have to be faked at exactly the places it would be wrong. `utf8ByteSize()` re-adds one byte per line for CRLF files, since the buffer is LF-normalized on load. Memoized on the baseline — recomputing per keystroke would walk the whole file for a number that describes the disk, not the draft.
- **Encoding** — the constant `"UTF-8"`. The daemon decodes text as UTF-8 unconditionally and nothing in the stack sniffs a charset, so this states what we actually did rather than implying a detection we don't perform. If real detection ever lands, `ENCODING_LABEL` is the single place to change.
- **Caret position** — `onCursorMoved`, a push callback added because neither existing selection hook fits: `getSelection()` is pull-only, and `onPointerSelect` fires for pointer selections only, so both miss plain arrow-key movement. Column is 1-based in **UTF-16 code units** — the same unit CM6 uses for offsets, so the readout always agrees with the editor's own idea of a position (an astral emoji advances it by 2).

Adding a push callback to the editor means seven touchpoints, all of which must land together or native silently loses the feature: the payload type + `CodeEditorProps` and the `EditorWebViewOutbound` variant (`editor-contract.ts`), `EditorCoreOptions` + the `updateListener` emit + an initial emit after the view is constructed (`editor-core.ts`), the web host forward (`code-editor.tsx`), the webview `sendToNative` (`webview/editor-webview-entry.ts`), and the native `handleMessage` case (`code-editor.native.tsx`). **Then rerun `npm run build:editor-webview`** — the webview bundle is a generated, committed file, so native runs whatever was last built, not your source.

A **pull command** (`getDoc`, `getSelection`, `getWordAtCursor`) has the same trap and a different list: an `EditorController` method plus a request/reply pair on `EditorWebViewInbound`/`Outbound` (`editor-contract.ts`), the `EditorCore` implementation (`editor-core.ts`), the web host's synchronous `Promise.resolve` bridge (`code-editor.tsx`), the webview's `receive` branch answering with the `requestId` (`webview/editor-webview-entry.ts`), and — on native — a pending-request map with a timeout, a `settlePendingReply` branch, and unmount rejection (`code-editor.native.tsx`). That native trio is why the message switches there are split into `settlePendingReply` / `forwardPushedEvent`: every new command adds a branch to exactly one of them. Rerun the webview build the same way.

## The unified file tab and view modes

Originally two tab kinds (a `file` viewer and an `editor` buffer) were planned; they were folded into a **single `file` tab kind** hosting three views behind an icon mode bar, **`FileViewModeBar`** (`packages/app/src/components/file-view-mode-bar.tsx`, hosted by `file-tab-pane.tsx`):

- **Editor**
- **Editor + preview split** — web/desktop only; a draggable `ResizeHandle` ratio with proportional scroll sync and click-to-align (`file-split-sync.ts`).
- **Preview**

**Preview reads are gated on visibility, never on focus.** The preview's read (`isFileQueryEnabled` in `file-pane-enabled.ts`) is disabled while its tab is hidden or the app is backgrounded, so a revisited tab refetches instead of showing a frozen snapshot. A disabled query is indistinguishable from an in-flight one — both are `isPending` — so anything that wrongly reports "not visible" leaves the pane spinning "Loading file..." forever, with no timeout and no error to explain it. Use `getIsAppInForeground` (AppState + `document.visibilityState`) for that gate, **not** `getIsAppActivelyVisible`, which additionally requires `document.hasFocus()`: focus leaves the host document for an Electron `<webview>`, devtools, or a second window while the pane is plainly on screen. Reserve the focus-sensitive predicate for "is the user actually looking at this chat" questions like attention-clearing and notifications.

The view mode is remembered per file in `file-view-store.ts`, with a path-derived default (`defaultFileViewMode`): rendered formats (markdown, images, binaries) open in preview; plain text/code opens straight in the editor. The editor buffer survives mode switches (preview renders the live draft); the discard guard runs only on tab close. Persisted legacy `editor` tab targets coerce to `file` targets — see **`COMPAT(unifiedFileTab)`** in the workspace-tabs store (`packages/app/src/stores/workspace-tabs-store/state.ts`).

**Find in the read-only preview** mirrors the editor's find strip minus replace (there is no buffer to write to). It does **not** go through CodeMirror — the preview renders a token stream per line, so find is a pure text scan (`file-preview-find.ts`: `findPreviewMatches` + `splitTokensForMatches`, both unit-tested) whose match semantics (case / whole-word / regexp) match `@codemirror/search` so the same query finds the same things in both views. Matched runs are re-cut out of the syntax tokens and tinted (base tint for every hit, stronger for the active one), the count feeds the strip, and next/previous scrolls the active hit into view. It is gated to the **syntax-highlighted text preview only** (`PreviewOnlyView` shows the button when `fileInfo.kind === "text" && !isMarkdown`): rendered markdown has no line-mapped text to highlight and images/binaries have no text, so those keep no find button — switch to the editor to search a markdown file. Matching caps at `MAX_PREVIEW_FIND_MATCHES` (shown as `999+`) so a one-letter query over a huge file can't build a million-entry array.

## AI Refactor — the safe core

Refactoring is delegated to an agent, not a static analyzer — Otto's home-field advantage. The critical design decision, which must not be undone lightly: **AI Refactor deliberately does not spawn an agent directly.** A direct spawn would touch the central agent-creation path while potentially unattended, violating the "safe operations" constraint. Instead it routes through the proven composer/draft path where the user has final say.

The flow (`packages/app/src/editor/`):

1. The editor's "Refactor with AI" (Sparkles) action reads the current selection via the `getSelection` editor command for scope.
2. It opens a small JetBrains-style dialog (`refactor-dialog.tsx`) showing the scope (file + line range + selected-code preview), an instruction field, and a scope-guard note (_change only within scope; no unrelated reformatting, no dependency changes, no drive-by fixes_).
3. On confirm, it composes a scope-guarded prompt via the **pure, unit-tested `refactor-prompt.ts`** (`buildRefactorPrompt`) and opens a **pre-filled draft tab** through the draft store (`use-ai-refactor.ts`, using `buildDraftStoreKey` / `generateDraftId`).

From there the change flows through the ordinary composer/agent path: the user reviews provider/model and hits send, and BlobLoader progress plus "view agent log" come for free from the existing chat tab. There is no new observation surface and no auto-spawn. Mechanical rename is already covered by Phase 3's whole-word project replace, surfaced next to the AI action as the honest cheap option.

## Deferred / not yet built

Preserved here so nothing is lost — these were explicitly scoped out of the shipped Phases 1–5:

1. **Read-only viewer gutter line-range touch selection.** The charter's _hard mobile requirement_ — tap a line number, drag/tap a second to extend a line range, in both viewer and editor, so a refactor can be scoped one-handed. Deep CM6/viewer work; **not built**. Until it lands, mobile refactor scoping relies on character-precise selection.
2. **Direct agent auto-spawn that skips the composer.** Deliberately deferred, not merely unfinished: it touches the central agent-creation path, and the safe-core design routes through the composer/draft path on purpose. Any future version must preserve a user review step.

Also parked from the original charter: **line comments in editor/viewer** (Phase 6) — workspace-scoped drafts bound to no agent at creation, surfaced as an "N code comments" pill on any composer in that workspace, included at send time (same decouple-collect-from-send model as the diff-review draft store).

## Testing

Daemon RPCs go through the ad-hoc daemon harness ([ad-hoc-daemon-testing.md](ad-hoc-daemon-testing.md)); editor-buffer and conflict-policy logic and `refactor-prompt.ts` and `word-at-cursor.ts` are pure unit tests (`editor-buffer-state.test.ts`, `refactor-prompt.test.ts`, `word-at-cursor.test.ts`, `workspace-files-session.test.ts`, highlight `symbols.test.ts`). Run only changed test files.
