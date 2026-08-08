---
id: "markdown-editing"
kind: "project"
title: "Markdown Editing"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "partial"
created_at: "2026-08-08T06:17:55.883Z"
updated_at: "2026-08-08T06:19:47.832Z"
---

# Markdown Editing

<!-- compiled_truth -->

# Markdown editing

Otto renders markdown better than MarkText does. It edits markdown worse than Notepad does.

`.md` resolves to the bare `@lezer/markdown` parser in `packages/highlight/src/parsers.ts`, which
buys syntax colors and nothing else. Press Enter inside a list and the list stops. There is no bold
command, no table tool, no paste-as-markdown, no image drop, no heading in the outline
(`extractSymbols` has no heading branch), no export. Meanwhile the _preview_ half carries
markdown-it with mermaid, task lists, YAML frontmatter, AsciiDoc translation and workspace-relative
image resolution, plus a split view with scroll sync.

This charter builds the missing half: markdown as a format Otto **edits**, not one it merely
displays. The target is MarkText's feel, reached without MarkText's architecture.

## The decision that shapes everything: one engine

MarkText's defining trait is WYSIWYG. Its source markers vanish and you edit rendered text. There
are two ways to get there and only one of them is compatible with this codebase.

**Rejected: a second editor engine.** A ProseMirror/muya-style rendered editor for `.md` would be
the literal port. It also means a second document model, a lossy markdown round-trip, and throwing
away everything CM6 already gives the file pane: find/replace, the LSP client, the overview ruler,
the dirty-against-baseline comparison, and the native webview bridge. `docs/text-editor.md` states
the one-engine rule for exactly this reason. A second engine would have to reimplement all of it and
would reimplement it worse.

**Chosen: live preview inside CM6.** A decoration plugin hides the markup and renders the result
inline, revealing the source on the line the caret is on (the Obsidian idiom). Decorations do not
touch the document, so every existing editor feature keeps working unchanged, the remote-buffer
architecture is untouched, and native gets it from the same `editor-core.ts` the web host uses.

Everything below follows from that choice.

## Scope boundaries

This is a **markdown editor**, not a knowledge base. No backlinks, no wiki links, no note graph, no
daily notes, no tags index. Those are a different product and adopting them would quietly commit
Otto to being one.

It is also not a rewrite of the rendering pipeline. `components/markdown/` stays the renderer of
record; Phase 4 fills its known gaps rather than replacing it.

## Phases

Status for all of these lives in [`projects/README.md`](../README.md), not here.

### Phase 1: markdown becomes an edited format

The base layer. Everything after this depends on it.

- **Language support.** `buildLanguageExtension` in `packages/app/src/editor/editor-core.ts` is the
  single seam: for `.md`/`.mdx` it returns `@codemirror/lang-markdown` (`markdown()` with the GFM
  extensions and `markdownKeymap`) instead of wrapping the bare parser. That alone delivers list
  continuation, list indent/outdent, correct Enter/Backspace semantics, and GFM table, task-list and
  strikethrough parsing.
  - **Do not change `packages/highlight/src/parsers.ts` for this.** That registry also feeds the
    read-only token renderer and the daemon's symbol extraction, neither of which wants a
    `LanguageSupport`. The editor's needs are the editor's.
  - Nested fence highlighting bridges back through `getLanguageForFile`, so a fenced `ts` block
    inside a markdown file colors with the same grammar a `.ts` tab uses. A fence info string may
    be a language name (`typescript`) or an extension (`ts`), and `filenameForHoverLanguage` in
    `hover-markdown.ts` already owns that table for hover code blocks. Reuse it rather than growing
    a second copy that drifts. This is also the reason `md` stays in the shared parser registry.
- **Formatting commands.** Bold, italic, inline code, strikethrough, link, heading level, blockquote,
  bullet/ordered/task list, horizontal rule, code fence. Each is a pure text transform over
  `(doc, selection)` so it unit-tests in plain Node, following the `word-at-cursor.ts` and
  `refactor-prompt.ts` precedent; the CM6 command is a thin wrapper.
- **The keybinding conflict, and the new scope.** `Mod+B` is Go to definition in the File Editor
  section. Bold cannot simply take it. The fix is a **`markdown-editor` focus scope** resolved by
  `focus-scope.ts` when the focused surface holds a markdown file, with its own **Markdown Editor**
  registry section whose bindings `bindingSpecificity` ranks above the `code-editor` ones. Bold gets
  `Mod+B` there, and go-to-definition is not a thing a markdown file has anyway. Rebindable and
  listed in Settings like every other row, per the rules in `docs/text-editor.md`.
  - **Verify first:** that `focus-scope.ts` can carry a per-file-type scope on the same wrapper. If
    it cannot, that mechanism is Phase 1's real work and the commands land on the toolbar meanwhile.
