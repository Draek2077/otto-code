// @vitest-environment jsdom
// The review draft store persists through AsyncStorage's web shim, which needs window.
import "@/test/window-local-storage";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutStatusUpdate } from "@otto-code/protocol/messages";
import { checkoutPrStatusQueryKey, checkoutStatusQueryKey } from "@/git/query-keys";
import { prPaneTimelineQueryKey } from "@/git/pull-request-panel/query-keys";
import { resetReviewDraftStore, useReviewDraftStore } from "@/review/store";
import {
  applyCheckoutStatusUpdateFromEvent,
  ensureCheckoutStatus,
  type CheckoutPrStatusPayload,
  type CheckoutStatusPayload,
  fetchCheckoutStatus,
  reconcileCheckoutStatusWithUncommittedDiff,
} from "./checkout-status-cache";

const serverId = "server-1";
const cwd = "/repo";

function checkoutStatus(overrides: Partial<CheckoutStatusPayload> = {}): CheckoutStatusPayload {
  return {
    cwd,
    error: null,
    requestId: "checkout-status-1",
    isGit: true,
    isOttoOwnedWorktree: false,
    repoRoot: cwd,
    currentBranch: "main",
    isDirty: false,
    baseRef: "origin/main",
    aheadBehind: { ahead: 0, behind: 0 },
    aheadOfOrigin: 0,
    behindOfOrigin: 0,
    hasRemote: true,
    remoteUrl: "git@github.com:otto-code-ai/otto-code.git",
    ...overrides,
  } as CheckoutStatusPayload;
}

function notGitStatus(overrides: Partial<CheckoutStatusPayload> = {}): CheckoutStatusPayload {
  return {
    ...checkoutStatus(),
    isGit: false,
    repoRoot: null,
    currentBranch: null,
    isDirty: null,
    baseRef: null,
    aheadBehind: null,
    aheadOfOrigin: null,
    behindOfOrigin: null,
    hasRemote: false,
    remoteUrl: null,
    ...overrides,
  } as CheckoutStatusPayload;
}

function prStatus(overrides: Partial<CheckoutPrStatusPayload> = {}): CheckoutPrStatusPayload {
  return {
    cwd,
    status: {
      forge: "github",
      url: "https://github.com/otto-code-ai/otto-code/pull/42",
      title: "My PR",
      state: "open",
      baseRefName: "main",
      headRefName: "feature",
      isMerged: false,
      isDraft: false,
      mergeable: "MERGEABLE",
      checks: [],
      checksStatus: "success",
      reviewDecision: null,
    },
    githubFeaturesEnabled: true,
    error: null,
    requestId: "pr-status-1",
    ...overrides,
  } as CheckoutPrStatusPayload;
}

function checkoutStatusUpdate(
  payload: CheckoutStatusPayload,
  extraPrStatus?: CheckoutPrStatusPayload,
  meta: { prStatusOnly?: boolean } = {},
): CheckoutStatusUpdate {
  return {
    type: "checkout_status_update",
    payload: {
      ...payload,
      prStatusOnly: meta.prStatusOnly ?? false,
      ...(extraPrStatus ? { prStatus: extraPrStatus } : {}),
    },
  } as CheckoutStatusUpdate;
}

function setDiffModeOverride(isDirtyAtSelection: boolean): void {
  useReviewDraftStore.getState().setDiffModeOverride({
    scopeKey: "review:scope",
    override: { serverId, cwd, mode: "base", isDirtyAtSelection },
  });
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  resetReviewDraftStore();
});

