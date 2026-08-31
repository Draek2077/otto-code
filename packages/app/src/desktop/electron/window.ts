import {
  getDesktopHost,
  type DesktopWindowBridge,
  type DesktopWindowChromeUpdate,
} from "@/desktop/host";

export function getDesktopWindow(): DesktopWindowBridge | null {
  const getter = getDesktopHost()?.window?.getCurrentWindow;
  if (typeof getter !== "function") {
    return null;
  }
  try {
    return getter() ?? null;
  } catch {
    return null;
  }
}

export async function minimizeDesktopWindow(): Promise<void> {
  await getDesktopWindow()?.minimize?.();
}

export async function closeDesktopWindow(): Promise<void> {
  await getDesktopWindow()?.close?.();
}

export async function toggleDesktopMaximize(): Promise<void> {
  const win = getDesktopWindow();
  if (!win || typeof win.toggleMaximize !== "function") {
    return;
  }
  await win.toggleMaximize();
}

export async function isDesktopMaximized(): Promise<boolean> {
  return (await getDesktopWindow()?.isMaximized?.()) ?? false;
}

export async function isDesktopFullscreen(): Promise<boolean> {
  const win = getDesktopWindow();
  if (!win || typeof win.isFullscreen !== "function") {
    return false;
  }
  return await win.isFullscreen();
}

export async function updateDesktopWindowChrome(update: DesktopWindowChromeUpdate): Promise<void> {
  const win = getDesktopWindow();
  if (!win || typeof win.updateChrome !== "function") {
    return;
  }

  await win.updateChrome(update);
}

// Tell main the first durable screen is ready so it can reveal the window.
// Best-effort: off-desktop, or on a desktop shell without the handler, this is a
// no-op - the reveal falls back to main's timeout, never a broken startup.
export async function signalDesktopWindowReady(): Promise<void> {
  const signal = getDesktopHost()?.window?.signalReady;
  if (typeof signal !== "function") {
    return;
  }
  try {
    await signal();
  } catch {
    // A failed reveal signal must never break startup.
  }
}
