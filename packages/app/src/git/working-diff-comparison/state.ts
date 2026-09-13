import { withOttoComparisonScope } from "../otto/comparison-scope";

export type WorkingDiffComparison = "uncommitted" | "base";

export interface WorkingDiffComparisonOverride {
  comparison: WorkingDiffComparison;
}

export interface WorkingDiffComparisonState {
  overrides: Record<string, WorkingDiffComparisonOverride>;
}

export interface WorkingDiffCheckoutIdentity {
  /** Otto allows an independent manual selection for each Changes surface. */
  modeScope?: string;
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}

function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "");
}

export function workingDiffComparisonKey(input: WorkingDiffCheckoutIdentity): string {
  const workspaceId = input.workspaceId?.trim();
  const checkout = workspaceId
    ? `workspace=${encodeURIComponent(workspaceId)}`
    : `cwd=${encodeURIComponent(normalizeCwd(input.cwd))}`;
  return withOttoComparisonScope(
    `working-diff:server=${encodeURIComponent(input.serverId.trim())}:${checkout}`,
    input.modeScope,
  );
}

export function selectWorkingDiffComparisonInState(
  state: WorkingDiffComparisonState,
  input: WorkingDiffCheckoutIdentity & {
    comparison: WorkingDiffComparison;
  },
): WorkingDiffComparisonState {
  return {
    overrides: {
      ...state.overrides,
      [workingDiffComparisonKey(input)]: {
        comparison: input.comparison,
      },
    },
  };
}

export function resolveWorkingDiffComparisonFromState(
  state: WorkingDiffComparisonState,
  input: WorkingDiffCheckoutIdentity & { isDirty: boolean },
): WorkingDiffComparison {
  const override = state.overrides[workingDiffComparisonKey(input)];
  // Manual comparison is a reader choice, not an inference from live dirtiness.
  // A commit may empty Uncommitted, but must not switch the reader to Base.
  if (override) return override.comparison;
  return input.isDirty ? "uncommitted" : "base";
}