describe("fetchCheckoutStatus", () => {
  it("fetches from the client and returns the payload", async () => {
    const fetched = checkoutStatus({ requestId: "fetch-1" });
    const client = { getCheckoutStatus: vi.fn(async () => fetched) };

    const result = await fetchCheckoutStatus({ client, serverId, cwd });

    expect(result).toEqual(fetched);
    expect(client.getCheckoutStatus).toHaveBeenCalledExactlyOnceWith(cwd);
  });

  it("preserves a manual diff-mode override when the fetched dirty state flipped", async () => {
    setDiffModeOverride(true);
    const client = { getCheckoutStatus: vi.fn(async () => checkoutStatus({ isDirty: false })) };

    await fetchCheckoutStatus({ client, serverId, cwd });

    expect(useReviewDraftStore.getState().diffModeOverrides["review:scope"]).toBeDefined();
  });

  it("rejects a failed measurement instead of caching it as a non-git checkout", async () => {
    const client = {
      getCheckoutStatus: vi.fn(async () =>
        notGitStatus({ error: { code: "UNKNOWN", message: "Git command timed out" } }),
      ),
    };

    await expect(fetchCheckoutStatus({ client, serverId, cwd })).rejects.toThrow(
      "Git command timed out",
    );
  });

  it("rejects a not-git error until repository discovery returns an error-free snapshot", async () => {
    const answered = notGitStatus({ error: { code: "NOT_GIT_REPO", message: "not a repo" } });
    const client = { getCheckoutStatus: vi.fn(async () => answered) };

    await expect(fetchCheckoutStatus({ client, serverId, cwd })).rejects.toThrow("not a repo");
  });

  it("returns an error-free non-git snapshot as the conclusive answer", async () => {
    const answered = notGitStatus();
    const client = { getCheckoutStatus: vi.fn(async () => answered) };

    await expect(fetchCheckoutStatus({ client, serverId, cwd })).resolves.toEqual(answered);
  });
});

describe("ensureCheckoutStatus", () => {
  it("awaits the canonical checkout-status query and reuses its cached result", async () => {
    const queryClient = createQueryClient();
    const fetched = checkoutStatus({ currentBranch: "feature/current" });
    const client = { getCheckoutStatus: vi.fn(async () => fetched) };

    const first = await ensureCheckoutStatus({ queryClient, client, serverId, cwd });
    const second = await ensureCheckoutStatus({ queryClient, client, serverId, cwd });

    expect(first).toEqual(fetched);
    expect(second).toEqual(fetched);
    expect(client.getCheckoutStatus).toHaveBeenCalledExactlyOnceWith(cwd);
  });

  it("awaits a refetch when the canonical cached status was invalidated", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ currentBranch: "feature/stale" }),
    );
    await queryClient.invalidateQueries({
      queryKey: checkoutStatusQueryKey(serverId, cwd),
      refetchType: "none",
    });
    const fetched = checkoutStatus({ currentBranch: "feature/current" });
    const client = { getCheckoutStatus: vi.fn(async () => fetched) };

    const result = await ensureCheckoutStatus({ queryClient, client, serverId, cwd });

    expect(result.currentBranch).toBe("feature/current");
    expect(client.getCheckoutStatus).toHaveBeenCalledExactlyOnceWith(cwd);
  });
});

