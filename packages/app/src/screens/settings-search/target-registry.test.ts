import { describe, expect, it, vi } from "vitest";
import { SettingsTargetRegistry } from "./target-registry";
// Drain the whole promise chain, independent of the number of async focus steps.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Settings target requests", () => {
  it("waits for async row registration and focuses only once", async () => {
    const registry = new SettingsTargetRegistry();
    registry.request("row");
    const focus = vi.fn(() => true);
    registry.register("row", { focus });
    await flush();
    registry.layout();
    await flush();
    expect(focus).toHaveBeenCalledOnce();
  });
  it("retries a not-yet-visible row on layout instead of polling", async () => {
    const registry = new SettingsTargetRegistry();
    const focus = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    registry.register("row", { focus });
    registry.request("row");
    await flush();
    expect(focus).toHaveBeenCalledTimes(1);
    registry.layout();
    await flush();
    expect(focus).toHaveBeenCalledTimes(2);
  });
  it("opens an explicitly registered nested editor and waits for its row", async () => {
    const registry = new SettingsTargetRegistry();
    const reveal = vi.fn();
    registry.request("nested");
    registry.registerReveal(["nested"], reveal);
    registry.layout();
    expect(reveal).toHaveBeenCalledOnce();
    const focus = vi.fn(() => true);
    registry.register("nested", { focus });
    await flush();
    expect(focus).toHaveBeenCalledOnce();
  });
  it("does not focus an old request after navigation changes", async () => {
    const registry = new SettingsTargetRegistry();
    const old = vi.fn(() => true),
      current = vi.fn(() => true);
    registry.register("old", { focus: old });
    registry.register("current", { focus: current });
    registry.request("old");
    registry.request("current");
    await flush();
    await flush();
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });
  it("unregisters abandoned editors and waits for their replacement", async () => {
    const registry = new SettingsTargetRegistry();
    const abandoned = vi.fn(() => true),
      replacement = vi.fn(() => true);
    const unregister = registry.register("row", { focus: abandoned });
    unregister();
    registry.request("row");
    await flush();
    expect(abandoned).not.toHaveBeenCalled();
    registry.register("row", { focus: replacement });
    await flush();
    expect(replacement).toHaveBeenCalledOnce();
  });
  it("releases a native measurement that never answers after its editor unmounts", async () => {
    const registry = new SettingsTargetRegistry();
    const unregister = registry.register("row", { focus: () => new Promise<boolean>(() => {}) });
    registry.request("row");
    await flush();
    unregister();
    const replacement = vi.fn(() => true);
    registry.register("row", { focus: replacement });
    await flush();
    await flush();
    expect(replacement).toHaveBeenCalledOnce();
  });
  it("skips hidden collection rows and chooses the first real visible target", async () => {
    const registry = new SettingsTargetRegistry();
    const hidden = vi.fn(() => false),
      visible = vi.fn(() => true);
    registry.register("row", { focus: hidden });
    registry.register("row", { focus: visible });
    registry.request("row");
    await flush();
    await flush();
    expect(hidden).toHaveBeenCalledOnce();
    expect(visible).toHaveBeenCalledOnce();
  });
  it("reveals a retained hidden panel even when its row is already registered", async () => {
    const registry = new SettingsTargetRegistry();
    let visible = false;
    const focus = vi.fn(() => visible);
    const reveal = vi.fn(() => {
      visible = true;
      registry.layout();
    });
    registry.register("row", { focus });
    registry.registerReveal(["row"], reveal);
    registry.request("row");
    await flush();
    await flush();
    await flush();
    expect(reveal).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledTimes(2);
  });
  it("invalidates a canceled attempt even when an unrelated row caused cancellation", async () => {
    const registry = new SettingsTargetRegistry();
    const validity: Array<() => boolean> = [];
    registry.register("row", {
      focus: (isCurrent) => {
        validity.push(isCurrent);
        return validity.length === 1 ? new Promise<boolean>(() => {}) : true;
      },
    });
    const removeUnrelated = registry.register("unrelated", { focus: () => true });
    registry.request("row");
    await flush();
    expect(validity[0]?.()).toBe(true);
    removeUnrelated();
    await flush();
    expect(validity).toHaveLength(2);
    expect(validity[0]?.()).toBe(false);
    expect(validity[1]?.()).toBe(true);
  });
});
