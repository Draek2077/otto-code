import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useBrowserStore } from "@/desktop/browser/store";
import {
  collectAllTabs,
  getFocusedBrowserId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useHostedBrowserTabs } from "./use-hosted-browser-tabs";

const browserId = "11111111-1111-4111-8111-111111111111";
const workspaceKey = buildWorkspaceTabPersistenceKey({
  serverId: "host",
  workspaceId: "workspace",
})!;

describe("hosted browser tab projection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useBrowserStore.setState({ browsersById: {} });
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  });

  afterEach(() => vi.useRealTimers());

  it("opens an AI-created host tab locally and removes it after a remote close", async () => {
    const hostedTabs = {
      tabs: [
        {
          browserId,
          workspaceId: "workspace",
          url: "https://example.com/",
          title: "Shared page",
          viewport: { mode: "fixed", width: 820, height: 1180 },
          state: "ready",
          error: null,
        },
      ],
    };
    const remoteBrowserExecute = vi
      .fn()
      .mockResolvedValueOnce(hostedTabs)
      .mockResolvedValueOnce(hostedTabs)
      .mockResolvedValueOnce({ tabs: [] });
    const client = { remoteBrowserExecute } as unknown as DaemonClient;

    const hook = renderHook(() =>
      useHostedBrowserTabs({
        client,
        serverId: "host",
        workspaceId: "workspace",
        workspaceKey,
        canSplitPanes: false,
        enabled: true,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(remoteBrowserExecute).toHaveBeenCalledTimes(1);
    const record = useBrowserStore.getState().browsersById[browserId];
    expect(record).toMatchObject({
      renderMode: "hosted",
      title: "Shared page",
      viewport: { mode: "fixed", width: 820, height: 1180 },
    });
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!;
    expect(collectAllTabs(layout.root).filter((tab) => tab.target.kind === "browser")).toHaveLength(
      1,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(remoteBrowserExecute).toHaveBeenCalledTimes(2);
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]).toBe(layout);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(remoteBrowserExecute).toHaveBeenCalledTimes(3);
    expect(useBrowserStore.getState().browsersById[browserId]).toBeUndefined();
    const afterClose = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!;
    expect(
      collectAllTabs(afterClose.root).filter((tab) => tab.target.kind === "browser"),
    ).toHaveLength(0);
    hook.unmount();
  });

  it("reveals a background tab when the AI focuses it", async () => {
    const otherBrowserId = "22222222-2222-4222-8222-222222222222";
    const tab = (id: string, focusRequestId?: string) => ({
      browserId: id,
      workspaceId: "workspace",
      url: "https://example.com/",
      title: id,
      viewport: { mode: "responsive" as const, width: 390, height: 844 },
      state: "ready",
      error: null,
      focusRequestId,
    });
    const remoteBrowserExecute = vi
      .fn()
      .mockResolvedValueOnce({ tabs: [tab(browserId), tab(otherBrowserId)] })
      .mockResolvedValueOnce({ tabs: [tab(browserId), tab(otherBrowserId, "focus-first")] })
      .mockResolvedValueOnce({ tabs: [tab(browserId), tab(otherBrowserId, "focus-first")] })
      .mockResolvedValueOnce({
        tabs: [tab(browserId), tab(otherBrowserId, "focus-after-restart")],
      });
    const client = { remoteBrowserExecute } as unknown as DaemonClient;
    const hook = renderHook(() =>
      useHostedBrowserTabs({
        client,
        serverId: "host",
        workspaceId: "workspace",
        workspaceKey,
        canSplitPanes: false,
        enabled: true,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    const focusedId = () => {
      const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!;
      return getFocusedBrowserId(layout);
    };
    expect(focusedId()).toBe(browserId);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(focusedId()).toBe(otherBrowserId);
    const focusedLayout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]).toBe(focusedLayout);

    const firstTab = collectAllTabs(focusedLayout!.root).find(
      (item) => item.target.kind === "browser" && item.target.browserId === browserId,
    )!;
    act(() => useWorkspaceLayoutStore.getState().focusTab(workspaceKey, firstTab.tabId));
    expect(focusedId()).toBe(browserId);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(focusedId()).toBe(otherBrowserId);
    hook.unmount();
  });

  it("projects page loading into a background tab until the host finishes", async () => {
    const tab = (isLoading: boolean) => ({
      browserId,
      workspaceId: "workspace",
      url: "https://example.com/",
      title: "Shared page",
      viewport: { mode: "responsive", width: 390, height: 844 },
      state: "ready",
      isLoading,
      error: null,
    });
    const remoteBrowserExecute = vi
      .fn()
      .mockResolvedValueOnce({ tabs: [tab(true)] })
      .mockResolvedValueOnce({ tabs: [tab(false)] });
    const client = { remoteBrowserExecute } as unknown as DaemonClient;
    const hook = renderHook(() =>
      useHostedBrowserTabs({
        client,
        serverId: "host",
        workspaceId: "workspace",
        workspaceKey,
        canSplitPanes: false,
        enabled: true,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(useBrowserStore.getState().browsersById[browserId]?.isLoading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(useBrowserStore.getState().browsersById[browserId]?.isLoading).toBe(false);
    hook.unmount();
  });

  it("adopts a preview tab with its server identity", async () => {
    const remoteBrowserExecute = vi.fn().mockResolvedValue({
      tabs: [
        {
          browserId,
          workspaceId: "workspace",
          url: "http://localhost:5173/",
          title: "App",
          viewport: { mode: "responsive", width: 390, height: 844 },
          state: "ready",
          error: null,
          preview: { serverId: "preview-1", serverName: "web", cwd: "/project" },
          layout: "split-right",
        },
      ],
    });
    const client = { remoteBrowserExecute } as unknown as DaemonClient;
    const hook = renderHook(() =>
      useHostedBrowserTabs({
        client,
        serverId: "host",
        workspaceId: "workspace",
        workspaceKey,
        canSplitPanes: false,
        enabled: true,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(useBrowserStore.getState().browsersById[browserId]).toMatchObject({
      renderMode: "hosted",
      isPreview: true,
      previewServerId: "preview-1",
      previewServerName: "web",
      previewCwd: "/project",
      previewStatus: "ready",
    });
    hook.unmount();
  });
});
