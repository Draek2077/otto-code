import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";
import log from "electron-log/main";

// A VM guest with no 3D acceleration (VMware "No 3D enabled"), or a broken GPU
// driver, crashes Electron's GPU process. The window then comes up blank or the
// app exits, with nothing actionable in the UI — the classic "it won't start"
// report. Rather than expect every affected user to discover the
// OTTO_ELECTRON_FLAGS escape hatch, recover automatically: on the first GPU
// failure persist a marker and relaunch into software rendering, then honor
// that marker on every subsequent boot so the app just works.

const MARKER_FILENAME = "disable-hardware-acceleration";

// Electron `child-process-gone` Details.reason values that mean the GPU process
// genuinely failed, as opposed to a normal clean recycle ("clean-exit") or a
// deliberate kill ("killed"). Relaunching only helps for real failures.
const GPU_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "crashed",
  "abnormal-exit",
  "launch-failed",
  "oom",
  "integrity-failure",
]);

export function isGpuProcessFailure(details: { type: string; reason: string }): boolean {
  return details.type === "GPU" && GPU_FAILURE_REASONS.has(details.reason);
}

// Set once we commit to relaunching into software rendering, so the crash dialog
// stays quiet during the controlled restart instead of talking over our own
// recovery. A GPU death often takes the renderer with it (render-process-gone),
// which the crash dialog would otherwise surface.
let gpuRecoveryInProgress = false;

export function isGpuRecoveryInProgress(): boolean {
  return gpuRecoveryInProgress;
}

function markerFilePath(userDataDir: string): string {
  return path.join(userDataDir, MARKER_FILENAME);
}

export function isSoftwareRenderingMarked(userDataDir: string): boolean {
  return existsSync(markerFilePath(userDataDir));
}

export function writeSoftwareRenderingMarker(userDataDir: string, reason: string): void {
  const file = markerFilePath(userDataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${reason}\n`, "utf-8");
}

export function clearSoftwareRenderingMarker(userDataDir: string): void {
  rmSync(markerFilePath(userDataDir), { force: true });
}

// A GPU that hangs (blank window that never paints) rather than cleanly
// crashing fires no `child-process-gone` event, so the reactive path above can't
// see it. The startup sentinel closes that gap: it's armed right before the
// first window is created and cleared once that window paints. A sentinel that
// survives to the next launch means the previous launch never reached a visible
// window — a startup crash or hang — which we treat as a hardware-acceleration
// failure and recover from.
const STARTUP_SENTINEL_FILENAME = "startup-in-progress";

function startupSentinelPath(userDataDir: string): string {
  return path.join(userDataDir, STARTUP_SENTINEL_FILENAME);
}

export function isStartupSentinelPresent(userDataDir: string): boolean {
  return existsSync(startupSentinelPath(userDataDir));
}

export function writeStartupSentinel(userDataDir: string): void {
  const file = startupSentinelPath(userDataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${process.pid}\n`, "utf-8");
}

export function clearStartupSentinel(userDataDir: string): void {
  rmSync(startupSentinelPath(userDataDir), { force: true });
}

// The recovery flags for a Linux guest with no 3D acceleration (VMware
// "No 3D enabled"). app.disableHardwareAcceleration() (--disable-gpu) is NOT
// a working fallback there: on a Wayland session presentation falls into the
// X11 software-bitmap path while the window itself is a Wayland surface, so
// no frame is ever committed and the window exists but is invisible
// ("XGetWindowAttributes failed for window 1"). The combination below —
// force the X11/XWayland backend and disable GL so frames go through the
// software presenter — matches what VS Code ships on Linux and is the only
// configuration verified to paint on a no-3D VMware guest.
//
// The flags must be real process argv: by the time this module runs, the
// browser process has already chosen its Ozone platform, so
// app.commandLine.appendSwitch() only reaches child processes — a
// browser/GPU platform mismatch that presents Wayland surfaces through X11
// and shows nothing. Hence app.relaunch() with args rather than appendSwitch().
const LINUX_SOFTWARE_RENDERING_ARGS = ["--ozone-platform=x11", "--use-gl=disabled"];

export function hasLinuxSoftwareRenderingArgs(argv: readonly string[]): boolean {
  return LINUX_SOFTWARE_RENDERING_ARGS.every((arg) => argv.includes(arg));
}

// Relaunch into software rendering. Returns true when a relaunch was issued
// (the caller should stop doing further startup work), false when the current
// process is already running with the recovery flags (nothing left to do —
// relaunching again would loop).
function relaunchWithLinuxSoftwareRendering(): boolean {
  if (hasLinuxSoftwareRenderingArgs(process.argv)) {
    return false;
  }
  gpuRecoveryInProgress = true;
  app.relaunch({ args: [...process.argv.slice(1), ...LINUX_SOFTWARE_RENDERING_ARGS] });
  app.exit(0);
  return true;
}

// A first launch on a no-3D guest doesn't crash — it hangs with no visible
// window, and the sentinel-based recovery only helps on the NEXT launch.
// Don't make the user relaunch: if the first window hasn't painted within
// the timeout, treat it as the hang and relaunch into software rendering now.
const STARTUP_PAINT_TIMEOUT_MS = 15_000;
let startupPaintTimer: NodeJS.Timeout | null = null;

