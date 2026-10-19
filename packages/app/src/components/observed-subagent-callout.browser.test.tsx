import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ProviderSubagentDescriptorPayload } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { providerSubagentKey, useProviderSubagentStore } from "@/subagents/provider-store";
import { useConfirmDialogStore } from "@/utils/confirm-dialog";
import { ToastProvider } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { ProviderSubagentCallout } from "./observed-subagent-callout";

// The transport and mobile keyboard are outside this component journey. Keep
// the real provider control hook, stores, translations, buttons and toast UI.
const connection = vi.hoisted(() => ({ connected: true }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => connection.connected,
  useHostRuntimeClient: () => null,
}));
vi.mock("@/hooks/use-keyboard-shift-style", () => ({
  useKeyboardShiftStyle: () => ({ style: {} }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const control = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const stopObserved = vi.fn();
let root: Root;
let container: HTMLDivElement;
const descriptor: ProviderSubagentDescriptorPayload = {
  id: "child-thread",
  parentAgentId: "parent-chat",
  provider: "codex",
  title: "Operator",
  description: null,
  status: "running",
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  toolCallId: "spawn",
  stopScope: "child",
};

function updateDescriptor(patch: Partial<ProviderSubagentDescriptorPayload> = {}) {
  act(() =>
    useProviderSubagentStore
      .getState()
      .replaceList("host", "parent-chat", [{ ...descriptor, ...patch }]),
  );
}

function renderCallout() {
  act(() =>
    root.render(
      <ToastProvider>
        <ProviderSubagentCallout
          serverId="host"
          parentAgentId="parent-chat"
          subagentId="child-thread"
        />
      </ToastProvider>,
    ),
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  connection.connected = true;
  control.mockReset().mockResolvedValue(undefined);
  stopObserved.mockReset();
  useSessionStore.getState().initializeSession("host", {
    controlProviderSubagent: control,
    stopObservedSubagent: stopObserved,
  } as unknown as DaemonClient);
  useSessionStore.getState().updateSessionServerInfo("host", {
    serverId: "host",
    hostname: null,
    version: "0.9.34",
    features: { providerSubagentControl: true },
  });
  updateDescriptor();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSessionStore.getState().clearSession("host");
  useProviderSubagentStore.setState({ descriptors: new Map(), timelines: new Map() });
  useConfirmDialogStore.setState({ queue: [] });
});

describe("provider subagent read-only callout", () => {
  it.each([390, 1280])(
    "shows ownership and no composer at %s px; Stop uses provider control",
    async (width) => {
      await page.viewport(width, 844);
      renderCallout();
      expect(container.textContent).toContain("Observed subagent · read-only");
      expect(container.textContent).toContain("Controlled by parent chat: parent-chat");
      expect(container.querySelector("textarea,input,[contenteditable=true]")).toBeNull();
      const bounds = container
        .querySelector('[data-testid="observed-subagent-callout"]')!
        .getBoundingClientRect();
      expect(bounds.right).toBeLessThanOrEqual(width);
      await page.getByRole("button", { name: "Stop subagent" }).click();
      expect(control).toHaveBeenCalledExactlyOnceWith("parent-chat", "child-thread", "stop", false);
      expect(stopObserved).not.toHaveBeenCalled();
      updateDescriptor({ status: "completed" });
      expect(container.querySelector('[role="button"]')).toBeNull();
      expect(container.textContent).toContain("Observed subagent · read-only");
    },
  );

  it("hides Stop on hosts without control and disables it on disconnect", () => {
    useSessionStore.getState().updateSessionServerInfo("host", {
      serverId: "host",
      hostname: null,
      version: "old",
      features: {},
    });
    renderCallout();
    expect(container.querySelector('[role="button"]')).toBeNull();
    useSessionStore.getState().updateSessionServerInfo("host", {
      serverId: "host",
      hostname: null,
      version: "new",
      features: { providerSubagentControl: true },
    });
    connection.connected = false;
    renderCallout();
    expect(container.querySelector('[role="button"]')?.getAttribute("aria-disabled")).toBe("true");
    expect(control).not.toHaveBeenCalled();
  });

  it("waits for existing parent-session confirmation and respects cancellation", async () => {
    updateDescriptor({ stopScope: "parent" });
    renderCallout();
    await page.getByRole("button", { name: "Stop subagent" }).click();
    expect(control).not.toHaveBeenCalled();
    expect(useConfirmDialogStore.getState().queue[0]).toMatchObject({
      title: i18n.t("subagents.stopParentTitle"),
      message: i18n.t("subagents.stopParentMessage"),
      destructive: true,
    });
    await act(async () =>
      useConfirmDialogStore
        .getState()
        .resolveActive({ confirmed: false, checkboxChecked: false, choice: "cancel" }),
    );
    expect(control).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Stop subagent" }).click();
    await act(async () =>
      useConfirmDialogStore
        .getState()
        .resolveActive({ confirmed: true, checkboxChecked: false, choice: "confirm" }),
    );
    expect(control).toHaveBeenCalledExactlyOnceWith("parent-chat", "child-thread", "stop", true);
  });

  it("prevents duplicate Stop and shows a rejected operation for retry", async () => {
    let rejectStop: (error: Error) => void = () => {};
    control.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStop = reject;
        }),
    );
    renderCallout();
    await page.getByRole("button", { name: "Stop subagent" }).click();
    expect(container.querySelector('[role="button"]')?.getAttribute("aria-disabled")).toBe("true");
    expect(control).toHaveBeenCalledTimes(1);
    await act(async () => rejectStop(new Error("Stop rejected by provider")));
    await expect
      .element(page.getByText("Stop rejected by provider", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Stop subagent" }).click();
    expect(control).toHaveBeenCalledTimes(2);
    expect(
      useProviderSubagentStore
        .getState()
        .descriptors.get(providerSubagentKey("host", "parent-chat", "child-thread"))?.status,
    ).toBe("running");
  });
});
