import { app, BrowserWindow, dialog } from "electron";
import log from "electron-log/main";

import { writeSoftwareRenderingMarker } from "./gpu-fallback.js";

// When a window's renderer dies, Electron leaves a blank frame with nothing to
// tell the user what happened — the "it just froze / went blank" report. This
// surfaces a native dialog (which does not depend on Chromium or the GPU, so it
// works even when the graphics stack is the thing that died) offering to reload,
// restart with GPU acceleration off, or quit.

// Electron `render-process-gone` Details.reason values that mean the renderer
// actually failed, as opposed to a normal navigation teardown ("clean-exit") or
// a deliberate kill ("killed", e.g. the OS reclaiming memory we asked to free).
const RENDERER_CRASH_REASONS: ReadonlySet<string> = new Set([
  "crashed",
  "oom",
  "abnormal-exit",
  "launch-failed",
  "integrity-failure",
]);

export function isRendererCrash(details: { reason: string }): boolean {
  return RENDERER_CRASH_REASONS.has(details.reason);
}

export function buildCrashDialogDetail(input: {
  reason: string;
  exitCode: number;
  logFilePath: string | null;
}): string {
  const lines = [
    `The Otto window stopped unexpectedly (${input.reason}, exit code ${input.exitCode}).`,
    "",
    "Reload restarts the view. If the window keeps failing to appear, Restart in Safe Mode turns off GPU acceleration — the usual fix on virtual machines and systems without 3D drivers.",
  ];
  if (input.logFilePath) {
    lines.push("", `Full details were written to:\n${input.logFilePath}`);
  }
  return lines.join("\n");
}

export interface CrashDialogOptions {
  // Resolves the on-disk log path shown in the dialog, or null if unavailable.
  getLogFilePath?: () => string | null;
  // Returns true when a controlled recovery (e.g. the GPU software-rendering
  // relaunch) is already in flight, so the dialog stays quiet.
  isSuppressed?: () => boolean;
}

export function registerCrashDialog(options: CrashDialogOptions = {}): void {
  app.on("render-process-gone", (_event, webContents, details) => {
    if (!isRendererCrash(details)) {
      return;
    }
    if (options.isSuppressed?.()) {
      log.info("[crash-dialog] suppressed — recovery already in progress", details);
      return;
    }
    log.error("[crash-dialog] renderer process gone", details);
    void presentCrashDialog(webContents, details, options).catch((error) => {
      log.error("[crash-dialog] failed to present dialog", error);
    });
  });
}

async function presentCrashDialog(
  webContents: Electron.WebContents,
  details: { reason: string; exitCode: number },
  options: CrashDialogOptions,
): Promise<void> {
  const logFilePath = options.getLogFilePath?.() ?? null;
  const parentWindow =
    BrowserWindow.fromWebContents(webContents) ?? BrowserWindow.getFocusedWindow();

  const messageBoxOptions: Electron.MessageBoxOptions = {
    type: "error",
    title: "Otto stopped responding",
    message: "Otto stopped responding",
    detail: buildCrashDialogDetail({
      reason: details.reason,
      exitCode: details.exitCode,
      logFilePath,
    }),
    buttons: ["Reload", "Restart in Safe Mode", "Quit"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };

  const { response } =
    parentWindow && !parentWindow.isDestroyed()
      ? await dialog.showMessageBox(parentWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);

  if (response === 0) {
    reloadCrashedView(webContents);
    return;
  }
  if (response === 1) {
    restartInSafeMode();
    return;
  }
  app.quit();
}

function reloadCrashedView(webContents: Electron.WebContents): void {
  if (webContents.isDestroyed()) {
    // The crashed WebContents is gone; reload whatever window still exists.
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    win?.reload();
    return;
  }
  webContents.reload();
}

function restartInSafeMode(): void {
  try {
    writeSoftwareRenderingMarker(app.getPath("userData"), "user-safe-mode");
  } catch (error) {
    log.error("[crash-dialog] failed to persist safe-mode marker", error);
  }
  app.relaunch();
  app.exit(0);
}

// A native error box for a fatal startup failure, where no window exists to
// render an in-app error. showErrorBox does not depend on Chromium/GPU, so it
// still appears when the renderer or graphics stack is what failed.
export function showStartupErrorDialog(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    dialog.showErrorBox("Otto failed to start", message);
  } catch (dialogError) {
    log.error("[crash-dialog] failed to present startup error box", dialogError);
  }
}
