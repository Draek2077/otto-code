import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const state = { userDataDir: "" };
  return {
    state,
    listeners,
    app: {
      getPath: vi.fn((name: string) => (name === "userData" ? state.userDataDir : "")),
      disableHardwareAcceleration: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners.set(event, cb);
      }),
    },
  };
});

vi.mock("electron", () => ({ app: mocks.app }));
vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  applyPersistedHardwareAccelerationFallback,
  armGpuStartupSentinel,
  clearSoftwareRenderingMarker,
  clearStartupSentinel,
  hasSoftwareRenderingArgv,
  isGpuProcessFailure,
  isSoftwareRenderingActive,
  isSoftwareRenderingMarked,
  isStartupSentinelPresent,
  markGpuStartupHealthy,
  registerGpuFallbackRecovery,
  writeSoftwareRenderingMarker,
  writeStartupSentinel,
} from "./gpu-fallback";

let tempDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  tempDir = mkdtempSync(path.join(tmpdir(), "otto-gpu-fallback-"));
  mocks.state.userDataDir = tempDir;
  delete process.env.OTTO_FORCE_GPU;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.OTTO_FORCE_GPU;
});

describe("isGpuProcessFailure", () => {
  it("is true for GPU failure reasons", () => {
    expect(isGpuProcessFailure({ type: "GPU", reason: "crashed" })).toBe(true);
    expect(isGpuProcessFailure({ type: "GPU", reason: "launch-failed" })).toBe(true);
    expect(isGpuProcessFailure({ type: "GPU", reason: "abnormal-exit" })).toBe(true);
  });

  it("is false for clean GPU exits, kills, and non-GPU processes", () => {
    expect(isGpuProcessFailure({ type: "GPU", reason: "clean-exit" })).toBe(false);
    expect(isGpuProcessFailure({ type: "GPU", reason: "killed" })).toBe(false);
    expect(isGpuProcessFailure({ type: "Utility", reason: "crashed" })).toBe(false);
  });
});

describe("software-rendering marker", () => {
  it("writes, reads, and clears round-trip", () => {
    expect(isSoftwareRenderingMarked(tempDir)).toBe(false);
    writeSoftwareRenderingMarker(tempDir, "crashed");
    expect(isSoftwareRenderingMarked(tempDir)).toBe(true);
    clearSoftwareRenderingMarker(tempDir);
    expect(isSoftwareRenderingMarked(tempDir)).toBe(false);
  });
});

describe("software-rendering detection", () => {
  it("recognizes software-rendering argv switches", () => {
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--use-gl=disabled"])).toBe(true);
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--disable-gpu"])).toBe(true);
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--use-angle=swiftshader"])).toBe(true);
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--use-angle=swiftshader-webgl"])).toBe(true);
  });

  it("does not match hardware or unrelated switches", () => {
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto"])).toBe(false);
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--ozone-platform=x11"])).toBe(false);
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--use-angle=metal"])).toBe(false);
    // --disable-gpu-sandbox is not software rendering.
    expect(hasSoftwareRenderingArgv(["/usr/bin/Otto", "--disable-gpu-sandbox"])).toBe(false);
  });

  it("reports active when the persisted marker is present", () => {
    expect(isSoftwareRenderingActive()).toBe(false);
    writeSoftwareRenderingMarker(tempDir, "crashed");
    expect(isSoftwareRenderingActive()).toBe(true);
  });
});

describe("applyPersistedHardwareAccelerationFallback", () => {
  it("disables hardware acceleration when the marker is present", () => {
    writeSoftwareRenderingMarker(tempDir, "crashed");
    applyPersistedHardwareAccelerationFallback();
    expect(mocks.app.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
  });

  it("leaves acceleration on when the marker is absent", () => {
    applyPersistedHardwareAccelerationFallback();
    expect(mocks.app.disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it("promotes a stale startup sentinel into software rendering", () => {
    // A sentinel that survived from a prior launch means that launch never
    // painted a window — recover by falling back this launch.
    writeStartupSentinel(tempDir);
    applyPersistedHardwareAccelerationFallback();
    expect(isSoftwareRenderingMarked(tempDir)).toBe(true);
    expect(mocks.app.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
  });

  it("clears the marker and sentinel and keeps acceleration on when OTTO_FORCE_GPU=1", () => {
    writeSoftwareRenderingMarker(tempDir, "crashed");
    writeStartupSentinel(tempDir);
    process.env.OTTO_FORCE_GPU = "1";
    applyPersistedHardwareAccelerationFallback();
    expect(mocks.app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(isSoftwareRenderingMarked(tempDir)).toBe(false);
    expect(isStartupSentinelPresent(tempDir)).toBe(false);
  });
});

describe("startup sentinel", () => {
  it("round-trips write / present / clear", () => {
    expect(isStartupSentinelPresent(tempDir)).toBe(false);
    writeStartupSentinel(tempDir);
    expect(isStartupSentinelPresent(tempDir)).toBe(true);
    clearStartupSentinel(tempDir);
    expect(isStartupSentinelPresent(tempDir)).toBe(false);
  });

  it("armGpuStartupSentinel arms and markGpuStartupHealthy disarms", () => {
    armGpuStartupSentinel();
    expect(isStartupSentinelPresent(tempDir)).toBe(true);
    markGpuStartupHealthy();
    expect(isStartupSentinelPresent(tempDir)).toBe(false);
  });
});

describe("registerGpuFallbackRecovery", () => {
  function emitChildProcessGone(details: { type: string; reason: string }): void {
    const handler = mocks.listeners.get("child-process-gone");
    if (!handler) {
      throw new Error("child-process-gone listener was not registered");
    }
    handler({}, details);
  }

  it("marks software rendering and relaunches on the first GPU failure", () => {
    registerGpuFallbackRecovery();
    emitChildProcessGone({ type: "GPU", reason: "crashed" });
    expect(isSoftwareRenderingMarked(tempDir)).toBe(true);
    expect(mocks.app.relaunch).toHaveBeenCalledTimes(1);
    expect(mocks.app.exit).toHaveBeenCalledWith(0);
  });

  it("does not relaunch again when already in software rendering", () => {
    writeSoftwareRenderingMarker(tempDir, "crashed");
    registerGpuFallbackRecovery();
    emitChildProcessGone({ type: "GPU", reason: "crashed" });
    expect(mocks.app.relaunch).not.toHaveBeenCalled();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });

  it("ignores clean GPU exits and non-GPU process failures", () => {
    registerGpuFallbackRecovery();
    emitChildProcessGone({ type: "GPU", reason: "clean-exit" });
    emitChildProcessGone({ type: "Utility", reason: "crashed" });
    expect(mocks.app.relaunch).not.toHaveBeenCalled();
    expect(isSoftwareRenderingMarked(tempDir)).toBe(false);
  });
});
