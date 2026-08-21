# Markdown rendering

One pipeline serves every markdown surface: chat (`components/message.tsx`), the file viewer
(`components/file-pane.tsx`), and the pull-request panel - all through `MarkdownRenderer`
(`components/markdown/renderer.tsx`, `react-native-markdown-display` + markdown-it). Anything
added at that level lights up all three at once.

## We do not render HTML

Markdown documents in the wild - READMEs above all - carry embedded HTML. Otto's policy:

> **Translate what has a markdown equivalent. Drop the tag and keep the text for everything else.
> Never show raw markup, and never let a document load or execute anything from outside itself.**

This is deliberately _not_ "render a safe subset of HTML". We render markdown; HTML is an input
format we translate on the way in. The translation lives in
`components/markdown/html-ish.ts`, which runs before markdown-it (which itself has `html: false`).

**This is also why [widgets](widgets.md) do not go through here.** An agent that wants to draw
something emits a `show_widget` tool call carrying an HTML/SVG fragment, and the client renders it
in a sandboxed frame anchored to that tool call - beside the markdown, never inside it, exactly as
the Suggested Tasks card is. Widgets exist so that this policy never has to be weakened: the answer
to "the model wants to show a chart" is a separate, contained renderer, not `html: true`.

The five rules that follow from it, and that are easy to break:

1. **The default for an unrecognized tag is unwrap, not passthrough.** A tag with no translation
   drops to its text - legible, not broken. Reverting this to raw passthrough puts markup on
   screen. `script`/`style` are the only tags whose _contents_ are dropped too.
   - **`<table>` is translated, not unwrapped.** It becomes a GFM table: `thead`/`tbody` are
     wrappers and the rows are found wherever they sit, the first row is the header, short rows
     are padded, and a pipe inside a cell is escaped. A cell GFM cannot express - a nested list,
     another table, anything with a newline - collapses onto one line, because the choice is
     between losing the layout and losing the table and the table is worth more. A table with no
     rows falls back to the plain unwrap.
2. **Translation is a token-level transform, not a string one.** `<summary><h3>Files</h3></summary>`
   must yield the label `Files`, not `### Files` - heading translation is stripped from summaries
   before rendering, while the tag is still a token. String post-processing cannot tell the
   difference.
