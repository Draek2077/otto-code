export interface StashRpcResult {
  error: { message: string } | null;
}

export interface StashSwitchPopOperations {
  saveStash: () => Promise<StashRpcResult>;
  switchBranch: () => Promise<{ ok: true } | { ok: false; message: string }>;
  popStash: () => Promise<StashRpcResult>;
}

export type StashSwitchPopResult =
  | { ok: true }
  | { ok: false; stage: "stash" | "switch" | "pop"; message: string };

/**
 * Carry the current working tree to another branch.
 *
 * A failed pop deliberately leaves the stash in place: that is Git's safe
 * conflict behavior, and the caller surfaces the error instead of risking the
 * user's changes by attempting a cleanup.
 */
export async function stashSwitchAndPop(
  operations: StashSwitchPopOperations,
): Promise<StashSwitchPopResult> {
  const stash = await operations.saveStash();
  if (stash.error) {
    return { ok: false, stage: "stash", message: stash.error.message };
  }

  const switched = await operations.switchBranch();
  if (!switched.ok) {
    return { ok: false, stage: "switch", message: switched.message };
  }

  const popped = await operations.popStash();
  if (popped.error) {
    return { ok: false, stage: "pop", message: popped.error.message };
  }

  return { ok: true };
}
