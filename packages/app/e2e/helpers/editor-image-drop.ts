import type { Locator } from "@playwright/test";

/**
 * Synthetic paste and drop payloads for the CM6 editor.
 *
 * Playwright cannot drive a real OS drag, and it cannot put an image on the
 * system clipboard, so the gesture is reconstructed inside the page: a real
 * `DataTransfer` carrying real `File` objects, dispatched on `.cm-content` —
 * the element `EditorView.domEventHandlers` attaches its handlers to, which is
 * why the event is dispatched there rather than on the pane or the page.
 *
 * Only the gesture is synthetic. Everything downstream of the DOM event is
 * production code: the handler's own `FileReader`, the base64 that crosses the
 * bridge, the daemon write, and the insert.
 */

/**
 * Two distinct 1x1 PNGs. Distinct on purpose: the collision case has to prove
 * *which* bytes ended up in each file, and two copies of the same image would
 * make a clobber indistinguishable from correct behaviour.
 */
export const RED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export const CLEAR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjhRd9YAAAAASUVORK5CYII=";

export interface SyntheticFile {
  /**
   * Empty for a clipboard image, which is the real shape of a pasted
   * screenshot: a MIME type and no name at all.
   */
  name: string;
  type: string;
  base64: string;
}

export interface DropPoint {
  x: number;
  y: number;
}

interface TransferPayload {
  kind: "drop" | "paste";
  x: number;
  y: number;
  files: SyntheticFile[];
  text: string | null;
}

async function dispatchTransfer(content: Locator, payload: TransferPayload): Promise<void> {
  await content.evaluate((element, transferPayload: TransferPayload) => {
    const transfer = new DataTransfer();
    for (const file of transferPayload.files) {
      const binary = atob(file.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
    }
    if (transferPayload.text !== null) {
      transfer.setData("text/plain", transferPayload.text);
    }
    const event =
      transferPayload.kind === "drop"
        ? new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: transferPayload.x,
            clientY: transferPayload.y,
            dataTransfer: transfer,
          })
        : new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          });
    element.dispatchEvent(event);
  }, payload);
}

/** Drop files (and optionally text) onto the editor at a viewport coordinate. */
export async function dispatchEditorDrop(
  content: Locator,
  input: { point: DropPoint; files?: SyntheticFile[]; text?: string },
): Promise<void> {
  await dispatchTransfer(content, {
    kind: "drop",
    x: input.point.x,
    y: input.point.y,
    files: input.files ?? [],
    text: input.text ?? null,
  });
}

/**
 * Paste files onto the editor. No coordinate: a paste has no pointer, which is
 * exactly why it lands at the caret and a drop does not.
 */
export async function dispatchEditorPaste(
  content: Locator,
  input: { files?: SyntheticFile[]; text?: string },
): Promise<void> {
  await dispatchTransfer(content, {
    kind: "paste",
    x: 0,
    y: 0,
    files: input.files ?? [],
    text: input.text ?? null,
  });
}

/**
 * A point over the start of a rendered editor line's own text.
 *
 * Deliberately just inside the glyphs rather than out in the line's trailing
 * whitespace: the drop handler resolves the position with a *precise*
 * `posAtCoords`, which answers for a point over a character and may decline one
 * past the end of the rendered text.
 */
export async function dropPointOnLine(line: Locator): Promise<DropPoint> {
  const box = await line.boundingBox();
  if (!box) {
    throw new Error("The target editor line has no layout box to drop onto.");
  }
  return { x: box.x + 8, y: box.y + box.height / 2 };
}
