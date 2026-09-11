const activeBrowsers = new Map<string, number>();
let restoreTarget: HTMLElement | null = null;

function isAutomatedGuest(element: EventTarget | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    activeBrowsers.has(element.getAttribute("data-otto-browser-id") ?? "")
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
  if (isAutomatedGuest(event.target)) {
    // Electron forwards native guest focus as a DOM event. Do not let the pane
    // promote this automation click into an explicit pane/webContents focus.
    event.stopImmediatePropagation();
    restoreFocus();
  } else if (event.target instanceof HTMLElement) {
    // Follow the user's current control, including menus opened mid-command.
    restoreTarget = event.target;
  }
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
  if (activeBrowsers.size === 0) {
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.addEventListener("focus", handleFocus, true);
    window.addEventListener("focusin", handleFocus, true);
    window.addEventListener("blur", handleBlur, true);
  }
  activeBrowsers.set(browserId, (activeBrowsers.get(browserId) ?? 0) + 1);
  try {
    return await task();
  } finally {
    restoreFocus();
    const remaining = (activeBrowsers.get(browserId) ?? 1) - 1;
    if (remaining > 0) activeBrowsers.set(browserId, remaining);
    else activeBrowsers.delete(browserId);
    if (activeBrowsers.size === 0) {
      window.removeEventListener("focus", handleFocus, true);
      window.removeEventListener("focusin", handleFocus, true);
      window.removeEventListener("blur", handleBlur, true);
      restoreTarget = null;
    }
  }
}
