import type { HostingCurrentPullRequestStatus } from "../github-service.js";

// Retain-count based PR status poller, extracted from the GitHub service's
// embedded implementation so other providers reuse the same discipline:
// nothing polls without a live subscriber, pending PRs poll on the fast
// interval, settled PRs on the slow one, and consecutive errors back off
// exponentially up to a hard cap. Never polls faster than fastIntervalMs.

export interface PullRequestStatusPollerIntervals {
  fastIntervalMs: number;
  slowIntervalMs: number;
  errorBackoffCapMs: number;
}

export interface PullRequestStatusPollTargetKey {
  cwd: string;
  headRef: string;
  headRepositoryOwner?: string;
}

interface PollTarget {
  key: string;
  target: PullRequestStatusPollTargetKey;
  retainCount: number;
  timer: NodeJS.Timeout | null;
  latestStatus: HostingCurrentPullRequestStatus | null;
  consecutiveErrors: number;
  callbacks: Set<(status: HostingCurrentPullRequestStatus | null) => void>;
  errorCallbacks: Set<(error: unknown) => void>;
}

export interface PullRequestStatusPoller {
  retain(options: {
    cwd: string;
    headRef: string;
    headRepositoryOwner?: string;
    onStatus?: (status: HostingCurrentPullRequestStatus | null) => void;
    onError?: (error: unknown) => void;
  }): { unsubscribe: () => void };
  // Reports a successful read (from any code path) so an active target can
  // reschedule from fresh data and notify subscribers when it was a poll.
  reportSuccess(options: {
    target: PullRequestStatusPollTargetKey;
    status: HostingCurrentPullRequestStatus | null;
    notify: boolean;
  }): void;
  dispose(): void;
}

export function isPullRequestStatusPending(
  status: HostingCurrentPullRequestStatus | null,
): boolean {
  if (!status) {
    return false;
  }
  if (status.isMerged || status.state !== "OPEN") {
    return false;
  }
  return status.checksStatus === "pending";
}

export function computeNextPollInterval(params: {
  status: HostingCurrentPullRequestStatus | null;
  consecutiveErrors: number;
  intervals: PullRequestStatusPollerIntervals;
}): number {
  const base = isPullRequestStatusPending(params.status)
    ? params.intervals.fastIntervalMs
    : params.intervals.slowIntervalMs;
  if (params.consecutiveErrors <= 1) {
    return base;
  }
  const backoff = base * 2 ** (params.consecutiveErrors - 1);
  return Math.min(backoff, params.intervals.errorBackoffCapMs);
}

export function createPullRequestStatusPoller(options: {
  intervals: PullRequestStatusPollerIntervals;
  // The poll body; implementations route this through their cached
  // getCurrentPullRequestStatus with a forced-read reason.
  poll: (target: PullRequestStatusPollTargetKey) => Promise<void>;
}): PullRequestStatusPoller {
  const targets = new Map<string, PollTarget>();

  function keyOf(target: PullRequestStatusPollTargetKey): string {
    return JSON.stringify({
      cwd: target.cwd,
      headRef: target.headRef,
      headRepositoryOwner: target.headRepositoryOwner,
    });
  }

  function schedule(target: PollTarget, delayMs: number): void {
    if (target.retainCount <= 0) {
      return;
    }
    if (target.timer) {
      clearTimeout(target.timer);
    }
    target.timer = setTimeout(() => {
      target.timer = null;
      void runPoll(target);
    }, delayMs);
  }

  function scheduleFromState(target: PollTarget): void {
    schedule(
      target,
      computeNextPollInterval({
        status: target.latestStatus,
        consecutiveErrors: target.consecutiveErrors,
        intervals: options.intervals,
      }),
    );
  }

  async function runPoll(target: PollTarget): Promise<void> {
    try {
      await options.poll(target.target);
      // Success path reschedules via reportSuccess from the implementation.
    } catch (error) {
      target.consecutiveErrors += 1;
      for (const callback of target.errorCallbacks) {
        callback(error);
      }
      scheduleFromState(target);
    }
  }

  function close(target: PollTarget): void {
    if (target.timer) {
      clearTimeout(target.timer);
      target.timer = null;
    }
    target.retainCount = 0;
    target.callbacks.clear();
    target.errorCallbacks.clear();
  }

  return {
    retain(input) {
      const targetKey = keyOf(input);
      let target = targets.get(targetKey);
      if (!target) {
        target = {
          key: targetKey,
          target: {
            cwd: input.cwd,
            headRef: input.headRef,
            headRepositoryOwner: input.headRepositoryOwner,
          },
          retainCount: 0,
          timer: null,
          latestStatus: null,
          consecutiveErrors: 0,
          callbacks: new Set(),
          errorCallbacks: new Set(),
        };
        targets.set(targetKey, target);
      }

      const isNewlyRetained = target.retainCount === 0;
      target.retainCount += 1;
      if (input.onStatus) {
        target.callbacks.add(input.onStatus);
      }
      if (input.onError) {
        target.errorCallbacks.add(input.onError);
      }
      if (isNewlyRetained) {
        schedule(target, 0);
      } else {
        scheduleFromState(target);
      }

      let unsubscribed = false;
      return {
        unsubscribe: () => {
          if (unsubscribed) {
            return;
          }
          unsubscribed = true;
          if (input.onStatus) {
            target.callbacks.delete(input.onStatus);
          }
          if (input.onError) {
            target.errorCallbacks.delete(input.onError);
          }
          target.retainCount -= 1;
          if (target.retainCount > 0) {
            return;
          }
          close(target);
          targets.delete(targetKey);
        },
      };
    },

    reportSuccess(input) {
      const target = targets.get(keyOf(input.target));
      if (!target) {
        return;
      }
      target.latestStatus = input.status;
      target.consecutiveErrors = 0;
      if (input.notify) {
        for (const callback of target.callbacks) {
          callback(input.status);
        }
      }
      scheduleFromState(target);
    },

    dispose() {
      for (const target of targets.values()) {
        close(target);
      }
      targets.clear();
    },
  };
}
