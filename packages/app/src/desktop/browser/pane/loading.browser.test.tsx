import React, { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { BrowserPane } from "./index.electron";
import { browserPanelRegistration } from "../panel";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-icon";
import { useBrowserStore } from "../store";
import { withBrowserAutomationFocus } from "../automation/focus-guard.web";
import {
  clearResidentBrowserWebviewsForTests,
  ensureResidentBrowserWebview,
} from "../resident-webviews";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

// Only the surrounding app services and Electron methods are substituted.
// The pane, resident lifecycle, store, descriptor, toolbar and tab icon are real.
vi.mock("@/desktop/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/desktop/host")>()),
  isElectronRuntime: () => true,
  getDesktopHost: () => ({
    browser: {
      profilePartition: "persist:otto-browser-test",
      registerAttachedBrowser: async () => {},
    },
  }),
}));
vi.mock("@/hooks/use-settings", () => ({ useAppSettings: () => ({ settings: {} }) }));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));
vi.mock("@/stores/session-store-hooks", () => ({ useWorkspaceDirectory: () => null }));
vi.mock("@/attachments/workspace-attachments-store", () => {
  const attachments: never[] = [];
  return {
    buildWorkspaceAttachmentScopeKey: () => "workspace",
    useWorkspaceAttachments: () => attachments,
    useWorkspaceAttachmentsStore: () => () => {},
  };
});
vi.mock("@/attachments/service", () => ({ persistAttachmentFromDataUrl: async () => null }));
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => {} }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

type Guest = HTMLElement & {
  reload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
};
let container: HTMLDivElement;
let root: Root;
let browserId: string;
let guest: Guest;
const reloadLabel = "workspace.browser.controls.refresh";
const stopLabel = "workspace.browser.controls.stopLoading";

function BrowserTab({ pane = true }: { pane?: boolean }) {
  const descriptor = browserPanelRegistration.useDescriptor(
    { kind: "browser", browserId },
    { serverId: "host", workspaceId: "workspace", tabId: "tab" },
  );
  const presentation = useMemo<WorkspaceTabPresentation>(
    () => ({
      ...descriptor,
      key: "tab",
      kind: "browser",
      subtitle: descriptor.subtitle ?? "",
    }),
    [descriptor],
  );
  return (
    <>
      <span data-testid="tab-title">{descriptor.label}</span>
      <div data-testid="tab-icon">
        <WorkspaceTabIcon presentation={presentation} />
      </div>
      {pane && (
        <BrowserPane browserId={browserId} serverId="host" workspaceId="workspace" cwd={null} />
      )}
    </>
  );
}

function button(label: string): HTMLElement | null {
  return container.querySelector(`[role="button"][aria-label="${label}"]`);
}

function expectLoading(loading: boolean) {
  expect(button(loading ? stopLabel : reloadLabel)).not.toBeNull();
  expect(button(loading ? reloadLabel : stopLabel)).toBeNull();
  expect(container.querySelector('[data-testid="tab-icon"] [role="progressbar"]') !== null).toBe(
    loading,
  );
}

function navigateTo(url: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="workspace.browser.controls.browserUrl"]',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
    ),
  );
}