- **The formatting toolbar, designed for touch.** A phone has no chords, so on mobile the toolbar is
  not a convenience, it is the only affordance. A horizontally scrollable icon strip in the file tab,
  `compactUp` sizing and doubled icons per the mobile conventions, tooltips on web. It is shown for
  markdown files only, and it is the same component on both platforms.
- **Headings in the outline, and the protocol constraint that shapes them.** The obvious move is a
  markdown branch inside `extractSymbols`. **It is wrong, and the reason must not be rediscovered:**
  `CodeSymbolKindSchema` is a five-value `z.enum` on the wire, so a daemon that started answering
  `code.outline` with `kind: "heading"` would make a six-month-old client reject the entire response
  message. The protocol contract forbids that, and no feature flag helps, because clients do not
  advertise which enum values they tolerate.
  - So headings are **client-side**, in their own function with its own type:
    `extractMarkdownHeadings` (`packages/highlight/src/markdown-headings.ts`), returning
    `{ level, text, line, from }`. The client already holds the document it wants an outline of, so
    there was never anything to ask the daemon for. The shape is also strictly better: a heading
    level is a nesting depth the flat `SymbolKind` cannot express, and a real table of contents
    needs it.
  - It parses rather than scanning for `#`, because only a parse knows a `#` inside a fenced code
    block is a comment. That is the single most common way a regex outline goes wrong on a README,
    and it is covered by a test.
  - The outline sheet branches on markdown and sources locally; `code.outline` keeps returning
    nothing for `.md`, exactly as it does today.

### Phase 2: input intelligence

- **Paste HTML as markdown.** Copying from a browser should paste structure, not a wall of tags.
  Needs an HTML to markdown converter, which is new: `markdown/html-ish.ts` translates the other
  direction. A library evaluation belongs beside this charter before a dependency is chosen, weighed
  against bundle size and whether it runs in the native webview.
- **Paste or drop an image.** The image is written into the workspace and a relative `![](...)` is
  inserted. **This goes through the daemon**, because the client never touches its own filesystem
  for workspace files. The insert path then resolves through the viewer's existing
  workspace-bounded image resolver, which already works.
  - **Not `file.create`, and the reason must not be rediscovered.** An earlier version of this
    charter named `file.create` under `features.fileMutations`. That RPC cannot carry an image:
    `FileCreateRequestSchema` creates an _empty_ file or directory and has no content field at all.
    Neither of the neighbours works either - `file.write` takes `content: z.string()`, which the
    daemon LF-normalizes and re-EOLs, so any byte sequence that is not text comes out corrupted;
    and `file.upload` does stream real bytes but lands them in `$OTTO_HOME/uploads/<id>/`, outside
    every workspace, so a document could never link to what it wrote.
  - The write is **`fs.file.write_binary`**, gated on `features.binaryFileWrite` - bytes to a
    workspace-relative path, workspace-bounded the way create/delete/rename are. It was added for
    the Phase 5 exports and this is its second consumer. Images land in an `assets/` folder beside
    the document; the daemon creates that parent and never clobbers, so an occupied name comes back
    as `exists` and the client retries `x-2.png`.
  - The editor cannot perform any of this itself: on native it runs inside a webview with no daemon
    connection, so the CM6 handler only recognises the image and pushes the bytes to the host, which
    writes them and inserts the link. That is a push callback, with the touchpoint cost
    [`docs/text-editor.md`](../../docs/text-editor.md) states.
- **Table editing.** Auto-format a GFM table on edit (column alignment maintained as you type), plus
  add/remove row and column commands. On mobile these are toolbar actions, since selecting a table
  cell precisely on a phone is not realistic.
- **Link and reference autocomplete.** Typing `[[`-free plain `](` offers workspace files through
  `code.list_files`, which already exists and is already gated on `features.codeIndex`; typing `#`
  inside a link offers the current document's headings, which Phase 1 already extracts.

### Phase 3: live preview

The MarkText feel, and the phase that justifies the engine decision.

- **The decoration plugin.** Markers are hidden and the result is rendered inline: headings take
  their scale, bold and italic take their weight, links render as link text, inline code takes the
  code surface. The line holding the caret (and any line intersecting the selection) reveals its raw
  source, so the document is always directly editable and never a proxy for itself.
