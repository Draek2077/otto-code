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

The five rules that follow from it, and that are easy to break:

1. **The default for an unrecognized tag is unwrap, not passthrough.** `<table>` has no markdown
   translation yet, so it drops to its cell text — legible, not broken. Reverting this to raw
   passthrough puts markup on screen. `script`/`style` are the only tags whose _contents_ are
   dropped too.
2. **Translation is a token-level transform, not a string one.** `<summary><h3>Files</h3></summary>`
   must yield the label `Files`, not `### Files` — heading translation is stripped from summaries
   before rendering, while the tag is still a token. String post-processing cannot tell the
   difference.
3. **Image srcs are gated by scheme, and that gate is the only thing between a document and a
   network fetch.** An image that fails the gate renders as its `alt` text (or is dropped if it has
   none). Never as raw markup, and never as a blank sized box.
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

## What is still missing

Tracked in `projects/file-rendering/`: relative image resolution (a workspace-local
`![](docs/x.png)` still shows alt text — see `relative-image-resolution.md`), CSV, notebooks,
GitHub alerts (`> [!NOTE]` renders its literal marker), tables, footnotes, math.
