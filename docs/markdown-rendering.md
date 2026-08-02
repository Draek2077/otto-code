# Markdown rendering

One pipeline serves every markdown surface: chat (`components/message.tsx`), the file viewer
(`components/file-pane.tsx`), and the pull-request panel — all through `MarkdownRenderer`
(`components/markdown/renderer.tsx`, `react-native-markdown-display` + markdown-it). Anything
added at that level lights up all three at once.

## We do not render HTML

Markdown documents in the wild — READMEs above all — carry embedded HTML. Otto's policy:

> **Translate what has a markdown equivalent. Drop the tag and keep the text for everything else.
> Never show raw markup, and never let a document load or execute anything from outside itself.**

This is deliberately _not_ "render a safe subset of HTML". We render markdown; HTML is an input
format we translate on the way in. The translation lives in
`components/markdown/html-ish.ts`, which runs before markdown-it (which itself has `html: false`).

**This is also why [widgets](widgets.md) do not go through here.** An agent that wants to draw
something emits a `show_widget` tool call carrying an HTML/SVG fragment, and the client renders it
in a sandboxed frame anchored to that tool call — beside the markdown, never inside it, exactly as
the Suggested Tasks card is. Widgets exist so that this policy never has to be weakened: the answer
to "the model wants to show a chart" is a separate, contained renderer, not `html: true`.

The five rules that follow from it, and that are easy to break:

1. **The default for an unrecognized tag is unwrap, not passthrough.** A tag with no translation
   drops to its text — legible, not broken. Reverting this to raw passthrough puts markup on
   screen. `script`/`style` are the only tags whose _contents_ are dropped too.
   - **`<table>` is translated, not unwrapped.** It becomes a GFM table: `thead`/`tbody` are
     wrappers and the rows are found wherever they sit, the first row is the header, short rows
     are padded, and a pipe inside a cell is escaped. A cell GFM cannot express — a nested list,
     another table, anything with a newline — collapses onto one line, because the choice is
     between losing the layout and losing the table and the table is worth more. A table with no
     rows falls back to the plain unwrap.
2. **Translation is a token-level transform, not a string one.** `<summary><h3>Files</h3></summary>`
   must yield the label `Files`, not `### Files` — heading translation is stripped from summaries
   before rendering, while the tag is still a token. String post-processing cannot tell the
   difference.
