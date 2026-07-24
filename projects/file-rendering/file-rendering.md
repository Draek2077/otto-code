# File Rendering — charter

Bring the file viewer (and the shared markdown pipeline it sits on) up to the rendering level
people expect from an IDE-grade tool: rich markdown, diagrams, and first-class previews for the
file formats developers actually open. Pure client-side work — provider-agnostic by construction,
no daemon or protocol changes except where noted.

## Where rendering happens

One markdown pipeline serves two surfaces: chat messages (`packages/app/src/components/message.tsx`)
and the file viewer (`packages/app/src/components/file-pane.tsx`), both through
`MarkdownRenderer` (`packages/app/src/components/markdown/renderer.tsx`,
`react-native-markdown-display` + markdown-it). Anything added at that level (task lists, mermaid
fences) lights up both surfaces at once. Standalone file formats (SVG, CSV, notebooks) are
viewer-only concerns in `file-pane.tsx`.

## Current state (2026-07-09)

The viewer renders: syntax-highlighted text (Lezer, ~14 language families via
`packages/highlight`), markdown (tables, strikethrough, autolinks, typographer, inline-HTML
subset, sized inline images, highlighted fences, YAML frontmatter as a metadata block), images
(png/jpg/gif/webp + svg on web via blob URLs), and a binary fallback.

### Shipped quick wins

- **Task lists** — `- [ ]` / `- [x]` render as checkbox glyphs in both chat and viewer.
  Token-level markdown-it rule (`markdown/task-lists.ts`) so fenced examples are untouched.
  Read-only glyphs (☐/☑); icon or interactive checkboxes are polish tracked below.
- **HTML is translated, never rendered** — embedded HTML with a markdown equivalent is converted
  (`<h1>` → `#`, `<strong>` → `**`, lists, blockquotes, `<hr>`); everything else drops its tag and
  keeps its text. Raw markup never reaches the reader. Unrenderable images fall back to alt text,
  and the viewer passes `remoteImages: "altText"` so a repo document cannot reach the network.
  `markdown/html-ish.ts`; the standing policy now lives in [docs/markdown-rendering.md](../../docs/markdown-rendering.md).
- **SVG on native** — `image/svg+xml` renders through `SvgXml` (react-native-svg) on iOS/Android
  instead of a blank `Image`; parse failures fall back to the binary message. Web keeps the
  blob-URL `<img>` path, which tolerates more of the SVG spec.
- **Mermaid diagrams — SHIPPED.** ` ```mermaid ` / ` ```mmd ` fences render on every surface the
  markdown pipeline feeds (chat, viewer, PR panel) and on all four platforms; `.mmd`/`.mermaid`
  files render as a single diagram in the viewer. Web/Electron render in-page from a lazily
  imported mermaid; iOS/Android run the same render core inside a self-contained webview payload
  (`npm run build:mermaid-webview`). Malformed diagrams show their source with the parse message
  beneath. `components/markdown/mermaid/`; the durable design notes — the ~3.4 MB bundle and its
  dynamic-import boundary, why theme values must be concrete, the debounce-and-cache rule that
  streaming forces — now live in
  [docs/markdown-rendering.md](../../docs/markdown-rendering.md). Deferred polish: pan/zoom for
  diagrams wider than the pane, and a source/diagram toggle.

## Workstreams

### 1. Relative image resolution in markdown files

`![](docs/diagram.png)` and `<img src="packages/website/public/logo.svg">` in a repo markdown file
don't resolve — the renderer has no base path, and the two forms fail in two different places.
Resolve relative srcs through the existing daemon file-read RPC and the attachment blob pipeline
(`attachments/service.ts`), same as image previews. Only workstream that touches the daemon path,
and only via existing RPCs. Moderate.

Broken out in full: **[relative-image-resolution.md](relative-image-resolution.md)** — the two
code paths, the containment boundary, and the open fallback-behavior decision.

### 2. CSV/TSV table view

Client-side parse + virtualized rows (FlatList patterns as in the explorer). Toggle between table
and raw text. Moderate.

### 3. Jupyter notebooks (`.ipynb`)

JSON parse → markdown cells via `MarkdownRenderer`, code cells via `HighlightedCodeBlock`,
base64 image outputs via the existing image path, text outputs as code blocks. Moderate, very
high perceived value.

### 4. Markdown polish (smaller items, batch as convenient)

- Icon (or interactive) checkboxes replacing the ☐/☑ glyphs.
- GitHub alerts — `> [!NOTE]` / `[!WARNING]` / `[!TIP]` blockquotes currently render the literal
  marker text. Token-level markdown-it rule mapping the five kinds onto themed callouts; lights up
  chat and viewer at once. Common in READMEs, so higher value than its size suggests.
- Footnotes.
- Math (KaTeX): feasible on web; native needs the webview approach — the mermaid payload
  (`components/markdown/mermaid/webview/`) is now the pattern to copy, and it already bundles
  katex.

### 5. PDF (deferred)

The one genuinely heavy item: pdf.js on web, a separate native library, large payloads. Revisit
after 1–3 ship.

## Sequencing

1 (relative images) → 2/3 in either order → 4 opportunistically → 5 deferred.

## Exit

When a workstream ships, fold durable facts into `docs/` (likely a short "file rendering" section
or additions to existing docs) and prune it from this charter; delete the folder when empty, per
the projects convention in CLAUDE.md.