3. **Image srcs are gated by scheme, and that gate is the only thing between a document and a
   network fetch.** An image that fails the gate renders as its `alt` text (or is dropped if it has
   none). Never as raw markup, and never as a blank sized box. Workspace-relative srcs are an
   additive allowed _class_ routed through the daemon, not a loosening of the scheme check - see
   [Relative images](#relative-images-a-documents-own-files).
4. **Whitespace changes meaning at the boundary.** It is insignificant in HTML and structural in
   markdown, so text coming out of a tag has its line indentation stripped - otherwise a
   pretty-printed nested `<div>` body arrives with 4+ leading spaces and markdown-it reads it as an
   indented code block. Text _outside_ any tag is already markdown and is left exactly as written
   (nested lists depend on it), as are protected code ranges. This is what the `insideHtml`
   parameter on `renderInlineTokens` tracks.
5. **Inline constructs must end up on one line.** Link labels, emphasis, and headings collapse
   their content to a single line. A multi-line `[label](href)` is not a link - markdown emits the
   brackets as literal text, which is how a `<picture>` inside an `<a>` used to produce a stray
   `[` and `](…)` around a code block.

Nothing in this path can execute anything regardless: the renderer emits React Native primitives,
so passthrough would be inert - but inert markup on screen is still a rendering bug.

## `remoteImages`: who is allowed to fetch

`MarkdownRenderer` takes `remoteImages?: "load" | "altText"` (default `"load"`).

| Surface            | Setting     | Why                                                                                                  |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| File viewer        | `"altText"` | A repo document must not reach the network just by being previewed. Badges render as their alt text. |
| Pull-request panel | `"load"`    | Already network-backed against the forge; avatars and badges are wanted.                             |
| Chat               | n/a         | Renders with `enableHtmlish={false}`, so the HTML path never runs.                                   |

Note the desktop app shell's CSP (`packages/desktop/src/main.ts`) sets `img-src 'self' data: blob:`
with no `https:`, so remote images cannot load there regardless of this setting - `"load"` only
takes effect on native. Do not widen that CSP to "fix" a blank image; the alt-text fallback is the
intended behavior.

**Both image forms are now behind this one gate.** There is a shared `image` render rule
(`markdown/renderer.tsx`) as well as the HTML `<img>` translation. Before it existed, only the HTML
path honoured `remoteImages` - markdown `![](x)` fell through to `react-native-markdown-display`'s
default rule, which matched the src against `allowedImageHandlers` and otherwise prefixed
`defaultImageHandler`, so a viewer `![](docs/x.png)` became a fetch of `https://docs/x.png`. Do not
remove that rule to "simplify"; the library default is a network fetch.

## Relative images: a document's own files

A document may show images that live beside it - `![](assets/flow.png)`,
`<img src="packages/website/public/logo.svg">`, AsciiDoc's `image::flow.png[]` - resolved against
the document's location the way GitHub resolves them against a repo. Only the file viewer opts in,
by passing `workspaceImages` to `MarkdownRenderer`.

| Module                      | Role                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workspace-image-source.ts` | Pure. Resolves a src against the document's directory and **contains it under the workspace root**. The security boundary. |
| `workspace-image-cache.ts`  | The daemon read, deduplicated by path. Bytes → the attachment store.                                                       |
| `image-context.tsx`         | The context both image paths resolve through, so the gate is applied once.                                                 |
| `svg-intrinsic-size.ts`     | An SVG's size from its `width`/`height` or `viewBox` - native never sends SVG through `Image.getSize`.                     |

The load-bearing decisions:

- **Containment is app-side, and it happens before any RPC.** The daemon deliberately does not bound
  a single-file read to a known workspace (`file-explorer/workspace-files-session.ts`), so
  `resolveWorkspaceImagePath` refusing a path is the whole of the protection: `../../../etc/passwd`,
  `C:/…`, `//host/share`, `file:` and percent-encoded or backslash-spelled variants of all of them
  never become a read. It shares its `..`-collapsing primitive (`containRelativePath`, `utils/path`)
  with the assistant-file-link resolver - one containment algorithm, not two.
- **Only known image extensions are read.** Containment alone would happily allow `![](.env)`. The
  extension allowlist is what makes a document unable to use this path as a file reader.
- **The transport is the file-read RPC the viewer already uses.** No protocol change, no
  image-serving endpoint. `client.readFile` → `persistAttachmentFromBytes` → `useAttachmentPreviewUrl`
  is exactly `createFilePanePreview`'s shape, so blob-URL (web) / `file://` (native) lifecycle and GC
  are the store's, not a second caching layer. Reads are capped at 8 MB after the fact - the daemon
  read has no size limit of its own - and an oversized image falls back to alt text.
- **Resolution is cached per daemon + workspace + path, not per component.** A badge table naming the
  same file twenty times is one read; a remount is none. The trade: an image edited on disk keeps
  showing its cached copy until the entry is evicted.
- **`remoteImages: "altText"` still means what it says.** The raw src of a relative image never
  reaches an `<Image>` - only the store URL the read produced. `localImages: "workspace"` in
  `HtmlishOptions` adds an allowed _class_ (scheme-less paths); it does not widen the scheme
  allowlist, which is what `html-ish.test.ts` pins.
- **AsciiDoc arrives already folded in.** `asciiDocToMarkdown` emits `![alt](target)` for both image
  macros and applies `:imagesdir:` to the target, so an AsciiDoc image takes the identical route from
  there. There is no second resolver on that side.
- **Native SVG splits, as it already did for whole-file previews.** `Image` cannot decode SVG on
  iOS/Android, so the read hands back markup for `SvgXml` instead of a store URL, and its size comes
  from the markup rather than from `Image.getSize`.
- **Unresolvable is not a special case.** An escaping path, a missing file, an oversized one and a
  blocked scheme all land on the standing rule: show the `alt` text, or nothing when there is no alt.

`test-documents/markdown.md` and `test-documents/asciidoc.adoc` carry the fixture - relative,
root-relative, HTML, escaping, missing and remote images in one document each.

### Two resolvers, on purpose - do not unify them

Chat has its own, older path for the same-looking problem: `utils/assistant-image-source.ts` →
`AssistantMarkdownImage` (`message.tsx`), which reads an agent-authored `![](screenshots/out.png)`
through the identical `readFile` → attachment-store transport. It looks like a duplicate. It is not,
and merging them would be a security regression.

|                       | Viewer (`workspace-image-source.ts`) | Chat (`assistant-image-source.ts`)                                      |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Who wrote the src     | A repo file - **untrusted**          | The agent this user is talking to - trusted                             |
| Base                  | The document's own directory         | The workspace root; chat messages have no directory                     |
| Outside the workspace | **Refused**                          | **Deliberately allowed** - falls back to the filesystem/drive/home root |
| Non-image paths       | Refused by extension                 | Read, then rejected on `kind !== "image"`                               |

Chat's breadth is a feature: an agent screenshots to `/tmp/otto-codex-screenshot.png` or
`~/.otto/screenshots/`, and chat has to show it. Applying the viewer's containment there would break
that. Applying chat's breadth to the viewer would let any README name any file on the host. The
shared thing between them is the transport, and that is already shared.

The HTML `<img>` half stays off in chat for a separate reason: chat renders with
`enableHtmlish={false}`, so the translation pass never runs at all.

### Preview attachments must be pinned, or the GC eats them

Both resolvers end in `persistAttachmentFromBytes`, which writes a **preview attachment** - a local
copy of a daemon-side image, ided by `createPreviewAttachmentId` so re-reading one file reuses one
stored copy. The attachment store's garbage collector owns everything in that store and treats
anything it cannot trace back to a live reference as garbage. It walks drafts, queued messages,
pending creates, the live stream and the workspace attachment store - **none of which a preview
attachment hangs off**. It also runs on every draft save, so a keystroke was enough to delete the
screenshot the chat had just rendered, leaving "Unable to load image preview."

`attachments/preview-pins.ts` is the fix and the rule: minting a preview id pins it for the session,
and `runAttachmentGc` counts pinned ids as referenced. Pinning happens inside
`createPreviewAttachmentId`, before the bytes are written, so no file ever exists unpinned. The pin
set is capped so a long session cannot grow the attachment directory without bound; an evicted id
becomes collectable again, and React Query will have dropped its metadata by then, so a re-rendered
image that far back refetches and re-pins.

The general rule, for the next feature that persists an attachment nobody sends: if it does not hang
off a draft, a queued message or the workspace attachment store, it needs a reference in
`runAttachmentGc` or it will be deleted, quickly and silently.

## Both sides of chat parse, with different parsers

The user's own bubble renders through `MarkdownRenderer` too, not as plain text: a prompt with a
fence gets the same highlighted code block the agent's reply gets, from the same
`createSharedMarkdownRules()`. The plain `<Text>` it used until then was inherited from upstream,
never a decision.

It does **not** share the assistant's parser, and that is the part to preserve:

|               | Assistant                                    | User                          |
| ------------- | -------------------------------------------- | ----------------------------- |
| `typographer` | on                                           | **off**                       |
| Plugins       | task lists, footnotes, math (**not** alerts) | math only                     |
| Rules         | the `message.tsx` copy (file-link aware)     | `createSharedMarkdownRules()` |

The assistant's chain is `createAssistantMarkdownParser()`
(`markdown/assistant-parser.ts`), its own module rather than a const inside `message.tsx` precisely
because it is the place a shared extension silently fails to reach: math shipped to the viewer first
and did not reach chat for a release. Alerts still do not, because the assistant rules carry no
`blockquote` rule to draw one.

**Math is the one plugin both sides take**, because a formula you send should look the way it will
look coming back. The currency guards are what make that safe in a prompt, and they are the reason
no other plugin followed it across: footnotes, task lists and alerts are parse cost per bubble for
constructs prompts do not use.

`typographer` is the load-bearing difference. It rewrites `"` into curly quotes, `--` into an en
dash and `...` into an ellipsis. That is right for prose a model wrote and wrong for text a person
typed, because the composer's file-mention autocomplete inserts a quoted, backslash-escaped path
(`formatQuotedFileMentionPath`), and smart quotes would show the user a mention they did not write.
Reuse the assistant's parser here and file mentions go curly; the straight-quote assertion in
`e2e/user-message-contract.ui-contract.spec.ts` is the tripwire.

The assistant's bespoke rules are also deliberately not reused: their `code_inline` and `link` rules
resolve file paths through `useAssistantFileLinkActions`, which the user bubble has no workspace
context for.

**Rendering is not the message.** `TurnCopyButton` and `RewindMenu` read the raw `message` string,
so copy, rewind and the text the agent receives keep byte fidelity no matter what the bubble draws.
Anything that starts feeding those the rendered output breaks the contract that makes markdown in a
user bubble safe at all.

One layout note: the user bubble has its own padding, and markdown blocks each own a bottom margin,
so the last block's margin stacks on it. The `body` rule override in `message.tsx` pulls the block
back by exactly that margin to keep the bubble's inset symmetric.

## Fences: one dispatch point

A fence info string that means something other than "highlight this as code" is resolved in exactly
one place, `components/markdown/fence.tsx` (`MarkdownFence`). Both `fence` render rules route
through it - the shared one in `markdown/renderer.tsx` and the **duplicate copy in `message.tsx`**,
which maintains its own `RenderRules` object for iOS text-hoisting reasons. Adding a fence language
means editing `MarkdownFence`, not the rules; forget the `message.tsx` rule and the feature works
everywhere except chat, which is the surface most people see first.

Before parsing, `fence-recovery.ts` repairs one narrow malformed-output shape: a document beginning
with a triple-backtick `markdown` wrapper whose literal contents contain plain triple-backtick fences. CommonMark
correctly treats the first inner marker as the outer close, so the renderer would otherwise alternate
between code and live markdown. When the complete ambiguous pattern is present, the outer opening and
final closing marker are raised by one backtick. This is recovery for model output, not a new Markdown
syntax: ordinary fences, non-`markdown` fences, and already correctly sized wrappers stay untouched.

### A streaming fence is throttled, and that is load-bearing

An open fence cannot be promoted out of the live tail block (`utils/split-markdown-blocks.ts`), so
while a model is typing one, the tail block **is** the whole fence-so-far and every ~32 ms reveal
tick produces a longer string. Tokenization is cached on the entire code
(`utils/highlight-cache.ts`), so each tick used to miss: a full synchronous Lezer pass over the
fence-so-far, plus `detectLanguage` again for untagged fences, plus the eviction of the prefix it
just replaced. Work per streamed fence was quadratic in its finished length, on the UI thread,
during the workload the product exists for.

`fence-highlight-debounce.ts` (`useSettledFenceCode`) quantizes the code `HighlightedCodeBlock` sees
to one commit per `FENCE_HIGHLIGHT_DEBOUNCE_MS` (250 ms, the same number and the same reasoning as
`MERMAID_RENDER_DEBOUNCE_MS`). Three properties it must keep:

- **It is a throttle with a trailing commit, not a debounce.** A debounce restarts its timer on
  every delta, which would leave a fence that streams for thirty seconds showing nothing but its
  first paint for thirty seconds. The first delta after a quiet window schedules one commit and
  later deltas ride along with it, so the block keeps growing - in 250 ms steps rather than 32 ms
  ones - and the last delta lands within one window of the stream ending.
- **Settled content never waits.** The first value is returned on mount, so history, the file viewer
  and the pull-request panel are fully highlighted on their first paint.
- **Only growth is coalesced.** Anything that is not an append (a rewind, a different message, a
  file the viewer just opened) replaces the current value immediately.

Mermaid fences deliberately keep the raw code: `MermaidDiagram` runs its own debounce, and stacking
a second one in front of it would only make a diagram settle later.

This is about what the fence renders and nothing else. It writes no scroll position and does not go
near the follow/detach state machine ([chat-scrolling.md](chat-scrolling.md)). Note also that
`patches/react-native-markdown-display+7.0.2.patch` is what makes the throttle possible at all:
position-stable node keys are why the fence component survives a re-parse instead of remounting (and
losing its window) on every flush.

## Mermaid diagrams

` ```mermaid ` (and ` ```mmd `) fences render as diagrams on all four platforms, and `.mmd` /
`.mermaid` files render as one diagram in the viewer. `components/markdown/mermaid/` owns it:

| Module                       | Role                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `mermaid-render.ts`          | The only module that knows the mermaid library. Needs a DOM. Also owns the cache. |
| `mermaid-diagram.tsx`        | Web/Electron host - injects the SVG into a raw `<div>`.                           |
| `mermaid-diagram.native.tsx` | iOS/Android host - a `react-native-webview` running the self-contained payload.   |
| `mermaid-block.tsx`          | Surface-facing: the themed wrapper and the source-block fallback.                 |
| `mermaid-theme.ts`           | Otto theme → mermaid `themeVariables`.                                            |
| `mermaid-document.ts`        | Standalone `.mmd` source → a one-fence markdown document.                         |

The load-bearing decisions:

- **Web renders in the page; native renders in a webview.** There is no DOM on iOS/Android and
  mermaid measures label text by laying it out, so native gets the CM6 editor's recipe: an esbuilt
  self-contained HTML payload (`scripts/build-mermaid-webview-html.mjs`, wired into
  `eas-build-post-install` next to the editor and terminal payloads) driven over a typed bridge.
  Rebuild it with `npm run build:mermaid-webview` after touching anything the payload imports -
  including `mermaid-render.ts`, which it shares with web. Nothing in the payload reaches the
  network.
- **Both hosts sit behind a dynamic `import()`, and that is not optional.** Mermaid is **~3.4 MB
  minified / ~950 KB gzipped** - bigger than the editor and terminal payloads combined. On web
  `import("mermaid")` is the boundary; on native it is `import("./webview/mermaid-webview-html")`,
  which is why nothing else may reference that generated module. Per
  [feature-flags.md](feature-flags.md), a dynamic boundary is the only lever Metro respects. If the
  native bundle ever needs trimming, aliasing out `cytoscape` (mindmap, architecture) and `katex`
  (math labels) removes ~24% - at the cost of web/native parity, which is why it was not done.
