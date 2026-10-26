// OTTO(context-compaction): preserved prose-only gate from Refine. Content sniffing must never admit code rewrites.
const proseExtensions = new Set([
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
export function isRefinableDocument(file: string): boolean {
  const normalized = file.trim().toLowerCase().replaceAll("\\", "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return dot === -1;
  return proseExtensions.has(name.slice(dot + 1));
}
