import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page, Request } from "playwright";
import { RemoteBrowserManager } from "./remote-browser-manager.js";

const managers: RemoteBrowserManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});

describe("hosted browser page loading", () => {
  it("relays a pinch at the page point through Chromium", async () => {
    const manager = new RemoteBrowserManager("test-browser-profile");
    managers.push(manager);
    const browserId = "11111111-1111-4111-8111-111111111111";
    const tab = manager["ensureTab"]("workspace", { kind: "open", browserId });
    const send = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    tab.page = {
      isClosed: () => false,
      close: vi.fn().mockResolvedValue(undefined),
      context: () => ({ newCDPSession: async () => ({ send, detach }) }),
      url: () => "https://example.com/",
      title: async () => "Example",
    } as unknown as Page;
    tab.state = "ready";

    await manager.execute("workspace", {
      kind: "pinch",
      browserId,
      x: 120,
      y: 180,
      scaleFactor: 1.25,
    });

    expect(send).toHaveBeenCalledWith("Input.synthesizePinchGesture", {
      x: 120,
      y: 180,
      scaleFactor: 1.25,
      relativeSpeed: 800,
    });
    expect(detach).toHaveBeenCalledTimes(2);
  });

  it("passes right clicks and double clicks to the host page", async () => {
    const manager = new RemoteBrowserManager("test-browser-profile");
    managers.push(manager);
    const browserId = "11111111-1111-4111-8111-111111111111";
    const tab = manager["ensureTab"]("workspace", { kind: "open", browserId });
    const click = vi.fn().mockResolvedValue(undefined);
    tab.page = {
      mouse: { click },
      isClosed: () => false,
      close: vi.fn().mockResolvedValue(undefined),
      url: () => "https://example.com/",
      title: async () => "Example",
    } as unknown as Page;
    tab.state = "ready";

    await manager.execute("workspace", {
      kind: "tap",
      browserId,
      x: 12,
      y: 34,
      button: "right",
    });
    await manager.execute("workspace", {
      kind: "tap",
      browserId,
      x: 56,
      y: 78,
      clickCount: 2,
    });

    expect(click).toHaveBeenNthCalledWith(1, 12, 34, { button: "right", clickCount: 1 });
    expect(click).toHaveBeenNthCalledWith(2, 56, 78, { button: "left", clickCount: 2 });
  });

  it("tracks main-frame loading through load and stops an active navigation", async () => {
    const manager = new RemoteBrowserManager("test-browser-profile");
    managers.push(manager);
    const browserId = "11111111-1111-4111-8111-111111111111";
    const workspaceId = "workspace";
    const tab = manager["ensureTab"](workspaceId, {
      kind: "open",
      browserId,
      url: "https://example.com/",
    });
    const frame = {};
    const send = vi.fn().mockResolvedValue({});
    const detach = vi.fn().mockResolvedValue(undefined);
    const events = Object.assign(new EventEmitter(), {
      mainFrame: () => frame,
      isClosed: () => false,
      close: vi.fn().mockResolvedValue(undefined),
      context: () => ({ newCDPSession: async () => ({ send, detach }) }),
    });
    const page = events as unknown as Page;
    tab.page = page;
    tab.state = "ready";
    manager["observePage"](tab, page);

    const request = (navigation: boolean, requestFrame = frame) =>
      ({
        isNavigationRequest: () => navigation,
        frame: () => requestFrame,
        url: () => "https://example.com/next",
        method: () => "GET",
        resourceType: () => "document",
        failure: () => ({ errorText: "net::ERR_ABORTED" }),
      }) as unknown as Request;

    events.emit("request", request(true));
    const loading = (await manager.execute(workspaceId, { kind: "get", browserId })).tab!;
    expect(loading.isLoading).toBe(true);
    events.emit("domcontentloaded");
    expect((await manager.execute(workspaceId, { kind: "get", browserId })).tab?.isLoading).toBe(
      true,
    );
    events.emit("load");
    const complete = (await manager.execute(workspaceId, { kind: "get", browserId })).tab!;
    expect(complete.isLoading).toBe(false);
    expect(complete.observationId).toBeGreaterThan(loading.observationId!);

    events.emit("request", request(true));
    events.emit("request", request(true, {}));
    expect((await manager.execute(workspaceId, { kind: "get", browserId })).tab?.isLoading).toBe(
      true,
    );
    const stopped = (await manager.execute(workspaceId, { kind: "stop", browserId })).tab!;
    expect(send).toHaveBeenCalledWith("Page.stopLoading");
    expect(detach).toHaveBeenCalledOnce();
    expect(stopped.isLoading).toBe(false);

    const superseded = request(true);
    const failed = request(true);
    events.emit("request", superseded);
    events.emit("request", failed);
    events.emit("requestfailed", superseded);
    expect((await manager.execute(workspaceId, { kind: "get", browserId })).tab?.isLoading).toBe(
      true,
    );
    events.emit("requestfailed", failed);
    expect((await manager.execute(workspaceId, { kind: "get", browserId })).tab?.isLoading).toBe(
      false,
    );
  });
});
