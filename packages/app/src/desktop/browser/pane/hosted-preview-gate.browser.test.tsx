import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceBrowser, useBrowserStore } from "../store";
import { useHostedPreviewGate } from "./hosted-preview-gate";

const previewStart = vi.fn();
const previewBindTab = vi.fn(async () => undefined);
const settings = { previewAutoStartOnRestore: true };

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ previewStart, previewBindTab }),
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/hooks/use-settings", () => ({ useAppSettings: () => ({ settings }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));

function previewTab(previewStatus: "idle" | "starting" | "ready") {
  return createWorkspaceBrowser({
    renderMode: "hosted",
    isPreview: true,
    previewServerName: "web",
    previewCwd: "/project",
    previewStatus,
  }).browserId;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("hosted preview gate", () => {
  beforeEach(() => {
    useBrowserStore.setState({ browsersById: {} });
    previewStart.mockReset();
    previewBindTab.mockClear();
    settings.previewAutoStartOnRestore = true;
  });

  it("holds the pane while the server starts and releases it when ready", () => {
    const browserId = previewTab("starting");
    const hook = renderHook(() => useHostedPreviewGate({ browserId, serverId: "host" }));
    expect(hook.result.current.pending).toBe(true);
    expect(previewStart).not.toHaveBeenCalled();

    act(() =>
      useBrowserStore.getState().updateBrowser(browserId, {
        url: "http://localhost:5173/",
        previewStatus: "ready",
      }),
    );
    expect(hook.result.current.pending).toBe(false);
    expect(hook.result.current.overlay).toBeNull();
  });

  it("restarts a restored tab's server and binds the tab to it", async () => {
    previewStart.mockResolvedValue({
      success: true,
      server: { serverId: "preview-1", url: "http://localhost:5173/" },
    });
    const browserId = previewTab("idle");
    const hook = renderHook(() => useHostedPreviewGate({ browserId, serverId: "host" }));
    await settle();

    expect(previewStart).toHaveBeenCalledWith("/project", "web");
    expect(previewBindTab).toHaveBeenCalledWith("preview-1", browserId);
    expect(useBrowserStore.getState().browsersById[browserId]).toMatchObject({
      url: "http://localhost:5173/",
      previewServerId: "preview-1",
      previewStatus: "ready",
    });
    expect(hook.result.current.pending).toBe(false);
  });

  it("reports a failed start and waits for the user", async () => {
    previewStart.mockResolvedValue({ success: false, error: "port 5173 is in use" });
    const browserId = previewTab("idle");
    const hook = renderHook(() => useHostedPreviewGate({ browserId, serverId: "host" }));
    await settle();

    expect(useBrowserStore.getState().browsersById[browserId]).toMatchObject({
      previewStatus: "error",
      lastError: "port 5173 is in use",
    });
    expect(hook.result.current.pending).toBe(true);
  });

  it("leaves a restored tab stopped when auto-start is off", async () => {
    settings.previewAutoStartOnRestore = false;
    const browserId = previewTab("idle");
    renderHook(() => useHostedPreviewGate({ browserId, serverId: "host" }));
    await settle();

    expect(previewStart).not.toHaveBeenCalled();
    expect(useBrowserStore.getState().browsersById[browserId]?.previewStatus).toBe("needs-start");
  });
});