beforeEach(async () => {
  await useBrowserStore.persist.rehydrate();
  useBrowserStore.setState({ browsersById: {} });
  browserId = useBrowserStore.getState().createBrowser({ initialUrl: "https://example.com" });
  guest = ensureResidentBrowserWebview({
    browserId,
    workspaceId: "workspace",
    url: "https://example.com",
  }) as Guest;
  guest.reload = vi.fn();
  guest.stop = vi.fn(() => guest.dispatchEvent(new Event("did-stop-loading")));
  guest.loadURL = vi.fn(async () => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearResidentBrowserWebviewsForTests();
  useBrowserStore.setState({ browsersById: {} });
});

describe("browser loading controls", () => {
  it("keeps the device menu open while automation focuses the guest and updates loading", async () => {
    act(() =>
      root.render(
        <>
          <ReducedMotionConfig mode={ReduceMotion.Always} />
          <BrowserTab />
        </>,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLElement>('[aria-label="workspace.browser.devices.label"]')!
        .click(),
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-menu-item="true"]')).not.toBeNull();
    });
    const menuItem = document.querySelector<HTMLElement>('[data-menu-item="true"]')!;
    menuItem.focus();
    guest.tabIndex = 0;
    const automate = async () => {
      guest.focus();
      guest.dispatchEvent(new Event("did-start-loading"));
      guest.dispatchEvent(new Event("did-stop-loading"));
    };
    await act(() => withBrowserAutomationFocus(browserId, automate));
    expect(menuItem.isConnected).toBe(true);
    expect(document.activeElement).toBe(menuItem);
  });

  it("reads the current guest title when reopening and persists the completed page title", async () => {
    guest.dispatchEvent(new Event("dom-ready"));
    let title = "A page loaded before the pane opened";
    Object.assign(guest, { getTitle: () => title });
    act(() => root.render(<BrowserTab />));
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe(title);
    title = "The final website title";
    act(() => guest.dispatchEvent(new Event("did-stop-loading")));
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe(title);
    const stored = await useBrowserStore.persist
      .getOptions()
      .storage?.getItem("workspace-browser-store");
    expect(stored?.state.browsersById[browserId].title).toBe(title);
  });

  it("falls back to the hostname only when the page clears its title", () => {
    act(() => root.render(<BrowserTab />));
    act(() =>
      guest.dispatchEvent(
        Object.assign(new Event("page-title-updated"), { title: "Website title" }),
      ),
    );
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe("Website title");
    act(() => guest.dispatchEvent(Object.assign(new Event("page-title-updated"), { title: "" })));
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe("example.com");
  });

  it("shows the page title received before pane mount and tracks background title changes", () => {
    guest.dispatchEvent(
      Object.assign(new Event("page-title-updated"), { title: "Otto Documentation" }),
    );
    act(() => root.render(<BrowserTab />));
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe(
      "Otto Documentation",
    );
    act(() => root.render(<BrowserTab pane={false} />));
    act(() =>
      guest.dispatchEvent(
        Object.assign(new Event("page-title-updated"), { title: "Getting Started - Otto" }),
      ),
    );
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe(
      "Getting Started - Otto",
    );
    act(() => root.render(<BrowserTab />));
    expect(container.querySelector('[data-testid="tab-title"]')?.textContent).toBe(
      "Getting Started - Otto",
    );
  });

  it("shows progress immediately on reload and Stop cancels in the same tab", () => {
    guest.dispatchEvent(new Event("dom-ready"));
    act(() => root.render(<BrowserTab />));
    expectLoading(false);
    act(() => button(reloadLabel)!.click());
    expect(guest.reload).toHaveBeenCalledTimes(1);
    expectLoading(true);
    act(() => guest.dispatchEvent(new Event("did-start-loading")));
    act(() => button(stopLabel)!.click());
    expect(guest.stop).toHaveBeenCalledTimes(1);
    expectLoading(false);
    act(() => button(reloadLabel)!.click());
    expectLoading(true);
    act(() => guest.dispatchEvent(new Event("dom-ready")));
    expectLoading(true);
    act(() => guest.dispatchEvent(new Event("did-stop-loading")));
    expectLoading(false);
    expect(guest.isConnected).toBe(true);
  });

  it("reflects background loads when mounting and completes while the pane is absent", () => {
    guest.dispatchEvent(new Event("did-start-loading"));
    guest.dispatchEvent(new Event("dom-ready"));
    act(() => root.render(<BrowserTab />));
    expectLoading(true);
    act(() => root.render(<BrowserTab pane={false} />));
    act(() => guest.dispatchEvent(new Event("did-stop-loading")));
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    act(() => root.render(<BrowserTab />));
    expectLoading(false);
  });

  it("navigates in the same tab after stopping a load that never reached DOM ready", () => {
    guest.dispatchEvent(new Event("dom-ready"));
    act(() => root.render(<BrowserTab />));
    act(() => guest.dispatchEvent(new Event("did-start-loading")));
    act(() => button(stopLabel)!.click());
    expectLoading(false);
    navigateTo("https://example.com/recovered");
    expect(guest.loadURL).toHaveBeenCalledWith("https://example.com/recovered");
    expectLoading(true);
    act(() => guest.dispatchEvent(new Event("did-stop-loading")));
    expectLoading(false);
    expect(guest.isConnected).toBe(true);
  });

  it("replaces a stalled first request without waiting for its DOM ready", () => {
    guest.dispatchEvent(new Event("did-start-loading"));
    act(() => root.render(<BrowserTab />));
    navigateTo("https://example.com/recovered");
    expect(guest.getAttribute("src")).toBe("https://example.com/recovered");
    expect(guest.loadURL).not.toHaveBeenCalled();
    expectLoading(true);
    act(() => button(stopLabel)!.click());
    act(() => guest.dispatchEvent(new Event("dom-ready")));
    expect(guest.loadURL).not.toHaveBeenCalled();
    expectLoading(false);
  });

  it("shows a failed page above the guest with clickable Reload and permits retry", async () => {
    container.style.cssText =
      "position:fixed;left:0;top:0;width:360px;height:300px;display:flex;flex-direction:column;z-index:0";
    guest.dispatchEvent(new Event("dom-ready"));
    act(() => root.render(<BrowserTab />));
    act(() => button(reloadLabel)!.click());
    act(() =>
      guest.dispatchEvent(
        Object.assign(new Event("did-fail-load"), {
          errorCode: -102,
          errorDescription: "ERR_CONNECTION_REFUSED",
          isMainFrame: true,
        }),
      ),
    );
    expectLoading(false);
    const overlayRoot = document.getElementById("overlay-root")!;
    expect(overlayRoot.textContent).toContain("workspace.browser.errors.connectionRefused");
    const retry = overlayRoot.querySelector<HTMLElement>('[role="button"]')!;
    await expect
      .poll(() => {
        const rect = retry.getBoundingClientRect();
        return retry.contains(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
        );
      })
      .toBe(true);
    act(() => retry.click());
    expectLoading(true);
    expect(overlayRoot.textContent).not.toContain("workspace.browser.errors.connectionRefused");
  });

  it("does not let a stopped request rejection clear progress for the next navigation", async () => {
    let rejectLoad!: (reason: Error) => void;
    guest.loadURL.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    guest.dispatchEvent(new Event("dom-ready"));
    act(() => root.render(<BrowserTab />));
    navigateTo("https://example.com/old");
    act(() => button(stopLabel)!.click());
    navigateTo("https://example.com/new");
    await act(async () => rejectLoad(new Error("ERR_CONNECTION_REFUSED")));
    expectLoading(true);
    expect(container.textContent).not.toContain("workspace.browser.errors.connectionRefused");
  });

  it("settles synchronous guest navigation failures and leaves the tab retryable", () => {
    guest.dispatchEvent(new Event("dom-ready"));
    guest.loadURL.mockImplementationOnce(() => {
      throw new Error("GUEST_VIEW_MANAGER_CALL failed");
    });
    act(() => root.render(<BrowserTab />));
    navigateTo("https://example.com/recovered");
    expectLoading(false);
    expect(document.getElementById("overlay-root")!.textContent).toContain(
      "workspace.browser.errors.failedToLoad",
    );
    act(() => button(reloadLabel)!.click());
    expectLoading(true);
    expect(guest.reload).toHaveBeenCalledTimes(1);
  });
});
