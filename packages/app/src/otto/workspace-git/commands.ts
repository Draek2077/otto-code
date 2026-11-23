import type { GitActions } from "@/git/policy";

/** Preserve Paseo's Command Center selection; add only Otto's explicit Fetch. */
export function workspaceGitCommands(actions: GitActions) {
  return [...actions.secondary, ...actions.menu.filter((action) => action.id === "fetch")];
}
