import type { QueryClient } from "@tanstack/react-query";
import type { CheckoutStatusResponse, CheckoutStatusUpdate } from "@otto-code/protocol/messages";
import equal from "fast-deep-equal/es6";
import {
  checkoutPrStatusQueryKey,
  checkoutStatusQueryKey,
  invalidatePrPaneTimelineForCheckout,
} from "@/git/query-keys";
import { expireStaleDiffModeOverrides } from "@/review/store";

export type CheckoutStatusPayload = CheckoutStatusResponse["payload"];
export type CheckoutPrStatusPayload = NonNullable<CheckoutStatusUpdate["payload"]["prStatus"]>;

export interface CheckoutStatusClient {
  getCheckoutStatus: (cwd: string) => Promise<CheckoutStatusPayload>;
}

// Checkout status enters the app through exactly two doors: daemon pushes
// (applyCheckoutStatusUpdateFromEvent) and query fetches (fetchCheckoutStatus). Both run
// the dirty-state reactions, so they hold regardless of which screens are mounted.

/**
 * Whether a status payload is a measurement that failed rather than an answer.
 *
 * The daemon answers a status request it could not complete with a well-formed
 * `isGit: false` payload carrying the error (checkout-session `handleStatusRequest`),
 * because the wire shape has no third state. That payload is indistinguishable from
 * "this directory is not a repository" to every consumer downstream, and `isGit` is
 * the single switch the whole Git and PR control cluster hangs off - `buildGitActions`
 * returns nothing for a non-git checkout, so the split button unmounts entirely.
 *
 * Treating it as an answer is what makes the controls vanish and stay vanished: this
 * cache is push-driven with `staleTime: Infinity` and no refetch on mount, focus, or
 * reconnect, so one failed measurement (a git command timeout, a spawn failure, a
 * transient lock) is cached as truth for the life of the app. A conclusive
 * non-repository answer is instead the error-free `isGit: false` snapshot the
 * workspace Git service returns after it has completed repository discovery.
 *
 * An error labelled `NOT_GIT_REPO` is not sufficient evidence here. It can come
 * from a lower-level Git command while discovery is still settling, and its
 * indistinguishable wire shape must remain retryable rather than paint a false
 * terminal state in Changes.
 */
function isFailedMeasurement(payload: CheckoutStatusPayload): boolean {
  return payload.error != null;
}

export async function fetchCheckoutStatus({
  client,
  serverId,
  cwd,
}: {
  client: CheckoutStatusClient;
  serverId: string;
  cwd: string;
}): Promise<CheckoutStatusPayload> {
  const payload = await client.getCheckoutStatus(cwd);
  if (isFailedMeasurement(payload)) {
    // Rejecting keeps the last known-good status in the cache and lets the query
    // retry, instead of caching "not a repository" forever.
    throw new Error(payload.error?.message ?? "Checkout status is unavailable.");
  }
  expireStaleDiffModeOverrides({ serverId, cwd, isDirty: payload.isGit && payload.isDirty });
  return payload;
}

export async function ensureCheckoutStatus({
  queryClient,
  client,
  serverId,
  cwd,
}: {
  queryClient: QueryClient;
  client: CheckoutStatusClient;
  serverId: string;
  cwd: string;
}): Promise<CheckoutStatusPayload> {
  return await queryClient.fetchQuery({
    queryKey: checkoutStatusQueryKey(serverId, cwd),
    queryFn: () => fetchCheckoutStatus({ client, serverId, cwd }),
    staleTime: Infinity,
  });
}

export function applyCheckoutStatusUpdateFromEvent({
  queryClient,
  serverId,
  message,
}: {
  queryClient: QueryClient;
  serverId: string;
  message: CheckoutStatusUpdate;
}): void {
  const { payload } = message;
  if (isFailedMeasurement(payload)) {
    // Same reasoning as the fetch door: a push whose git block is a failed
    // measurement must not overwrite good state with "not a repository".
    return;
  }
  if (carriesFreshGitState(queryClient, serverId, payload)) {
    queryClient.setQueryData(checkoutStatusQueryKey(serverId, payload.cwd), payload);
    expireStaleDiffModeOverrides({
      serverId,
      cwd: payload.cwd,
      isDirty: payload.isGit && payload.isDirty,
    });
  }

  const prStatus = payload.prStatus;
  if (!prStatus) {
    return;
  }

  const previous = queryClient.getQueryData<CheckoutPrStatusPayload>(
    checkoutPrStatusQueryKey(serverId, prStatus.cwd),
  );
  queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, prStatus.cwd), prStatus);

  // The PR activity timeline has no push channel; mark it stale when the pushed PR status
  // meaningfully changed. Active panes refetch immediately, evicted ones on next mount.
  if (hasPrStatusChanged(previous, prStatus)) {
    void invalidatePrPaneTimelineForCheckout(queryClient, { serverId, cwd: prStatus.cwd });
  }
}