3. **Image srcs are gated by scheme, and that gate is the only thing between a document and a
   network fetch.** An image that fails the gate renders as its `alt` text (or is dropped if it has
   none). Never as raw markup, and never as a blank sized box. Workspace-relative srcs are an
   additive allowed _class_ routed through the daemon, not a loosening of the scheme check — see
   [Relative images](#relative-images-a-documents-own-files).
4. **Whitespace changes meaning at the boundary.** It is insignificant in HTML and structural in
   markdown, so text coming out of a tag has its line indentation stripped — otherwise a
   pretty-printed nested `<div>` body arrives with 4+ leading spaces and markdown-it reads it as an
   indented code block. Text _outside_ any tag is already markdown and is left exactly as written
   (nested lists depend on it), as are protected code ranges. This is what the `insideHtml`
   parameter on `renderInlineTokens` tracks.
5. **Inline constructs must end up on one line.** Link labels, emphasis, and headings collapse
   their content to a single line. A multi-line `[label](href)` is not a link — markdown emits the
   brackets as literal text, which is how a `<picture>` inside an `<a>` used to produce a stray
   `[` and `](…)` around a code block.

Nothing in this path can execute anything regardless: the renderer emits React Native primitives,
so passthrough would be inert — but inert markup on screen is still a rendering bug.

## `remoteImages`: who is allowed to fetch

`MarkdownRenderer` takes `remoteImages?: "load" | "altText"` (default `"load"`).

| Surface            | Setting     | Why                                                                                                  |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| File viewer        | `"altText"` | A repo document must not reach the network just by being previewed. Badges render as their alt text. |
| Pull-request panel | `"load"`    | Already network-backed against the forge; avatars and badges are wanted.                             |
| Chat               | n/a         | Renders with `enableHtmlish={false}`, so the HTML path never runs.                                   |

Note the desktop app shell's CSP (`packages/desktop/src/main.ts`) sets `img-src 'self' data: blob:`
with no `https:`, so remote images cannot load there regardless of this setting — `"load"` only
takes effect on native. Do not widen that CSP to "fix" a blank image; the alt-text fallback is the
intended behavior.

**Both image forms are now behind this one gate.** There is a shared `image` render rule
(`markdown/renderer.tsx`) as well as the HTML `<img>` translation. Before it existed, only the HTML
path honoured `remoteImages` — markdown `![](x)` fell through to `react-native-markdown-display`'s
default rule, which matched the src against `allowedImageHandlers` and otherwise prefixed
`defaultImageHandler`, so a viewer `![](docs/x.png)` became a fetch of `https://docs/x.png`. Do not
remove that rule to "simplify"; the library default is a network fetch.

## Relative images: a document's own files

A document may show images that live beside it — `![](assets/flow.png)`,
`<img src="packages/website/public/logo.svg">`, AsciiDoc's `image::flow.png[]` — resolved against
the document's location the way GitHub resolves them against a repo. Only the file viewer opts in,
by passing `workspaceImages` to `MarkdownRenderer`.

| Module                      | Role                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workspace-image-source.ts` | Pure. Resolves a src against the document's directory and **contains it under the workspace root**. The security boundary. |
| `workspace-image-cache.ts`  | The daemon read, deduplicated by path. Bytes → the attachment store.                                                       |
| `image-context.tsx`         | The context both image paths resolve through, so the gate is applied once.                                                 |
| `svg-intrinsic-size.ts`     | An SVG's size from its `width`/`height` or `viewBox` — native never sends SVG through `Image.getSize`.                     |

The load-bearing decisions:

- **Containment is app-side, and it happens before any RPC.** The daemon deliberately does not bound
  a single-file read to a known workspace (`file-explorer/workspace-files-session.ts`), so
  `resolveWorkspaceImagePath` refusing a path is the whole of the protection: `../../../etc/passwd`,
  `C:/…`, `//host/share`, `file:` and percent-encoded or backslash-spelled variants of all of them
  never become a read. It shares its `..`-collapsing primitive (`containRelativePath`, `utils/path`)
  with the assistant-file-link resolver — one containment algorithm, not two.
- **Only known image extensions are read.** Containment alone would happily allow `![](.env)`. The
  extension allowlist is what makes a document unable to use this path as a file reader.
- **The transport is the file-read RPC the viewer already uses.** No protocol change, no
  image-serving endpoint. `client.readFile` → `persistAttachmentFromBytes` → `useAttachmentPreviewUrl`
  is exactly `createFilePanePreview`'s shape, so blob-URL (web) / `file://` (native) lifecycle and GC
  are the store's, not a second caching layer. Reads are capped at 8 MB after the fact — the daemon
  read has no size limit of its own — and an oversized image falls back to alt text.
- **Resolution is cached per daemon + workspace + path, not per component.** A badge table naming the
  same file twenty times is one read; a remount is none. The trade: an image edited on disk keeps
  showing its cached copy until the entry is evicted.
- **`remoteImages: "altText"` still means what it says.** The raw src of a relative image never
  reaches an `<Image>` — only the store URL the read produced. `localImages: "workspace"` in
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

`test-documents/markdown.md` and `test-documents/asciidoc.adoc` carry the fixture — relative,
root-relative, HTML, escaping, missing and remote images in one document each.

### Two resolvers, on purpose — do not unify them

Chat has its own, older path for the same-looking problem: `utils/assistant-image-source.ts` →
`AssistantMarkdownImage` (`message.tsx`), which reads an agent-authored `![](screenshots/out.png)`
through the identical `readFile` → attachment-store transport. It looks like a duplicate. It is not,
and merging them would be a security regression.

|                       | Viewer (`workspace-image-source.ts`) | Chat (`assistant-image-source.ts`)                                      |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Who wrote the src     | A repo file — **untrusted**          | The agent this user is talking to — trusted                             |
| Base                  | The document's own directory         | The workspace root; chat messages have no directory                     |
| Outside the workspace | **Refused**                          | **Deliberately allowed** — falls back to the filesystem/drive/home root |
| Non-image paths       | Refused by extension                 | Read, then rejected on `kind !== "image"`                               |

Chat's breadth is a feature: an agent screenshots to `/tmp/otto-codex-screenshot.png` or
`~/.otto/screenshots/`, and chat has to show it. Applying the viewer's containment there would break
that. Applying chat's breadth to the viewer would let any README name any file on the host. The
shared thing between them is the transport, and that is already shared.

The HTML `<img>` half stays off in chat for a separate reason: chat renders with
`enableHtmlish={false}`, so the translation pass never runs at all.

### Preview attachments must be pinned, or the GC eats them

Both resolvers end in `persistAttachmentFromBytes`, which writes a **preview attachment** — a local
copy of a daemon-side image, ided by `createPreviewAttachmentId` so re-reading one file reuses one
stored copy. The attachment store's garbage collector owns everything in that store and treats
anything it cannot trace back to a live reference as garbage. It walks drafts, queued messages,
pending creates, the live stream and the workspace attachment store — **none of which a preview
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

## Fences: one dispatch point

A fence info string that means something other than "highlight this as code" is resolved in exactly
one place, `components/markdown/fence.tsx` (`MarkdownFence`). Both `fence` render rules route
through it — the shared one in `markdown/renderer.tsx` and the **duplicate copy in `message.tsx`**,
which maintains its own `RenderRules` object for iOS text-hoisting reasons. Adding a fence language
means editing `MarkdownFence`, not the rules; forget the `message.tsx` rule and the feature works
everywhere except chat, which is the surface most people see first.

## Mermaid diagrams

` ```mermaid ` (and ` ```mmd `) fences render as diagrams on all four platforms, and `.mmd` /
`.mermaid` files render as one diagram in the viewer. `components/markdown/mermaid/` owns it:

