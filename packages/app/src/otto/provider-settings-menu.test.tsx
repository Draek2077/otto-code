/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { push, installedPlugin, events } = vi.hoisted(() => ({
  push: vi.fn(),
  installedPlugin: vi.fn(),
  events: [] as string[],
}));
vi.mock("expo-router", () => ({ router: { push } }));
vi.mock("@/plugins/registry", () => ({ useInstalledPlugin: installedPlugin }));
vi.mock("@/components/settings", () => ({
  SettingsCard: ({ children }: React.PropsWithChildren) => <section>{children}</section>,
  SettingsRow: ({
    children,
    label,
    hint,
  }: React.PropsWithChildren<{ label: string; hint: string }>) => (
    <div>
      {label}
      {hint}
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: React.PropsWithChildren<{ onPress: () => void }>) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));

import { OttoProviderConfigurationAction } from "./provider-settings-menu";
import { resolveProviderLabel } from "@/utils/provider-definitions";

let container: HTMLDivElement;
let root: Root;
const close = () => events.push("close");
beforeEach(() => {
  vi.stubGlobal("React", React);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  events.length = 0;
  installedPlugin.mockImplementation((serverId: string) =>
    serverId === "selected-host" ? { settingsScreens: [{ id: "connection" }] } : null,
  );
  push.mockImplementation(() => events.push("navigate"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("opens the selected host's endpoint editor after dismissing the provider sheet", () => {
  act(() =>
    root.render(
      <OttoProviderConfigurationAction
        serverId="selected-host"
        provider="openai-compatible"
        hasModels={false}
        onOpen={close}
      />,
    ),
  );
  expect(container.textContent).toContain("Configure endpoint");
  act(() => container.querySelector("button")!.click());
  expect(events).toEqual(["close", "navigate"]);
  expect(push).toHaveBeenCalledWith({
    pathname: "/settings/hosts/[serverId]/plugins/[pluginId]/[screenId]",
    params: {
      serverId: "selected-host",
      pluginId: "otto-openai-compatible-provider",
      screenId: "connection",
    },
  });
});

it.each(["claude", "codex", "custom-openai"])(
  "does not redirect %s to another provider's editor",
  (provider) => {
    act(() =>
      root.render(
        <OttoProviderConfigurationAction
          serverId="selected-host"
          provider={provider}
          hasModels={false}
          onOpen={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toBe("");
  },
);

it("does not offer another host's settings when the target host lacks the editor", () => {
  act(() =>
    root.render(
      <OttoProviderConfigurationAction
        serverId="other-host"
        provider="openai-compatible"
        hasModels={false}
        onOpen={vi.fn()}
      />,
    ),
  );
  expect(installedPlugin).toHaveBeenCalledWith("other-host", "otto-openai-compatible-provider");
  expect(container.textContent).toBe("");
});

it("hides setup once the endpoint has discovered models", () => {
  act(() =>
    root.render(
      <OttoProviderConfigurationAction
        serverId="selected-host"
        provider="openai-compatible"
        hasModels
        onOpen={close}
      />,
    ),
  );
  expect(container.textContent).toBe("");
});

it("uses the friendly provider name even before its host snapshot arrives", () => {
  expect(resolveProviderLabel("openai-compatible", undefined)).toBe("OpenAI Compatible API");
  expect(resolveProviderLabel("custom-provider", undefined)).toBe("custom-provider");
});
