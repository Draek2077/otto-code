import { randomUUID } from "node:crypto";

export interface QuitConfirmTargetWindow {
  webContents: {
    send(channel: string, payload: unknown): void;
  };
}

const QUIT_CONFIRM_REQUEST_EVENT = "otto:event:quit-confirm-request";

const pendingConfirmations = new Map<string, (confirmed: boolean) => void>();

// Set when the last window's own `close` handler already ran the confirmation
// (while the window still existed to render it) before destroying it, which
// then cascades to window-all-closed → app.quit() → before-quit. Lets
// confirmQuitIfNeeded skip re-asking for a decision that's already been made.
let quitPreConfirmed = false;

export function markQuitPreConfirmed(): void {
  quitPreConfirmed = true;
}

export function consumeQuitPreConfirmation(): boolean {
  if (!quitPreConfirmed) {
    return false;
  }
  quitPreConfirmed = false;
  return true;
}

// Called from the `respond_quit_confirm` command handler once the renderer has
// resolved (or auto-accepted) the quit confirmation shown via requestQuitConfirmation.
export function respondToQuitConfirm(args: Record<string, unknown>): void {
  const requestId = typeof args.requestId === "string" ? args.requestId : "";
  if (!requestId) {
    return;
  }
  const resolve = pendingConfirmations.get(requestId);
  if (!resolve) {
    // Either already resolved (e.g. by the timeout) or a stale/duplicate
    // renderer response — surfaced so it's visible in logs if it recurs.
    console.warn("[quit-confirm] respond_quit_confirm for unknown/already-settled requestId", {
      requestId,
    });
    return;
  }
  pendingConfirmations.delete(requestId);
  resolve(args.confirmed === true);
}

/**
 * Asks the renderer to show (or silently accept, per the user's settings) a
 * quit confirmation and awaits its response. Falls back to `true` after
 * `timeoutMs` so a stuck round trip (e.g. the renderer never mounted the
 * listener) can never block the user from quitting Otto.
 */
export function requestQuitConfirmation({
  window,
  willStopDaemon,
  timeoutMs = 20000,
}: {
  window: QuitConfirmTargetWindow | null;
  willStopDaemon: boolean;
  timeoutMs?: number;
}): Promise<boolean> {
  if (!window) {
    return Promise.resolve(true);
  }

  const requestId = randomUUID();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingConfirmations.delete(requestId);
      // The `settled` guard above makes this genuinely single-fire even though
      // the linter can't prove it statically (finish is reachable both from the
      // timeout and from the external respondToQuitConfirm caller).
      // oxlint-disable-next-line eslint-plugin-promise/no-multiple-resolved
      resolve(confirmed);
    };

    const timer = setTimeout(() => {
      console.warn("[quit-confirm] renderer never responded, auto-confirming quit", {
        requestId,
        timeoutMs,
      });
      finish(true);
    }, timeoutMs);
    pendingConfirmations.set(requestId, finish);

    window.webContents.send(QUIT_CONFIRM_REQUEST_EVENT, { requestId, willStopDaemon });
  });
}
