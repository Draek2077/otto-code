import { afterEach, describe, expect, it } from "vitest";
import { useProviderSettingsStore } from "./provider-settings-store";

describe("provider settings store", () => {
  afterEach(() => {
    useProviderSettingsStore.setState({
      serverId: null,
      provider: null,
      overlayParentLayer: 0,
      settingId: null,
      visible: false,
    });
  });

  it("carries the opener layer without leaking it into later base-level opens", () => {
    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "codex",
      overlayParentLayer: 30,
    });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(30);

    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "claude",
    });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(0);
  });
  it("keeps the chosen host/provider and request together, then clears search on an ordinary open", () => {
    const { open, close } = useProviderSettingsStore.getState();
    open({
      serverId: "chosen-host",
      provider: "brain",
      settingId: "host-providers-agents-default-auto-compact",
    });
    expect(useProviderSettingsStore.getState()).toMatchObject({
      serverId: "chosen-host",
      provider: "brain",
      settingId: "host-providers-agents-default-auto-compact",
      visible: true,
    });
    close();
    expect(useProviderSettingsStore.getState().visible).toBe(false);
    open({ serverId: "other-host", provider: "plugin:custom" });
    expect(useProviderSettingsStore.getState()).toMatchObject({
      serverId: "other-host",
      provider: "plugin:custom",
      settingId: null,
      visible: true,
    });
  });
});
