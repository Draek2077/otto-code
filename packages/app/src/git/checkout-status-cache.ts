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
  expireStaleDiffModeOverrides({ serverId, cwd, isDirty: payload.isGit && payload.isDirty });
  return payload;
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
  queryClient.setQueryData(checkoutStatusQueryKey(serverId, payload.cwd), payload);
  expireStaleDiffModeOverrides({
    serverId,
    cwd: payload.cwd,
    isDirty: payload.isGit && payload.isDirty,
  });

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
 * Resync checkout status when the live uncommitted diff proves the tree is dirty
 * but the cached status still says clean.
 *
 * The uncommitted diff is a per-pane live subscription (checkout_diff_update), while
 * checkout status is a passive, push-only cache (staleTime: Infinity, no refetch on
 * mount/focus/reconnect — see use-status-query.ts). If a checkout_status_update
 * broadcast is missed after the tree goes dirty again (e.g. edits right after a
 * commit/push), isDirty freezes at `false` and never self-heals. The git-actions CTA
 * derives its only commit affordance from isDirty, so the whole split button vanishes —
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
