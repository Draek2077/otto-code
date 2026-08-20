export interface ProjectFormSaveState {
  isDirty: boolean;
  isSaving: boolean;
  canSave: boolean;
  save: () => void;
}

/** Combines independently mounted Project Settings drafts behind one Save button. */
export function combineProjectFormSaveStates(
  states: readonly (ProjectFormSaveState | null)[],
): ProjectFormSaveState | null {
  const available = states.filter((state): state is ProjectFormSaveState => state !== null);
  if (available.length === 0) return null;

  const dirty = available.filter((state) => state.isDirty);
  const isSaving = available.some((state) => state.isSaving);
  return {
    isDirty: dirty.length > 0,
    isSaving,
    canSave: dirty.length > 0 && !isSaving && dirty.every((state) => state.canSave),
    save: () => {
      for (const state of dirty) {
        state.save();
      }
    },
  };
}
