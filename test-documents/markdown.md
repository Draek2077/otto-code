---
description: Markdown counterpart to asciidoc-preview-test.adoc, for A/B comparison.
component: Otto
version: 1
---

# Markdown Preview Test

The companion to [asciidoc.adoc](asciidoc.adoc). The
two diagrams below are **byte-identical** to the ones in that file — they should
render identically, because both formats funnel into the same `MermaidBlock`.
If they differ, that's the bug.

The YAML frontmatter above appears in the metadata block, the same way the
AsciiDoc file's header attributes do.

> **Note:** Markdown has no admonition syntax, so this is a plain blockquote —
> which is exactly what the AsciiDoc `NOTE:` form converts into.

## Diagrams

```mermaid
flowchart LR
  A[".adoc source"] --> B["asciiDocToMarkdown()"]
  B --> C["markdown"]
  C --> D["MarkdownRenderer"]
  D --> E["MermaidBlock"]
```

A second diagram, to prove more than one renders per document:

```mermaid
sequenceDiagram
  participant V as File viewer
  participant C as Converter
  participant M as MermaidBlock
  V->>C: .adoc source
  C-->>V: markdown
  V->>M: mermaid fence
  M-->>V: rendered diagram
```

## Text formatting

**Bold**, _italic_, `monospace`, and a snake_case_identifier that must stay
intact.

This line ends with an explicit break  
and this text should sit directly underneath it.

Links: [the AsciiDoc site](https://asciidoc.org) and [GitHub](https://github.com).

## Source blocks

```typescript
export function asciiDocToMarkdown(source: string): AsciiDocDocument {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const header = parseDocumentHeader(lines);
  return { frontmatter: formatFrontmatter(header.entries), body: "" };
}
```

An untagged fence:

```
plain, unhighlighted text
```

## Lists

Unordered, nested three deep:

- Top level
  - Second level
    - Third level
- Back to the top

Ordered:

1. First step
2. Second step
   1. A sub-step
3. Third step

## Tables

| Construct | Rendered as |
| --- | --- |
| ` ```mermaid ` | A diagram, via MermaidBlock |
| ` ```typescript ` | A fenced code block with syntax highlighting |
| `> **Note:**` | A blockquote with a bold label |

## Quotes

> A capability isn't done when one provider has it; it's done when they all do.
>
> — Otto CLAUDE.md

---

Everything above this rule should have rendered. Compare against the `.adoc`
file section by section.