describe("applyCheckoutStatusUpdateFromEvent", () => {
  it("keeps the cached status when a push carries a failed measurement", () => {
    const queryClient = createQueryClient();
    const good = checkoutStatus({ requestId: "push-good", isDirty: true });
    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), good);

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(
        notGitStatus({ error: { code: "UNKNOWN", message: "Git command timed out" } }),
      ),
    });

    expect(queryClient.getQueryData(checkoutStatusQueryKey(serverId, cwd))).toEqual(good);
  });

  it("writes the checkout status to the cache using the cwd from the payload", () => {
    const queryClient = createQueryClient();
    const pushed = checkoutStatus({ requestId: "push-1", isDirty: true });

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(pushed),
    });

    expect(queryClient.getQueryData(checkoutStatusQueryKey(serverId, cwd))).toEqual(
      expect.objectContaining(pushed),
    );
  });

  it("writes the PR status cache when prStatus is present, and skips it otherwise", () => {
    const queryClient = createQueryClient();
    const pushedPr = prStatus({ requestId: "pr-1" });

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus(), pushedPr),
    });
    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, cwd))).toEqual(pushedPr);

    const otherCwd = "/repo2";
    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ cwd: otherCwd, repoRoot: otherCwd })),
    });
    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, otherCwd))).toBeUndefined();
  });

  // Regression: a branch switch keeps the same cwd, so every PR-dependent
  // surface must replace the provider facts from this subscription-fed cache.
  it("replaces cached provider facts when switching between GitHub and Bitbucket", () => {
    const queryClient = createQueryClient();
    const github = prStatus({
      hosting: { provider: "github", featuresEnabled: true },
      forge: "github",
    });
    const bitbucket = prStatus({
      hosting: { provider: "bitbucket-cloud", featuresEnabled: true },
      forge: "bitbucket-cloud",
      status: { ...prStatus().status!, forge: "bitbucket-cloud" },
    });

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus(), github),
    });
    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(
        checkoutStatus({ currentBranch: "bitbucket-branch" }),
        bitbucket,
      ),
    });
    expect(
      queryClient.getQueryData<CheckoutPrStatusPayload>(checkoutPrStatusQueryKey(serverId, cwd)),
    ).toMatchObject({ hosting: { provider: "bitbucket-cloud" }, forge: "bitbucket-cloud" });

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ currentBranch: "github-return" }), github),
    });
    expect(
      queryClient.getQueryData<CheckoutPrStatusPayload>(checkoutPrStatusQueryKey(serverId, cwd)),
    ).toMatchObject({ hosting: { provider: "github" }, forge: "github" });
  });

  it("preserves a manual diff-mode override when the pushed dirty state flipped", () => {
    const queryClient = createQueryClient();
    setDiffModeOverride(false);

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ isDirty: true })),
    });

    expect(useReviewDraftStore.getState().diffModeOverrides["review:scope"]).toBeDefined();
  });

  it("keeps a manual diff-mode override while the pushed dirty state still matches", () => {
    const queryClient = createQueryClient();
    setDiffModeOverride(true);

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ isDirty: true })),
    });

    expect(useReviewDraftStore.getState().diffModeOverrides["review:scope"]).toBeDefined();
  });

  it("invalidates the PR timeline when the prStatus changes, ignoring the volatile requestId", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutPrStatusQueryKey(serverId, cwd),
      prStatus({ requestId: "pr-v1" }),
    );
    const timelineKey = prPaneTimelineQueryKey({ serverId, cwd, prNumber: 42 });
    queryClient.setQueryData(timelineKey, { items: [] });

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus(), prStatus({ requestId: "pr-v2" })),
    });
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(false);

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(
        checkoutStatus(),
        prStatus({
          requestId: "pr-v3",
          status: { ...prStatus().status!, state: "closed" },
        }),
      ),
    });
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);
  });

  // Regression: after a commit, GitHub's PR-status poll re-broadcast a whole status
  // payload rebuilt from a pre-commit git snapshot. It landed on top of the fresh
  // aheadOfOrigin, so the Push button went back to "nothing to push".
  it("keeps freshly committed git state when a PR-status-only push echoes the old snapshot", () => {
    const queryClient = createQueryClient();
    const committed = checkoutStatus({ aheadOfOrigin: 1, isDirty: false, gitStateAt: 200 });
    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), committed);

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(
        checkoutStatus({ aheadOfOrigin: 0, isDirty: true, gitStateAt: 100 }),
        prStatus({ requestId: "pr-poll" }),
        { prStatusOnly: true },
      ),
    });

    expect(queryClient.getQueryData(checkoutStatusQueryKey(serverId, cwd))).toEqual(committed);
    // The PR half of the same push is still applied - that is the only thing it refreshed.
    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, cwd))).toEqual(
      prStatus({ requestId: "pr-poll" }),
    );
  });

  it("drops a full push whose git state was measured before the cached one", () => {
    const queryClient = createQueryClient();
    const newer = checkoutStatus({ aheadOfOrigin: 1, gitStateAt: 200 });
    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), newer);

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ aheadOfOrigin: 0, gitStateAt: 100 })),
    });

    expect(queryClient.getQueryData(checkoutStatusQueryKey(serverId, cwd))).toEqual(newer);
  });

  it("applies a full push whose git state is at least as new as the cached one", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ aheadOfOrigin: 1, gitStateAt: 200 }),
    );

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ aheadOfOrigin: 0, gitStateAt: 300 })),
    });

    expect(
      queryClient.getQueryData<CheckoutStatusPayload>(checkoutStatusQueryKey(serverId, cwd))
        ?.aheadOfOrigin,
    ).toBe(0);
  });

  // Old daemons send neither signal; the only correct reading of such a payload is
  // the pre-existing apply-everything behavior.
  it("applies an unstamped push from a daemon that predates the freshness fields", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ aheadOfOrigin: 1, gitStateAt: 200 }),
    );

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus({ aheadOfOrigin: 0 })),
    });

    expect(
      queryClient.getQueryData<CheckoutStatusPayload>(checkoutStatusQueryKey(serverId, cwd))
        ?.aheadOfOrigin,
    ).toBe(0);
  });

  it("invalidates the PR timeline on the first prStatus emission, scoped to its cwd", () => {
    const queryClient = createQueryClient();
    const timelineKey = prPaneTimelineQueryKey({ serverId, cwd, prNumber: 42 });
    const otherTimelineKey = prPaneTimelineQueryKey({ serverId, cwd: "/repo2", prNumber: 42 });
    queryClient.setQueryData(timelineKey, { items: [] });
    queryClient.setQueryData(otherTimelineKey, { items: [] });

    applyCheckoutStatusUpdateFromEvent({
      queryClient,
      serverId,
      message: checkoutStatusUpdate(checkoutStatus(), prStatus()),
    });

    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherTimelineKey)?.isInvalidated).toBe(false);
  });
});

