/**
 * The cheap Brain-status cache: one entry per host, written by push.
 *
 * The daemon subscribes to its brain's own event stream and broadcasts a
 * complete snapshot as `brain_status_changed`. That lands here, and every Brain
 * surface - the rail button, the workspace title button, the Brain console -
 * reads the same entry, so a transition reaches all of them at once instead of
 * whenever each one's timer next happened to fire.
 *
 * Two things this module deliberately does NOT do:
 *
 *  - **It never invents fresh resources.** CPU/GPU/RAM still come only from the
 *    Overview's opt-in pull. When that enriched cache exists, a cheap push
 *    replaces its status fields while retaining only the last resource sample;
 *    this is how live inference reaches Overview without spawning nvidia-smi at
 *    event cadence.
 *  - **It does not merge.** A snapshot is complete by contract, so writing it
 *    whole is what makes a missed message and a reconnect the same recovery.
 *
 * The write is scoped by the `serverId` of the runtime that delivered it, so two
 * connected hosts cannot overwrite each other's brain state.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { BrainHostStatus, SessionOutboundMessage } from "@otto-code/protocol/messages";

type StatusMessage = Extract<SessionOutboundMessage, { type: "status" }>;

export function brainStatusQueryKey(serverId: string, resources: boolean) {
  return ["brain-console-status", serverId, resources] as const;
}

/**
 * How long a pushed status entry counts as fresh for an observer that mounts
 * later.
 *
 * Finite on purpose (fetch queries reject a non-finite stale time), and long
 * because the cache is authoritative while the stream is up. It is not a poll:
 * `refetchOnMount: "always"` already gives every new surface one fresh read, and
 * this only governs how long a *second* observer joining can reuse that read.
 */
export const PUSHED_BRAIN_STATUS_STALE_MS = 5 * 60_000;

function isBrainStatusChangedPayload(
  payload: unknown,
): payload is { status: "brain_status_changed"; brain: BrainHostStatus } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { status?: unknown }).status === "brain_status_changed" &&
    typeof (payload as { brain?: unknown }).brain === "object" &&
    (payload as { brain?: unknown }).brain !== null
  );
}

export function applyBrainStatusChanged(input: {
  serverId: string;
  queryClient: QueryClient;
  message: StatusMessage;
}): void {
  if (!isBrainStatusChangedPayload(input.message.payload)) {
    return;
  }
  const brain = input.message.payload.brain;
  input.queryClient.setQueryData(brainStatusQueryKey(input.serverId, false), brain);
  input.queryClient.setQueryData<BrainHostStatus>(
    brainStatusQueryKey(input.serverId, true),
    (current) =>
      current
        ? {
            ...brain,
            // The pushed snapshot is complete for every cheap field. Resources
            // are deliberately absent, so retain that one enriched field from
            // the Overview's slower opt-in sample.
            resources: current.resources,
          }
        : current,
  );
}

/**
 * Show a load or unload starting, before the brain has said anything.
 *
 * The brain's own load endpoint does not answer until the load has *finished*,
 * so without this the button sits there and the rail keeps reading "ready" for
 * the entire wait - the exact gap the event stream cannot close, because the
 * event and the request race and the request is the slower one.
 *
 * Deliberately one field. `starting` and `stopping` are supervisor states the
 * client already renders, so this is the UI predicting the state machine's next
 * step, not inventing a new one. It is not extended to inference states on
 * purpose: an open request is not evidence a model is thinking (see the rule at
 * the top of `brain-state.ts`). The next authoritative snapshot overwrites it
 * whole, including when the load failed and the answer is `failed`.
 */
export function applyOptimisticBrainLifecycle(input: {
  serverId: string;
  queryClient: QueryClient;
  lifecycle: "loading" | "unloading";
}): void {
  const queryKey = brainStatusQueryKey(input.serverId, false);
  const current = input.queryClient.getQueryData<BrainHostStatus>(queryKey);
  // Nothing to be optimistic about: with no status at all, the surfaces are
  // already showing "off" and inventing a transition would be a guess.
  if (!current) {
    return;
  }
  input.queryClient.setQueryData<BrainHostStatus>(queryKey, {
    ...current,
    state: input.lifecycle === "loading" ? "starting" : "stopping",
  });
}

/**
 * Reconnect repair: one fresh cheap read, because the daemon dropped the
 * subscription when the socket went away and any transition during the gap was
 * never delivered. Only the cheap key - re-fetching the resource variant would
 * spawn `nvidia-smi` on every reconnect for a panel that may not be open.
 */
export function invalidateBrainStatusAfterReconnect(input: {
  queryClient: QueryClient;
  serverId: string;
}): void {
  void input.queryClient.invalidateQueries({
    queryKey: brainStatusQueryKey(input.serverId, false),
  });
}
