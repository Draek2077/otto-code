import { createHash } from "node:crypto";
import type pino from "pino";
import type { SubscribeCheckoutDiffRequest, SessionOutboundMessage } from "./messages.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "./workspace-git-service.js";
import { expandTilde } from "../utils/path.js";
import { toCheckoutError } from "./checkout-git-utils.js";

const CHECKOUT_DIFF_WATCH_DEBOUNCE_MS = 150;

type CheckoutDiffWorkspace = Pick<
  WorkspaceGitService,
  | "getCheckoutDiff"
  | "getSnapshot"
  | "peekSnapshot"
  | "registerWorkspace"
  | "requestWorkingTreeWatch"
>;

export type CheckoutDiffCompareInput = SubscribeCheckoutDiffRequest["compare"];

export type CheckoutDiffSnapshotPayload = Omit<
  Extract<SessionOutboundMessage, { type: "checkout_diff_update" }>["payload"],
  "subscriptionId"
>;

export interface CheckoutDiffMetrics {
  checkoutDiffTargetCount: number;
  checkoutDiffSubscriptionCount: number;
  checkoutDiffWatcherCount: number;
  checkoutDiffFallbackRefreshTargetCount: number;
}

interface CheckoutDiffWatchTarget {
  key: string;
  cwd: string;
  diffCwd: string;
  compare: CheckoutDiffCompareInput;
  listeners: Set<(snapshot: CheckoutDiffSnapshotPayload) => void>;
  workingTreeWatchUnsubscribe: (() => void) | null;
  workspaceGitUnsubscribe: (() => void) | null;
  latestWorkspaceStructureFingerprint: string | null;
  latestWorkspaceWorktreeFingerprint: string | null;
  latestWorkspaceForgeFingerprint: string | null;
  debounceTimer: NodeJS.Timeout | null;
  pendingDebounceForce: boolean;
  refreshPromise: Promise<void> | null;
  refreshQueued: boolean;
  refreshQueuedForce: boolean;
  latestPayload: CheckoutDiffSnapshotPayload | null;
  latestFingerprint: string | null;
  latestRawDiffFingerprint: string | null;
  openPromise: Promise<void> | null;
}

interface CheckoutDiffSnapshotResult {
  payload: CheckoutDiffSnapshotPayload;
  rawDiffFingerprint: string | null;
}

/**
 * Hash the unified patch text, which is what actually decides whether a subscriber has
 * anything new to render. `diffTooLarge` rides along because it turns an empty patch into a
 * different payload.
 */
function fingerprintRawDiff(result: { diff: string; diffTooLarge?: boolean }): string {
  const hash = createHash("sha1").update(result.diff).digest("hex");
  return result.diffTooLarge === true ? `too-large:${hash}` : hash;
}

export interface CheckoutDiffSubscriptionRequest {
  cwd: string;
  compare: CheckoutDiffCompareInput;
  signal?: AbortSignal;
}

export interface CheckoutDiffSubscription {
  initial: CheckoutDiffSnapshotPayload;
  unsubscribe: () => void;
}

export class CheckoutDiffManager {
  private readonly workspaceGitService: CheckoutDiffWorkspace;
  private readonly targets = new Map<string, CheckoutDiffWatchTarget>();

  constructor(options: {
    logger: pino.Logger;
    ottoHome: string;
    workspaceGitService: CheckoutDiffWorkspace;
  }) {
    this.workspaceGitService = options.workspaceGitService;
  }