| Module                       | Role                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `mermaid-render.ts`          | The only module that knows the mermaid library. Needs a DOM. Also owns the cache. |
| `mermaid-diagram.tsx`        | Web/Electron host — injects the SVG into a raw `<div>`.                           |
| `mermaid-diagram.native.tsx` | iOS/Android host — a `react-native-webview` running the self-contained payload.   |
| `mermaid-block.tsx`          | Surface-facing: the themed wrapper and the source-block fallback.                 |
| `mermaid-theme.ts`           | Otto theme → mermaid `themeVariables`.                                            |
| `mermaid-document.ts`        | Standalone `.mmd` source → a one-fence markdown document.                         |

The load-bearing decisions:

- **Web renders in the page; native renders in a webview.** There is no DOM on iOS/Android and
  mermaid measures label text by laying it out, so native gets the CM6 editor's recipe: an esbuilt
  self-contained HTML payload (`scripts/build-mermaid-webview-html.mjs`, wired into
  `eas-build-post-install` next to the editor and terminal payloads) driven over a typed bridge.
  Rebuild it with `npm run build:mermaid-webview` after touching anything the payload imports —
  including `mermaid-render.ts`, which it shares with web. Nothing in the payload reaches the
  network.
- **Both hosts sit behind a dynamic `import()`, and that is not optional.** Mermaid is **~3.4 MB
  minified / ~950 KB gzipped** — bigger than the editor and terminal payloads combined. On web
  `import("mermaid")` is the boundary; on native it is `import("./webview/mermaid-webview-html")`,
  which is why nothing else may reference that generated module. Per
  [feature-flags.md](feature-flags.md), a dynamic boundary is the only lever Metro respects. If the
  native bundle ever needs trimming, aliasing out `cytoscape` (mindmap, architecture) and `katex`
  (math labels) removes ~24% — at the cost of web/native parity, which is why it was not done.
- **A diagram that can't be drawn shows its source.** `MermaidDiagram` takes a `renderFallback`
  rather than having a "nothing yet" state, so neither host has a code path that draws an empty box.
  Failure adds the parse message under the source block; the source block is a normal
  `HighlightedCodeBlock`, copy button included.
- **Theme values must be concrete, never `themeColorRef`.** Mermaid runs color math (khroma) over
  every variable it is handed, so a `var(--colors-surface2)` produces `NaN` shades and an unstyled
  diagram. `mermaid-theme.ts` therefore reads resolved colors through a `withUnistyles` mapping.
  Consequence, accepted: a diagram inside the black chat scope on web follows the app theme rather
  than the scope — the same class of leak as icon `color` props (see [unistyles.md](unistyles.md)).
  Only mermaid's `base` theme honours `themeVariables`; the others hardcode their palettes.
- **Rendering is always debounced, and outcomes are cached.** `react-native-markdown-display` mints
  fresh node keys on every parse (`getUniqueID`), so any surface that re-parses — a streaming chat
  message above all — unmounts and remounts every block. Rendering eagerly on mount would mean one
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

## What is still missing

Tracked in the File rendering section of [`projects/README.md`](../projects/README.md#file-rendering):
CSV/TSV table view, Jupyter notebooks, footnotes, math (KaTeX), interactive checkboxes, and PDF.
