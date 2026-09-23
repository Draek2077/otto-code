import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  notifications: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    emit: (event: string) => void;
  }>,
  getSettings: vi.fn(async () => ({ notifications: { playSound: false } })),
}));

vi.mock("electron", () => ({
  app: { name: "Otto", isPackaged: true },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  Notification: class {
    static isSupported() {
      return true;
    }

    private handlers = new Map<string, () => void>();
    close = vi.fn(() => this.emit("close"));

    constructor(_options: unknown) {
      harness.notifications.push(this);
    }

    on(event: string, handler: () => void) {
      this.handlers.set(event, handler);
    }

    emit(event: string) {
      this.handlers.get(event)?.();
    }

    show() {}
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      harness.handlers.set(channel, handler);
    },
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({ get: harness.getSettings }),
}));

function registeredHandler(channel: string): (...args: unknown[]) => unknown {
  const registered = harness.handlers.get(channel);
  if (!registered) throw new Error(`Missing handler: ${channel}`);
  return registered;
}

describe("native notification reconciliation", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    harness.handlers.clear();
    harness.notifications.length = 0;
    harness.getSettings.mockResolvedValue({ notifications: { playSound: false } });
    const { registerNotificationHandlers } = await import("./notifications");
    registerNotificationHandlers({ requireTrustedSender: () => {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a Linux handle after toast expiry, then dismisses cleared attention", async () => {
    await registeredHandler("otto:notification:send")(
      { sender: {} },
      {
        title: "Agent finished",
        data: { serverId: "host-a", agentId: "agent-a" },
      },
    );
    const notification = harness.notifications[0]!;
    notification.emit("close");

    registeredHandler("otto:notification:reconcile")(
      { sender: {} },
      {
        serverId: "host-a",
        agentIds: [],
        workspaceIds: [],
      },
    );
    expect(notification.close).toHaveBeenCalledOnce();
  });

  it("preserves active sources and dismisses only the source that was reviewed", async () => {
    await registeredHandler("otto:notification:send")(
      { sender: {} },
      {
        title: "Agent finished",
        data: { serverId: "host-a", agentId: "agent-a" },
      },
    );
    await registeredHandler("otto:notification:send")(
      { sender: {} },
      {
        title: "Terminal finished",
        data: { serverId: "host-a", workspaceId: "workspace-a", terminalId: "terminal-a" },
      },
    );

    registeredHandler("otto:notification:reconcile")(
      { sender: {} },
      {
        serverId: "host-a",
        agentIds: ["agent-a"],
        workspaceIds: ["workspace-a"],
      },
    );
    expect(harness.notifications[0]!.close).not.toHaveBeenCalled();
    expect(harness.notifications[1]!.close).not.toHaveBeenCalled();

    registeredHandler("otto:notification:reconcile")(
      { sender: {} },
      {
        serverId: "host-a",
        agentIds: [],
        workspaceIds: ["workspace-a"],
      },
    );
    expect(harness.notifications[0]!.close).toHaveBeenCalledOnce();
    expect(harness.notifications[1]!.close).not.toHaveBeenCalled();
  });

  it("does not show a delayed notification after its attention was cleared", async () => {
    let finishSettings!: (value: { notifications: { playSound: boolean } }) => void;
    harness.getSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSettings = resolve;
        }),
    );
    const send = registeredHandler("otto:notification:send")(
      { sender: {} },
      {
        title: "Agent finished",
        data: { serverId: "host-a", agentId: "agent-a" },
      },
    );

    registeredHandler("otto:notification:reconcile")(
      { sender: {} },
      {
        serverId: "host-a",
        agentIds: [],
        workspaceIds: [],
      },
    );
    finishSettings({ notifications: { playSound: false } });

    expect(await send).toBe(false);
    expect(harness.notifications).toHaveLength(0);
  });

  it("replaces repeated notifications from one agent", async () => {
    const event = { sender: {} };
    const input = {
      title: "Agent finished",
      data: { serverId: "host-a", agentId: "agent-a" },
    };
    await registeredHandler("otto:notification:send")(event, input);
    await registeredHandler("otto:notification:send")(event, input);

    expect(harness.notifications[0]!.close).toHaveBeenCalledOnce();
    expect(harness.notifications[1]!.close).not.toHaveBeenCalled();

    registeredHandler("otto:notification:reconcile")(event, {
      serverId: "host-a",
      agentIds: [],
      workspaceIds: [],
    });
    expect(harness.notifications[1]!.close).toHaveBeenCalledOnce();
  });
});
