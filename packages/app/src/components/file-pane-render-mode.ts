import type { FileViewMode } from "@/stores/file-view-store";

export function isRenderedMarkdownFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

/** A standalone mermaid diagram: rendered as a diagram, not as its source. */
export function isRenderedMermaidFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".mmd") || normalizedPath.endsWith(".mermaid");
}

/**
 * An AsciiDoc document. `.asc` is deliberately excluded - it collides with PGP
 * armored files, and `.adoc`/`.asciidoc` are what the highlight package already
 * names (packages/highlight/src/language-names.ts).
 */
export function isRenderedAsciiDocFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".adoc") || normalizedPath.endsWith(".asciidoc");
}

/** A standalone HTML document, rendered in an isolated browser viewport. */
export function isRenderedHtmlFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm");
}

/**
 * Which kind of document the viewer renders instead of showing as highlighted
 * source. `null` means "show the source".
 */
export type RenderedDocumentKind = "markdown" | "mermaid" | "asciidoc" | "html";

export function renderedDocumentKind(filePath: string): RenderedDocumentKind | null {
  if (isRenderedMarkdownFile(filePath)) return "markdown";
  if (isRenderedMermaidFile(filePath)) return "mermaid";
  if (isRenderedAsciiDocFile(filePath)) return "asciidoc";
  if (isRenderedHtmlFile(filePath)) return "html";
  return null;
}

/**
 * Highlighting is a synchronous pass over the whole file on the UI thread, and
 * every highlighted line then mounts as its own row. Past this size a multi-MB
 * log or lockfile freezes the app for seconds on open, so the viewer falls back
 * to plain text. Characters, not bytes: `length` is what the highlighter walks.
 */
export const HIGHLIGHT_MAX_CHARS = 1_000_000;
export const HIGHLIGHT_MAX_LINES = 10_000;

/** Whether a file is too big to highlight and mount line-by-line. */
export function exceedsHighlightBudget(content: string): boolean {
  if (content.length > HIGHLIGHT_MAX_CHARS) {
    return true;
  }
  // Counted by scanning rather than `split`, so an under-budget file never pays
  // for an array of every line, and an over-budget one stops at the limit.
  let lines = 1;
  let index = content.indexOf("\n");
  while (index !== -1) {
    lines += 1;
    if (lines > HIGHLIGHT_MAX_LINES) {
      return true;
    }
    index = content.indexOf("\n", index + 1);
  }
  return false;
}

// Formats whose preview is not just the highlighted source: rendered (SVG as
// an image), viewable-only (images, media), or binary. Grows as the
// File rendering section of projects/README.md ships more rich previews
// (CSV, notebooks).
const PREVIEW_FIRST_EXTENSIONS = new Set([
  // Images (the viewer renders them; SVG renders as an image, not XML).
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
  "heic",
  "heif",
  // Media.
  "mp3",
  "mp4",
  "m4a",
  "wav",
  "ogg",
  "webm",
  "mov",
  "avi",
  "mkv",
  // Documents and archives - binary; the editor could never open them.
  "pdf",
  "zip",
  "gz",
  "tgz",
  "tar",
  "7z",
  "rar",
  "jar",
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "class",
  "bin",
  // Fonts.
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
]);

function fileExtension(filePath: string): string {
  const normalized = filePath.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastDot <= lastSlash + 1) {
    return "";
  }
  return normalized.slice(lastDot + 1);
}

/**
 * Which view a file tab opens in when the user hasn't picked one for it yet:
 * formats whose preview renders differently than the raw text (markdown,
 * images, binaries) open in preview; ordinary text and code open straight in
 * the editor. An explicit choice, remembered per file, always wins.
 */
export function defaultFileViewMode(filePath: string): FileViewMode {
  if (renderedDocumentKind(filePath) !== null) {
    return "preview";
  }
  return PREVIEW_FIRST_EXTENSIONS.has(fileExtension(filePath)) ? "preview" : "editor";
}
