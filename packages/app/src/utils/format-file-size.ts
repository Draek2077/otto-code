/**
 * Byte count as a short human label ("512 B", "3.4 KB", "1.2 MB").
 *
 * Binary units (1024), because this describes bytes on disk. Extracted from
 * byte-identical copies in file-pane.tsx and file-explorer-pane.tsx.
 */
export function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * UTF-8 byte length of the editor's baseline text, as it exists on disk.
 *
 * The buffer is LF-normalized on load, so a CRLF file is one byte per line
 * short of its real size — add those back rather than reporting a number that
 * disagrees with the file manager.
 */
export function utf8ByteSize(content: string, eol: "lf" | "crlf"): number {
  const bytes = new TextEncoder().encode(content).length;
  if (eol === "lf") {
    return bytes;
  }
  let newlines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      newlines++;
    }
  }
  return bytes + newlines;
}
