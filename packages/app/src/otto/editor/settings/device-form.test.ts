import { describe, expect, it, vi } from "vitest";
import { DeviceEditorForm, type DeviceEditorDraft } from "./device-form";
import {
  editorPreferenceDefaults,
  editorStoredPreferences,
  normalizeVimMappings,
} from "../preferences";

describe("device editor settings", () => {
  it("writes only owned preferences and preserves edits made while saving", async () => {
    let accept: (() => void) | undefined;
    const write = vi.fn(
      (_draft: DeviceEditorDraft) =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    const initial = {
      ...editorPreferenceDefaults,
      vimKeybindings: false,
      unrelated: "leave alone",
    };
    const model = new DeviceEditorForm(initial, write);
    model.activate();
    model.edit({ fileEditorMode: "vim" });
    const saving = model.save();
    expect(write.mock.calls[0]?.[0]).not.toHaveProperty("unrelated");
    expect(write.mock.calls[0]?.[0]).not.toHaveProperty("vimKeybindings");
    model.edit({ rulerEnabled: false });
    await model.save();
    expect(write).toHaveBeenCalledTimes(1);
    accept?.();
    await saving;
    expect(model.getSnapshot()).toMatchObject({
      dirty: true,
      pending: false,
      draft: { rulerEnabled: false },
    });
  });
  it("retains invalid mappings and rejected writes for correction", async () => {
    const write = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    const model = new DeviceEditorForm(editorPreferenceDefaults, write);
    model.activate();
    model.mapping("find", "s");
    await model.save();
    expect(write).not.toHaveBeenCalled();
    expect(model.getSnapshot().error).toContain("more than once");
    model.mapping("find", "ff");
    await model.save();
    expect(model.getSnapshot()).toMatchObject({
      dirty: true,
      pending: false,
      draft: { vimMappings: { mappings: { find: "ff" } } },
    });
    expect(model.getSnapshot().error).toContain("retained");
  });
  it("preserves legacy ruler clamping and mapping collision priority", () => {
    expect(editorStoredPreferences.rulerColumn.parse(300)).toBe(240);
    expect(editorStoredPreferences.rulerColumn.parse(1)).toBe(80);
    expect(editorStoredPreferences.rulerColumn.parse(null)).toBe(120);
    const mappings = normalizeVimMappings({ mappings: { save: "f", find: "ff" } }).mappings;
    expect(mappings.save).toBe("f");
    expect(mappings.find).toBe("ff");
  });
});