- **Block widgets** for images, mermaid diagrams and math, replacing the fence with the rendered
  result. Mermaid already has a diagram component and a native webview payload; this reuses them
  rather than growing a second renderer.
- **Focus mode and typewriter mode.** Both are small CM6 extensions (dim everything outside the
  active paragraph; keep the caret line vertically centered). They are cheap once the plugin exists
  and they are half of what people mean when they say a markdown editor feels good.
- **The mode bar gains a position.** `FileViewModeBar` becomes Source / Live / Split / Preview, with
  Live as the default for markdown once it is trustworthy. Split stays web-only for the same reason
  it always was.
- **Do not break the contract.** Any new push callback or pull command on the editor costs the seven
  (or nine) touchpoints listed in `docs/text-editor.md`, and `npm run build:editor-webview` must be
  rerun or native silently ships the old bundle.

### Phase 4: rendering parity

These are already open rows under **File rendering** in the ledger. This charter claims them,
because a live preview that cannot render math is not a live preview.

- **Math (KaTeX).** Web is straightforward; native copies the mermaid webview pattern, which already
  bundles katex.
- **GitHub alerts** (`> [!NOTE]` and friends): a token-level markdown-it rule, the shape
  `task-lists.ts` already proved, lighting up chat and viewer together.
- **Footnotes.**
- **HTML `<table>` translation to GFM**, following `renderTable` in the AsciiDoc converter.
- **Interactive checkboxes**, replacing the read-only glyphs task lists render today.

### Phase 5: export - shipped

- **HTML export** everywhere, from the rendered document.
- **PDF** via Electron print-to-PDF on desktop. Named but never built in the
  [user-mode](../user-mode/user-mode.md) charter; this is where it lands.

Both shipped. Three decisions worth keeping:

- **The PDF is the HTML export, printed.** `markdownToHtmlDocument` produces the document and
  `webContents.printToPDF` renders that exact HTML in a hidden window. One converter, one
  stylesheet, two containers, so the two formats cannot drift. The window runs with
  `javascript: false`, which the export can afford because embedded HTML is translated on the way in
  and KaTeX math ships as MathML.
- **It lands beside the source**, `docs/design.md` -> `docs/design.pdf`, matching HTML rather than
  opening a save dialog. A native dialog returns a path on the _host running the app_, and the
  workspace may be on another machine entirely - the same click would mean two different things for
  a local and a remote daemon. Consistency was the smaller argument; that was the deciding one.
- **The bytes go back through the daemon**, not out of Electron main to disk, for the same reason.
  That needed a new capability: the text write is UTF-8, re-applies a detected EOL, and _refuses a
  binary target outright_, so it could never have written a PDF, let alone replaced one on
  re-export. `fs.file.write_binary` is that capability, gated on
  `server_info.features.binaryFileWrite`. It is also the capability image paste/drop was blocked on.

Verified by unit tests for the naming, path and both failure paths, and by a server test that pins
the binary-overwrite behaviour against the text write's refusal. `printToPDF` itself has no headless
stand-in; it was exercised by hand.

## Testing

Follows the tiers in [`docs/testing.md`](../../docs/testing.md).

- **Pure units** for every formatting transform, the table formatter and the HTML converter. These
  are text in, text out, and they are where the bugs will actually be.
- **Browser tests** (`*.browser.test.ts`, real CM6 in a real browser) for the decoration plugin and
  the caret-reveal behaviour. None of that survives a mock, exactly as the hover timing did not.
- **An E2E row added to the coverage matrix in the same change**, per the rule.

## Fixtures

`test-documents/` already carries the markdown fixture. Phase 3 and 4 want it extended with math, a
GFM table, footnotes and each alert kind, so the live preview and the renderer are exercised by the
same file.

## Timeline

