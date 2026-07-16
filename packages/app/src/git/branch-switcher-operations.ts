import type { DaemonClient } from "@otto-code/client/internal/daemon-client";

// Binds the branch switcher's git operations to a single workspace directory, so a
// workspace id can never be passed where a cwd is expected. `cwd` is set once here;
// callers choose the operation, never the directory.
export function createBranchSwitcherOperations(client: DaemonClient, cwd: string) {
  return {
    getBranchSuggestions: (limit: number) => client.getBranchSuggestions({ cwd, limit }),
    listOttoStashes: () => client.stashList(cwd, { ottoOnly: true }),
    saveStash: (branch: string | undefined) => client.stashSave(cwd, { branch }),
    popStash: (stashIndex: number) => client.stashPop(cwd, stashIndex),
    // The branch switch itself lives in the checkout-actions store
    // (useCheckoutGitActionsStore.switchBranch) so its pending state is shared
    // with the rest of the git UI.
  };
}

export type BranchSwitcherOperations = ReturnType<typeof createBranchSwitcherOperations>;
