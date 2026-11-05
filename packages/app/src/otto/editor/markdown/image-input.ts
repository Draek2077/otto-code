import { markdownLanguage } from "@codemirror/lang-markdown";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { EditorImage } from "@getpaseo/plugin/otto/editor";
import type { CodePort } from "../code/port";

interface Paste {
  activation: number;
  from: number;
  to: number;
  conflicted: boolean;
}
function readImage(file: File): Promise<EditorImage> {
  if (file.size > 2 * 1024 * 1024)
    return Promise.reject(new Error("Paste images up to 2 MB each."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () => reject(new Error(`Could not read ${file.name || "the clipboard image"}.`)),
      { once: true },
    );
    reader.addEventListener(
      "load",
      () => {
        const value = reader.result;
        if (typeof value !== "string" || !value.includes(",")) {
          reject(new Error("The image could not be decoded."));
          return;
        }
        resolve({
          name: file.name,
          mimeType: file.type,
          dataBase64: value.slice(value.indexOf(",") + 1),
        });
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}
/** Async asset creation owns a mapped insertion range, never a second draft.
 * Typing elsewhere is preserved; replacing the selected range pauses insertion. */
export function markdownImageInput(port: CodePort) {
  return ViewPlugin.fromClass(
    class {
      private alive = true;
      private pending: Paste | null = null;
      constructor(private readonly view: EditorView) {}
      update(update: ViewUpdate) {
        const pending = this.pending;
        if (!pending || !update.docChanged) return;
        update.changes.iterChangedRanges((from, to) => {
          if (from < pending.to && to > pending.from) pending.conflicted = true;
        });
        pending.from = update.changes.mapPos(pending.from, 1);
        pending.to = update.changes.mapPos(pending.to, 1);
      }
      claim(files: FileList | null | undefined, event: ClipboardEvent | DragEvent): boolean {
        const images = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
        if (
          !images.length ||
          !port.active() ||
          !markdownLanguage.isActiveAt(this.view.state, this.view.state.selection.main.head)
        )
          return false;
        event.preventDefault();
        if (this.pending) {
          port.reportError("Wait for the current image paste to finish.");
          return true;
        }
        if (images.length > 8) {
          port.reportError("Paste up to 8 images at a time.");
          return true;
        }
        if ("clientX" in event) {
          const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position !== null) this.view.dispatch({ selection: { anchor: position } });
        }
        const { from, to } = this.view.state.selection.main;
        const pending: Paste = { from, to, conflicted: false, activation: port.activation() };
        this.pending = pending;
        void this.write(images, pending);
        return true;
      }
      private async write(files: File[], pending: Paste) {
        const links: string[] = [];
        try {
          for (const file of files) {
            if (!this.alive || !port.active() || port.activation() !== pending.activation) return;
            const link = await port.writeImage(await readImage(file));
            if (link === null) return;
            links.push(link);
          }
        } catch (error) {
          port.reportError(error instanceof Error ? error.message : "The image paste failed.");
        } finally {
          this.pending = null;
          this.insert(links, pending);
        }
      }
      private insert(links: string[], pending: Paste) {
        if (!links.length) return;
        if (
          !this.alive ||
          !port.active() ||
          port.activation() !== pending.activation ||
          pending.conflicted
        ) {
          port.reportError(
            `Images were saved, but their insertion range changed. Insert these links when ready:\n${links.join("\n")}`,
          );
          return;
        }
        const insert = links.join("\n");
        this.view.dispatch({
          changes: { from: pending.from, to: pending.to, insert },
          selection: { anchor: pending.from + insert.length },
          userEvent: "input.paste",
        });
        this.view.focus();
      }
      destroy() {
        this.alive = false;
      }
    },
    {
      eventHandlers: {
        paste(event) {
          return this.claim(event.clipboardData?.files, event);
        },
        drop(event) {
          return this.claim(event.dataTransfer?.files, event);
        },
      },
    },
  );
}
