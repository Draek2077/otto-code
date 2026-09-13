// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { ProviderSettingsHost } from "./provider-settings-host";
vi.mock("react-native", () => ({
  View: "div",
  Text: "span",
  AccessibilityInfo: {},
  findNodeHandle: () => null,
}));
vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/components/ui/scroll-viewport-context", () => ({ useScrollViewport: () => null }));
vi.mock("@/lib/overlay-root", () => ({
  OverlayLayerProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/provider-diagnostic-sheet", async () => {
  const { useSettingsSearchRequest } = await import("@/screens/settings-search/target");
  return {
    ProviderDiagnosticSheet: ({ serverId, provider }: { serverId: string; provider: string }) => (
      <output data-testid="provider-request">
        {JSON.stringify({ serverId, provider, settingId: useSettingsSearchRequest() })}
      </output>
    ),
  };
});
afterEach(() => {
  cleanup();
  useProviderSettingsStore.setState({
    serverId: null,
    provider: null,
    settingId: null,
    visible: false,
    overlayParentLayer: 0,
  });
});
describe("outside-Settings provider request bridge", () => {
  it("carries only the explicit chosen entity request and cancels it when the sheet closes", () => {
    useProviderSettingsStore.getState().open({
      serverId: "selected",
      provider: "brain",
      settingId: "host-providers-agents-default-auto-compact",
    });
    render(<ProviderSettingsHost />);
    expect(JSON.parse(screen.getByTestId("provider-request").textContent!)).toEqual({
      serverId: "selected",
      provider: "brain",
      settingId: "host-providers-agents-default-auto-compact",
    });
    act(() => useProviderSettingsStore.getState().close());
    expect(JSON.parse(screen.getByTestId("provider-request").textContent!).settingId).toBeNull();
    act(() =>
      useProviderSettingsStore.getState().open({ serverId: "other", provider: "plugin:local" }),
    );
    expect(JSON.parse(screen.getByTestId("provider-request").textContent!)).toEqual({
      serverId: "other",
      provider: "plugin:local",
      settingId: null,
    });
  });
});