  async subscribe(
    params: CheckoutDiffSubscriptionRequest,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): Promise<CheckoutDiffSubscription> {
    const cwd = params.cwd;
    const compare = this.normalizeCompare(params.compare);
    const target = this.ensureTarget(cwd, compare);
    target.listeners.add(listener);
    target.openPromise ??= this.openTarget(target);

    let isSubscribed = true;
    const unsubscribe = () => {
      if (!isSubscribed) {
        return;
      }
      isSubscribed = false;
      params.signal?.removeEventListener("abort", unsubscribe);
      this.removeListener(target, listener);
    };
    params.signal?.addEventListener("abort", unsubscribe, { once: true });
    if (params.signal?.aborted) {
      unsubscribe();
    }

    try {
      await target.openPromise;
      let initial = target.latestPayload;
      if (!initial) {
        const computed = await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
          diffCwd: target.diffCwd,
        });
        initial = computed.payload;
        target.latestRawDiffFingerprint = computed.rawDiffFingerprint;
      }
      target.latestPayload = initial;
      target.latestFingerprint = JSON.stringify(initial);
      return { initial, unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  scheduleRefreshForCwd(cwd: string): void {
    const resolvedCwd = expandTilde(cwd);
    for (const target of this.targets.values()) {
      if (target.cwd !== resolvedCwd && target.diffCwd !== resolvedCwd) {
        continue;
      }
      this.scheduleTargetRefresh(target);
    }
  }

  getMetrics(): CheckoutDiffMetrics {
    let checkoutDiffSubscriptionCount = 0;

    for (const target of this.targets.values()) {
      checkoutDiffSubscriptionCount += target.listeners.size;
    }

    return {
      checkoutDiffTargetCount: this.targets.size,
      checkoutDiffSubscriptionCount,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
    };
  }

  dispose(): void {
    for (const target of this.targets.values()) {
      this.closeTarget(target);
    }
    this.targets.clear();
  }

  private normalizeCompare(compare: CheckoutDiffCompareInput): CheckoutDiffCompareInput {
    const ignoreWhitespace = compare.ignoreWhitespace === true;
    if (compare.mode === "uncommitted") {
      return { mode: "uncommitted", ignoreWhitespace };
    }
    const trimmedBaseRef = compare.baseRef?.trim();
    return trimmedBaseRef
      ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace }
      : { mode: "base", ignoreWhitespace };
  }

  private buildTargetKey(cwd: string, compare: CheckoutDiffCompareInput): string {
    return JSON.stringify([
      cwd,
      compare.mode,
      compare.mode === "base" ? (compare.baseRef ?? "") : "",
      compare.ignoreWhitespace === true,
    ]);
  }

