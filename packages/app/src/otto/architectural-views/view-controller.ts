import {
  parseInteractiveViewGuestEvent,
  type InteractiveViewCommand,
  type InteractiveViewCommandResult,
  type InteractiveViewState,
  type InteractiveViewExportFormat,
} from "./view-bridge";
import type { ViewFrameMessage } from "./frame-types";

interface Snapshot {
  ready: boolean;
  state: InteractiveViewState | null;
  notice: string | null;
}
interface Pending {
  resolve(value: InteractiveViewCommandResult): void;
  timer: ReturnType<typeof setTimeout>;
  exportFormat?: InteractiveViewExportFormat;
}
const exportMimeTypes: Record<InteractiveViewExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  webm: "video/webm",
};
/** One mounted frame lifetime. Untrusted messages cannot resolve another frame's commands. */
export class ViewController {
  private snapshot: Snapshot = { ready: false, state: null, notice: null };
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<number, Pending>();
  private sender: ((message: ViewFrameMessage) => void) | null = null;
  private sequence = 0;
  private closed = false;
  constructor(readonly channel: string) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  notice(message: string | null) {
    this.publish({ notice: message });
  }
  transport = (sender: ((message: ViewFrameMessage) => void) | null) => {
    this.sender = sender;
    if (!sender) {
      this.cancel();
      this.publish({ ready: false });
    }
  };
  receive = (raw: unknown) => {
    if (this.closed) return;
    const event = parseInteractiveViewGuestEvent(raw, this.channel);
    if (!event) return;
    if (event.type === "notice") {
      this.notice(event.message);
      return;
    }
    if (event.type === "result") {
      const pending = this.pending.get(event.id);
      if (!pending) return;
      if (
        event.result.ok &&
        ((event.result.file && !pending.exportFormat) ||
          (pending.exportFormat &&
            event.result.file?.mimeType !== exportMimeTypes[pending.exportFormat]))
      ) {
        const error = "The View did not return the explicitly requested export.";
        this.notice(error);
        this.finish(event.id, { ok: false, error });
        return;
      }
      if (event.result.ok) this.publish({ state: event.result.state });
      else this.notice(event.result.error);
      this.finish(event.id, event.result);
      return;
    }
    this.publish({ ready: true, state: event.state });
  };
  run(command: InteractiveViewCommand): Promise<InteractiveViewCommandResult> {
    const sender = this.sender;
    if (this.closed || !sender || !this.snapshot.ready)
      return Promise.resolve({ ok: false, error: "The View is not active yet." });
    if (this.pending.size >= 8)
      return Promise.resolve({ ok: false, error: "Wait for the current View controls to finish." });
    const id = ++this.sequence;
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => {
          this.notice("The View did not acknowledge that control.");
          this.finish(id, { ok: false, error: "The View did not acknowledge that control." });
        },
        command.type === "export" ? 45000 : 5000,
      );
      this.pending.set(id, {
        resolve,
        timer,
        exportFormat: command.type === "export" ? command.format : undefined,
      });
      try {
        sender({ id, command });
      } catch {
        this.finish(id, { ok: false, error: "The View transport is unavailable." });
      }
    });
  }
  private finish(id: number, result: InteractiveViewCommandResult) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(result);
  }
  activate() {
    this.closed = false;
  }
  private cancel() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: "This View frame was closed." });
    }
    this.pending.clear();
  }
  close() {
    this.closed = true;
    this.sender = null;
    this.cancel();
    this.listeners.clear();
  }
}
