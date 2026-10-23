import { describe, expect, it } from "vitest";
import { assertInteractiveTerminal, runUiCommand } from "./ui.js";
import { MemoryScreen, MemoryTuiHost } from "../../test-tui.js";

describe("standalone interactive UI command", () => {
  it("refuses either missing TTY before constructing a host", async () => {
    let created = 0;
    const createHost = async () => {
      created += 1;
      return new MemoryTuiHost();
    };
    for (const [stdinIsTTY, stdoutIsTTY] of [
      [false, true],
      [true, false],
      [false, false],
    ]) {
      await expect(
        runUiCommand(createHost, {
          terminal: { stdinIsTTY, stdoutIsTTY, platform: "linux", electron: false },
        }),
      ).rejects.toMatchObject({ code: "NO_TTY" });
    }
    expect(created).toBe(0);
  });
  it("explains the bundled Windows GUI-host limitation without claiming a launcher fix", () => {
    expect(() =>
      assertInteractiveTerminal({
        stdinIsTTY: false,
        stdoutIsTTY: false,
        platform: "win32",
        electron: true,
      }),
    ).toThrow("bundled Windows CLI");
    try {
      assertInteractiveTerminal({
        stdinIsTTY: false,
        stdoutIsTTY: false,
        platform: "win32",
        electron: true,
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "NO_TTY",
        details: expect.stringContaining("@otto-code/cli"),
      });
    }
  });
  it("runs without runtime discovery and cancels only terminal demand on abort", async () => {
    const host = new MemoryTuiHost();
    const screen = new MemoryScreen();
    const controller = new AbortController();
    const running = runUiCommand(async () => host, {
      screen,
      keys: () => () => {},
      signal: controller.signal,
      terminal: { stdinIsTTY: true, stdoutIsTTY: true, platform: "win32", electron: false },
    });
    // Dynamic app loading is async; abort is valid before or after it settles.
    controller.abort();
    await running;
    expect(host.actions).toEqual([]);
    expect(host.retained).toBe(0);
    expect(screen.entered).toBe(false);
  });
});
