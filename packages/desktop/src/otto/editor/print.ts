import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const Input = z.object({ html: z.string().max(4 * 1024 * 1024) });
let printing = false;
/** Static printing is device-local; the resulting bytes return to the owning
 * daemon. Main never writes a remote workspace into a local directory. */
export function registerEditorPrint() {
  ipcMain.handle("otto:editor:print", (_event, value: unknown) =>
    printEditorPdf(Input.parse(value).html),
  );
}
export async function printEditorPdf(html: string): Promise<string> {
  Input.parse({ html });
  if (printing) throw new Error("Another document is being printed. Wait before exporting again.");
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `otto-editor-print-${randomUUID()}`,
    },
  });
  printing = true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "file://*/*"] },
      (_details, done) => done({ cancel: true }),
    );
    return await Promise.race([
      (async () => {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const bytes = await window.webContents.printToPDF({
          printBackground: true,
          margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
        });
        if (bytes.length > 9 * 1024 * 1024)
          throw new Error("The PDF exceeds the 9 MB export limit.");
        return bytes.toString("base64");
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF printing timed out.")), 30000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!window.isDestroyed()) window.destroy();
    printing = false;
  }
}