- **A diagram that can't be drawn shows its source.** `MermaidDiagram` takes a `renderFallback`
  rather than having a "nothing yet" state, so neither host has a code path that draws an empty box.
  Failure adds the parse message under the source block; the source block is a normal
  `HighlightedCodeBlock`, copy button included.
- **Theme values must be concrete, never `themeColorRef`.** Mermaid runs color math (khroma) over
  every variable it is handed, so a `var(--colors-surface2)` produces `NaN` shades and an unstyled
  diagram. `mermaid-theme.ts` therefore reads resolved colors through a `withUnistyles` mapping.
  Consequence, accepted: a diagram inside the black chat scope on web follows the app theme rather
  than the scope - the same class of leak as icon `color` props (see [unistyles.md](unistyles.md)).
  Only mermaid's `base` theme honours `themeVariables`; the others hardcode their palettes.
- **Rendering is always debounced, and outcomes are cached.** `react-native-markdown-display` mints
  fresh node keys on every parse (`getUniqueID`), so any surface that re-parses - a streaming chat
  message above all - unmounts and remounts every block. Rendering eagerly on mount would mean one
  full mermaid render (on native, one WebView create/destroy) per streamed flush. So: no immediate
  first attempt, and `peekMermaidOutcome` answers a remount synchronously from a bounded cache keyed
  by source **and** theme. This is why the first appearance of a diagram costs a beat of source
  text and later ones don't.
