import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerWindowManager } from "./window-manager";

const { handlers, fromWebContents } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { setBadgeCount: vi.fn() },
  BrowserWindow: { fromWebContents },
  clipboard: {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  nativeTheme: { shouldUseDarkColors: false },
  screen: {},
  shell: {},
}));

function registeredHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return handler;
}

describe("window-manager IPC", () => {
  const sender = { id: 42 } as Electron.WebContents;
  const event = { sender } as Electron.IpcMainInvokeEvent;
  const window = {
    close: vi.fn(),
    isFullScreen: vi.fn(() => false),
    isMaximized: vi.fn(() => true),
    maximize: vi.fn(),
    minimize: vi.fn(),
    setBackgroundColor: vi.fn(),
    setFullScreen: vi.fn(),
    unmaximize: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    fromWebContents.mockReturnValue(window);
    registerWindowManager({ isTrustedSender: () => true });
  });

  it("registers and serves every window operation exposed by the preload bridge", () => {
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        "otto:window:minimize",
        "otto:window:close",
        "otto:window:toggleMaximize",
        "otto:window:isMaximized",
        "otto:window:setFullscreen",
        "otto:window:isFullscreen",
        "otto:window:updateChrome",
      ]),
    );

    registeredHandler("otto:window:minimize")(event);
    registeredHandler("otto:window:close")(event);
    registeredHandler("otto:window:toggleMaximize")(event);
    expect(registeredHandler("otto:window:isMaximized")(event)).toBe(true);
    registeredHandler("otto:window:setFullscreen")(event, true);
    expect(registeredHandler("otto:window:isFullscreen")(event)).toBe(false);
    registeredHandler("otto:window:updateChrome")(event, { backgroundColor: "#1e2221" });

    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();
    expect(window.unmaximize).toHaveBeenCalledOnce();
    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(window.setBackgroundColor).toHaveBeenCalledWith("#1e2221");
  });

  it("rejects an untrusted renderer before it can control a window", () => {
    handlers.clear();
    registerWindowManager({ isTrustedSender: () => false });

    expect(() => registeredHandler("otto:window:minimize")(event)).toThrow(
      "Rejected IPC from an untrusted renderer.",
    );
    expect(window.minimize).not.toHaveBeenCalled();
  });
});
