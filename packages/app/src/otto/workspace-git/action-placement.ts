import type { GitAction, GitActions } from "@/git/policy";

/** Fetch belongs with Pull/Push in the existing split button, not a second menu. */
export function withManualFetch(actions: GitActions, fetch: GitAction | null): GitActions {
  if (!fetch) return actions;
  return actions.primary
    ? { ...actions, secondary: [...actions.secondary, fetch] }
    : { ...actions, primary: fetch };
}
