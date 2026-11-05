# Viewer fixtures

These frozen documents exercise the restored AsciiDoc converter and its existing
Markdown/diagram rendering path. Formatting is intentionally preserved; the
formatter excludes this directory. Tests read the fixtures without rewriting them.

`asciidoc.adoc` covers the general viewer. `archdocs-corpus/` covers nested tables,
inline markers, source blocks and document structure from the Otto 0.9 corpus.
