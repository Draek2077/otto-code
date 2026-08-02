import type { FsFileWriteBinaryResult } from "@otto-code/protocol/messages";
import { base64ToBytes } from "@/utils/base64";
import { exportSiblingPath, markdownToHtmlDocument } from "./markdown-to-html";

/**
 * Write a markdown document out as a PDF file beside it.
 *
 * The PDF is the HTML export, printed. `markdownToHtmlDocument` produces the
 * document; the desktop shell renders it with `webContents.printToPDF` and
 * hands back the bytes. There is deliberately no second converter: whatever
 * "Export as HTML" produces is what the PDF shows, including task lists, GitHub
 * alerts, footnotes and MathML formulas, and a change to the export stylesheet
 * lands in both at once.
 *
 * Printing is Electron-only, so this whole path is desktop-only — the caller
 * omits the action elsewhere rather than offering one that cannot work.
 *
 * The write goes through the daemon like every other write in this app: the
 * client never touches a workspace file itself, on any platform. That the
 * bytes were produced by the desktop main process changes nothing — main is on
 * the same machine as the *app*, which is not necessarily the machine the
 * workspace is on.
 */

/** The desktop print bridge, as a port. See `DesktopPdfBridge`. */
export interface PdfPrinter {
  /** Standalone HTML in, base64-encoded PDF bytes out. */
  printHtml(input: { html: string }): Promise<string>;
}

/**
 * The one daemon call this needs, as a port — narrower than `DaemonClient` so a
 * test can supply an in-memory adapter. Gated on `features.binaryFileWrite`:
 * the text write refuses binary targets outright, so re-exporting over an
 * existing PDF is not something the older RPC could ever have done.
 */
export interface PdfExportWriter {
  writeBinaryFile(options: {
    cwd: string;
    path: string;
    bytes: Uint8Array;
    overwrite?: boolean;
  }): Promise<FsFileWriteBinaryResult>;
}

export type PdfExportResult =
  | { status: "written"; path: string; title: string }
  | { status: "error"; message: string };

/** `notes/design.md` exports to `notes/design.pdf`. */
export function pdfExportPath(markdownPath: string): string {
  return exportSiblingPath(markdownPath, "pdf");
}

function baseName(path: string): string {
  return path.split(/[/\\]/).findLast(Boolean) ?? path;
}

export async function exportMarkdownAsPdf(input: {
  printer: PdfPrinter;
  writer: PdfExportWriter;
  cwd: string;
  /** Workspace-relative path of the markdown document. */
  path: string;
  /** The text to export, which is the live buffer rather than what is on disk. */
  markdown: string;
}): Promise<PdfExportResult> {
  const target = pdfExportPath(input.path);
  const { html, title } = markdownToHtmlDocument(input.markdown, baseName(input.path));

  let contentBase64: string;
  try {
    contentBase64 = await input.printer.printHtml({ html });
  } catch (error) {
    // A failed print is the likely failure here — a window that would not load,
    // a renderer that died — and it has to read as a failed export rather than
    // an unhandled rejection with a toast that never comes.
    return { status: "error", message: errorMessage(error) };
  }

  // Overwrite unconditionally: a re-export replaces the PDF this document
  // produced last time, which is the same thing re-exporting the HTML does.
  // There is no precondition to carry, because nothing here was read from the
  // file being written.
  const result = await input.writer.writeBinaryFile({
    cwd: input.cwd,
    path: target,
    // The bridge encodes because IPC cannot carry bytes; this is the last point
    // that string exists, and the write itself goes out as binary frames.
    bytes: base64ToBytes(contentBase64),
    overwrite: true,
  });

  if (result.status === "written") {
    return { status: "written", path: target, title };
  }
  return {
    status: "error",
    message:
      result.status === "error"
        ? result.error
        : // Unreachable while this asks for `overwrite`, but the result type
          // carries the case and silently reporting success would be a lie.
          "A file already exists at that path.",
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
