import type { MutableRefObject } from "react";
import type {
  InteractiveViewCommand,
  InteractiveViewCommandResult,
  InteractiveViewGuestEvent,
} from "@/architectural-views/view-bridge";

export interface InteractiveViewFrameHandle {
  run: (command: InteractiveViewCommand) => Promise<InteractiveViewCommandResult>;
}

export interface InteractiveViewFrameProps {
  /** A document already prepared by `prepareInteractiveViewDocument`. */
  html: string;
  /** Painted behind the guest while it loads, so a dark theme never flashes white. */
  background: string;
  handleRef: MutableRefObject<InteractiveViewFrameHandle | null>;
  onEvent: (event: InteractiveViewGuestEvent) => void;
  /** Opt-in automation for the authoring preview (desktop only). */
  browserAutomation?: { browserId: string; workspaceId: string };
}

// Motion export records a few seconds of video; everything else is immediate.
export function interactiveViewCommandTimeoutMs(command: InteractiveViewCommand): number {
  if (command.type === "export") return command.format === "webm" ? 30_000 : 15_000;
  return 5_000;
}

export const INTERACTIVE_VIEW_NOT_READY: InteractiveViewCommandResult = {
  ok: false,
  error: "The View is still loading.",
};

/** Correlates posted commands with their asynchronous results. */
export class InteractiveViewRequests {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: InteractiveViewCommandResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  begin(timeoutMs: number): { id: number; promise: Promise<InteractiveViewCommandResult> } {
    const id = this.nextId++;
    const promise = new Promise<InteractiveViewCommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "The View did not respond." });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
    return { id, promise };
  }

  settle(id: number, result: InteractiveViewCommandResult): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(result);
  }

  cancelAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(INTERACTIVE_VIEW_NOT_READY);
      this.pending.delete(id);
    }
  }
}