  private closeTarget(target: CheckoutDiffWatchTarget): void {
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
      target.debounceTimer = null;
    }
    target.workingTreeWatchUnsubscribe?.();
    target.workingTreeWatchUnsubscribe = null;
    target.workspaceGitUnsubscribe?.();
    target.workspaceGitUnsubscribe = null;
    target.listeners.clear();
  }

  private rememberWorkspaceSnapshot(
    target: CheckoutDiffWatchTarget,
    snapshot: WorkspaceGitRuntimeSnapshot,
  ): void {
    const structureFingerprint = JSON.stringify({
      isGit: snapshot.git.isGit,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch,
      remoteUrl: snapshot.git.remoteUrl,
      isOttoOwnedWorktree: snapshot.git.isOttoOwnedWorktree,
      baseRef: snapshot.git.baseRef,
      aheadBehind: snapshot.git.aheadBehind,
      aheadOfOrigin: snapshot.git.aheadOfOrigin,
      behindOfOrigin: snapshot.git.behindOfOrigin,
      hasRemote: snapshot.git.hasRemote,
    });
    const worktreeFingerprint = JSON.stringify({
      isDirty: snapshot.git.isDirty,
      diffStat: snapshot.git.diffStat,
    });
    const forgeFingerprint = JSON.stringify(snapshot.forge);
    const previousStructureFingerprint = target.latestWorkspaceStructureFingerprint;
    const previousWorktreeFingerprint = target.latestWorkspaceWorktreeFingerprint;
    const previousForgeFingerprint = target.latestWorkspaceForgeFingerprint;
    target.latestWorkspaceStructureFingerprint = structureFingerprint;
    target.latestWorkspaceWorktreeFingerprint = worktreeFingerprint;
    target.latestWorkspaceForgeFingerprint = forgeFingerprint;

    if (previousStructureFingerprint === null) {
      return;
    }
    const structureChanged = structureFingerprint !== previousStructureFingerprint;
    const worktreeChanged = worktreeFingerprint !== previousWorktreeFingerprint;
    const forgeChanged = forgeFingerprint !== previousForgeFingerprint;
    if (structureChanged || (!worktreeChanged && !forgeChanged)) {
      this.scheduleTargetRefresh(target, false);
    }
  }

  private removeListener(
    target: CheckoutDiffWatchTarget,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): void {
    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }
    this.closeTarget(target);
    if (this.targets.get(target.key) === target) {
      this.targets.delete(target.key);
    }
  }

  private scheduleTargetRefresh(target: CheckoutDiffWatchTarget, force = true): void {
    target.pendingDebounceForce ||= force;
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
    }
    target.debounceTimer = setTimeout(() => {
      target.debounceTimer = null;
      const pendingForce = target.pendingDebounceForce;
      target.pendingDebounceForce = false;
      void this.refreshTarget(target, pendingForce);
    }, CHECKOUT_DIFF_WATCH_DEBOUNCE_MS);
  }

  private async computeCheckoutDiffSnapshot(
    cwd: string,
    compare: CheckoutDiffCompareInput,
    options?: { diffCwd?: string; force?: boolean; reason?: string },
  ): Promise<CheckoutDiffSnapshotResult> {
    const diffCwd = options?.diffCwd ?? cwd;
    try {
      const diffResult = await this.workspaceGitService.getCheckoutDiff(
        diffCwd,
        {
          mode: compare.mode,
          baseRef: compare.baseRef,
          ignoreWhitespace: compare.ignoreWhitespace,
          includeStructured: true,
        },
        options?.force
          ? { force: true, reason: options.reason ?? "checkout-diff-refresh" }
          : undefined,
      );
      const rawDiffFingerprint = fingerprintRawDiff(diffResult);
      if (diffResult.diffTooLarge) {
        return {
          payload: {
            cwd,
            files: [],
            diffTooLarge: true,
            error: toCheckoutError(new Error("Diff too large to display")),
          },
          rawDiffFingerprint,
        };
      }
      const files = [...(diffResult.structured ?? [])];
      files.sort((a, b) => {
        if (a.path === b.path) return 0;
        return a.path < b.path ? -1 : 1;
      });
      return {
        payload: {
          cwd,
          files,
          error: null,
        },
        rawDiffFingerprint,
      };
    } catch (error) {
      // A failed read carries no usable fingerprint, so the next wakeup must do the full
      // read again rather than compare against a stale hash.
      return {
        payload: {
          cwd,
          files: [],
          error: toCheckoutError(error),
        },
        rawDiffFingerprint: null,
      };
    }
  }

  /**
   * Read the patch text alone - no structuring, no highlighting, no `git show` per changed
   * file - and hash it. This is the cheap half of {@link computeCheckoutDiffSnapshot}, and
   * it is what lets a watcher wakeup that did not move the diff bail before the expensive
   * half runs. Returns null when the read fails, so the caller falls through to the full
   * read and turns the same failure into an error payload for subscribers.
   */
  private async readRawDiffFingerprint(target: CheckoutDiffWatchTarget): Promise<string | null> {
    try {
      const diffResult = await this.workspaceGitService.getCheckoutDiff(
        target.diffCwd,
        {
          mode: target.compare.mode,
          baseRef: target.compare.baseRef,
          ignoreWhitespace: target.compare.ignoreWhitespace,
          includeStructured: false,
        },
        { force: true, reason: "working-tree-watch-probe" },
      );
      return fingerprintRawDiff(diffResult);
    } catch {
      return null;
    }
  }

  private async refreshTarget(target: CheckoutDiffWatchTarget, force: boolean): Promise<void> {
    if (target.refreshPromise) {
      target.refreshQueued = true;
      target.refreshQueuedForce ||= force;
      return;
    }

    target.refreshPromise = (async () => {
      let currentForce = force;
      do {
        target.refreshQueued = false;
        target.refreshQueuedForce = false;

        // Change detection runs on the raw patch text first. Most watcher wakeups move no
        // diff at all - build churn, a save that changed nothing, an editor's atomic
        // rename - and those used to pay a full structure + full-file re-highlight +
        // snapshot stringify before concluding nothing happened. The probe costs one cheap
        // git read; a real change pays it on top of the full read, which is the trade.
        if (currentForce && target.latestRawDiffFingerprint !== null) {
          const probeFingerprint = await this.readRawDiffFingerprint(target);
          if (probeFingerprint !== null && probeFingerprint === target.latestRawDiffFingerprint) {
            continue;
          }
        }

        const { payload, rawDiffFingerprint } = await this.computeCheckoutDiffSnapshot(
          target.cwd,
          target.compare,
          {
            diffCwd: target.diffCwd,
            force: currentForce,
            ...(currentForce ? { reason: "working-tree-watch" } : {}),
          },
        );
        target.latestPayload = payload;
        target.latestRawDiffFingerprint = rawDiffFingerprint;
        const fingerprint = JSON.stringify(payload);
        if (fingerprint !== target.latestFingerprint) {
          target.latestFingerprint = fingerprint;
          for (const listener of target.listeners) {
            listener(payload);
          }
        }
        currentForce = target.refreshQueuedForce;
      } while (target.refreshQueued);
    })();

    try {
      await target.refreshPromise;
    } finally {
      target.refreshPromise = null;
    }
  }

  private ensureTarget(cwd: string, compare: CheckoutDiffCompareInput): CheckoutDiffWatchTarget {
    const targetKey = this.buildTargetKey(cwd, compare);
    const existing = this.targets.get(targetKey);
    if (existing) {
      return existing;
    }

    const target: CheckoutDiffWatchTarget = {
      key: targetKey,
      cwd,
      diffCwd: cwd,
      compare,
      listeners: new Set(),
      workingTreeWatchUnsubscribe: null,
      workspaceGitUnsubscribe: null,
      latestWorkspaceStructureFingerprint: null,
      latestWorkspaceWorktreeFingerprint: null,
      latestWorkspaceForgeFingerprint: null,
      debounceTimer: null,
      pendingDebounceForce: false,
      refreshPromise: null,
      refreshQueued: false,
      refreshQueuedForce: false,
      latestPayload: null,
      latestFingerprint: null,
      latestRawDiffFingerprint: null,
      openPromise: null,
    };
    this.targets.set(targetKey, target);
    return target;
  }

  private async openTarget(target: CheckoutDiffWatchTarget): Promise<void> {
    if (target.compare.mode === "base") {
      const snapshot =
        this.workspaceGitService.peekSnapshot(target.cwd) ??
        (await this.workspaceGitService.getSnapshot(target.cwd, { includeForge: false }));
      target.diffCwd = snapshot.git.repoRoot ?? target.cwd;
      if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
        return;
      }
      this.rememberWorkspaceSnapshot(target, snapshot);
      const workspaceSubscription = this.workspaceGitService.registerWorkspace(
        { cwd: target.cwd },
        (nextSnapshot) => this.rememberWorkspaceSnapshot(target, nextSnapshot),
      );
      if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
        workspaceSubscription.unsubscribe();
        return;
      }
      target.workspaceGitUnsubscribe = workspaceSubscription.unsubscribe;
      return;
    }

    const { repoRoot, unsubscribe } = await this.workspaceGitService.requestWorkingTreeWatch(
      target.cwd,
      () => this.scheduleTargetRefresh(target),
    );
    target.diffCwd = repoRoot ?? target.cwd;
    if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
      unsubscribe();
      return;
    }
    target.workingTreeWatchUnsubscribe = unsubscribe;
  }
}
