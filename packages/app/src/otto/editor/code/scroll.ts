import { ViewPlugin, type EditorView } from "@codemirror/view";
import type { CodePort } from "./port";
/** Scroll geometry only; no source serialization, React render or model request. */
export function synchronizeEditorScroll(port: CodePort) {
  return ViewPlugin.fromClass(
    class {
      private frame = 0;
      private readonly release: (() => void) | undefined;
      constructor(private readonly view: EditorView) {
        view.scrollDOM.addEventListener("scroll", this.scrolled, { passive: true });
        this.release = port.scroll?.subscribe((fraction) => {
          if (!port.active()) return;
          const node = view.scrollDOM,
            maximum = node.scrollHeight - node.clientHeight;
          if (maximum > 0 && node.clientHeight > 0) node.scrollTop = maximum * fraction;
        });
      }
      private scrolled = () => {
        if (this.frame || !port.active() || !port.scroll?.enabled()) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          const node = this.view.scrollDOM,
            maximum = node.scrollHeight - node.clientHeight;
          if (maximum > 0 && node.clientHeight > 0) port.scroll?.report(node.scrollTop / maximum);
        });
      };
      destroy() {
        cancelAnimationFrame(this.frame);
        this.view.scrollDOM.removeEventListener("scroll", this.scrolled);
        this.release?.();
      }
    },
  );
}