/**
 * Whether a pushed status update actually carries git-tracking news, or is an echo
 * that would clobber fresher state already in the cache.
 *
 * Two producers write this cache entry: the workspace git refresh, which measures
 * ahead/behind/dirty, and the hosting PR-status poll, which refreshes only PR and
 * check state but has to re-send a whole status payload because
 * `checkout_status_update` has no PR-only shape. Applying the poll's git block
 * unconditionally is what mutes Push right after a commit - the poll re-broadcasts
 * a pre-commit `aheadOfOrigin: 0` over the freshly fetched `aheadOfOrigin: 1`.
 *
 * Two independent gates:
 *  - `prStatusOnly`, set by the daemon on exactly the poll path. Authoritative, and
 *    the one the server-side fix relies on.
 *  - `gitStateAt`, a monotonic stamp of when the daemon measured the git block.
 *    Chosen over per-field freshness rules because the git-tracking fields move as
 *    one unit written by one producer, so a single comparison is total and also
 *    covers out-of-order delivery in general; a per-field rule would instead have to
 *    guess which of aheadOfOrigin/behindOfOrigin/isDirty may legitimately regress
 *    (all of them can - push, fetch, discard).
 *
 * Either signal missing means an older daemon, where the pre-existing
 * apply-everything behavior is the only correct reading of the payload.
 */
function carriesFreshGitState(
  queryClient: QueryClient,
  serverId: string,
  payload: CheckoutStatusUpdate["payload"],
): boolean {
  if (payload.prStatusOnly) {
    return false;
  }
  const incomingAt = payload.gitStateAt;
  if (incomingAt === undefined) {
    return true;
  }
  const cachedAt = queryClient.getQueryData<CheckoutStatusPayload>(
    checkoutStatusQueryKey(serverId, payload.cwd),
  )?.gitStateAt;
  return cachedAt === undefined || incomingAt >= cachedAt;
}

/**
 * Resync checkout status when the live uncommitted diff proves the tree is dirty
 * but the cached status still says clean.
 *
 * The uncommitted diff is a per-pane live subscription (checkout_diff_update), while
 * checkout status is a passive, push-only cache (staleTime: Infinity, no refetch on
 * mount/focus/reconnect - see use-status-query.ts). If a checkout_status_update
 * broadcast is missed after the tree goes dirty again (e.g. edits right after a
 * commit/push), isDirty freezes at `false` and never self-heals. The git-actions CTA
 * derives its only commit affordance from isDirty, so the whole split button vanishes -
 * even though the manual commit box, which reads the diff, is still shown.
 *
 * We reconcile only the dirty-proving direction: a non-empty uncommitted diff means the
 * tree is unambiguously dirty, so a cached `isDirty: false` is wrong and we refetch. The
 * reverse (empty diff, isDirty true) can happen legitimately under whitespace filtering,
 * so it's left alone to avoid needless refetch churn.
 */
export function reconcileCheckoutStatusWithUncommittedDiff({
  queryClient,
  serverId,
  cwd,
  diffHasUncommittedFiles,
}: {
  queryClient: QueryClient;
  serverId: string;
  cwd: string;
  diffHasUncommittedFiles: boolean;
}): void {
  if (!diffHasUncommittedFiles) {
    return;
  }
  const status = queryClient.getQueryData<CheckoutStatusPayload>(
    checkoutStatusQueryKey(serverId, cwd),
  );
  if (!status || !status.isGit || status.isDirty) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: checkoutStatusQueryKey(serverId, cwd) });
}

// requestId changes on every emission and carries no PR state.
function prStatusWithoutVolatileFields(
  prStatus: CheckoutPrStatusPayload,
): Omit<CheckoutPrStatusPayload, "requestId"> {
  const { requestId: _requestId, ...rest } = prStatus;
  return rest;
}

function hasPrStatusChanged(
  previous: CheckoutPrStatusPayload | undefined,
  next: CheckoutPrStatusPayload,
): boolean {
  if (!previous) {
    return true;
  }
  return !equal(prStatusWithoutVolatileFields(previous), prStatusWithoutVolatileFields(next));
}
