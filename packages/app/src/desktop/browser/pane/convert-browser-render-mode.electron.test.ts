import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { createWorkspaceBrowser, useBrowserStore } from "@/desktop/browser/store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { convertBrowserRenderMode } from "./convert-browser-render-mode.electron";

vi.mock("expo-router", () => ({}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock("@/screens/workspace/use-hosted-browser-tabs", () => ({
  ignoreHostedBrowserTab: vi.fn(),
  allowHostedBrowserTab: vi.fn(),
}));

const serverId = "host";
const workspaceId = "workspace";
const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId })!;

function openBrowser(renderMode: "native" | "hosted") {
  const { browserId } = createWorkspaceBrowser({
    initialUrl: "https://example.com/path",
    renderMode,
  });
  const tabId = useWorkspaceLayoutStore.getState().openTabInBackground(workspaceKey, {
    kind: "browser",
    browserId,
  });
  expect(tabId).not.toBeNull();
  return { browserId, tabId };
}

function soleTab() {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!;
  const tabs = collectAllTabs(layout.root).filter((tab) => tab.target.kind === "browser");
  expect(tabs).toHaveLength(1);
  return tabs[0]!;
}

describe("browser host switch", () => {
  beforeEach(() => {
    useBrowserStore.setState({ browsersById: {} });
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  });

  it("closes the host page and reloads its URL in a native browser in the same tab", async () => {
    const initial = openBrowser("hosted");
    const remoteBrowserExecute = vi.fn().mockResolvedValue({});
    await convertBrowserRenderMode({
      ...initial,
      serverId,
      workspaceId,
      client: { remoteBrowserExecute } as unknown as DaemonClient,
    });
    expect(remoteBrowserExecute).toHaveBeenCalledWith(workspaceId, {
      kind: "close",
      browserId: initial.browserId,
    });
    const next = soleTab();
    expect(next.tabId).toBe(initial.tabId);
    expect(next.target).toMatchObject({ kind: "browser" });
    if (next.target.kind !== "browser") throw new Error("Expected browser tab");
    expect(next.target.browserId).not.toBe(initial.browserId);
    expect(useBrowserStore.getState().browsersById[initial.browserId]).toBeUndefined();
    expect(useBrowserStore.getState().browsersById[next.target.browserId]).toMatchObject({
      renderMode: "native",
      url: "https://example.com/path",
    });

    await convertBrowserRenderMode({
      browserId: next.target.browserId,
      serverId,
      workspaceId,
      client: null,
    });
    const hostedAgain = soleTab();
    expect(hostedAgain.tabId).toBe(initial.tabId);
    if (hostedAgain.target.kind !== "browser") throw new Error("Expected browser tab");
    expect(hostedAgain.target.browserId).not.toBe(next.target.browserId);
    expect(hostedAgain.target.browserId).not.toBe(initial.browserId);
    expect(useBrowserStore.getState().browsersById[hostedAgain.target.browserId]).toMatchObject({
      renderMode: "hosted",
      url: "https://example.com/path",
    });
  });

  it("moves a native tab to a fresh host identity without changing its tab slot", async () => {
    const initial = openBrowser("native");
    await convertBrowserRenderMode({ ...initial, serverId, workspaceId, client: null });
    const next = soleTab();
    expect(next.tabId).toBe(initial.tabId);
    if (next.target.kind !== "browser") throw new Error("Expected browser tab");
    expect(next.target.browserId).not.toBe(initial.browserId);
    expect(useBrowserStore.getState().browsersById[next.target.browserId]).toMatchObject({
      renderMode: "hosted",
      url: "https://example.com/path",
    });
  });

  it("keeps the hosted tab when the host cannot close it", async () => {
    const initial = openBrowser("hosted");
    const remoteBrowserExecute = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      convertBrowserRenderMode({
        ...initial,
        serverId,
        workspaceId,
        client: { remoteBrowserExecute } as unknown as DaemonClient,
      }),
    ).rejects.toThrow("offline");
    expect(soleTab().target).toEqual({ kind: "browser", browserId: initial.browserId });
    expect(useBrowserStore.getState().browsersById[initial.browserId]?.renderMode).toBe("hosted");
  });
});
