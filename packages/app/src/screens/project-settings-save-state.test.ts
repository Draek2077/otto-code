import { describe, expect, it, vi } from "vitest";
import { combineProjectFormSaveStates } from "./project-settings-save-state";

describe("combineProjectFormSaveStates", () => {
  it("enables Save and invokes each dirty draft", () => {
    const saveConfig = vi.fn();
    const saveLinks = vi.fn();
    const saveKanban = vi.fn();
    const state = combineProjectFormSaveStates([
      { isDirty: true, isSaving: false, canSave: true, save: saveConfig },
      { isDirty: true, isSaving: false, canSave: true, save: saveLinks },
      { isDirty: false, isSaving: false, canSave: false, save: saveKanban },
    ]);

    expect(state).toMatchObject({ isDirty: true, isSaving: false, canSave: true });
    state?.save();
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(saveLinks).toHaveBeenCalledOnce();
    expect(saveKanban).not.toHaveBeenCalled();
  });

  it("disables Save while a dirty draft is invalid or saving", () => {
    const state = combineProjectFormSaveStates([
      { isDirty: true, isSaving: false, canSave: false, save: vi.fn() },
      { isDirty: true, isSaving: true, canSave: true, save: vi.fn() },
    ]);

    expect(state).toMatchObject({ isDirty: true, isSaving: true, canSave: false });
  });
});
