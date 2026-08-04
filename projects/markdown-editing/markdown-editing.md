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
