import type { FileEol, FileWriteResult } from "@otto-code/protocol/messages";
import { exportSiblingPath, markdownToHtmlDocument } from "./markdown-to-html";

/**
 * Write a markdown document out as an HTML file beside it.
 *
 * The write goes through the daemon like every other write in this app: the
 * client never touches a workspace file itself, on any platform.
 */

/**
 * The one daemon call this needs, as a port. Narrower than `DaemonClient` so a
 * test can supply an in-memory adapter instead of a mocked client.
 */
export interface HtmlExportWriter {
  writeFile(options: {
    cwd: string;
    path: string;
    content: string;
    expectedModifiedAt: string;
    expectedHash?: string;
    allowCreate?: boolean;
    eol?: FileEol;
  }): Promise<FileWriteResult>;
}

export type HtmlExportResult =
  | { status: "written"; path: string; title: string }
  | { status: "error"; message: string };

/** `notes/design.md` exports to `notes/design.html`. */
export function htmlExportPath(markdownPath: string): string {
  return exportSiblingPath(markdownPath, "html");
}

function baseName(path: string): string {
  return path.split(/[/\\]/).findLast(Boolean) ?? path;
}

export async function exportMarkdownAsHtml(input: {
  writer: HtmlExportWriter;
  cwd: string;
  /** Workspace-relative path of the markdown document. */
  path: string;
  /** The text to export, which is the live buffer rather than what is on disk. */
  markdown: string;
}): Promise<HtmlExportResult> {
  const target = htmlExportPath(input.path);
  const { html, title } = markdownToHtmlDocument(input.markdown, baseName(input.path));

  const write = (expectedModifiedAt: string, expectedHash?: string) =>
    input.writer.writeFile({
      cwd: input.cwd,
      path: target,
      content: html,
      expectedModifiedAt,
      expectedHash,
      allowCreate: true,
      // Generated rather than edited, so it has no on-disk EOL to preserve and
      // no reason to inherit the source document's.
      eol: "lf",
    });

  // First attempt assumes the file is not there, which is the common case and
  // what `allowCreate` covers. A conflict means a previous export exists; its
  // response carries the identity needed to overwrite it, so re-exporting costs
  // one extra round trip rather than a read before every write.
  const first = await write("");
  if (first.status === "ok") {
    return { status: "written", path: target, title };
  }
  if (first.status === "error") {
    return { status: "error", message: first.message };
  }

  const second = await write(first.modifiedAt, first.hash);
  if (second.status === "ok") {
    return { status: "written", path: target, title };
  }
  return {
    status: "error",
    message:
      second.status === "error"
        ? second.message
        : // Two conflicts means something else is writing the same file while we
          // are; overwriting again would be a loop, not a fix.
          "The exported file changed while it was being written.",
  };
}
