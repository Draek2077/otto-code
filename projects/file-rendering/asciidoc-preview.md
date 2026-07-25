# AsciiDoc preview

Rendered `.adoc` / `.asciidoc` in the file viewer's Preview mode, with embedded
Mermaid diagrams. Increment 1 is **built**.

## The architecture decision

Two ways to preview AsciiDoc, and they are not close:

|                                | Asciidoctor HTML in a webview                           | **AsciiDoc → markdown → the existing pipeline** |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| Fidelity to published HTML     | exact                                                   | good for common constructs, flattens the rest   |
| Theme tokens, fonts, selection | foreign — needs a parallel CSS theme                    | inherited                                       |
| Mermaid                        | **a second mermaid host** (mermaid.min.js in the guest) | the _same_ `MermaidBlock` a `.md` fence uses    |
| Cost                           | daemon RPC + capability gate + async render path        | one pure function                               |

The mermaid row decided it. `[mermaid]` blocks in a `.adoc` and ```mermaid
fences in a `.md`must produce identical diagrams — same theme, same sizing,
same failure behaviour. The webview path would draw them through a different
engine in the same app. That is exactly what`markdown/mermaid/mermaid-document.ts`was written to avoid ("rather than
growing a second mermaid host with its own theming, sizing and failure
behaviour"), and the`.mmd` viewer had already set the precedent: a standalone
diagram file becomes a one-fence markdown document.

So AsciiDoc joins the same contract. `toRenderedDocument("asciidoc", …)`
returns markdown; everything downstream — theming, code highlighting, images,
find gating, scroll sync, native/web parity — was already built and generic.

**This is not the "adoc→markdown normalizer" idea rejected earlier in the
design discussion.** That was rejected as a way to approximate a _publishing_
pipeline. The target here is not HTML, it is Otto's render tree, which is an
approximation layer for markdown too. The question is only whether the author
sees the structure they wrote — and for sections, lists, blocks, tables,
admonitions and diagrams, they do.

## What was built

| File                                             | Role                                                            |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `markdown/asciidoc/asciidoc-to-markdown.ts`      | The converter: block pass + inline pass                         |
| `markdown/asciidoc/asciidoc-to-markdown.test.ts` | 51 tests, incl. the archdocs corpus                             |
| `file-pane-render-mode.ts`                       | `isRenderedAsciiDocFile`, `"asciidoc"` kind, preview-by-default |
| `markdown/rendered-document.ts`                  | The `asciidoc` case                                             |
| `material-file-icons.ts`                         | The `asciidoc` icon for `.adoc` / `.asciidoc`                   |

Covered: document header (title → h1, attributes → the frontmatter metadata
block, `{name}` references), sections, listing/literal/example/sidebar/quote/
comment/passthrough/open blocks, `[source,lang]` fences, **`[mermaid]` blocks**,
tables (`cols`, header detection, multi-line cells, cell specs), admonitions in
both forms, nested ordered/unordered/description/callout lists, block titles,
and the inline set (constrained + unconstrained formatting, `link:`/`image:`/
`xref:`/`<<>>`/`footnote:`/`kbd:`/`btn:`/`menu:`/`pass:`, hard line breaks).

Degradation is visible, never silent: `include::` renders as a "not resolved in
preview" note, passthrough blocks render as HTML source, unresolved `{attrs}`
stay on screen.

### Fidelity corpus

`archdocs/pages/*.adoc` — 18 real documents with tables, admonition blocks,
nested lists and embedded diagrams — is a parameterized test. Each page must
convert with no AsciiDoc markup left behind, and **the count of `[mermaid]`
blocks in the source must equal the count of ```mermaid fences out**, so a
regression that stops diagrams reaching `MermaidBlock` fails the suite.

`.asc` is deliberately not claimed: it collides with PGP armored files.

A second, denser fixture lives at `test-documents/asciidoc.adoc` — hand-authored
to exercise constructs the architecture pages happen not to use (callout lists,
literal blocks, description lists, sidebars, an unresolved include). It is under
test too, so the file people open to eyeball the viewer is the same file that
fails the build when a construct regresses. Writing it immediately paid for
itself: it surfaced two bugs the archdocs corpus had missed — headerless tables
inferring their width from the total cell count instead of the first row, and
wrapped paragraphs inside a quote losing the `>` prefix after their first
physical line.

## Deferred

Ranked by what an author actually notices:

1. **`include::` resolution.** The one gap that needs infrastructure — a daemon
   RPC, since resolving includes means file-system access and a `base_dir`.
   Doing it raises a real policy question: an `include::` can point outside the
   workspace, which turns rendering into a permissions decision (see
   `resolveEditGate` and the gated-multi-root project). Decide the safe-mode
   policy before building it.
2. **CM6 asciidoc language mode.** `.adoc` currently edits as plain monospace —
   no Lezer grammar and no legacy mode exists, so this is a hand-written
   `StreamLanguage`. The status bar already says "AsciiDoc"
   (`packages/highlight/src/language-names.ts`).
3. **Scroll sync between editor and preview.** The preview currently inherits
   the proportional line mapping every rendered document uses. Real sync wants
   per-block source lines — the same idea as Asciidoctor's `sourcemap`, which
   the converter could emit as it walks.
4. **Authoring affordances:** section outline, xref/attribute completion,
   paste-image, diagnostics for broken xrefs.
5. **Constructs that flatten today:** description lists become bulleted bold
   terms, sidebars become quotes, table cell spans become ordinary cells.

## Exit

Fold the architecture decision (markdown as the common render target, one
mermaid host) into `docs/markdown-rendering.md`, then delete this file.
