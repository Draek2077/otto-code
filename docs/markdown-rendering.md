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

## What is still missing

Tracked in `projects/file-rendering/`: mermaid, relative image resolution (a workspace-local
`![](docs/x.png)` still shows alt text — see `relative-image-resolution.md`), CSV, notebooks,
GitHub alerts (`> [!NOTE]` renders its literal marker), tables, footnotes, math.
