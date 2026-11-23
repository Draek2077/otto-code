import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { CodePort } from "./port";

/** An editor-local overlay never participates in the text/scroller layout.
 * Hidden retained panes keep their last valid geometry instead of publishing 0. */
export function columnRuler(port: CodePort, color: string) {
  return ViewPlugin.fromClass(
    class {
      private readonly host = document.createElement("div");
      private readonly line = document.createElement("div");
      private readonly release: () => void;
      private alive = true;
      constructor(private readonly view: EditorView) {
        this.host.className = "otto-editor-ruler";
        this.host.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
        this.line.style.cssText = "position:absolute;width:0;opacity:.5;pointer-events:none";
        this.line.style.borderLeft = `1px solid ${color}`;
        this.host.append(this.line);
        view.dom.append(this.host);
        this.release = port.subscribe(() => this.measure());
        this.measure();
      }
      update(update: ViewUpdate) {
        if (update.geometryChanged || update.viewportChanged) this.measure();
      }
      private measure() {
        const preferences = port.rendering();
        this.host.style.display = preferences.rulerEnabled ? "block" : "none";
        if (!preferences.rulerEnabled || !port.active()) return;
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const outer = view.dom.getBoundingClientRect();
            const content = view.contentDOM.getBoundingClientRect();
            const scroll = view.scrollDOM.getBoundingClientRect();
            if (outer.width <= 0 || outer.height <= 0 || scroll.height <= 0) return null;
            const firstLine = view.contentDOM.querySelector<HTMLElement>(".cm-line");
            const padding = firstLine
              ? Number.parseFloat(getComputedStyle(firstLine).paddingLeft) || 0
              : 0;
            return {
              left:
                content.left -
                outer.left +
                padding +
                preferences.rulerColumn * view.defaultCharacterWidth,
              top: scroll.top - outer.top,
              height: view.scrollDOM.clientHeight,
            };
          },
          write: (bounds) => {
            if (!bounds || !this.alive) return;
            this.line.style.left = `${bounds.left}px`;
            this.line.style.top = `${bounds.top}px`;
            this.line.style.height = `${bounds.height}px`;
          },
        });
      }
      destroy() {
        this.alive = false;
        this.release();
        this.host.remove();
      }
    },
  );
}