- **Sizing belongs to the host.** Mermaid's `useMaxWidth` writes an inline `max-width` onto the
  `<svg>`; `mermaid-render` strips it and returns the natural size instead, which the web host
  reapplies as a container `maxWidth` (natural size, scaled down in narrow panes). The native
  payload posts its laid-out height back so the host can size the WebView, and re-posts on reflow.

## GitHub alerts

`> [!NOTE]` and its four siblings (`TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) render as themed
callouts. `components/markdown/github-alerts.ts` is the parse half and runs as a **token-level**
core rule, the same shape `task-lists.ts` uses and for the same reason: a marker is only an alert
when it opens a real blockquote, so `[!NOTE]` inside a code fence or mid-sentence stays literal
text. A regex over the source could not tell those apart.

The kind rides on the `blockquote_open` token as an attribute, which `tokensToAST` turns into
`node.attributes`, so the renderer's `blockquote` rule reads it without knowing how detection
worked. Only the accent varies per kind: the surface stays the ordinary blockquote's, so an alert
reads as a blockquote that is telling you something rather than as a different kind of box, and
every colour is a token that already exists in all themes.

**The titles are deliberately untranslated.** They are GitHub's markdown vocabulary, written into
the document's own source as `[!NOTE]`, and a reader comparing the rendering against the source
should see the same word.

## Footnotes

`A claim[^src]` becomes a superscript marker and `[^src]: The source.` moves into a numbered list
at the end of the document, under a rule. Numbering follows first reference, not definition order,
and a repeated reference reuses its number.

**A core-ruler rewrite cannot implement this, unlike task lists and alerts.** By the time core rules
run, markdown-it has already read `[^src]: The source.` as a _link reference definition_, which is
exactly what the syntax looks like to CommonMark, and rewritten every `[^src]` in the body into a
link to it. The definition is gone from the token stream and the reference is a
`link_open`/`text`/`link_close` triple, so there is nothing left to match. `footnotes.ts` therefore
registers a **block rule before `reference`** to claim the definitions first; with no reference
definition left, `[^src]` stays a plain text token and the core rule can rewrite it.

Two deliberate limits:

- **A reference is not a tappable link.** The rewrite produces plain text and an ordinary list, so
  every surface that already renders markdown got footnotes with no new render rules and no
  divergence between the chat bubble and the file viewer. A jump target would need both.
- **A definition is one line.** Lazy continuation would mean reimplementing paragraph continuation
  inside the block rule.

An unreferenced definition is left exactly where the author wrote it, as an ordinary paragraph.
Dropping it would silently delete text; numbering it would invent a note nothing points at.

## Task lists are real checkboxes

`- [ ]` and `- [x]` no longer bake a glyph into the item's text. The marker is lifted out and
re-expressed as `data-otto-task` and `data-otto-task-line` on the `list_item_open` token, which
`tokensToAST` hands to the `list_item` rule as `node.attributes`.

Read-only is the default and looks exactly as it did: a surface only gets a tickable box when it
passes `onToggleTask`, which is right, because a task list in an assistant message has no document
behind it to write to. The markdown preview beside the editor passes one, and a tick routes through
`selectLines` + `replaceSelection` so it lands in the editor's own undo history.

The line number is the catch. The renderer counts lines of the _rendered body_, and the file may
have frontmatter above it, so `toRenderedDocument` reports a `bodyLineOffset`. It is **null** for
mermaid and AsciiDoc, whose bodies are translations rather than slices of the source, and a null
offset keeps their checkboxes read-only rather than writing to a line that means nothing.

## Math

`$x^2$` inline and `$$...$$` as a block, rendered with KaTeX. In the file viewer, the preview, the
HTML/PDF export and in agent replies.

**Chat is a second wiring site, not a free ride.** Every other surface picks math up from
`defaultMarkdownParser` + `createSharedMarkdownRules()`; chat parses with its own chain and its own
rules copy (see [above](#both-sides-of-chat-parse-with-different-parsers)), so both halves are
registered there by hand and `assistant-parser.test.ts` is what stops the parse half from being
dropped again. The user's own bubble takes the parse half too, and gets the render half
free from the shared rules it already spreads.

**A display formula holds an assistant block open.** An assistant reply is cut into blocks on blank
lines
by `utils/split-markdown-blocks.ts` before it reaches the renderer, so a `$$ … $$` that contains a
blank line (an `aligned` environment, usually) would arrive as two blocks with an unclosed `$$` each
and render as raw TeX. `$$` therefore holds a block open the way a code fence does. The single-line
`$$x$$` form opens nothing. A user prompt is rendered whole and never sees this splitter.

**Math is the one extension here that needs a render rule.** Task lists, alerts and footnotes all
rewrite into node types markdown already has, which is why the HTML export got them for free. A
formula needs real layout, so it reaches the renderer as its own `math_inline` / `math_block` node
carrying the TeX.

**It is also the one that parses during tokenization rather than after.** A core ruler pass runs
after emphasis and links have already chewed through the `_` and `^` inside a formula, so `math.ts`
registers an inline rule before `escape` and a block rule before `fence`.

Three guards keep prose out of it, and currency is the reason all three exist: the opening `$` must
be followed by a non-space, the closing `$` preceded by one, and a digit straight after the closing
`$` disqualifies the match. That is what leaves "it cost $5 and $10" alone. An unclosed `$$` is not
math either; swallowing the rest of a document because a delimiter was mistyped is the worst failure
available.

Unparseable TeX falls back to its source rather than to an error, on every platform. Otto renders
documents it did not write, and a typo in someone else's README should not take the page down with
it.

### Two KaTeX outputs, one per platform

KaTeX can emit HTML (positioned spans, needing `katex.min.css` and a set of woff2 faces) or MathML
(needing an engine that lays MathML out). Otto uses **both**, and which one is right is decided by
the surface, not by preference.

| Platform      | Output | Why                                                                                                                                            |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Web, Electron | MathML | A React Native Web bundle has no CSS pipeline, so a stylesheet and font files cannot ship into it. Browsers lay MathML out natively.           |
| iOS, Android  | HTML   | The formula is inside a webview, which _is_ a CSS pipeline, and it is a document we generate whole. So it carries KaTeX's reference rendering. |

The web path costs one script dependency and no styling at all, and the formula inherits the
surrounding text's colour and size for free. The HTML export uses the same path, which is why an
exported file shows formulae with no script and no stylesheet.

The native path is `math-formula.tsx`, a react-native-webview host over the payload in
`markdown/math-webview/`. It is the same recipe as mermaid, the CM6 editor and the terminal: a
webview entry (`math-webview-entry.ts`) that esbuild turns into one self-contained HTML string
(`math-webview-html.ts`, generated by `npm run build:math-webview` and **committed**). Three things
about it are load-bearing:

- **KaTeX's stylesheet and fonts are inlined as data URIs.** A webview loaded from an HTML string
  has no base URL to resolve `fonts/...` against, and a rendered document is never allowed to reach
  the network. Only the woff2 of each face is kept; the woff and ttf alternates would triple the
  payload for engines that do not exist here.
- **The payload is reached only through a dynamic `import()`.** That is what keeps ~640 KB out of
  the startup graph; on Metro a dynamic boundary is the only lever that works. It is fetched the
  first time a formula appears and shared by every later one.
- **The webview reports its laid-out size, and the host is what sizes it.** Until it does, the
  webview measures off-flow at a provisional height: a WebView squeezed to zero height may never lay
  its page out, and then it could never report the height that would give it one. A formula wider
  than the pane is scaled down rather than clipped, because losing the right-hand side of an
  equation silently changes what it says.

Because the webview has no surrounding document to inherit from, the host hands it a **concrete**
colour and font size off the surrounding text style. `themeColorRef` resolves to a real colour on
native and only to a CSS `var()` on web, so this works; a `var()` would paint nothing.

### Inline math is still the TeX source on native

This is a property of React Native's text model, not of the renderer. `math_inline` arrives inside a
`textgroup`, which is a `<Text>`. On iOS that is a `UITextView`, whose non-text children are
dropped; on Android an inline `View` child becomes a placeholder span. A webview survives neither.
Block math has its own `View` (the `math_block` rule), which is why it can host one.

Rendering inline math too means letting a paragraph that contains a formula opt out of the
`UITextView` path, the way `containsImage` already does for paragraph images. That trades
cross-inline drag selection in that paragraph for a rendered formula, and it mounts one webview per
inline formula. Tracked in [`projects/README.md`](../projects/README.md#file-rendering) rather than
decided here.

## Export: HTML, and PDF as printed HTML

A markdown tab exports to a file beside the document. `notes/design.md` produces
`notes/design.html`, and on desktop `notes/design.pdf`.

**There is one converter.** `markdownToHtmlDocument` renders through the same markdown-it
extensions the viewer uses, so task lists, alerts, footnotes and math arrive in the export without a
second code path to keep in sync. The PDF is that same HTML, loaded in a hidden window and printed
with Electron's `webContents.printToPDF`. A separate PDF renderer would be a second thing to keep
agreeing with the first, and it would lose that argument eventually.

The export is standalone: the stylesheet is inlined, math is MathML, and nothing is fetched when the
file opens. The one thing it does not carry is the document's own images. A relative
`![](assets/x.png)` stays relative, so it resolves for the HTML saved beside the document and shows
as alt text otherwise - including in the PDF, which has no directory to be relative to.

**Where the bytes go, and why it is not simply `fs.writeFile`.** PDF is the first thing Otto
generates on the client that is not text, and it exposed a real boundary:

- The client never touches a workspace file on any platform, because the workspace may be on the
  daemon's machine rather than the app's. Electron main is on the app's machine, so main writing the
  PDF itself would quietly mean something different for a remote daemon than a local one. That also
  decided against a native save dialog: it returns a path on the wrong machine.
- The text write could not carry it. `fs.file.write` LF-normalizes, re-applies a detected EOL, and
  **refuses a binary target outright** - so it could never have replaced a PDF on re-export.

So the bytes go back through the daemon on `fs.file.write_binary`, gated on
`server_info.features.binaryFileWrite`. That RPC is workspace-bounded (unlike `fs.file.write`, which
is deliberately not, because a tab may edit a file opened from anywhere) and takes an explicit
`overwrite` rather than a precondition: a generated artifact has nothing to reconcile against.

**The payload does not ride in the request.** The JSON message says where the bytes go and how many
to expect; the bytes follow as `FileTransfer` binary frames correlated on `requestId`, the transport
`file.upload` already used. A printed document is routinely several MB, and base64 in JSON costs a
third again on the wire plus the whole encoded string allocated on both sides and walked by the
validator. The daemon buffers a transfer in memory and writes it in one call, so every containment
guarantee (resolving through `resolveMutationPath`, creating parent directories one re-checked
segment at a time, the exclusive create) stays at a single open instead of being reimplemented by a
streaming writer. `contentBase64` is still accepted and no longer sent - `COMPAT(binaryWriteBase64)`.

PDF export is desktop-only and simply absent elsewhere, per the no-fallback rule in the root
`CLAUDE.md`. `printToPDF` has no headless stand-in, so it is proven by the packaged desktop smoke;
see [testing.md](testing.md).

## What is still missing

Tracked in the File rendering section of [`projects/README.md`](../projects/README.md#file-rendering):
CSV/TSV table view, Jupyter notebooks, inline math on native (see above), and PDF _viewing_ -
which is a different problem from the PDF _export_ above, and the heavier one.
