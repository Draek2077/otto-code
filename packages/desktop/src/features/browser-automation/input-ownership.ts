import type { MouseInputEvent } from "electron";

const automatedInputs = new Map<number, number>();
const observedGuests = new WeakSet<object>();

export interface BrowserInputOwnershipGuest {
  readonly id: number;
  readonly hostWebContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  } | null;
  on(event: "before-mouse-event", listener: (event: unknown, input: MouseInputEvent) => void): void;
}

/** Native guest pointer events do not bubble into the host document. */
export function observeBrowserUserActivation(guest: BrowserInputOwnershipGuest): void {
  if (observedGuests.has(guest)) return;
  observedGuests.add(guest);
  const webContentsId = guest.id;
  guest.on("before-mouse-event", (_event, input) => {
    if (input.type !== "mouseDown" || automatedInputs.has(webContentsId)) return;
    const host = guest.hostWebContents;
    if (host && !host.isDestroyed()) {
      host.send("otto:event:browser-user-activation", { webContentsId });
    }
  });
}

/** CDP acknowledges input after before-mouse-event; keep its source until then. */
export async function withBrowserAutomationInput<T>(
  webContentsId: number,
  task: () => Promise<T>,
): Promise<T> {
  automatedInputs.set(webContentsId, (automatedInputs.get(webContentsId) ?? 0) + 1);
  try {
    return await task();
  } finally {
    const remaining = (automatedInputs.get(webContentsId) ?? 1) - 1;
    if (remaining > 0) automatedInputs.set(webContentsId, remaining);
    else automatedInputs.delete(webContentsId);
  }
}
