import { Prec } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { getCM, Vim, type CodeMirror } from "@replit/codemirror-vim";
import type { CodePort } from "./port";
import { VIM_ACTIONS } from "../preferences";

/** Per-view capture only. Vim.map is process-global and would let one editor's
 * mappings change another tab. Unclaimed sequences replay through Vim itself. */
export function vimLeader(port: CodePort) {
  class Leader {
    private pending: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly release: () => void;
    private settings = port.rendering().vimMappings;
    constructor(private readonly view: EditorView) {
      this.release = port.subscribe(() => {
        const current = port.rendering().vimMappings;
        if (JSON.stringify(current) !== JSON.stringify(this.settings) || !port.active()) {
          this.settings = current;
          this.reset();
        }
      });
    }
    reset() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.pending = null;
      port.leaderPending(null);
    }
    private replay(cm: CodeMirror, sequence: string) {
      Vim.handleKey(cm, " ", "otto-vim-leader");
      for (const key of sequence) Vim.handleKey(cm, key, "otto-vim-leader");
    }
    private arm(cm: CodeMirror) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const sequence = this.pending;
        this.reset();
        if (sequence !== null && port.active() && this.view.hasFocus) this.replay(cm, sequence);
      }, 650);
    }
    key(event: KeyboardEvent): boolean {
      const cm = getCM(this.view);
      const normal = cm?.state.vim && !cm.state.vim.insertMode && !cm.state.vim.visualMode;
      if (!cm || !normal || !port.active() || !this.view.hasFocus || event.isComposing) {
        this.reset();
        return false;
      }
      if (this.pending !== null && event.key === "Escape") {
        this.reset();
        event.preventDefault();
        return true;
      }
      const modified = event.ctrlKey || event.metaKey || event.altKey;
      const plain = !modified && (event.key === " " || /^[A-Za-z0-9]$/u.test(event.key));
      if (!plain) {
        if (this.pending !== null) {
          const sequence = this.pending;
          this.reset();
          this.replay(cm, sequence);
        }
        return false;
      }
      if (event.repeat && this.pending !== null) return true;
      return this.capture(event, cm);
    }
    private capture(event: KeyboardEvent, cm: CodeMirror): boolean {
      const mappings = this.settings.mappings;
      if (this.pending === null) {
        if (event.key !== " " || !Object.values(mappings).some(Boolean)) return false;
        this.pending = "";
        port.leaderPending("");
        this.arm(cm);
        event.preventDefault();
        return true;
      }
      const sequence = this.pending + event.key;
      const action = VIM_ACTIONS.find((candidate) => mappings[candidate] === sequence);
      if (action) {
        this.reset();
        port.vimAction(action);
        event.preventDefault();
        return true;
      }
      const isPrefix = Object.values(mappings).some((mapping) => mapping?.startsWith(sequence));
      if (isPrefix) {
        this.pending = sequence;
        port.leaderPending(sequence);
        this.arm(cm);
        event.preventDefault();
        return true;
      }
      const prefix = this.pending;
      this.reset();
      this.replay(cm, prefix);
      return false;
    }
    destroy() {
      this.reset();
      this.release();
    }
  }
  return Prec.highest(
    ViewPlugin.fromClass(Leader, {
      eventHandlers: {
        keydown(event) {
          return this.key(event);
        },
        blur() {
          this.reset();
        },
      },
    }),
  );
}