describe("reconcileCheckoutStatusWithUncommittedDiff", () => {
  it("invalidates a stale-clean status when the uncommitted diff proves the tree is dirty", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ isDirty: false }),
    );

    reconcileCheckoutStatusWithUncommittedDiff({
      queryClient,
      serverId,
      cwd,
      diffHasUncommittedFiles: true,
    });

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
  });

  it("leaves an already-dirty status untouched", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ isDirty: true }),
    );

    reconcileCheckoutStatusWithUncommittedDiff({
      queryClient,
      serverId,
      cwd,
      diffHasUncommittedFiles: true,
    });

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      false,
    );
  });

  it("does not reconcile the reverse direction (empty diff) to avoid whitespace-filter churn", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ isDirty: true }),
    );

    reconcileCheckoutStatusWithUncommittedDiff({
      queryClient,
      serverId,
      cwd,
      diffHasUncommittedFiles: false,
    });

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      false,
    );
  });

  it("no-ops when the checkout is not git or has no cached status", () => {
    const queryClient = createQueryClient();

    // No cached status at all.
    reconcileCheckoutStatusWithUncommittedDiff({
      queryClient,
      serverId,
      cwd,
      diffHasUncommittedFiles: true,
    });
    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))).toBeUndefined();

    // Cached status is a non-git checkout - isDirty is null, nothing to reconcile.
    queryClient.setQueryData(
      checkoutStatusQueryKey(serverId, cwd),
      checkoutStatus({ isGit: false, isDirty: null, repoRoot: null, currentBranch: null }),
    );
    reconcileCheckoutStatusWithUncommittedDiff({
      queryClient,
      serverId,
      cwd,
      diffHasUncommittedFiles: true,
    });
    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      false,
    );
  });
});
