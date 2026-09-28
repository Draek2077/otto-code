import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page, Request } from "playwright";
import { RemoteBrowserManager } from "./remote-browser-manager.js";

const managers: RemoteBrowserManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});

describe("hosted browser page loading", () => {
  it("tracks main-frame loading through load and stops an active navigation", async () => {
    const manager = new RemoteBrowserManager();
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
