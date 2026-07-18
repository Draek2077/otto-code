import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Self-healing state that sits alongside the marker. The marker alone is a
// one-way latch — once written it pinned software rendering forever (only
// OTTO_FORCE_GPU=1 cleared it), so a single transient hiccup (a dev launch
// killed before first paint, one Modern-Standby GPU lock) disabled GPU visuals
// permanently. This state lets the fallback heal itself:
//   - A lone "never painted" launch retries hardware next boot instead of
//     latching software immediately (NEVER_PAINTED_STRIKE_LIMIT). Only a second
//     consecutive never-paint commits to software.
//   - While software rendering is latched, hardware is re-probed after
//     `reprobeAfter` launches. You can't tell a GPU has recovered from within
//     software mode (a CPU rasterizer always paints), so healing means actually
//     running hardware for one launch: it paints -> clear the marker for good;
//     it fails -> back off and keep software.
// Missing/corrupt state degrades to the defaults, i.e. the pre-self-heal
// behavior, so this can never make the fallback worse than before.
const STATE_FILENAME = "gpu-fallback-state.json";
const NEVER_PAINTED_STRIKE_LIMIT = 2;
const REPROBE_BASE_LAUNCHES = 8;
const REPROBE_MAX_LAUNCHES = 256;

interface GpuFallbackState {
  // Consecutive launches that armed the startup sentinel but never painted,
  // observed while NOT in software rendering. Reset to 0 on any healthy paint.
  neverPaintedStrikes: number;
  // Consecutive software-rendering launches since the marker was last written.
  softwareLaunches: number;
  // Software launches to wait before the next hardware re-probe. Doubles (up to
  // REPROBE_MAX_LAUNCHES) each time a probe fails, so a genuinely dead GPU
  // re-probes ever less often instead of flapping every N launches.
  reprobeAfter: number;
  // True for exactly the one launch where we run hardware despite the marker to
  // see whether the GPU has recovered.
  probing: boolean;
}

const DEFAULT_STATE: GpuFallbackState = {
  neverPaintedStrikes: 0,
  softwareLaunches: 0,
  reprobeAfter: REPROBE_BASE_LAUNCHES,
  probing: false,
};

function statePath(userDataDir: string): string {
  return path.join(userDataDir, STATE_FILENAME);
}

function coerceCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

export function readGpuFallbackState(userDataDir: string): GpuFallbackState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(userDataDir), "utf-8")) as Record<
      string,
      unknown
    >;
    return {
      neverPaintedStrikes: coerceCount(parsed.neverPaintedStrikes, 0),
      softwareLaunches: coerceCount(parsed.softwareLaunches, 0),
      reprobeAfter: Math.max(1, coerceCount(parsed.reprobeAfter, REPROBE_BASE_LAUNCHES)),
      probing: parsed.probing === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeGpuFallbackState(userDataDir: string, state: GpuFallbackState): void {
  try {
    const file = statePath(userDataDir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), "utf-8");
  } catch (error) {
    log.warn("[gpu-fallback] failed to persist self-heal state", error);
  }
}

function clearGpuFallbackState(userDataDir: string): void {
  rmSync(statePath(userDataDir), { force: true });
}

