import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { on: vi.fn(), getPath: vi.fn(() => ""), relaunch: vi.fn(), exit: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
  dialog: { showMessageBox: vi.fn(), showErrorBox: vi.fn() },
}));
vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("./gpu-fallback", () => ({ writeSoftwareRenderingMarker: vi.fn() }));

import { buildCrashDialogDetail, isRendererCrash } from "./crash-dialog";

describe("isRendererCrash", () => {
  it("is true for genuine renderer failures", () => {
    expect(isRendererCrash({ reason: "crashed" })).toBe(true);
    expect(isRendererCrash({ reason: "oom" })).toBe(true);
    expect(isRendererCrash({ reason: "launch-failed" })).toBe(true);
    expect(isRendererCrash({ reason: "abnormal-exit" })).toBe(true);
  });

  it("is false for clean exits and deliberate kills", () => {
    expect(isRendererCrash({ reason: "clean-exit" })).toBe(false);
    expect(isRendererCrash({ reason: "killed" })).toBe(false);
  });
});

describe("buildCrashDialogDetail", () => {
  it("includes the reason, exit code, and log path when available", () => {
    const detail = buildCrashDialogDetail({
      reason: "crashed",
      exitCode: 139,
      logFilePath: "/home/u/.config/Otto/logs/main.log",
    });
    expect(detail).toContain("crashed");
    expect(detail).toContain("139");
    expect(detail).toContain("/home/u/.config/Otto/logs/main.log");
    expect(detail).toContain("Safe Mode");
  });

  it("omits the log-path line when unavailable", () => {
    const detail = buildCrashDialogDetail({ reason: "oom", exitCode: 0, logFilePath: null });
    expect(detail).not.toContain("written to");
    expect(detail).toContain("oom");
  });
});