export function armGpuStartupPaintWatchdog(): void {
  if (process.platform !== "linux") {
    return;
  }
  startupPaintTimer = setTimeout(() => {
    if (hasLinuxSoftwareRenderingArgs(process.argv)) {
      // Already on the recovery flags and still not painting — relaunching
      // again would loop; leave the sentinel to tell the story.
      log.error("[gpu-fallback] window never painted despite software rendering flags");
      return;
    }
    log.warn(
      "[gpu-fallback] window did not paint within 15s; relaunching with --ozone-platform=x11 --use-gl=disabled",
    );
    try {
      writeSoftwareRenderingMarker(app.getPath("userData"), "startup-paint-timeout");
    } catch (error) {
      log.error("[gpu-fallback] failed to persist the marker; not relaunching", error);
      return;
    }
    gpuRecoveryInProgress = true;
    app.relaunch({ args: [...process.argv.slice(1), ...LINUX_SOFTWARE_RENDERING_ARGS] });
    app.exit(0);
  }, STARTUP_PAINT_TIMEOUT_MS);
  // Don't let a pending watchdog keep the process alive on normal quit.
  startupPaintTimer.unref?.();
}

// Must run before app.whenReady(): disableHardwareAcceleration() is a no-op once
// the app is ready.
export function applyPersistedHardwareAccelerationFallback(): void {
  let userDataDir: string;
  try {
    userDataDir = app.getPath("userData");
  } catch (error) {
    log.warn("[gpu-fallback] could not resolve userData; skipping fallback check", error);
    return;
  }

  // Escape hatch: a user whose GPU later starts working (moved off the VM, fixed
  // the driver) can force hardware acceleration back on and clear the sticky
  // marker with OTTO_FORCE_GPU=1.
  if (process.env.OTTO_FORCE_GPU === "1") {
    if (isSoftwareRenderingMarked(userDataDir)) {
      clearSoftwareRenderingMarker(userDataDir);
      log.info("[gpu-fallback] OTTO_FORCE_GPU=1 cleared the software-rendering marker");
    }
    clearStartupSentinel(userDataDir);
    return;
  }

  // A sentinel left behind by a previous launch means that launch armed the
  // startup watch but never reached a painted window — it hung or crashed during
  // GPU/compositor init. Treat that as a hardware-acceleration failure and fall
  // back, even though no GPU crash event reached this process.
  if (isStartupSentinelPresent(userDataDir) && !isSoftwareRenderingMarked(userDataDir)) {
    writeSoftwareRenderingMarker(userDataDir, "previous-launch-never-painted");
    log.warn(
      "[gpu-fallback] previous launch never reached a visible window; enabling software rendering",
    );
  }

  if (isSoftwareRenderingMarked(userDataDir)) {
    if (process.platform === "linux") {
      if (relaunchWithLinuxSoftwareRendering()) {
        log.warn(
          "[gpu-fallback] prior GPU failure recorded; relaunching with --ozone-platform=x11 --use-gl=disabled",
        );
        return;
      }
      log.warn(
        "[gpu-fallback] software rendering active (--ozone-platform=x11 --use-gl=disabled) — a prior GPU failure was recorded (set OTTO_FORCE_GPU=1 to re-enable hardware acceleration)",
      );
      return;
    }
    app.disableHardwareAcceleration();
    log.warn(
      "[gpu-fallback] software rendering active — a prior GPU failure was recorded (set OTTO_FORCE_GPU=1 to re-enable hardware acceleration)",
    );
  }
}

// Arm the startup watch just before the first GUI window is created. Only call
// this on the GUI path — never for CLI passthrough or smoke runs, which
// legitimately exit without ever painting a window and would otherwise leave a
// stale sentinel that flips the next launch into software rendering.
export function armGpuStartupSentinel(): void {
  try {
    writeStartupSentinel(app.getPath("userData"));
  } catch (error) {
    log.warn("[gpu-fallback] failed to arm startup sentinel", error);
  }
}

// Clear the startup watch once the first window has painted — the graphics path
// is proven healthy for this launch.
export function markGpuStartupHealthy(): void {
  if (startupPaintTimer) {
    clearTimeout(startupPaintTimer);
    startupPaintTimer = null;
  }
  try {
    clearStartupSentinel(app.getPath("userData"));
  } catch (error) {
    log.warn("[gpu-fallback] failed to clear startup sentinel", error);
  }
}

// Registers the GPU-failure recovery listener. Safe to call at module load
// (before app.whenReady()) so GPU launch failures during cold start are caught.
export function registerGpuFallbackRecovery(): void {
  app.on("child-process-gone", (_event, details) => {
    if (!isGpuProcessFailure(details)) {
      return;
    }
    const userDataDir = app.getPath("userData");
    if (isSoftwareRenderingMarked(userDataDir)) {
      // Already running without hardware acceleration; another GPU failure
      // isn't something toggling acceleration will fix, and relaunching would
      // loop. Leave it be and let the failure surface.
      log.error("[gpu-fallback] GPU process failed while already in software rendering", details);
      return;
    }
    log.error("[gpu-fallback] GPU process failed; relaunching into software rendering", details);
    try {
      writeSoftwareRenderingMarker(userDataDir, details.reason);
    } catch (error) {
      log.error("[gpu-fallback] failed to persist the marker; not relaunching", error);
      return;
    }
    gpuRecoveryInProgress = true;
    if (process.platform === "linux") {
      // Relaunch straight into the working configuration instead of relying
      // on the marker + disableHardwareAcceleration() on the next boot.
      app.relaunch({ args: [...process.argv.slice(1), ...LINUX_SOFTWARE_RENDERING_ARGS] });
    } else {
      app.relaunch();
    }
    app.exit(0);
  });
}