// The backed-off state after a failed hardware re-probe: stay software, wait
// longer before the next probe, and clear the probing flag.
function backedOffState(state: GpuFallbackState): GpuFallbackState {
  return {
    ...state,
    probing: false,
    softwareLaunches: 0,
    reprobeAfter: Math.min(state.reprobeAfter * 2, REPROBE_MAX_LAUNCHES),
  };
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
    const userDataDir = app.getPath("userData");
    const state = readGpuFallbackState(userDataDir);
    try {
      if (state.probing) {
        // A hardware re-probe hung — the GPU is still bad. Back off; the marker
        // is already on disk from before the probe.
        writeGpuFallbackState(userDataDir, backedOffState(state));
      } else {
        writeSoftwareRenderingMarker(userDataDir, "startup-paint-timeout");
        writeGpuFallbackState(userDataDir, { ...DEFAULT_STATE });
      }
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

// Argv switches that mean this run rasterizes frames on the CPU: the
// fallback's own --use-gl=disabled, the generic --disable-gpu, and the
// SwiftShader software-GL escape hatches (--use-angle=swiftshader /
// swiftshader-webgl). Exact-matched except where the switch carries a value
// ("--disable-gpu" must not match e.g. --disable-gpu-sandbox, which is not
// software rendering).
const SOFTWARE_RENDERING_ARGV_EXACT: ReadonlySet<string> = new Set([
  "--use-gl=disabled",
  "--disable-gpu",
]);
const SOFTWARE_RENDERING_ARGV_PREFIXES = ["--use-angle=swiftshader"];

export function hasSoftwareRenderingArgv(argv: readonly string[]): boolean {
  return argv.some(
    (arg) =>
      SOFTWARE_RENDERING_ARGV_EXACT.has(arg) ||
      SOFTWARE_RENDERING_ARGV_PREFIXES.some((prefix) => arg.startsWith(prefix)),
  );
}

// Whether this run presents frames without GPU acceleration — via explicit
// software argv or the persisted fallback marker (which drives
// disableHardwareAcceleration() on non-Linux and the relaunch flags on
// Linux). Static for the process lifetime; exposed to the renderer through
// desktop_get_runtime_info so it can trim GPU-hungry visuals (e.g. the
// Visualizer force-disables its bloom pass — three full-canvas blurs per
// frame is exactly what a CPU rasterizer can't afford).
export function isSoftwareRenderingActive(): boolean {
  if (hasSoftwareRenderingArgv(process.argv)) {
    return true;
  }
  try {
    const userDataDir = app.getPath("userData");
    if (!isSoftwareRenderingMarked(userDataDir)) {
      return false;
    }
    // During a hardware re-probe the marker stays on disk but the GPU is
    // actually driving this launch (disableHardwareAcceleration was skipped),
    // so report hardware — otherwise the renderer would needlessly trim GPU
    // visuals on the very launch meant to prove the GPU works.
    return !readGpuFallbackState(userDataDir).probing;
  } catch {
    return false;
  }
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
    clearGpuFallbackState(userDataDir);
    return;
  }

  // Read the self-heal state once and thread it through: each branch below
  // assigns the updated state object it persists, so the re-probe decision at
  // the bottom works off the in-memory value instead of re-reading the file it
  // just wrote.
  let state = readGpuFallbackState(userDataDir);
  const sentinelSurvived = isStartupSentinelPresent(userDataDir);

  if (state.probing) {
    // Last launch was a hardware re-probe that did not heal — a successful probe
    // clears `probing` (see markGpuStartupHealthy) and a crashed one is handled
    // by the recovery listener before relaunch. Reaching here means it hung
    // (never painted) or was killed. Back off and keep the marker's software
    // rendering; the marker is still on disk from before the probe.
    state = backedOffState(state);
    writeGpuFallbackState(userDataDir, state);
    log.warn("[gpu-fallback] hardware re-probe did not paint; backing off, staying in software");
  } else if (sentinelSurvived && !isSoftwareRenderingMarked(userDataDir)) {
    // A sentinel left by a previous hardware launch means that launch armed the
    // startup watch but never painted — a hang/crash during GPU init, OR just a
    // launch killed or restarted before first paint (routine in dev). One
    // occurrence is not enough to condemn the GPU: retry hardware next launch.
    // Only NEVER_PAINTED_STRIKE_LIMIT consecutive never-paints latch software.
    const neverPaintedStrikes = state.neverPaintedStrikes + 1;
    if (neverPaintedStrikes >= NEVER_PAINTED_STRIKE_LIMIT) {
      writeSoftwareRenderingMarker(userDataDir, "previous-launch-never-painted");
      state = { ...DEFAULT_STATE };
      writeGpuFallbackState(userDataDir, state);
      log.warn(
        `[gpu-fallback] ${neverPaintedStrikes} consecutive launches never painted; enabling software rendering`,
      );
    } else {
      writeGpuFallbackState(userDataDir, { ...state, neverPaintedStrikes });
      log.warn(
        "[gpu-fallback] previous launch never painted; retrying hardware acceleration once more before falling back",
      );
      return;
    }
  }

  if (!isSoftwareRenderingMarked(userDataDir)) {
    return;
  }

  // Already committed to software this launch by real argv flags: the Linux
  // post-relaunch process (--ozone-platform=x11 --use-gl=disabled) re-enters
  // this function, and an explicit --disable-gpu is a deliberate user choice.
  // The decision was made by the launch that set the flags — don't re-count it
  // (which would double the Linux tally) or try to re-probe within it.
  if (hasSoftwareRenderingArgv(process.argv)) {
    log.warn(
      "[gpu-fallback] software rendering active — a prior GPU failure was recorded (set OTTO_FORCE_GPU=1 to re-enable hardware acceleration)",
    );
    return;
  }

  // Marker present → software rendering, unless enough software launches have
  // passed to warrant a hardware re-probe. `state.probing` is always false
  // here: the back-off branch above cleared it (and reset the counter with a
  // doubled `reprobeAfter`), and the never-paint branch just reset the state —
  // so a re-probe can't fire on the same launch that (re)wrote the marker.
  const softwareLaunches = state.softwareLaunches + 1;
  if (softwareLaunches >= state.reprobeAfter) {
    // Give the GPU another chance: run hardware this launch despite the marker.
    // If it paints we heal; if it fails the recovery/watchdog/next-startup path
    // backs off. `isSoftwareRenderingActive()` reports hardware while probing.
    writeGpuFallbackState(userDataDir, { ...state, probing: true, softwareLaunches: 0 });
    log.warn(
      `[gpu-fallback] re-probing hardware acceleration after ${softwareLaunches} software launches (heal-on-success)`,
    );
    return;
  }
  writeGpuFallbackState(userDataDir, { ...state, softwareLaunches });

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
// is proven healthy for this launch. Also advances the self-heal state: a
// healthy paint clears any lone never-painted strike, and a paint during a
// hardware re-probe means the GPU recovered — clear the marker for good.
export function markGpuStartupHealthy(): void {
  if (startupPaintTimer) {
    clearTimeout(startupPaintTimer);
    startupPaintTimer = null;
  }
  try {
    const userDataDir = app.getPath("userData");
    clearStartupSentinel(userDataDir);
    const state = readGpuFallbackState(userDataDir);
    if (state.probing) {
      // The hardware re-probe painted: the GPU works again. Heal permanently.
      clearSoftwareRenderingMarker(userDataDir);
      clearGpuFallbackState(userDataDir);
      log.info(
        "[gpu-fallback] hardware re-probe painted successfully; cleared the software-rendering marker",
      );
    } else if (state.neverPaintedStrikes !== 0) {
      writeGpuFallbackState(userDataDir, { ...state, neverPaintedStrikes: 0 });
    }
  } catch (error) {
    log.warn("[gpu-fallback] failed to update self-heal state on healthy paint", error);
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
    const state = readGpuFallbackState(userDataDir);
    if (isSoftwareRenderingMarked(userDataDir) && !state.probing) {
      // Already running without hardware acceleration; another GPU failure
      // isn't something toggling acceleration will fix, and relaunching would
      // loop. Leave it be and let the failure surface.
      log.error("[gpu-fallback] GPU process failed while already in software rendering", details);
      return;
    }
    try {
      if (state.probing) {
        // A hardware re-probe crashed — the GPU is still bad. Back off and go
        // back to software; the marker is already on disk from before the probe.
        writeGpuFallbackState(userDataDir, backedOffState(state));
        log.error(
          "[gpu-fallback] hardware re-probe crashed; relaunching into software rendering",
          details,
        );
      } else {
        // First GPU failure on a hardware launch — latch software rendering.
        writeSoftwareRenderingMarker(userDataDir, details.reason);
        writeGpuFallbackState(userDataDir, { ...DEFAULT_STATE });
        log.error(
          "[gpu-fallback] GPU process failed; relaunching into software rendering",
          details,
        );
      }
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
