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
- **Layout-only HTML unwrapping** — `<p>`, `<div>`, `<center>`, `<span>` no longer echo their raw
  markup as literal text in the viewer; they unwrap to their children (block tags keep a paragraph
  boundary). GitHub renders these invisibly, so showing the tags was strictly worse than dropping
  them. `markdown/html-ish.ts`; unknown non-layout tags are still passed through inert.
- **SVG on native** — `image/svg+xml` renders through `SvgXml` (react-native-svg) on iOS/Android
  instead of a blank `Image`; parse failures fall back to the binary message. Web keeps the
  blob-URL `<img>` path, which tolerates more of the SVG spec.

## Workstreams

### 1. Mermaid diagrams (flagship)

Render ` ```mermaid ` fences (chat + viewer) and standalone `.mmd`/`.mermaid` files through one
`MermaidView` component. Both hard problems already have in-repo precedent:

- **Web + Electron: direct render.** Mermaid is a bundled dependency (`script-src 'self'` — the
  strict app-shell CSP that blocks _artifact_ inline scripts does not apply to our own bundle; see
  the partition note in `components/artifacts/artifact-html-view.electron.tsx`). Lazy `import()`
  keeps its size (order of ~1 MB gzipped) out of startup. `mermaid.render()` → SVG string →
  DOM-injected under an `isWeb` gate.
- **Native: webview payload.** No DOM on iOS/Android. Reuse the CM6 editor's recipe:
  `scripts/build-editor-webview-html.mjs` esbuilds a TS entry into a self-contained HTML module
  rendered in `react-native-webview` (`editor/webview/`). A mermaid payload posts the diagram
  source in and either displays in-webview (free pan/zoom) or returns the SVG for `SvgXml`.
- **Theming:** map our theme tokens (docs/design.md) onto mermaid `themeVariables` so diagrams
  follow dark/light.
- **Failure mode:** invalid diagrams render the highlighted source with the parse error beneath —
  never a blank box.
- Estimated ~2–3 days (web first, then the native payload).

### 2. Relative image resolution in markdown files

`![](docs/diagram.png)` and `<img src="packages/website/public/logo.svg">` in a repo markdown file
don't resolve — the renderer has no base path, and the two forms fail in two different places.
Resolve relative srcs through the existing daemon file-read RPC and the attachment blob pipeline
(`attachments/service.ts`), same as image previews. Only workstream that touches the daemon path,
and only via existing RPCs. Moderate.

Broken out in full: **[relative-image-resolution.md](relative-image-resolution.md)** — the two
code paths, the containment boundary, and the open fallback-behavior decision.

### 3. CSV/TSV table view

Client-side parse + virtualized rows (FlatList patterns as in the explorer). Toggle between table
and raw text. Moderate.

### 4. Jupyter notebooks (`.ipynb`)

JSON parse → markdown cells via `MarkdownRenderer`, code cells via `HighlightedCodeBlock`,
base64 image outputs via the existing image path, text outputs as code blocks. Moderate, very
high perceived value.

### 5. Markdown polish (smaller items, batch as convenient)

- Icon (or interactive) checkboxes replacing the ☐/☑ glyphs.
- GitHub alerts — `> [!NOTE]` / `[!WARNING]` / `[!TIP]` blockquotes currently render the literal
  marker text. Token-level markdown-it rule mapping the five kinds onto themed callouts; lights up
  chat and viewer at once. Common in READMEs, so higher value than its size suggests.
- Footnotes.
- Math (KaTeX): feasible on web; native needs the webview approach — piggyback on the mermaid
  payload infrastructure if demand shows up.

### 6. PDF (deferred)

The one genuinely heavy item: pdf.js on web, a separate native library, large payloads. Revisit
after 1–4 ship.

## Sequencing

1 (mermaid) → 2 (relative images) → 3/4 in either order → 5 opportunistically → 6 deferred.

## Exit

When a workstream ships, fold durable facts into `docs/` (likely a short "file rendering" section
or additions to existing docs) and prune it from this charter; delete the folder when empty, per
the projects convention in CLAUDE.md.
