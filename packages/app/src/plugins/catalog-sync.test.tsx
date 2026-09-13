/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";

const connection = vi.hoisted(() => ({ connected: true, supported: true }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => connection.connected,
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: () => connection.supported,
}));

vi.mock("./client-runtime", () => ({
  createPluginClientRuntime: () => ({
    otto: {},
    rpc: async () => undefined,
    openSettings() {},
    openSurface() {},
    openPanel() {},
    addComposerPill: () => ({ update() {}, remove() {} }),
    addHeaderButton: () => ({ update() {}, remove() {} }),
  }),
}));

import { PluginCatalogSync } from "./catalog-sync";
import { pluginRegistry } from "./registry";

function bundle(): string {
  return `(function() { return { default: function(plugin) {
    plugin.addSurface("main", function() { return null; });
    return function() { globalThis.__catalogSyncCleanups = (globalThis.__catalogSyncCleanups || 0) + 1; };
  } }; })`;
}

const unsubscribe = vi.fn();
const subscribeStatus = vi.fn<
  (
    type: "status",
    handler: (message: Extract<SessionOutboundMessage, { type: "status" }>) => void,
  ) => () => void
>(() => unsubscribe);
const catalogClient = {
  getPluginCatalog: vi.fn(async () => [
    { id: "example", requirements: { paseo: ">=0.8.0" }, clientBundle: bundle() },
  ]),
  on: subscribeStatus,
} as unknown as DaemonClient;

describe("PluginCatalogSync", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    connection.connected = true;
    connection.supported = true;
    unsubscribe.mockReset();
    vi.mocked(catalogClient.getPluginCatalog).mockClear();
    subscribeStatus.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    pluginRegistry.removeHost("host-a");
    container.remove();
    Reflect.deleteProperty(globalThis, "__catalogSyncCleanups");
    vi.unstubAllGlobals();
  });

  async function renderSync(): Promise<void> {
    await act(async () => {
      root.render(<PluginCatalogSync serverId="host-a" client={catalogClient} />);
      await Promise.resolve();
    });
  }

  it("invalidates settings without reloading the plugin or discarding its query state", async () => {
    await renderSync();
    const plugin = pluginRegistry.getSnapshot()[0]!;
    plugin.queryClient.setQueryData(["draft"], "unsaved");
    const invalidate = vi.spyOn(plugin.queryClient, "invalidateQueries");
    const callback = subscribeStatus.mock.calls.find(([name]) => name === "status")?.[1];
    expect(callback).toBeDefined();
    if (!callback) throw new Error("Expected status subscription");
    act(() => {
      callback({
        type: "status",
        payload: {
          status: "plugin_settings_changed",
          pluginId: "example",
          settingsId: "preferences",
        },
      });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["plugin-settings", "preferences"] });
    expect(pluginRegistry.getSnapshot()[0]).toBe(plugin);
    expect(plugin.queryClient.getQueryData(["draft"])).toBe("unsaved");
    expect(catalogClient.getPluginCatalog).toHaveBeenCalledTimes(1);
    expect(Reflect.get(globalThis, "__catalogSyncCleanups")).toBeUndefined();
  });

  it("tears down through disconnect and unmount boundaries exactly once each", async () => {
    await renderSync();
    const first = pluginRegistry.getSnapshot()[0];
    expect(first?.id).toBe("example");
    first?.queryClient.setQueryData(["owned"], "state");

    connection.connected = false;
    await renderSync();

    expect(Reflect.get(globalThis, "__catalogSyncCleanups")).toBe(1);
    expect(first?.queryClient.getQueryCache().getAll()).toEqual([]);
    expect(pluginRegistry.getSnapshot()).toEqual([]);

    connection.connected = true;
    await renderSync();
    expect(pluginRegistry.getSnapshot()).toHaveLength(1);

    act(() => root.unmount());
    root = createRoot(container);

    expect(Reflect.get(globalThis, "__catalogSyncCleanups")).toBe(2);
    expect(pluginRegistry.getSnapshot()).toEqual([]);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
