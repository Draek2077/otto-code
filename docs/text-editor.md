# Text editor

IDE-grade text editing inside Otto — a companion to the AI tooling, not a replacement for an IDE. The goal is that you never feel locked down and need to escape to a real editor for the small stuff: read a file, navigate a project, make a scoped edit, or describe a bigger change and let an agent do it. Bare-minimum configuration, no external processes, no unbundleable dependencies.

Shipped 0.4.4 (Phases 1–5). This doc is the durable architecture; the point-in-time build plan lived in `projects/text-editor/` and was folded in here on completion.

## The core principle: the daemon owns everything file-shaped

The deployment reality drives the whole design: the daemon may run in WSL while the client runs on Windows, or the client is a phone on the far side of the relay. **The client never touches its local filesystem for workspace files.** The editor is a _remote-buffer editor_ — read, write, watch, search, and symbol indexing are all daemon-side, addressed by `(workspaceRoot, relativePath)` exactly like the existing `file_explorer_request`.

Consequences that must survive future changes:

- **Path normalization is daemon-side and POSIX-first.** The client treats paths as opaque keys. Path containment under the workspace root is enforced on the daemon (reusing the explorer's normalization); files outside the workspace root and `~`-scoped paths are viewer-only by design.
  - One deliberate, scoped relaxation: the **Solution view** renders and opens `.csproj` files a solution names outside the workspace root. That is not free browsing — the solution file itself is the authority naming those paths — and editing one still warns through `resolveEditGate`. The rule above governs _browsing_; that one governs _following a solution's own declarations_. See [solution-view.md](solution-view.md#out-of-workspace-projects--stay-out-of-the-way).
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

## What "dirty" means

Dirty is a **comparison against the saved text, not a latch on "an edit happened"**. The editor holds the buffer's baseline (`CodeEditorProps.cleanDoc`, kept live — whenever the baseline moves the prop moves) and re-derives dirty from the document on every change, so an edit that leaves the file equal to what is on disk reports **not dirty** however it got there: an undo, a redo back to clean, a cut whose paste puts it back, retyping the character you deleted. Save and Revert disarm with it.

Two consequences worth keeping:

- **There is no "you are clean now" command.** A save landing, a revert, a reload, "Keep my changes" — all of them reach the editor as a new baseline, and the editor decides whether that leaves it dirty. This is what keeps a save that landed while the user kept typing honestly dirty against the text that was actually written.
- **The comparison must stay cheap.** It runs per keystroke, so it compares CM6 `Text` ropes (`Text.eq` rejects on length/line count first and prunes shared subtrees) rather than building document strings. The baseline reuses the document's own rope whenever the two are the same text — that sharing is what keeps the common case off the full-walk path. See the `cleanDoc` comment in `editor-core.ts`; `editor-core-dirty.browser.test.ts` covers the paths in a real browser, undo included.

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

ctags-style and name-based: no type resolution, so multiple hits are a picker, not a guess. Lives in `packages/server/src/server/file-explorer/code-index.ts`.

> **This index no longer answers definitions.** Go-to-definition, hover, references, rename and diagnostics resolve through a real language server — see [code-intelligence.md](code-intelligence.md). The index is the **designed fallback** (`unavailable`: no server for this language on this host), and it still owns the outline and the fuzzy finder, where name-matching is the honest answer. The "no LSP, ruled out" position this section used to state was reversed when the LSP client shipped.

- **Fuzzy file finder** — `listWorkspaceFiles` returns the gitignore-aware workspace listing (cap 20,000 files); the client does the fuzzy match. Highest value-per-effort, and a top-bar action on mobile (faster than tree-walking on touch).
- **Symbol index** — a name → `[{ path, line, kind }]` map built by walking the same Lezer parse trees the highlighter uses, via **`extractSymbols` from `@otto-code/highlight`** (`packages/highlight/src/symbols.ts`), which reuses the highlighter's trees. Built **lazily per workspace**, cached with a **30 s TTL** (`INDEX_TTL_MS`) and **invalidated on writes/replaces** (`invalidate(root)`); indexing caps at 5,000 files / 1 MB each. Exposed as `code.symbols` (lookup) and the pure lookup helper `findCodeSymbols`.
- **Document outline** — `getFileOutline` parses a single file's current buffer per request (cheap, uncached) via the same `extractSymbols`, exposed as `code.outline`. Client outline UI: `editor-outline-sheet.tsx` (bottom sheet on mobile).
- **Go to definition** — the editor toolbar action (and `Mod-B` / `F12`, both bound because muscle memory splits between JetBrains and VS Code) resolves the identifier under the caret and asks `code.symbols` for it. `use-go-to-definition.ts` turns the answer into one of three outcomes, and the three-way split is the whole design: **one hit jumps** (in-buffer via `goToLine` when the definition is in the open file, otherwise by opening the target file at that line), **several hits open a picker** (`definition-picker-dialog.tsx`, file + line per row) because a name-based index with no type resolution genuinely cannot choose, and **no hits is a plain toast, never an error tone** — the ctags-style walker only sees languages it has a Lezer grammar for, so "not found" is an ordinary answer.

  The identifier itself comes from `getWordAtCursor`, a pull command on `EditorController` alongside `getSelection`, backed by the pure, unit-tested `word-at-cursor.ts`. A caret touching a word on either side resolves to that word; a token starting with a digit resolves to nothing, since a number literal is never a definition. Nothing smarter belongs there — the lookup on the other end could not honour the extra precision.

  One path-shape trap worth keeping — **three spellings of the same file meet here, and comparing them raw is how a same-file jump opens a duplicate tab.** `code.symbols` answers **relative to the workspace it indexed**; `code.definition` answers with an **absolute native path**, because the daemon converts the language server's `file://` URI through `fileURLToPath` (backslashes and a drive letter on Windows); and the open tab's own path may be either. `definition-jump.ts` is the one place that reconciles them: both sides are resolved to a canonical absolute form before deciding in-buffer vs. open (Windows-insensitive via `absolutePathsEqual`), and the path handed on for an open is re-expressed workspace-relative when it lives inside the workspace — the same shape the explorer and chat links use, so the open lands on the existing tab instead of minting a second one keyed on the absolute spelling.

  Downstream of that, `openFileInWorkspace` anchors a relative path to the **pane's** workspace. That is the same root for an ordinary tab and a different root for a linked project's file (gated-multi-root), so `file-tab-pane.tsx` prefixes the tab's own workspace root when they diverge — and skips the prefix for an already-absolute target (a definition outside the workspace), letting the cross-project open gate re-derive the owner.

- **Hover explanations** — resting the pointer on an identifier asks `code.hover`. **The load order is the design here**, because the naive shape (`await provider(...)` inside CM6's `hoverTooltip` source) produces two bad states on a cold server: no tooltip at all, or a tooltip after a long pause. Both come from the same place — **CM6's `HoverPlugin.update` drops a pending source promise on ANY view update and restarts the hover 20 ms later**, so a slow answer was routinely thrown away and re-asked rather than shown late.

  So `buildHoverTooltip` races the provider against a short grace period (`HOVER_GRACE_MS`, 120 ms). Inside the grace it returns the finished tooltip exactly as before — a warm server never renders a placeholder and never costs an extra frame. Past it, the tooltip is returned **synchronously** with a pending body and fills itself in when the answer lands; a synchronous return has no pending promise for `update` to cancel, which is what makes the cold case converge at all. Three rules hold it together:
  - **`hoverTime` is untouched.** CM6's 300 ms pointer-rest delay is not part of this and should not be tuned to compensate for server latency.
  - **Only identifiers get an eager tooltip** (`state.wordAt`), anchored to the whole word so it survives the pointer drifting across it.
  - **The tooltip retracts itself** via `closeHoverTooltips` when the answer is "nothing" or "no server". An empty frame left sitting over the code is worse than no tooltip, and it is the one thing an eager tooltip can get wrong.

  That needs the daemon to tell "nothing to say" apart from "not warmed up yet", which on the wire were the same empty reply. `LspService.hover` returns `indexing` when no server produced markdown and one is still working — the same rule `definition()` and `references()` already used, so no protocol change. `use-code-hover.ts` maps the outcomes to `content` / `none` / `warming` / `unavailable`, and only `warming` is re-asked (`HOVER_RETRY_MS`, ceiling `HOVER_RETRY_CEILING_MS`). It also **skips the document sync when the buffer has not changed** since the last ask — a hover fires on every pointer rest, and re-shipping the whole file each time was the largest cost on the warm path. That memo is keyed on the client and dropped on any non-answer, so a reconnect or a lost daemon-side mirror re-syncs instead of staying wrong.

  The timing is covered by `editor-core-hover.browser.test.ts` against a real CM6 in a real browser — none of it survives a mock.

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

## Keyboard shortcuts: the File Editor scope

Editor shortcuts are ordinary registry bindings that **override** the general Otto bindings while the editor has focus. Not a modal takeover — the override is per combo. `Mod+B` runs Go to definition in the editor and toggles the left sidebar everywhere else; `Ctrl+K` opens the command center in both places, because nothing in the editor claims it.

Three pieces, and each is load-bearing:

1. **The section.** `SHORTCUT_BINDINGS` (`keyboard/keyboard-shortcuts.ts`) has a `"editor"` section — **File Editor** — whose bindings all carry `when: { focusScope: "code-editor" }`. That scope comes from `focus-scope.ts`, which resolves the `data-testid="code-editor-surface"` wrapper before the generic contentEditable test (CM6's content node _is_ contentEditable, so without that check the editor would read as a plain text field). Being registry rows, they are listed and rebindable in Settings like everything else.
2. **Specificity in the matcher.** `bindingSpecificity` ranks a binding that names the focused surface above one that applies everywhere, and `resolveInitialChordStep` / `resolveAdvancingChordStep` pick the most specific match rather than the first. Ties keep first-match-wins, so registry order still decides among equals.
3. **The bridge.** `editor/editor-key-bindings.ts` turns the File Editor rows of the user's _effective_ bindings into a CM6 keymap (`Mod+S` → `Mod-s`), which `file-tab-pane` passes to the editor as `keyBindings`. The core mounts it in its own `Compartment` and exposes `setKeyBindings`, so a rebind lands on an editor that is already open.

The rules that follow from that shape:

- **An Otto shortcut that overlaps an editor one needs no guard.** Put the editor's version in the File Editor section and specificity does the rest. `codeEditor: false` existed only to hand `Mod+B` to the editor by hand and is **gone** — a hardcoded guard cannot follow a rebind, so rebinding Go to definition off `Mod+B` used to leave that combo dead in the editor. Reach for `editable: false` only for scopes with **no** editor binding to hand the combo to (`Mod+F` still carries it, to keep the file finder out of the composer and plain text fields).
- **`editor.*` actions route nowhere.** `routeKeyboardShortcut` returns `none` for them on purpose: CodeMirror executes the command, and matching-then-doing-nothing is exactly what makes the shadowed general action stand down while the keystroke still reaches the editor (the global handler only calls `preventDefault` on an action it performed).
- **The registry is the source of truth; `DEFAULT_EDITOR_KEY_BINDINGS` is its restatement** for hosts that cannot read it — the native webview, which has no shortcuts screen anyway. `editor-key-bindings.test.ts` asserts the two agree, so a default changed in one place fails there rather than silently giving phones a different editor.
- **Not everything in the editor belongs in the registry.** CM6's `defaultKeymap` (select line, undo, indent, the clipboard) is the _platform's_ editor bindings, not Otto's, and stays outside the compartment so a user who never opens Settings still gets a complete editor. Escape-closes-find stays hardcoded too: "Escape, but only while a query is running, and otherwise not mine" is not something a binding can express.
- **Hints must come from the registry.** `useEditorShortcutHints()` reads the four rebindable commands through `useShortcutKeys` and only hardcodes what CM6 owns. Hints are chords (`ShortcutKey[][]`) because a rebind may be one.
- **A command rebound to a multi-step chord loses its editor key.** The chord state machine lives in the global handler; a second, partial one inside CM6 would give the same chord two owners. The Settings row still shows what the user chose.

## The overview ruler (the annotation lane)

The full-height lane down the right edge of the editor — the IDE pattern where the vertical scrollbar also reports where the problems are. It answers "where am I in this file" (a translucent viewport thumb) and "where is everything I care about" (marks for problems, search hits, and the caret), and a click or drag anywhere on it scrolls there.

`editor-overview-ruler.ts` is a CM6 `ViewPlugin` in plain DOM — no React, no app imports — so **native gets it from the same code**, exactly like the diagnostics gutter. `editor-overview-ruler.math.ts` holds the geometry, split out because it is the part that is easy to get wrong and impossible to eyeball; it is unit-tested in plain Node (`editor-overview-ruler.math.test.ts`) rather than in a browser test.

Four decisions worth keeping:

- **It replaces the vertical scrollbar; it does not sit beside one.** The web host passes `vertical: false` to `useWebElementScrollbar` (horizontal overlay only), and the lane's CSS hides the platform's vertical bar for the webview with an axis-scoped `::-webkit-scrollbar:vertical` rule — the horizontal touch indicator survives, because it is the only thing telling a phone user a line runs off the right. Drawing both would spend 26px of the right edge saying the same thing twice, and an auto-hiding thumb next to the marks is a second answer to the same question. The thumb is consequently **always visible** and **translucent**, since it paints over the marks and must not hide the errors that are on screen.

- **Marks are positioned in scroll space, not by line number.** A mark's `y` comes from `view.lineBlockAt(pos).top` — CM6's height map, the same coordinate space as `scrollTop` (this is why `scrollToLineAtOffset` works the way it does). Mapping by line number instead puts a mark where the line "should" be and leaves it a screen away from where clicking it lands, once wrapped lines or an estimated height map are involved. It is also why the plugin redraws on `geometryChanged`: CM6 replacing an estimate with a measurement moves every mark below it.

- **Marks are collapsed into 3px bands before any DOM exists**, worst severity winning a band, so a file with thousands of problems produces a few dozen elements and a warning can never hide the error three lines under it. Problems take the left 62% of the lane and search hits the right 38% — two bands rather than one, because overlapping them would let a hit hide an error. The hit find is currently _on_ takes the full lane width and two extra pixels of height, and outranks an ordinary hit for a shared band: stepping through results has to move a marker you can follow. That distinction is **size, not hue** — in the dark themes `statusWarningStrong` and `statusWarning` are the same amber, so a second colour token would differentiate nothing.

- **Selected ranges are bands, drawn behind the marks.** Painted with the editor's own (translucent) selection fill, so a problem inside a selection still shows through, and floored at the mark height — a three-line selection in a 5000-line file is a fraction of a pixel, and "your selection is around here" is the one thing the band exists to say. Empty ranges are skipped: a bare caret is the cursor mark's job, and a multi-cursor's extra carets are not a selection.

- **The lane is reserved, not overlaid.** `.cm-scroller` carries a matching `padding-right`, which narrows the content box `lineWrapping` measures, so wrapped text breaks at the lane's edge instead of vanishing under it. `overviewRulerWidth: 0` removes the lane and its reservation together — the off switch, same idiom as `rulerColumn: null`.

Clicking is **scroll-only**: the caret does not move and focus does not leave whatever had it, because this is a "let me look over there" gesture and a version that retargeted the caret would lose the user's place every time they glanced at an error. The clicked point is centred rather than put at the top, so the context above a mark is visible too. Hovering a problem mark shows the server's message via the platform `title` tooltip — CM6 tooltips are positioned in document coordinates and this element sits outside the content.

Search-hit marks are gated on the find panel being **open**, not on the query being non-empty: `closeSearchPanel` leaves the last query in state, and marks for a search the user dismissed would point at highlights that no longer exist anywhere else.

Marks come only from state the editor already holds (the diagnostics field, the search query, the selection), so there is no new data channel to keep in sync. **Git-changed lines are the obvious fourth lane and are deliberately absent**: the editor is never told what the file looked like at HEAD, and inventing that channel is a feature, not a mark.

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
