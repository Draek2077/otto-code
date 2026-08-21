# Text editor

IDE-grade text editing inside Otto - a companion to the AI tooling, not a replacement for an IDE. The goal is that you never feel locked down and need to escape to a real editor for the small stuff: read a file, navigate a project, make a scoped edit, or describe a bigger change and let an agent do it. Bare-minimum configuration, no external processes, no unbundleable dependencies.

Shipped 0.4.4 (Phases 1–5). This doc is the durable architecture; the point-in-time build plan lived in `projects/text-editor/` and was folded in here on completion.

## The core principle: the daemon owns everything file-shaped

The deployment reality drives the whole design: the daemon may run in WSL while the client runs on Windows, or the client is a phone on the far side of the relay. **The client never touches its local filesystem for workspace files.** The editor is a _remote-buffer editor_ - read, write, watch, search, and symbol indexing are all daemon-side, addressed by `(workspaceRoot, relativePath)` exactly like the existing `file_explorer_request`.

Consequences that must survive future changes:

- **Path normalization is daemon-side and POSIX-first.** The client treats paths as opaque keys. Path containment under the workspace root is enforced on the daemon (reusing the explorer's normalization); files outside the workspace root and `~`-scoped paths are viewer-only by design.
  - One deliberate, scoped relaxation: the **Solution view** renders and opens `.csproj` files a solution names outside the workspace root. That is not free browsing - the solution file itself is the authority naming those paths - and editing one still warns through `resolveEditGate`. The rule above governs _browsing_; that one governs _following a solution's own declarations_. See [solution-view.md](solution-view.md#out-of-workspace-projects--stay-out-of-the-way).
- **Line endings are detected on read (`lf` | `crlf`) and preserved verbatim on save.** A Windows client must not silently rewrite LF files in a WSL checkout. Content travels LF-normalized on the wire; the daemon re-applies the file's detected EOL. Mixed-EOL files normalize to the dominant ending on save (documented majority rule).
- **Encoding is UTF-8 only.** Non-UTF-8 and binary files stay viewer-only (binary is rejected on the write path with a clear error).
- **File watching uses daemon `fs.watch` with a polling fallback** - the proven `artifact-watcher.ts` pattern. inotify-inside-WSL is the daemon's problem, invisible to the client.

All RPCs use dotted namespaces with `.request`/`.response` suffixes (see [rpc-namespacing.md](rpc-namespacing.md)). No fallback paths: an old daemon means the client shows "Update the host to use this."

## Feature flags

Three capability flags in `server_info.features.*` (`packages/protocol/src/messages.ts`), each `COMPAT(...)`-tagged, added in v0.4.4:

| Flag                     | Gates                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.textEditor`    | The editable buffer + save/revert/dirty guard, disk-sync watching, and the in-file find/replace strip (Phases 1–2). AI Refactor rides on this flag too - there is deliberately **no** separate `aiRefactor` flag; the refactor entry lives on the editor. |
| `features.projectSearch` | Project-wide search and replace (Phase 3). Search and replace shipped together under this one flag.                                                                                                                                                       |
| `features.codeIndex`     | Navigation (Phase 4): fuzzy file finder, document outline, go-to-definition, and the symbol index behind `code.symbols` / `code.outline` / `code.list_files`. Read it through `use-code-index-feature.ts` - every `code.*` caller shares that one gate.   |

## Daemon file RPCs

All live in `packages/server/src/server/session/files/workspace-files-session.ts` (dispatched from `session.ts`):

- **`file.write.request` / `.response`** - conditional write. Request carries `{ cwd, path, content, expectedModifiedAt, expectedHash? }`; the daemon compares mtime/hash before writing and **never clobbers** - a mismatch returns a typed `conflict` result (discriminated union: `ok` | `conflict` | `error`), success returns fresh `modifiedAt` + `sha256` + `size`. Atomic write via `writeFileAtomic` (which gained an optional `mode` so saved executables keep their permission bits). Reads reuse `file_explorer_request` mode `file`, extended with an optional `eol` field on the response.
- **`file.watch.subscribe.request` / `.response`**, **`file.watch.unsubscribe.request` / `.response`**, and a pushed **`file.watch.event`** (`changed` | `deleted` | `recreated`, with fresh `modifiedAt`/hash). Subscriptions exist only for paths open in tabs and are cleaned up on socket close. Editor and viewer share the subscription through a refcounted client API.
- **`file.search.request`** → streamed **`file.search.result`** events + a terminal **`file.search.response`** (JetBrains "Find in Files" semantics - press-enter, not per-keystroke).
- **`file.replace.request` / `.response`** - per-file edit list, each edit preconditioned on `expectedHash`.
- **`file.create` / `file.delete` / `file.rename`** - the mutation surface: what exists in a directory, rather than what is inside a file. Gated separately on `features.fileMutations`, and - unlike `file.write` above - **workspace-bounded**. See [file-mutations.md](file-mutations.md).
- **`code.list_files.response`**, **`code.symbols.response`**, **`code.outline.response`** - the navigation trio (see below).

## What "dirty" means

Dirty is a **comparison against the saved text, not a latch on "an edit happened"**. The editor holds the buffer's baseline (`CodeEditorProps.cleanDoc`, kept live - whenever the baseline moves the prop moves) and re-derives dirty from the document on every change, so an edit that leaves the file equal to what is on disk reports **not dirty** however it got there: an undo, a redo back to clean, a cut whose paste puts it back, retyping the character you deleted. Save and Revert disarm with it.

Two consequences worth keeping:

- **There is no "you are clean now" command.** A save landing, a revert, a reload, "Keep my changes" - all of them reach the editor as a new baseline, and the editor decides whether that leaves it dirty. This is what keeps a save that landed while the user kept typing honestly dirty against the text that was actually written.
- **The comparison must stay cheap.** It runs per keystroke, so it compares CM6 `Text` ropes (`Text.eq` rejects on length/line count first and prunes shared subtrees) rather than building document strings. The baseline reuses the document's own rope whenever the two are the same text - that sharing is what keeps the common case off the full-walk path. See the `cleanDoc` comment in `editor-core.ts`; `editor-core-dirty.browser.test.ts` covers the paths in a real browser, undo included.

## Watch / save-conflict model

The client reacts to files changing under the editor by buffer state:

- **Buffer clean** → silently reload from disk. Agents change files constantly while you watch from a phone, so a file you haven't edited just updates. The viewer gets this behavior too (it's always clean).
- **Buffer dirty** → a non-modal inline banner: **Reload from disk** (discard mine) / **Overwrite** (a conditional write against the disk identity you were shown - not a blind clobber) / **Keep editing** (baseline updates to disk state so the next save is honest). A "Show diff" three-way is deferred until a two-string diff surface exists.
- **File deleted** → informational banner; the buffer is kept so work isn't lost, and save re-creates the file.
- A stale **save conflict** (`file.write` returning `conflict`) surfaces the same banner choice.

The buffer store keeps a debounced `draft` mirror of the live document so host remounts and native-webview crashes can't lose edits; saves still round-trip `getDoc` for the exact buffer. Editor buffers do **not** survive a full app reload (known gap). The dirty-guard `confirmClose` runs on single tab close; bulk closes ("close others/all") currently bypass it.

Client editor state lives in `packages/app/src/editor/` (`editor-buffer-store.ts`, `editor-buffer-state.ts`, `use-editor-buffer.ts`), keyed `(serverId, workspaceStateKey, path)`.

## Project search and replace (`features.projectSearch`)

Daemon-side pure-JS scan - no ripgrep or any spawned binary in v1 (the "nothing spawned" constraint; revisit only with performance evidence). The walker is gitignore-aware, size-capped, binary-sniffing, event-loop-yielding, with a **2000-match cap** and cancellation. One search per session supersedes the previous. Flags: match case, whole word, regex; optional include/exclude glob.

- **gitignore matching** is a pure-JS matcher (`gitignore.ts`) covering the common grammar - not every exotic corner.
- **Replace** is preview-first (JetBrains style): the result list becomes a per-match / per-file checklist. It is **desktop-only** - mobile gets read-only results (the checklist UI doesn't fit touch). Each file preconditions on its preview hash, so files changed since the preview are skipped and reported, never corrupted. Open dirty editor buffers are excluded from the disk replace (replaced in-buffer instead) to avoid the two-writers problem.

Client: `use-project-search-feature.ts`; a "Search" explorer-sidebar tab with results grouped by file, click-to-open at line.

## Navigation: code index, outline, fuzzy finder (`features.codeIndex`)

ctags-style and name-based: no type resolution, so multiple hits are a picker, not a guess. Lives in `packages/server/src/server/file-explorer/code-index.ts`.

> **This index no longer answers definitions.** Go-to-definition, hover, references, rename and diagnostics resolve through a real language server - see [code-intelligence.md](code-intelligence.md). The index is the **designed fallback** (`unavailable`: no server for this language on this host), and it still owns the outline and the fuzzy finder, where name-matching is the honest answer. The "no LSP, ruled out" position this section used to state was reversed when the LSP client shipped.

- **Fuzzy file finder** - `listWorkspaceFiles` returns the gitignore-aware workspace listing (cap 20,000 files); the client does the fuzzy match. Highest value-per-effort, and a top-bar action on mobile (faster than tree-walking on touch).
- **Symbol index** - a name → `[{ path, line, kind }]` map built by walking the same Lezer parse trees the highlighter uses, via **`extractSymbols` from `@otto-code/highlight`** (`packages/highlight/src/symbols.ts`), which reuses the highlighter's trees. Built **lazily per workspace**, cached with a **30 s TTL** (`INDEX_TTL_MS`) and **invalidated on writes/replaces** (`invalidate(root)`); indexing caps at 5,000 files / 1 MB each. Exposed as `code.symbols` (lookup) and the pure lookup helper `findCodeSymbols`.
- **Document outline** - `getFileOutline` parses a single file's current buffer per request (cheap, uncached) via the same `extractSymbols`, exposed as `code.outline`. Client outline UI: `editor-outline-sheet.tsx` (bottom sheet on mobile).
- **Go to definition** - the editor toolbar action (and `Mod-B` / `F12`, both bound because muscle memory splits between JetBrains and VS Code) resolves the identifier under the caret and asks `code.symbols` for it. `use-go-to-definition.ts` turns the answer into one of three outcomes, and the three-way split is the whole design: **one hit jumps** (in-buffer via `goToLine` when the definition is in the open file, otherwise by opening the target file at that line), **several hits open a picker** (`definition-picker-dialog.tsx`, file + line per row) because a name-based index with no type resolution genuinely cannot choose, and **no hits is a plain toast, never an error tone** - the ctags-style walker only sees languages it has a Lezer grammar for, so "not found" is an ordinary answer.

  The identifier itself comes from `getWordAtCursor`, a pull command on `EditorController` alongside `getSelection`, backed by the pure, unit-tested `word-at-cursor.ts`. A caret touching a word on either side resolves to that word; a token starting with a digit resolves to nothing, since a number literal is never a definition. Nothing smarter belongs there - the lookup on the other end could not honour the extra precision.

  One path-shape trap worth keeping - **three spellings of the same file meet here, and comparing them raw is how a same-file jump opens a duplicate tab.** `code.symbols` answers **relative to the workspace it indexed**; `code.definition` answers with an **absolute native path**, because the daemon converts the language server's `file://` URI through `fileURLToPath` (backslashes and a drive letter on Windows); and the open tab's own path may be either. `definition-jump.ts` is the one place that reconciles them: both sides are resolved to a canonical absolute form before deciding in-buffer vs. open (Windows-insensitive via `absolutePathsEqual`), and the path handed on for an open is re-expressed workspace-relative when it lives inside the workspace - the same shape the explorer and chat links use, so the open lands on the existing tab instead of minting a second one keyed on the absolute spelling.

  Downstream of that, `openFileInWorkspace` anchors a relative path to the **pane's** workspace. That is the same root for an ordinary tab and a different root for a linked project's file (gated-multi-root), so `file-tab-pane.tsx` prefixes the tab's own workspace root when they diverge - and skips the prefix for an already-absolute target (a definition outside the workspace), letting the cross-project open gate re-derive the owner.

- **Hover explanations** - resting the pointer on an identifier asks `code.hover`. **The load order is the design here**, because the naive shape (`await provider(...)` inside CM6's `hoverTooltip` source) produces two bad states on a cold server: no tooltip at all, or a tooltip after a long pause. Both come from the same place - **CM6's `HoverPlugin.update` drops a pending source promise on ANY view update and restarts the hover 20 ms later**, so a slow answer was routinely thrown away and re-asked rather than shown late.

  So `buildHoverTooltip` races the provider against a short grace period (`HOVER_GRACE_MS`, 120 ms). Inside the grace it returns the finished tooltip exactly as before - a warm server never renders a placeholder and never costs an extra frame. Past it, the tooltip is returned **synchronously** with a pending body and fills itself in when the answer lands; a synchronous return has no pending promise for `update` to cancel, which is what makes the cold case converge at all. Three rules hold it together:
  - **`hoverTime` is untouched.** CM6's 300 ms pointer-rest delay is not part of this and should not be tuned to compensate for server latency.
  - **Only identifiers get an eager tooltip** (`state.wordAt`), anchored to the whole word so it survives the pointer drifting across it.
  - **The tooltip retracts itself** via `closeHoverTooltips` when the answer is "nothing" or "no server". An empty frame left sitting over the code is worse than no tooltip, and it is the one thing an eager tooltip can get wrong.

  That needs the daemon to tell "nothing to say" apart from "not warmed up yet", which on the wire were the same empty reply. `LspService.hover` returns `indexing` when no server produced markdown and one is still working - the same rule `definition()` and `references()` already used, so no protocol change. `use-code-hover.ts` maps the outcomes to `content` / `none` / `warming` / `unavailable`, and only `warming` is re-asked (`HOVER_RETRY_MS`, ceiling `HOVER_RETRY_CEILING_MS`). It also **skips the document sync when the buffer has not changed** since the last ask - a hover fires on every pointer rest, and re-shipping the whole file each time was the largest cost on the warm path. That memo is keyed on the client and dropped on any non-answer, so a reconnect or a lost daemon-side mirror re-syncs instead of staying wrong.

  The timing is covered by `editor-core-hover.browser.test.ts` against a real CM6 in a real browser - none of it survives a mock.

## Editor engine: CodeMirror 6 + platform split

CM6 was chosen because the `@otto-code/highlight` package is already built on Lezer - CM6's parser system - and already depends on `@codemirror/language` and `@codemirror/legacy-modes`. It is MIT, pure JS, no worker processes, viewport-virtualized for large files, and `@codemirror/search` provides the JetBrains find/replace feature set. Monaco was rejected (size, worker architecture, discards the Lezer investment); extending the RN token renderer into an editor was rejected (reimplementing selection/undo/IME/search).

One engine, four platforms, per the Metro-extension rule (no `if (isWeb)` sprawl):

- **`editor-core.ts`** - framework-agnostic setup: extensions (line numbers, history, language from `getParserForFile`, search), a theme built from Otto tokens (`editor-theme.ts`), and a typed command surface (`editor-contract.ts`: getDoc/setDoc, find/replace ops, `getSelection`, dirty events) that both hosts drive.
- **`code-editor.tsx`** - CM6 mounted directly in a DOM node (web + Electron).
- **`code-editor.native.tsx`** - the same CM6 bundle hosted in `react-native-webview` with a message bridge (the terminal's pattern). The webview HTML is generated from `editor/webview/editor-webview-entry.ts` via a build script (`build:editor-webview`) and ships minified inline in the app bundle.

CM6's highlight tags are the same Lezer tags the highlighter consumes, so themes map straight from Otto's design tokens ([design.md](design.md)).

Two appearance rules the spec exists to enforce, both learned the hard way:

- **`activeLineBackground` must stay translucent, and the stripe must stay a line
  decoration.** These are one rule, because each half is what makes the other survivable.

  `drawSelection` renders into `.cm-selectionLayer` at a _negative_ z-index - behind the
  content - so an **opaque** background on `.cm-line` hides the selection on the caret's
  line completely. That was the original bug; upstream never sees it because CM6's own
  default fill is `#cceeff44`. The fix is to match upstream and keep the fill translucent
  (currently the foreground at 6%, well under the selection's 15–20% so an overlap still
  reads as _selected_).

  The tempting alternative - move the stripe into its own `layer({above: false})`
  registered after `drawSelection()` so it stacks underneath - **was built twice and
  reverted twice.** It works in principle, but a layer's rectangle has to be _computed_ to
  match the row instead of _being_ the row, and it kept landing in the wrong place: layers
  mount on `view.scrollDOM` and position against CM6's `getBase()` (the scroller's rect
  minus its scroll offset), so marker `(0, 0)` is left of the **gutters** and above
  `.cm-content`'s padding, while `BlockInfo.top` - the only vertical coordinate CM6 gives
  you for a line - is in _document_ space. Even with that conversion right, the stripe,
  the row and the gutter each ended up a different height. A `.cm-line` background can't
  drift from the row it paints: it is the row's own box.

  So: don't reach for a layer, and don't make the fill opaque. If the current line needs
  more presence, raise the alpha.

- **Search matches must not reuse the selection color.** They did (both were
  `terminal.selectionBackground`), which made a hit invisible exactly when you were also
  selecting. Matches are amber - the semantic `statusWarning*` surfaces - with an
  `outline` (never a `border`: an inline mark must not reflow the line it sits on), and the
  active hit steps up to the stronger fill plus a 2px outline.

**`EditorThemeSpec` is the whole appearance surface.** Both hosts receive concrete values (never CSS variables - nested palettes like `colors.syntax` have no per-token variable on web), so anything the editor should render differently belongs in that struct rather than in host-specific code. Most fields come from the Unistyles theme via `buildEditorThemeSpec(theme)`; a field driven by device-local app settings instead (`rulerColumn`) is merged in by the host in `file-tab-pane.tsx`, because the `withUnistyles` mapping only ever sees the theme.

The **line-length ruler** (Settings → Appearance → Syntax; `rulerEnabled` / `rulerColumn`, default on at column 80, clamped to 80–240) is drawn as a 1px `linear-gradient` stripe on `.cm-content` - no decorations, no overlay element, and it paints behind the text. It uses the `ch` unit, so it tracks the code font size for free, and it needs no repeat on the active line: the active-line fill is translucent (see above), so the ruler shows straight through it. The stripe therefore spans the content box only - which is `max(longest line, viewport)`, so a column the ruler doesn't reach is also one the user could never scroll to.

## Keyboard shortcuts: the File Editor scope

Editor shortcuts are ordinary registry bindings that **override** the general Otto bindings while the editor has focus. Not a modal takeover - the override is per combo. `Mod+B` runs Go to definition in the editor and toggles the left sidebar everywhere else; `Ctrl+K` opens the command center in both places, because nothing in the editor claims it.

Three pieces, and each is load-bearing:

1. **The section.** `SHORTCUT_BINDINGS` (`keyboard/keyboard-shortcuts.ts`) has a `"editor"` section - **File Editor** - whose bindings all carry `when: { focusScope: "code-editor" }`. That scope comes from `focus-scope.ts`, which resolves the `data-testid="code-editor-surface"` wrapper before the generic contentEditable test (CM6's content node _is_ contentEditable, so without that check the editor would read as a plain text field). Being registry rows, they are listed and rebindable in Settings like everything else.
2. **Specificity in the matcher.** `bindingSpecificity` ranks a binding that names the focused surface above one that applies everywhere, and `resolveInitialChordStep` / `resolveAdvancingChordStep` pick the most specific match rather than the first. Ties keep first-match-wins, so registry order still decides among equals.
3. **The bridge.** `editor/editor-key-bindings.ts` turns the File Editor rows of the user's _effective_ bindings into a CM6 keymap (`Mod+S` → `Mod-s`), which `file-tab-pane` passes to the editor as `keyBindings`. The core mounts it in its own `Compartment` and exposes `setKeyBindings`, so a rebind lands on an editor that is already open.

## Vim keybindings and Otto action mappings

The existing **Vim keybindings** setting is off by default and enables a constrained in-app Vim
emulation on the web/Electron File Editor. It is not a Vim or Neovim runtime and does not read
`.vimrc`, Lua, plugins, or arbitrary commands.

Phase 1B adds one device-local settings field:

```ts
vimMappings: {
  leader: "Space",
  mappings: Partial<Record<
    "save" | "find" | "goToDefinition" | "findReferences" |
    "renameSymbol" | "openFileSearch" | "openChanges" | "newTerminal",
    string
  >>
}
```

Mapping values are one or two ASCII letters or numbers after the Space leader. Invalid actions,
leaders, keys, and duplicate sequences are discarded during settings loading; the first action in
the documented order keeps a duplicate. Mappings run only in Vim normal mode on the focused file
editor. They route to existing editor callbacks or the keyboard action dispatcher, so LSP and
developer-mode capability gates remain authoritative. No mapping claims modifier chords, terminal
input, message input, browser shortcuts, or other editor surfaces.

The mapping dispatcher accumulates the full one- or two-character sequence. Escape cancels a
pending leader without replaying Space into Vim, while timeout or an unrelated key replays the
leader so ordinary Vim motion semantics are preserved. Reconfiguring or destroying the editor
cancels the pending timer.

The supported actions are Save, Find, Go to definition, Find references, Rename symbol, File
search, Changes, and New terminal. Code formatting, code actions, and agent chat are not exposed by
this mapping surface until each has a stable, honest editor entry point.

The rules that follow from that shape:

- **An Otto shortcut that overlaps an editor one needs no guard.** Put the editor's version in the File Editor section and specificity does the rest. `codeEditor: false` existed only to hand `Mod+B` to the editor by hand and is **gone** - a hardcoded guard cannot follow a rebind, so rebinding Go to definition off `Mod+B` used to leave that combo dead in the editor. Reach for `editable: false` only for scopes with **no** editor binding to hand the combo to (`Mod+F` still carries it, to keep the file finder out of the composer and plain text fields).
- **`editor.*` actions route nowhere.** `routeKeyboardShortcut` returns `none` for them on purpose: CodeMirror executes the command, and matching-then-doing-nothing is exactly what makes the shadowed general action stand down while the keystroke still reaches the editor (the global handler only calls `preventDefault` on an action it performed).
- **The registry is the source of truth; `DEFAULT_EDITOR_KEY_BINDINGS` is its restatement** for hosts that cannot read it - the native webview, which has no shortcuts screen anyway. `editor-key-bindings.test.ts` asserts the two agree, so a default changed in one place fails there rather than silently giving phones a different editor.
- **Not everything in the editor belongs in the registry.** CM6's `defaultKeymap` (select line, undo, indent, the clipboard) is the _platform's_ editor bindings, not Otto's, and stays outside the compartment so a user who never opens Settings still gets a complete editor. Escape-closes-find stays hardcoded too: "Escape, but only while a query is running, and otherwise not mine" is not something a binding can express.
- **Hints must come from the registry.** `useEditorShortcutHints()` reads the four rebindable commands through `useShortcutKeys` and only hardcodes what CM6 owns. Hints are chords (`ShortcutKey[][]`) because a rebind may be one.
- **A command rebound to a multi-step chord loses its editor key.** The chord state machine lives in the global handler; a second, partial one inside CM6 would give the same chord two owners. The Settings row still shows what the user chose.

## The overview ruler (the annotation lane)

The full-height lane down the right edge of the editor - the IDE pattern where the vertical scrollbar also reports where the problems are. It answers "where am I in this file" (a translucent viewport thumb) and "where is everything I care about" (marks for problems, search hits, and the caret), and a click or drag anywhere on it scrolls there.

`editor-overview-ruler.ts` is a CM6 `ViewPlugin` in plain DOM - no React, no app imports - so **native gets it from the same code**, exactly like the diagnostics gutter. `editor-overview-ruler.math.ts` holds the geometry, split out because it is the part that is easy to get wrong and impossible to eyeball; it is unit-tested in plain Node (`editor-overview-ruler.math.test.ts`) rather than in a browser test.

Four decisions worth keeping:

- **It replaces the vertical scrollbar; it does not sit beside one.** The web host passes `vertical: false` to `useWebElementScrollbar` (horizontal overlay only), and the lane's CSS hides the platform's vertical bar for the webview with an axis-scoped `::-webkit-scrollbar:vertical` rule - the horizontal touch indicator survives, because it is the only thing telling a phone user a line runs off the right. Drawing both would spend 26px of the right edge saying the same thing twice, and an auto-hiding thumb next to the marks is a second answer to the same question. The thumb is consequently **always visible** and **translucent**, since it paints over the marks and must not hide the errors that are on screen.

- **Marks are positioned in scroll space, not by line number.** A mark's `y` comes from `view.lineBlockAt(pos).top` - CM6's height map, the same coordinate space as `scrollTop` (this is why `scrollToLineAtOffset` works the way it does). Mapping by line number instead puts a mark where the line "should" be and leaves it a screen away from where clicking it lands, once wrapped lines or an estimated height map are involved. It is also why the plugin redraws on `geometryChanged`: CM6 replacing an estimate with a measurement moves every mark below it.

- **Marks are collapsed into 3px bands before any DOM exists**, worst severity winning a band, so a file with thousands of problems produces a few dozen elements and a warning can never hide the error three lines under it. Problems take the left 62% of the lane and search hits the right 38% - two bands rather than one, because overlapping them would let a hit hide an error. The hit find is currently _on_ takes the full lane width and two extra pixels of height, and outranks an ordinary hit for a shared band: stepping through results has to move a marker you can follow. That distinction is **size, not hue** - in the dark themes `statusWarningStrong` and `statusWarning` are the same amber, so a second colour token would differentiate nothing.

- **Selected ranges are bands, drawn behind the marks.** Painted with the editor's own (translucent) selection fill, so a problem inside a selection still shows through, and floored at the mark height - a three-line selection in a 5000-line file is a fraction of a pixel, and "your selection is around here" is the one thing the band exists to say. Empty ranges are skipped: a bare caret is the cursor mark's job, and a multi-cursor's extra carets are not a selection.

- **The lane is reserved, not overlaid.** `.cm-scroller` carries a matching `padding-right`, which narrows the content box `lineWrapping` measures, so wrapped text breaks at the lane's edge instead of vanishing under it. `overviewRulerWidth: 0` removes the lane and its reservation together - the off switch, same idiom as `rulerColumn: null`.

Clicking is **scroll-only**: the caret does not move and focus does not leave whatever had it, because this is a "let me look over there" gesture and a version that retargeted the caret would lose the user's place every time they glanced at an error. The clicked point is centred rather than put at the top, so the context above a mark is visible too. Hovering a problem mark shows the server's message via the platform `title` tooltip - CM6 tooltips are positioned in document coordinates and this element sits outside the content.

Search-hit marks are gated on the find panel being **open**, not on the query being non-empty: `closeSearchPanel` leaves the last query in state, and marks for a search the user dismissed would point at highlights that no longer exist anywhere else.

Marks come only from state the editor already holds (the diagnostics field, the search query, the selection), so there is no new data channel to keep in sync. **Git-changed lines are the obvious fourth lane and are deliberately absent**: the editor is never told what the file looked like at HEAD, and inventing that channel is a feature, not a mark.

## The status bar

`EditorStatusBar` (`packages/app/src/editor/editor-status-bar.tsx`) is the strip along the bottom of the file pane: **file type and size on the left, line endings + encoding + caret position on the right**. Read-only by design - every item reports state, so nothing in it is pressable (unlike VS Code's, where the same items are click targets). Items are icon + label at `iconSize.xs`/`fontSize.xs`, and the caret readout uses `tabular-nums` so the bar doesn't twitch sideways as the caret moves.

It renders in **all three view modes**, with items dropping out when the mode or the file genuinely has nothing to report:

| Mode             | Type | Size | Pixels        | EOL          | Encoding                | Caret            |
| ---------------- | ---- | ---- | ------------- | ------------ | ----------------------- | ---------------- |
| Editor           | ✔    | ✔    | -             | ✔            | ✔                       | ✔                |
| Split            | ✔    | ✔    | -             | ✔            | ✔                       | ✔ (the editor's) |
| Preview (text)   | ✔    | ✔    | -             | ✔            | ✔                       | - no editor      |
| Preview (image)  | ✔    | ✔    | ✔ if readable | - none exist | - never decoded as text | -                |
| Preview (binary) | ✔    | ✔    | -             | - none exist | - never decoded as text | -                |

The two modes feed it from different sources - the editor from its buffer baseline, the preview from its own read - so `eol` and `isText` are props rather than something the bar derives. Preview-mode EOL required threading the daemon's detected value through `FileReadResult` → `ExplorerFile` → `FilePreviewFileInfo`; it stays optional the whole way because only the inline JSON read path reports it (the chunked binary transfer never does), and a null means "not reported", never "LF".

Where each value comes from - worth knowing before adding a fifth item, because none of them arrive the obvious way:

- **File type** - `getLanguageDisplayName(path)` from `@otto-code/highlight` (`language-names.ts`). Deliberately a _separate_ registry from `parsersByExtension`: the editor opens any text file, so the label has to name plenty of formats we have no grammar for. A missing grammar means no syntax colors, not an unnamed file. Unknown extensions fall back to the extension in caps, never to "Unknown".
- **Size** - in preview it is the daemon's reported `size`; in the editor it is computed from `baseline.content` (`useBufferByteSize`) rather than carried in the buffer state. The daemon's read result does include `size`, but `use-editor-buffer.ts` builds baselines at six sites and two of them (conflict reload, event rebaseline) have no daemon size to pass, so a required `size` field would have to be faked at exactly the places it would be wrong. `utf8ByteSize()` re-adds one byte per line for CRLF files, since the buffer is LF-normalized on load. Memoized on the baseline - recomputing per keystroke would walk the whole file for a number that describes the disk, not the draft.
- **Pixel size** - parsed from the image's own container header before the first paint (see the image viewer below), not measured from the rendered element. Absent for a format we have no header reader for, because an invented size would be worse than a missing one.
- **Encoding** - the constant `"UTF-8"`. The daemon decodes text as UTF-8 unconditionally and nothing in the stack sniffs a charset, so this states what we actually did rather than implying a detection we don't perform. If real detection ever lands, `ENCODING_LABEL` is the single place to change.
- **Caret position** - `onCursorMoved`, a push callback added because neither existing selection hook fits: `getSelection()` is pull-only, and `onPointerSelect` fires for pointer selections only, so both miss plain arrow-key movement. Column is 1-based in **UTF-16 code units** - the same unit CM6 uses for offsets, so the readout always agrees with the editor's own idea of a position (an astral emoji advances it by 2).

Adding a push callback to the editor means seven touchpoints, all of which must land together or native silently loses the feature: the payload type + `CodeEditorProps` and the `EditorWebViewOutbound` variant (`editor-contract.ts`), `EditorCoreOptions` + the `updateListener` emit + an initial emit after the view is constructed (`editor-core.ts`), the web host forward (`code-editor.tsx`), the webview `sendToNative` (`webview/editor-webview-entry.ts`), and the native `handleMessage` case (`code-editor.native.tsx`). **Then rerun `npm run build:editor-webview`** - the webview bundle is a generated, committed file, so native runs whatever was last built, not your source.

A **pull command** (`getDoc`, `getSelection`, `getWordAtCursor`) has the same trap and a different list: an `EditorController` method plus a request/reply pair on `EditorWebViewInbound`/`Outbound` (`editor-contract.ts`), the `EditorCore` implementation (`editor-core.ts`), the web host's synchronous `Promise.resolve` bridge (`code-editor.tsx`), the webview's `receive` branch answering with the `requestId` (`webview/editor-webview-entry.ts`), and - on native - a pending-request map with a timeout, a `settlePendingReply` branch, and unmount rejection (`code-editor.native.tsx`). That native trio is why the message switches there are split into `settlePendingReply` / `forwardPushedEvent`: every new command adds a branch to exactly one of them. Rerun the webview build the same way.

## The unified file tab and view modes

Originally two tab kinds (a `file` viewer and an `editor` buffer) were planned; they were folded into a **single `file` tab kind** hosting three views behind an icon mode bar, **`FileViewModeBar`** (`packages/app/src/components/file-view-mode-bar.tsx`, hosted by `file-tab-pane.tsx`):

- **Editor**
- **Editor + preview split** - web/desktop only; a draggable `ResizeHandle` ratio with proportional scroll sync and click-to-align (`file-split-sync.ts`).
- **Preview**

Riding in the same bar, behind a divider, is one control that is deliberately **not** a mode: **Formatted** (see [Live preview](#live-preview)). Read the rules for adding to this bar in [Three modes and one axis](#three-modes-and-one-axis) before adding a fourth glyph.

**Preview reads are gated on visibility, never on focus.** The preview's read (`isFileQueryEnabled` in `file-pane-enabled.ts`) is disabled while its tab is hidden or the app is backgrounded, so a revisited tab refetches instead of showing a frozen snapshot. A disabled query is indistinguishable from an in-flight one - both are `isPending` - so anything that wrongly reports "not visible" leaves the pane spinning "Loading file..." forever, with no timeout and no error to explain it. Use `getIsAppInForeground` (AppState + `document.visibilityState`) for that gate, **not** `getIsAppActivelyVisible`, which additionally requires `document.hasFocus()`: focus leaves the host document for an Electron `<webview>`, devtools, or a second window while the pane is plainly on screen. Reserve the focus-sensitive predicate for "is the user actually looking at this chat" questions like attention-clearing and notifications.

The view mode is remembered per file in `file-view-store.ts`, with a path-derived default (`defaultFileViewMode`): rendered formats (markdown, images, binaries) open in preview; plain text/code opens straight in the editor. The editor buffer survives mode switches (preview renders the live draft); the discard guard runs only on tab close. Persisted legacy `editor` tab targets coerce to `file` targets - see **`COMPAT(unifiedFileTab)`** in the workspace-tabs store (`packages/app/src/stores/workspace-tabs-store/state.ts`).

### The toolbar in a narrow pane

Both file toolbars (editor and preview) hold more buttons than a split pane, a phone, or a
sidebar-squeezed workspace can fit. When the row runs out of room it **sheds buttons**, least
important first, rather than overflowing: the overflow used to push the mode bar off the right edge,
which is the one control that gets the user back to a wider view.

`file-toolbar-collapse.ts` owns the order, and it is the whole contract:

1. Refine with AI
2. Export as HTML
3. Export as PDF
4. Find in Files
5. View Changes
6. Outline
7. Word wrap

Everything else stays: save, revert, file history, Add to chat, the external-editor button, Find, the
host's leading slot, and the mode bar. Collapsed actions are **hidden, not moved into an overflow
menu** - a "..." that only exists when the pane is narrow is a second place to look for a control
that was somewhere else a moment ago, and each of these has another way in (the file explorer's
context menu, the Changes tab, a shortcut). Widen the pane and the buttons come back in reverse
order.

Two things the implementation must keep:

- **The decision is made against the bar's full width, never its current one.** The hook measures the
  two groups either side of the spacer and adds the collapsed buttons' widths back arithmetically, so
  collapsing a button cannot change the input that decided to collapse it. Deciding from the live
  width oscillates: dropping a button can also drop a group separator, the row now fits, the button
  comes back, and the row overflows again.
- **The groups are measured, not estimated.** The mode bar and the host's leading slot are arbitrary
  content; only the collapsible icon buttons are computed, from `useToolbarIconButtonWidth`, which
  lives beside the padding the button actually renders with.

## The image viewer

`packages/app/src/components/image-preview.tsx` owns the whole pane for an image file. There is no editor and no split for one - `editorAllowed` in `file-tab-pane.tsx` is false for any non-text `kind`, which withholds the mode bar entirely rather than showing a switch with two dead positions - so the viewer is free to spend the bottom-right corner on its own zoom controls.

- **The natural size is parsed from the container header, not measured.** `image-dimensions.ts` reads PNG, GIF, JPEG, WebP (all three sub-formats), BMP, ICO and SVG, sniffing the magic bytes rather than trusting the MIME type the daemon derived from the extension. It has to be synchronous and available on the first frame, because fit-to-pane, the zoom percentage and the status-bar readout are all ratios against it - `Image.getSize` is asynchronous and would make the first frame guess, and there is no equivalent at all for the raw-XML SVG branch. No pixels are decoded, so the cost is independent of file size. **An unreadable container is an ordinary answer, not an error:** `readImageDimensions` returns null, the pane falls back to a plain contain-fit, and the zoom controls are withheld rather than lying about a ratio they don't have.
- **Fit never upscales.** `fitScale` is capped at 1 (`image-zoom.ts`), so fitting shrinks an image too big for the pane and leaves a small one alone. Blowing a 16×16 favicon up to fill a desktop pane is not "fit", it is a decision the user didn't ask for - and the `+` button is right there.
- **Zoom is a ladder, not a multiplier.** A ×1.2 step drifts past 100% and leaves the user unable to land on it. `ZOOM_STEPS` is walked with a strict, epsilon-guarded comparison so a step from an arbitrary fit ratio (0.8123) reaches the next rung rather than snapping back to the one it is already past.
- **"Fit" is a mode, null, not a number.** That is what makes the image re-fit when the pane is resized or the sidebar opens. Storing the computed ratio instead would freeze it at whatever the pane happened to be when the file opened.
- **Panning is scrolling.** Both platforms already have a tuned, momentum-carrying, scrollbar-drawing scroller (the same nested vertical/horizontal pair the code preview uses), and a hand-rolled translate-the-image pan would reimplement it worse. Web additionally gets drag-to-pan on top - a mouse cannot flick a scroll view - through the React Native responder props, attached **only** under `isWeb`: on native the scroll view already owns the drag, and claiming the responder there would take panning away rather than add it.
- **Ctrl/Cmd + wheel zooms, and it must be a real DOM listener.** `preventDefault` on a non-passive `wheel` handler is what stops the browser zooming the whole app instead, and React Native has no wheel prop to hang that on - so this is one of the sanctioned web-only reach-throughs, cast from the container's `View` ref. It covers trackpad pinch for free, which reports as a ctrl-wheel. **Native has no pinch-to-zoom**; the buttons are the zoom there. Adding it means a gesture-handler pinch composed with two nested scroll views, which is not a change to make blind.
- **The transparency checker is a `withUnistyles`-wrapped leaf.** `fill` is an SVG presentation attribute, not a React Native style, so it cannot ride the ShadowRegistry path and `themeColorRef` explicitly does not work for it ([unistyles.md](unistyles.md)). Wrapping the one SVG node is the sanctioned route for a theme-reactive non-`style` prop, and only that node re-renders on a theme change. It sits behind the image box only, not the whole pane - the checker is there to say "these pixels are transparent", and a pane-wide one would be saying it about the padding too.

A **binary** file that is not an image ends at `BinaryPreview` in `file-pane.tsx`: a plain statement plus the facts a file manager would show (kind, size, extension, modified). It stays a statement rather than becoming a hex dump on purpose - a hex view of an arbitrary binary answers a question almost nobody opening a file tab is asking.

Fixtures: `test-documents/image.png` (raster path, with a fully transparent quadrant for the checker) and `test-documents/logo.svg` (the SVG path, which takes different code from the read onward), plus `test-documents/binary.bin` for the card above.

**Find in the read-only preview** mirrors the editor's find strip minus replace (there is no buffer to write to). It does **not** go through CodeMirror - the preview renders a token stream per line, so find is a pure text scan (`file-preview-find.ts`: `findPreviewMatches` + `splitTokensForMatches`, both unit-tested) whose match semantics (case / whole-word / regexp) match `@codemirror/search` so the same query finds the same things in both views. Matched runs are re-cut out of the syntax tokens and tinted (base tint for every hit, stronger for the active one), the count feeds the strip, and next/previous scrolls the active hit into view. It is gated to the **syntax-highlighted text preview only** (`PreviewOnlyView` shows the button when `fileInfo.kind === "text" && !isMarkdown`): rendered markdown has no line-mapped text to highlight and images/binaries have no text, so those keep no find button - switch to the editor to search a markdown file. Matching caps at `MAX_PREVIEW_FIND_MATCHES` (shown as `999+`) so a one-letter query over a huge file can't build a million-entry array.

**Rendered-document annotations** attach a source-backed rendered Markdown item to the current workspace context. For now, every source-mapped Markdown heading exposes a compact comment glyph; after an attachment is saved, it becomes a blue Chat glyph beside the heading. Clicking the glyph opens the shared Changes diff-comment editor in a trigger-anchored popup, leaving the rendered document's layout untouched. When reopening a saved comment, a destructive trash icon before Cancel removes its workspace attachment and closes the popup. Removing its Composer pill does the same and removes the corresponding heading glyph. Each attachment retains a renderer-specific locator, exact source line range (including frontmatter offsets), source excerpt, and the user's note. It follows the same workspace-scoped attachment semantics as Browser: saving it remains possible from a File tab, and the workspace Composer shows the pill when its chat is active. Paragraph, blockquote, and fenced-code locators are retained for future renderer entry points, but do not currently expose an action. A Markdown document remains annotatable when it merely documents literal HTML in prose or code. Converted AsciiDoc, standalone Mermaid, isolated HTML, images, and an item inside a renderer-created HTML fragment do not expose an annotation affordance: their visual output cannot yet be traced to an honest source item.

## Markdown: the format the editor edits

Every other format the editor opens, it colours. Markdown it edits. The architecture of that lives
in `packages/app/src/editor/markdown/`, and five decisions hold it together.

**One engine.** Live preview is CM6 **decorations**, never a second editor. The document is never
rewritten, which is what keeps find/replace, the dirty-against-baseline comparison, the overview
ruler, the LSP mirror and undo all operating on exactly the text that is on disk. A rendered
document model (ProseMirror, muya) would have to reimplement every one of them, and would
reimplement them worse. Do not trade this away.

**The commands decline outside markdown, and that is the whole keymap design.** Every formatting
command checks `markdownLanguage.isActiveAt` and returns false when the answer is no. Because CM6
tries same-key bindings in array order, one keymap can therefore serve `Mod-b` as **bold** in a
`.md` file and as **Go to definition** in a `.ts` one, with no binding aware of which file is open.
The markdown entries must be offered the key **first** - `DEFAULT_EDITOR_KEY_BINDINGS` and the
Markdown Editor registry section are both ordered ahead of the File Editor ones for that reason, and
`editor-key-bindings.test.ts` asserts it. The same property means bold inside a fenced ```ts block
correctly does nothing: the markdown language is not active there.

**`markdown-editor` is a focus scope with a parent.** It is the only scope in
`KeyboardFocusScope` that inherits: `FOCUS_SCOPE_PARENT` maps it to `code-editor`, so Save, Find
and Go to line are declared once and keep matching in a markdown file. `bindingSpecificity` has
three ranks (exact scope, inherited scope, unscoped) so an exact match still outranks an inherited
one. The scope exists because a few markdown combos collide with global actions - `Mod+K` is a link
here and the command center everywhere else - and claiming those at `code-editor` scope would take
them away in **every** code file, where the markdown command declines and the key would simply die.

**Heading levels get no keys, deliberately.** Every conventional combo (`Mod+1`, `Alt+1`,
`Mod+Alt+1`) is already a workspace or tab jump, and taking navigation away inside one file type
costs more than a heading shortcut is worth. They live on the toolbar.

**The transforms are pure and the commands are thin.** `markdown-format.ts` and
`markdown-table.ts` take `(doc, selection)` and return a single replacement, so the parts that are
easy to get wrong and impossible to eyeball - which markers to strip, ordered-list renumbering,
table column widths, what stays selected so a second keystroke round-trips - are unit-tested in
plain Node. The CM6 wrappers only read the selection, call a transform and dispatch. The toolbar
runs the _same_ commands through `EditorController.runMarkdownCommand`, so a button and a key can
never diverge.

### Live preview

Markers hide on every line except the one the caret is on. Two rules:

- **Reveal is per line, decided from the selection**, not per node. A node-level reveal makes text
  jump sideways as the caret crosses a marker; per-line is what every editor that does this well
  settled on.
- **Only markers hide, never content.** A hidden marker is zero-width, so arrow keys still traverse
  it and a selection over it still copies it.

Two traps, both found by the browser test rather than by reading the code. A fenced block's own
backtick lines are `CodeMark`s too, and hiding them collapses the fence into the prose around it,
so only _inline_ code marks hide. And block markers own the whitespace that separates them from
their content: hiding just the `#` of a heading leaves it indented by one space.

It defaults **on**, unlike every other editor preference, because it is the point of editing
markdown in a markdown editor rather than a text editor.

`markdown-live-preview.browser.test.ts` covers it against real CM6 in a real browser, asserting the
**rendered text of the content DOM** rather than the decoration set: a decoration that exists but
hides nothing would pass a structural assertion and fail the user.

### Three modes and one axis

**Formatted is not a fourth view mode, and the divider in the mode bar is what says so.** The
control lives in `FileViewModeBar` as a trailing segment after `Editor | Split | Preview`, separated
by a rule; state stays in `markdownLivePreview` (`editor-prefs-store.ts`), device-local and global,
never in `FileViewMode`.

This shape was chosen over folding it into the mode enum, and the reason is the only thing here
worth remembering. **The modes and this flag are orthogonal, so together they are a 2x2:
{Editor, Split} x {Formatted on, off}, plus Preview.** Collapsing that into a 1x4 buys one label at
the cost of one cell, and the cell it takes is the best one: **a formatted editor beside the
rendered preview**, which is where ticking a checkbox in the right pane edits the document in the
left one (`onToggleTask` in `file-tab-pane.tsx`). No arrangement of four radio positions can express
"split, and the editor half is formatted", because a radio group only ever holds one answer.

Three rules follow, and each is load-bearing:

- **The segment is withheld for non-markdown files** (`formatted: null`), the same withhold-rather-
  than-show-a-dead-position rule the image viewer applies to the whole bar.
- **In Preview mode it stays visible and goes inert** (`disabled: true`), which is the one place this
  differs from the withhold rule, and on purpose. A markdown file in Preview still has a formatted
  editor, you are simply not looking at it, so the control keeps its place instead of making the bar
  change width every time the mode does.
- **Formatted governs the editor pane, so it is live in Editor and in Split alike.** Anything that
  reads it per-mode has misunderstood the axis.

The complaint that produced this was **discoverability, not structure**: the toggle used to sit
pinned on the markdown toolbar, which only appears for markdown files, so it read as a formatting
button next to bold and italic rather than as the thing that decides what the document looks like.
Moving it into the mode bar puts it where people already look for a view control, while the divider
keeps it honest about not being one. The markdown toolbar is now uniformly **commands that act on a
selection**; if you are tempted to pin a second whole-document control there, put it in the mode bar
instead.

The UI label is **Formatted** (`editor.viewMode.formatted`, tooltip "Formatted markdown"), and the
glyph is Material's `wysiwyg`. Do not label it "Live preview" on screen: the bar already contains a
mode called Preview, and two controls a divider apart both saying "preview" is exactly the confusion
this arrangement exists to prevent. "Live preview" stays the name of the mechanism in code and in
this document. See [glossary.md](glossary.md).

### The toolbar is the mobile story

On a phone there are no chords, so the formatting toolbar is not a convenience, it is the only way
to reach these commands at all. That is why it scrolls horizontally instead of collapsing into an
overflow menu - a menu would bury the two or three buttons people actually reach for behind a tap.
Every command with a desktop key has a button.

### Headings are client-side, and must stay that way

`extractMarkdownHeadings` (`packages/highlight/src/markdown-headings.ts`) is deliberately **not**
part of `extractSymbols`. `CodeSymbolKindSchema` is a five-value `z.enum` on the wire, so a daemon
answering `code.outline` with `kind: "heading"` would make a six-month-old client reject the entire
response - which the protocol contract forbids, and which no feature flag fixes, because clients
never advertise which enum values they tolerate. The client already holds the document it wants an
outline of, so there was nothing to ask the daemon for. The shape is also better: a heading carries
its level, which the flat `SymbolKind` cannot express and a table of contents needs. It parses
rather than scanning for `#`, because only a parse knows a `#` inside a fenced block is a comment.

The outline sheet consequently sources markdown from the **open buffer**, not `code.outline`: the
outline of a document you are editing should follow the heading you just typed.

### Paste

Pasting HTML into a markdown file converts it (Turndown, configured to emit the same markers the
formatting commands produce, plus a GFM table rule Turndown does not ship). It is a DOM `paste`
handler rather than a keymap entry because paste is not only a keystroke - the context menu and a
middle-click reach the same event. Conversion is **skipped** for HTML carrying no structure:
copying out of a plain-text editor still puts a lone `<span>` on the clipboard, and round-tripping
that can only lose the exact whitespace the user copied.

### Images: paste and drop

An image pasted or dropped into a markdown buffer is written into an `assets/` folder beside the
document, and a relative `![](...)` lands at the caret.

**The core cannot do any of this, and that is what shapes the design.** On native the editor runs
inside a webview with no daemon connection, and on no platform does the client touch a workspace
file. So `markdownImageDropHandler` only _recognises_ the image and pushes base64 to the host
(`onImageDrop`, a push callback with the seven touchpoints above); the host writes it and calls
`replaceSelection`. The bytes are base64 because this crosses a JSON `postMessage` bridge that
cannot carry a `File`.

Four decisions worth keeping:

- **The write is `fs.file.write_binary`, gated on `features.binaryFileWrite`.** Not `file.create` -
  that makes an _empty_ file and has no content field. Not `file.write` - its `content` is a string
  the daemon LF-normalizes and re-EOLs, which corrupts any non-text bytes. Not `file.upload` - it
  streams real bytes but into `$OTTO_HOME/uploads/`, outside every workspace, so the document could
  not link to what it wrote. This trap has been walked into once already; the markdown-editing
  charter named the wrong RPC for months.
- **The base64 stops at the host.** `fs.file.write_binary` borrows `file.upload`'s transport rather
  than its destination: the request declares the size, the bytes follow as `FileTransfer` frames on
  the same `requestId`, and the daemon tells the two apart by which store owns that id. So the
  decode happens once, where the webview bridge hands the string over, and a dropped photo does not
  pay a third again on the wire. See
  [markdown-rendering.md](markdown-rendering.md#export-html-and-pdf-as-printed-html).
- **No handler means no extension.** Omitting `onImageDrop` registers nothing, so a daemon without
  the capability leaves a dropped image to the platform instead of swallowing it into a feature that
  cannot finish. That is the whole gate - there is no degraded path, because there is nothing the
  client could degrade _to_.
- **The drop moves the caret to the drop point** before the write starts. The read is asynchronous,
  and by the time it resolves the pointer position is gone.
- **The image handler is ordered ahead of the HTML one.** Copying an image out of a browser puts
  both an image file and an `<img>` tag on the clipboard; writing the image into the workspace gives
  a document that still renders offline, where the HTML conversion would leave it pointing at
  someone else's server.

Naming and path arithmetic are pure and unit-tested in `markdown/markdown-image-drop.ts`, reusing
`relativeLinkPath` from link completion rather than restating it. The daemon never clobbers, so an
occupied name comes back as `exists` and the client retries `x-2.png` - a drop can only ever add a
file.

## Terminal-backed Vim and Neovim sessions

The desktop **File editor** preference chooses where source files open. It defaults to **Otto**,
which uses Otto's built-in editor. Selecting Vim, Neovim, or a custom command opens source files
directly in that real host executable inside the File Editor terminal. Vim and Neovim are offered
only when the daemon host reports the matching executable as available through the existing terminal
compatibility diagnostic; a custom command is still launched through the same host-owned terminal
stack. Rendered text documents, including Markdown, open in the selected editor too by default.
The **Always use Otto editor for Markdown files** setting keeps `.md` files in Otto's built-in editor
and preview while the selected external editor continues to open other source and rendered documents.
Binary and media formats keep their normal preview behavior.

The terminal is pane-owned: choosing Vim or Neovim replaces the file's content in the existing File
tab and does not create a second workspace terminal tab. The setting is desktop-only, is independent
of compact layout, and is offered only when the selected host advertises both the compatibility
diagnostic and embedded-terminal capabilities. A selected mode against an older host produces an
explicit update-host message instead of silently falling back to Otto.

The launcher resolves the file to an absolute host path before spawning anything. Vim and Neovim
receive `--` before that path, so a filename beginning with `+` or `-` cannot be interpreted as an
editor command or option. Custom commands are parsed into executable and argv without a shell.

While a terminal-backed session is mounted, the terminal and selected file editor are authoritative. The
CodeMirror editor, its document mirror, and Otto's autosave path are unmounted, so they cannot race
the external process. The daemon continues watching the file and reports changed, deleted, and
recreated states in the terminal-backed pane. Files, Changes, Git, and agent context continue to
derive from daemon-owned disk state.

Each embedded session has a stable `(workspace, absolute file path)` presentation owner. Renderer
reload leaves the PTY running, then the remounted pane adopts that owner; the daemon also deduplicates
concurrent creates for it. Responsive layout and File editor preference changes apply to future
opens and do not terminate a running editor. Closing its File tab is the intentional stop path and
requires confirmation that unsaved changes inside the external editor may be lost.

Quitting the process or losing its terminal stream removes the dedicated session and returns to the
standard Otto editor, which reads the file from disk. Otto never overwrites an external edit as part
of this transition. Launch failures, missing executables, host disconnects, and deleted files remain
visible as explicit state. Direct Neovim RPC embedding and Difftastic integration are separate
future work.

## Add to chat - handing the file, or a range, to the composer

Two entry points, both producing the ordinary `file_context` attachment pill that the file explorer,
project search and the Changes pane already produce (`packages/app/src/attachments/file-context.ts`):

- **The toolbar button** (`file-add-to-chat`, in `FileAiToolbarGroup`, so both the editor and preview
  toolbars carry it) attaches the whole file.
- **The editor's right-click "Add selection to chat"** (`editor-context-add-selection-to-chat`)
  attaches the selected range, read live from `getSelection` rather than from the cursor readout,
  which is a render behind. `EditorSelection` reports `columnStart`/`columnEnd` alongside the lines
  for exactly this, so the pill shows `file.ts:12:5-40:18` - the range the gutter was showing.

Three things this deliberately does **not** do:

- **It does not send the selected text.** The attachment is a reference: path plus range, one line of
  prompt instead of the excerpt, and it cannot go stale if the agent edits the file before the turn
  runs. See [token-economy.md](token-economy.md).
- **It does not require a focused chat.** Both write to the _workspace_ attachment scope, which every
  chat composer in the workspace reads. The focused pane is the file, so `focusedAgentId` is null by
  construction here - gating on it (as the file explorer does, where a chat can be focused beside the
  sidebar) would remove the action exactly when the user is reading the code they want to ask about.
- **It does not offer itself outside the project.** Same restriction as history, Changes and Refine:
  the attachment carries a workspace-relative path, so a linked or outside-project file would point
  the agent at the wrong tree.

Every producer builds its dedupe id through `buildFileContextAttachmentId`, so the toolbar, the file
explorer and an `@` mention naming one file yield one pill and one X.

## AI Refactor - the safe core

Refactoring is delegated to an agent, not a static analyzer - Otto's home-field advantage. The critical design decision, which must not be undone lightly: **AI Refactor deliberately does not spawn an agent directly.** A direct spawn would touch the central agent-creation path while potentially unattended, violating the "safe operations" constraint. Instead it routes through the proven composer/draft path where the user has final say.

The flow (`packages/app/src/editor/`):

1. The editor's "Refactor with AI" (Sparkles) action reads the current selection via the `getSelection` editor command for scope.
2. It opens a small JetBrains-style dialog (`refactor-dialog.tsx`) showing the scope (file + line range + selected-code preview), an instruction field, and a scope-guard note (_change only within scope; no unrelated reformatting, no dependency changes, no drive-by fixes_).
3. On confirm, it composes a scope-guarded prompt via the **pure, unit-tested `refactor-prompt.ts`** (`buildRefactorPrompt`) and opens a **pre-filled draft tab** through the draft store (`use-ai-refactor.ts`, using `buildDraftStoreKey` / `generateDraftId`).

From there the change flows through the ordinary composer/agent path: the user reviews provider/model and hits send, and BlobLoader progress plus "view agent log" come for free from the existing chat tab. There is no new observation surface and no auto-spawn. Mechanical rename is already covered by Phase 3's whole-word project replace, surfaced next to the AI action as the honest cheap option.

## Deferred / not yet built

Preserved here so nothing is lost - these were explicitly scoped out of the shipped Phases 1–5:

1. **Read-only viewer gutter line-range touch selection.** The charter's _hard mobile requirement_ - tap a line number, drag/tap a second to extend a line range, in both viewer and editor, so a refactor can be scoped one-handed. Deep CM6/viewer work; **not built**. Until it lands, mobile refactor scoping relies on character-precise selection.
2. **Direct agent auto-spawn that skips the composer.** Deliberately deferred, not merely unfinished: it touches the central agent-creation path, and the safe-core design routes through the composer/draft path on purpose. Any future version must preserve a user review step.

Also parked from the original charter: **line comments in editor/viewer** (Phase 6) - workspace-scoped drafts bound to no agent at creation, surfaced as an "N code comments" pill on any composer in that workspace, included at send time (same decouple-collect-from-send model as the diff-review draft store).

## Testing

Daemon RPCs go through the ad-hoc daemon harness ([ad-hoc-daemon-testing.md](ad-hoc-daemon-testing.md)); editor-buffer and conflict-policy logic and `refactor-prompt.ts` and `word-at-cursor.ts` are pure unit tests (`editor-buffer-state.test.ts`, `refactor-prompt.test.ts`, `word-at-cursor.test.ts`, `workspace-files-session.test.ts`, highlight `symbols.test.ts`). Run only changed test files.
