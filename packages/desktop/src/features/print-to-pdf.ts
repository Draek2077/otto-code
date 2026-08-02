import { BrowserWindow, ipcMain } from "electron";

/**
 * Render a standalone HTML document to PDF bytes.
 *
 * Desktop only, because `webContents.printToPDF` is the whole implementation:
 * there is no browser or native equivalent worth shipping a second renderer
 * for. The caller passes HTML it already produced — the app's markdown export
 * produces exactly the document the user would get from "Export as HTML" — so
 * the PDF and the HTML cannot drift: one converter, one stylesheet, two
 * containers.
 *
 * The bytes come back to the renderer as base64 and go to the daemon from
 * there. Main does **not** write the file: the workspace may live on another
 * host entirely, and a desktop-writes-it-locally shortcut would silently mean
 * something different for a remote daemon than for a local one.
 */

/** What a caller may ask for. Deliberately not the full printToPDF surface. */
export interface PrintHtmlToPdfInput {
  html: string;
}

/**
 * Margins in inches. The export stylesheet's `@media print` rule drops the
 * body's own max-width and padding, so the page margin is the only thing
 * holding the text off the paper edge and it has to be a readable one.
 */
const PAGE_MARGIN_INCHES = 0.75;

/**
 * Load the document in a hidden window and print it.
 *
 * `javascript: false` because the export is static by construction: the
 * markdown converter translates embedded HTML rather than passing it through,
 * and KaTeX math ships as MathML, which lays out natively. Nothing in the
 * document needs a script, so nothing in the document gets one.
 *
 * Relative images do not resolve — the document loads from a `data:` URL with
 * no directory to be relative to, and for a remote workspace main could not
 * read them anyway. They fall back to alt text, which is the same limitation
 * the HTML export documents for a file opened away from its own folder.
 */
export async function printHtmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // No shared session: this window has no business reaching the app's
      // cookies, storage or service workers.
      partition: "otto-print-to-pdf",
    },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.webContents.printToPDF({
      printBackground: true,
      margins: {
        top: PAGE_MARGIN_INCHES,
        bottom: PAGE_MARGIN_INCHES,
        left: PAGE_MARGIN_INCHES,
        right: PAGE_MARGIN_INCHES,
      },
    });
  } finally {
    // Destroy rather than close: a hidden window with no listeners will not
    // answer a close, and leaking one per export is a leak per export.
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

export function registerPrintToPdfHandlers(): void {
  ipcMain.handle("otto:pdf:printHtml", async (_event, input: PrintHtmlToPdfInput) => {
    // base64 over the bridge: an IPC-serialized Buffer arrives as a Uint8Array
    // whose shape has changed across Electron versions, and the renderer is
    // handing this straight to a base64 protocol field regardless.
    const pdf = await printHtmlToPdf(input.html);
    return pdf.toString("base64");
  });
}
