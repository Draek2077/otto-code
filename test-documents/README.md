# Test documents

Hand-authored fixtures for exercising the file viewer: syntax highlighting,
rendered previews, and the editor/split/preview mode bar. Every file is
**self-contained and valid** — no imports of sibling files, no external data, no
network. Open any of them and the whole document should render.

**The one deliberate exception:** the Images section of `markdown.md` and
`asciidoc.adoc` references the sibling `logo.svg`, because resolving a document's
own images against its directory is exactly what those sections test. Each also
carries an escaping path, a missing file, and a remote URL, all of which must
render as their alt text rather than being fetched.

These are fixtures, not app code. `test-documents/**` is excluded from oxlint
and oxfmt (see `.oxlintrc.json`, `.oxfmtrc.json`) so the deliberately varied
formatting and unused declarations survive — the same treatment
`packages/app/demo/staging/templates/**` gets.

## Rendered previews

These open in **Preview** mode by default; use the mode bar for raw source.

| File | Exercises |
| --- | --- |
| [asciidoc.adoc](asciidoc.adoc) | Every AsciiDoc construct the converter handles, **including two `[mermaid]` diagrams** and both image macros |
| [markdown.md](markdown.md) | The markdown counterpart, with the **same two diagrams** for A/B comparison, plus relative, root-relative, HTML, escaping, missing and remote images |
| [diagram.mmd](diagram.mmd) | A standalone mermaid file — a state diagram with a note |
| [logo.svg](logo.svg) | Renders as an image, not as XML source |
| [image.png](image.png) | The raster image path: fit/zoom/pan, and a fully transparent corner over the checkerboard |
| [binary.bin](binary.bin) | The end of the line — a NUL byte in the first 8 bytes, so nothing can render it |

The `.adoc` and `.md` files are the pair worth opening together: the diagrams in
both are byte-identical, so they should render identically. If they don't,
something has grown a second mermaid host.

## Data and structured text

| File | Exercises |
| --- | --- |
| [data.json](data.json) | Nesting, escapes, unicode, number forms |
| [config.yaml](config.yaml) | Anchors, aliases, merge keys, block scalars, multi-doc |
| [data.xml](data.xml) | Namespaces, CDATA, entities, DOCTYPE |
| [page.html](page.html) | Inline `<style>` and `<script>`, a full self-contained page |
| [notebook.ipynb](notebook.ipynb) | Markdown + code cells with saved outputs |
| [data.csv](data.csv) | Quoted fields containing commas |
| [data.tsv](data.tsv) | Tab-separated columns |
| [plain.txt](plain.txt) | No markup at all — asterisks and hashes must stay literal |
| [mdx-example.mdx](mdx-example.mdx) | Markdown carrying JSX |

## Languages

One file per distinct parser in `packages/highlight/src/parsers.ts`. Each is a
small, complete program with comments, strings, numbers and control flow, so
highlighting has something to show.

| File | | File | |
| --- | --- | --- | --- |
| [typescript.ts](typescript.ts) | tide predictor | [component.tsx](component.tsx) | React countdown |
| [javascript.js](javascript.js) | Morse, both ways | [component.jsx](component.jsx) | twinkling stars |
| [python.py](python.py) | prime sieve and gaps | [rust.rs](rust.rs) | run-length coder |
| [go.go](go.go) | goroutine worker pool | [java.java](java.java) | Caesar + Vigenère |
| [csharp.cs](csharp.cs) | LINQ over a register | [cpp.cpp](cpp.cpp) | velocity Verlet N-body |
| [c.c](c.c) | ASCII Mandelbrot | [header.h](header.h) | header-only ring buffer |
| [objective-c.m](objective-c.m) | star catalogue | [php.php](php.php) | roman numerals |
| [swift.swift](swift.swift) | great-circle routes | [dart.dart](dart.dart) | Huffman coding |
| [elixir.ex](elixir.ex) | tide model, pipelines | [shell.sh](shell.sh) | self-seeding log tidier |
| [query.sql](query.sql) | DDL, CTEs, window functions | [styles.css](styles.css) | layers, container queries |
| [theme.scss](theme.scss) | maps, mixins, `@each` | | |

**Aliases are not duplicated.** `parsers.ts` maps several extensions onto each
parser — `yml`→yaml, `htm`→html, `cc`/`cxx`/`hpp`/`hxx`→cpp, `mjs`/`cjs`→js,
`mm`→objc, `exs`→elixir, `bash`/`zsh`/`shell`→sh, `scss`→css. One file per
parser is enough to prove the mapping; add an alias file only when testing the
extension lookup itself.

## The two generated fixtures

`image.png` and `binary.bin` are the exceptions to "hand-authored": you cannot
type a PNG. Both were emitted by a throwaway Node script and are checked in as
the smallest files that still exercise their branch.

`image.png` is 320×200 RGBA at ~2.4 KB — the colours are quantized to a handful
of levels precisely so it compresses to something worth committing. Its top-right
quadrant is fully transparent, which is the only part of the image viewer's
checkerboard that anything actually tests. Between it and `logo.svg` the two
image branches are both covered: `logo.svg` is the SVG path (raw XML through
`react-native-svg` on native), `image.png` is the raster path (bytes → attachment
store → platform `Image`), and they take different code from the read onward.

If you regenerate `image.png`, keep it under a few KB and keep the transparent
region. If you replace it with a different format, note that the viewer parses
its natural size from the container header (`image-dimensions.ts`) — PNG, GIF,
JPEG, WebP, BMP and ICO are read; anything else loses the zoom controls.

## Not covered

Nothing here covers `pdf`, `mp3`, `mp4`, fonts, or archives, all of which
`PREVIEW_FIRST_EXTENSIONS` in `file-pane-render-mode.ts` sends straight to
preview and none of which render today. `binary.bin` stands in for the whole
class: they all land on the same "can't be previewed here" card.