- time: "2026-08-08T06:17:55.883Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:55.883Z"
  kind: "evidence"
  summary: "Migrated from `projects/markdown-editing/markdown-editing.md` and the legacy `projects/README.md` ledger. Legacy status: Partial. Ledger summary: Otto renders markdown better than MarkText does and edited it worse than Notepad did. **Built:** Phase 1 (`@codemirror/lang-markdown` at the `buildLanguageExtension` seam, so Enter continues lists and GFM parses; formatting as **pure transforms** wrapped in CM6 commands that DECLINE outside markdown, which is what lets one keymap serve `Mod+B` as bold in a `.md` file and Go to definition in a `.ts` one; a **`markdown-editor` focus scope** that INHERITS `code-editor` so Save/Find keep working while `Mod+K` becomes a link here and stays the command center elsewhere; a touch-first toolbar; client-side `extractMarkdownHeadings`, kept off `extractSymbols` because `CodeSymbolKindSchema` is a wire enum an old client would reject). Phase 3 (**live preview** as CM6 decorations, default ON, reveal per line from the selection, verified by a browser test; markdown prose now reads as markdown in source mode too; the outline sources markdown headings from the OPEN BUFFER). Phase 2 in part (**paste HTML as markdown** via Turndown with a GFM table rule it does not ship, skipped for structure-free clipboard HTML; **GFM table editing** - realign, add/delete row and column, cycle alignment, all reformatting the whole table). Phase 4 in part (**GitHub alerts** as themed callouts and **HTML `<table>` translated to GFM**, both landing in the shared renderer so chat and the viewer get them together). Durable architecture folded into [docs/text-editor.md](../docs/text-editor.md#markdown-the-format-the-editor-edits) and [docs/markdown-rendering.md](../docs/markdown-rendering.md). Phase 2 completed with **link and heading autocomplete** (workspace files after `](`, the document own headings after `#`, anchored the way GitHub slugs them; candidates are PUSHED IN by the host because on native the editor is inside a webview and cannot reach the daemon). Phase 4 completed with **interactive task checkboxes** (the `[ ]` marker leaves the item text and becomes attributes, so the renderer draws a real control; read-only stays the default, which is what chat wants; a tick routes through `selectLines` + `replaceSelection` so undo works) and **footnotes** (a core-ruler rewrite CANNOT do this, unlike task lists and alerts, because markdown-it reads `[^id]: text` as a CommonMark link reference definition before core rules run, so a block rule registered BEFORE `reference` claims the definitions first). Phase 5 shipped in full. **HTML export**: one standalone file written beside the source through the daemon, rendered through the same extensions so it cannot drift from the viewer. **PDF export**: the same HTML, printed by Electron `printToPDF` in a hidden window, so there is one converter rather than two; it lands beside the source (`docs/design.pdf`) rather than behind a save dialog, because a dialog returns a path on the machine running the APP and the workspace may be on another one. The bytes go back through the daemon like every other write, which needed the NEW binary-write capability the charter had already identified as image paste/drop's blocker: `fs.file.write_binary`, gated on `server_info.features.binaryFileWrite` - `file.create` only makes empty files, `file.write` is UTF-8 text that REFUSES a binary target outright (so it could never replace a PDF on re-export), and `file.upload` lands bytes in `$OTTO_HOME/uploads/` rather than the workspace. **Phase 2 completed with image paste and drop**, the capability's second consumer: an image on the clipboard, or dropped onto a markdown buffer, is written into an `assets/` folder beside the document and a relative `![](...)` lands at the caret - at the DROP POINT for a drop, not wherever the caret happened to be, since by the time the read resolves there is no pointer position left to consult. `fs.file.write_binary` never clobbers, so a taken name retries as `x-2.png` and a drop can only ever add a file; the inserted link then resolves through the viewer's existing workspace-bounded image resolver, and the path maths is `relativeLinkPath` REUSED from link completion rather than a second copy that would drift. The CM6 handler only RECOGNISES the image and pushes base64 to the host, because on native the editor sits in a webview with no daemon connection - the same constraint that shaped link autocomplete - which makes this a push callback with the touchpoint cost `docs/text-editor.md` states. It is withheld entirely on a daemon without `features.binaryFileWrite`: no handler is registered at all, so the drop keeps whatever the platform does with it rather than being swallowed by a feature that cannot finish. The charter's long-standing claim that this would go through **`file.create` under `features.fileMutations` was WRONG** and is corrected in place - that RPC creates an EMPTY file and has no content field, `file.write` LF-normalizes and re-EOLs its `content: string` so binary comes out corrupted, and `file.upload` streams real bytes but lands them outside every workspace. **Open:** KaTeX **inline math on native only** (web and desktop render both forms; native renders block `$$...$$` through a webview carrying a bundled KaTeX, and inline `$...$` stays as its source because `math_inline` arrives inside a `textgroup` `<Text>`, which is a `UITextView` on iOS and drops non-text children, and on Android turns an inline `View` into a placeholder span. Closing it means letting a paragraph containing a formula opt out of the `UITextView` path the way `containsImage` does, trading that paragraph's cross-inline drag selection for a rendered formula and mounting one webview per formula); and an E2E row in the coverage matrix (PDF export is desktop-only, so it belongs to the packaged desktop smoke, not the app Playwright tier)"
- time: "2026-08-08T06:19:47.832Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
