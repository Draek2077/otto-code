// Which documents Refine is offered over.
//
// This is a deliberate restriction, not an oversight. Refine is a whole-document
// text rewrite: it has no parser, no symbol table, and no language server. The
// rename tab can safely touch code because an LSP tells it what a symbol is and
// where every reference lives; Refine knows none of that, so over source code it
// would produce a plausible-looking diff that silently breaks a call site — and
// a plausible-looking diff is exactly what gets rubber-stamped.
//
// That is the same objection that got the old "Refactor with AI" button pulled
// from the editor toolbar, and it survives Refine's review loop: reviewing is
// only a safeguard if the reviewer can actually see the breakage, and nobody can
// see a broken import in a 400-line diff.
//
// So: prose and instruction files, which is what the loop was built for. Code
// stays with the LSP-backed tools. If Refine ever grows symbol awareness, this
// is the one place that has to change.

const PROSE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "rst",
  "adoc",
  "asciidoc",
  "org",
]);

/**
 * True for prose and instruction documents. Extension-based on purpose: the
 * alternative is sniffing content, and "this file looks like prose" is exactly
 * the kind of guess that would put an AI rewrite over a `.ts` file.
 */
export function isRefinableDocument(path: string): boolean {
  const normalized = path.trim().toLowerCase().replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    // Extensionless files (LICENSE, NOTICE, AUTHORS) are prose by convention,
    // and none of them are code. A leading dot is a dotfile, not an extension.
    return dot === -1;
  }
  return PROSE_EXTENSIONS.has(name.slice(dot + 1));
}
