const activeBrowsers = new Map<string, number>();
let restoreTarget: HTMLElement | null = null;
let mountedGuards = 0;

function isBrowserGuest(element: EventTarget | null): element is HTMLElement {
  return element instanceof HTMLElement && element.hasAttribute("data-otto-browser-id");
}

function isAutomatedGuest(element: EventTarget | null): element is HTMLElement {
  return (
    isBrowserGuest(element) &&
    (mountedGuards > 0 || activeBrowsers.has(element.getAttribute("data-otto-browser-id") ?? ""))
  );
}

function restoreFocus(): void {
  if (
    isAutomatedGuest(document.activeElement) &&
    restoreTarget?.isConnected &&
    restoreTarget !== document.activeElement
  ) {
    restoreTarget.focus({ preventScroll: true });
  }
}

function handleFocus(event: FocusEvent): void {
  if (
    isAutomatedGuest(event.target) &&
    restoreTarget?.isConnected &&
    restoreTarget !== event.target
  ) {
    // Electron forwards native guest focus as a DOM event. Do not let the pane
    // promote this automation click into an explicit pane/webContents focus.
    event.stopImmediatePropagation();
    restoreFocus();
  } else if (event.target instanceof HTMLElement) {
    // Follow the user's current control, including menus opened mid-command.
    restoreTarget = event.target;
  }
}

function handleUserPointer(event: PointerEvent): void {
  // CDP input is delivered inside the guest. A pointer event in the embedder
  // is the user's own interaction, including a deliberate click into a guest.
  if (event.isTrusted) restoreTarget = null;
}

function handleUserKey(event: KeyboardEvent): void {
  // Ordinary typing keeps the editor's claim. Keyboard navigation must still
  // let the user enter a browser or activate a menu item that opens one.
  if (event.isTrusted && (event.key === "Tab" || !isBrowserAutomationEditorFocused())) {
    restoreTarget = null;
  }
}

function startObserving(): void {
  restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  window.addEventListener("focus", handleFocus, true);
  window.addEventListener("focusin", handleFocus, true);
  window.addEventListener("blur", handleBlur, true);
  window.addEventListener("pointerdown", handleUserPointer, true);
  window.addEventListener("keydown", handleUserKey, true);
}

function stopObservingIfIdle(): void {
  if (mountedGuards > 0 || activeBrowsers.size > 0) return;
  window.removeEventListener("focus", handleFocus, true);
  window.removeEventListener("focusin", handleFocus, true);
  window.removeEventListener("blur", handleBlur, true);
  window.removeEventListener("pointerdown", handleUserPointer, true);
  window.removeEventListener("keydown", handleUserKey, true);
  restoreTarget = null;
}

/** Keep ownership across command replies, delayed guest events, and new tabs. */
export function mountBrowserAutomationFocusGuard(
  subscribeToUserActivation?: (handler: (payload: unknown) => void) => Promise<() => void>,
): () => void {
  if (typeof document === "undefined") return () => {};
  if (mountedGuards === 0 && activeBrowsers.size === 0) startObserving();
  mountedGuards++;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  void subscribeToUserActivation?.(handleGuestUserActivation).then((release) => {
    if (disposed) release();
    else unsubscribe = release;
    return undefined;
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    mountedGuards--;
    stopObservingIfIdle();
  };
}

function handleGuestUserActivation(payload: unknown): void {
  if (!payload || typeof payload !== "object" || !("webContentsId" in payload)) return;
  const webContentsId = payload.webContentsId;
  if (!Number.isInteger(webContentsId)) return;
  for (const element of document.querySelectorAll<HTMLElement>("webview[data-otto-browser-id]")) {
    const guest = element as HTMLElement & { getWebContentsId?: () => number };
    try {
      if (guest.getWebContentsId?.() !== webContentsId) continue;
    } catch {
      // A detached guest cannot be the user's pointer target anymore.
      continue;
    }
    restoreTarget = null;
    guest.focus();
    return;
  }
}

/** Agent layout requests must not hide an editor the user is working in. */
export function isBrowserAutomationEditorFocused(): boolean {
  if (typeof document === "undefined") return false;
  const element = restoreTarget?.isConnected ? restoreTarget : document.activeElement;
  return (
    element instanceof HTMLElement &&
    (element.matches("input, textarea, [role='textbox']") || element.isContentEditable)
  );
}

function handleBlur(): void {
  // Chromium may move focus into the guest's internal iframe without emitting
  // focusin on the webview. Wait for that transfer, not for the tool to finish.
  queueMicrotask(restoreFocus);
}

export async function withBrowserAutomationFocus<T>(
  browserId: string,
  task: () => Promise<T>,
): Promise<T> {
  if (typeof document === "undefined") return task();
  if (activeBrowsers.size === 0 && mountedGuards === 0) startObserving();
  activeBrowsers.set(browserId, (activeBrowsers.get(browserId) ?? 0) + 1);
  try {
    return await task();
  } finally {
    restoreFocus();
    const remaining = (activeBrowsers.get(browserId) ?? 1) - 1;
    if (remaining > 0) activeBrowsers.set(browserId, remaining);
    else activeBrowsers.delete(browserId);
    stopObservingIfIdle();
  }
}
