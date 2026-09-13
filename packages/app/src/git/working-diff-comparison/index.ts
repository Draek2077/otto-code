import { useCallback } from "react";
import { create } from "zustand";
import {
  resolveWorkingDiffComparisonFromState,
  selectWorkingDiffComparisonInState,
  type WorkingDiffCheckoutIdentity,
  type WorkingDiffComparison,
  type WorkingDiffComparisonState,
} from "./state";

interface WorkingDiffComparisonStore extends WorkingDiffComparisonState {
  select: (
    input: WorkingDiffCheckoutIdentity & {
      comparison: WorkingDiffComparison;
    },
  ) => void;
}

const useWorkingDiffComparisonStore = create<WorkingDiffComparisonStore>((set) => ({
  overrides: {},
  select: (input) => set((state) => selectWorkingDiffComparisonInState(state, input)),
}));

export function useWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): {
  comparison: WorkingDiffComparison;
  selectComparison: (comparison: WorkingDiffComparison) => void;
} {
  const { serverId, workspaceId, cwd, isDirty, modeScope } = input;
  const comparison = useWorkingDiffComparisonStore((state) =>
    resolveWorkingDiffComparisonFromState(state, {
      serverId,
      workspaceId,
      cwd,
      isDirty,
      modeScope,
    }),
  );
  const select = useWorkingDiffComparisonStore((state) => state.select);
  const selectComparison = useCallback(
    (next: WorkingDiffComparison) =>
      select({ serverId, workspaceId, cwd, modeScope, comparison: next }),
    [cwd, modeScope, select, serverId, workspaceId],
  );
  return { comparison, selectComparison };
}

export function selectWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & {
    comparison: WorkingDiffComparison;
  },
): void {
  useWorkingDiffComparisonStore.getState().select(input);
}

export function resolveWorkingDiffComparison(
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): WorkingDiffComparison {
  return resolveWorkingDiffComparisonFromState(useWorkingDiffComparisonStore.getState(), input);
}

export function resetWorkingDiffComparisons(): void {
  useWorkingDiffComparisonStore.setState({ overrides: {} });
}
