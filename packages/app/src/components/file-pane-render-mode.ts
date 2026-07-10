import type { FileViewMode } from "@/stores/file-view-store";

export function isRenderedMarkdownFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

// Formats whose preview is not just the highlighted source: rendered (SVG as
// an image), viewable-only (images, media), or binary. Grows as the
// file-rendering project ships more rich previews (mermaid, CSV, notebooks).
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
  // Documents and archives — binary; the editor could never open them.
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
  if (isRenderedMarkdownFile(filePath)) {
    return "preview";
  }
  return PREVIEW_FIRST_EXTENSIONS.has(fileExtension(filePath)) ? "preview" : "editor";
}
