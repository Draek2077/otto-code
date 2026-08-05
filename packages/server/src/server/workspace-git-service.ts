import type { GitHostingProviderId, GitHostingCapabilities } from "@otto-code/protocol/messages";
import { watch, type FSWatcher } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { LRUCache } from "lru-cache";
import pLimit from "p-limit";
import type pino from "pino";
import type { ProjectCheckoutLitePayload } from "@otto-code/protocol/messages";
import { parseGitRemoteLocation } from "@otto-code/protocol/git-remote";
import type { CheckoutBaseSource, CheckoutContext } from "../utils/checkout-git.js";
import {
  type BranchCheckoutResolution,
  type BranchSuggestion,
  type CheckoutSnapshotFacts,
  type CheckoutDiffCompare,
  type CheckoutDiffResult,
  getCheckoutDiff,
  getCheckoutSnapshotFacts,
  getCheckoutShortstat,
  getCheckoutStatus,
  getCheckoutIdentity,
  getPullRequestStatus,
  forgeAuthStateFromError,
  hasOriginRemote,
  listBranchSuggestions,
  resolveRepositoryDefaultBranch,
  resolveBranchCheckout,
  resolveAbsoluteGitDir,
} from "../utils/checkout-git.js";
import type {
  ForgeAuthState,
  ForgeService,
  ForgeSpecificStatusFacts,
  PullRequestMergeable,
} from "../services/forge-service.js";
import { createForgeService } from "../services/forge-registry.js";
import {
  createForgeResolver,
  type ForgeResolution,
  type ForgeResolver,
} from "../services/forge-resolver.js";
import { parseGitRevParsePath } from "../utils/git-rev-parse-path.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { listOttoWorktrees, type OttoWorktreeInfo } from "../utils/worktree.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-utils.js";
import { deriveProjectSlug } from "./workspace-git-metadata.js";
import { checkoutLiteFromGitSnapshot } from "./workspace-registry-model.js";

const WORKSPACE_GIT_WATCH_DEBOUNCE_MS = 1_000;
const BACKGROUND_GIT_FETCH_INTERVAL_MS = 180_000;
export const WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS = 60_000;
const FORGE_PR_STATUS_POLL_FAST_INTERVAL_MS = 20_000;
const FORGE_PR_STATUS_POLL_SLOW_INTERVAL_MS = 120_000;
const FORGE_PR_STATUS_POLL_ERROR_BACKOFF_CAP_MS = 300_000;
const WORKING_TREE_WATCH_FALLBACK_REFRESH_MS = 5_000;
// Auxiliary reads may reuse cached values within this window; snapshots do not expire on read.
const WORKSPACE_GIT_AUXILIARY_READ_TTL_MS = 15_000;
// Non-forced refresh triggers share this minimum gap to absorb watcher/self-heal bursts; force bypasses it.
const WORKSPACE_GIT_INTERNAL_MIN_GAP_MS = 2_000;
// Heavy values (multi-MB highlighted diffs); cap aggressively. Ephemeral worktree cwds would otherwise pile up forever.
const WORKSPACE_GIT_CHECKOUT_DIFF_CACHE_MAX = 64;
// Small values (booleans, short strings, small arrays); generous cap.
const WORKSPACE_GIT_AUXILIARY_CACHE_MAX = 256;
const WORKSPACE_GIT_FACTS_REUSE_TTL_MS = 1_000;
const LINUX_WATCH_MAX_DIRS = 5_000;
const LINUX_WATCH_REFRESH_COOLDOWN_MS = 2_000;
const LINUX_WATCH_IGNORE_TTL_MS = 5 * 60 * 1_000;

const linuxWatchReaddirConcurrency =
  parseInt(process.env.OTTO_LINUX_WATCH_READDIR_CONCURRENCY ?? "16", 10) || 16;
const linuxWatchReaddirLimit = pLimit(linuxWatchReaddirConcurrency);

export interface WorkspaceGitRuntimeSnapshot {
  cwd: string;
  // Daemon clock (epoch ms) at which `git` below was last measured. Projected onto
  // the wire as `gitStateAt` so clients can reject an out-of-order status push.
  // Deliberately excluded from the emission fingerprint (see rememberSnapshot).
  gitLoadedAtMs?: number | null;
  git: {
    isGit: boolean;
    repoRoot: string | null;
    mainRepoRoot: string | null;
    currentBranch: string | null;
    remoteUrl: string | null;
    isOttoOwnedWorktree: boolean;
    isDirty: boolean | null;
    baseRef: string | null;
    // Where baseRef came from (user pick, inferred parent, worktree record, repo default), so
    // the client can label an inferred base as the heuristic it is.
    baseSource?: CheckoutBaseSource | null;
    aheadBehind: { ahead: number; behind: number } | null;
    aheadOfOrigin: number | null;
    behindOfOrigin: number | null;
    hasRemote: boolean;
    diffStat: { additions: number; deletions: number } | null;
  };
  forge: {
    // Otto's provider-neutral hosting layer (docs/git-providers.md). Upstream's forge
    // shape carries `authState` + a loose `forge` name; Otto additionally projects a
    // typed provider id and its capabilities to the client. Populated by the git-hosting
    // resolver -- see the re-attachment TODO in findings/upstream/.
    provider?: GitHostingProviderId;
    capabilities?: GitHostingCapabilities;
    credentialsMissing?: boolean;
    featuresEnabled: boolean;
    authState: ForgeAuthState;
    /**
     * Forge resolved for this workspace from its remote - including the per-host
     * probe, so self-managed GitLab hosts (no "gitlab" in the name) are labeled
     * correctly. The wire projection prefers this over the bare name heuristic.
     */
    forge?: string;
    pullRequest: {
      number?: number;
      repoOwner?: string;
      repoName?: string;
      projectPath?: string;
      url: string;
      title: string;
      state: string;
      baseRefName: string;
      headRefName: string;
      isMerged: boolean;
      isDraft?: boolean;
      mergeable?: PullRequestMergeable;
      checks?: Array<{
        name: string;
        status: "success" | "failure" | "pending" | "skipped" | "cancelled";
        url: string | null;
        workflow?: string;
        duration?: string;
      }>;
      checksStatus?: "none" | "pending" | "success" | "failure";
      reviewDecision?: "approved" | "changes_requested" | "pending" | null;
      forgeSpecific?: ForgeSpecificStatusFacts;
    } | null;
    error: { message: string } | null;
  };
}

export interface WorkspaceGitService {
  registerWorkspace(
    params: { cwd: string },
    listener: WorkspaceGitListener,
  ): WorkspaceGitSubscription;

  onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription;
  peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null;
  getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload>;
  /**
   * `getCheckout` without the drift half of the read - same payload, but the
   * dirty check, the ahead/behind counts and the base-ref ladder never run.
   * For callers that keep only the identity fields; see `getCheckoutIdentity`.
   */
  getCheckoutLite(cwd: string): Promise<ProjectCheckoutLitePayload>;
  getSnapshot(
    cwd: string,
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<WorkspaceGitRuntimeSnapshot>;
  resolveForge(cwd: string): Promise<ForgeResolution | null>;
  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult>;
  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult>;
  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean>;
  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]>;
  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]>;
  listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]>;
  getProjectSlug(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string>;
  resolveRepoRemoteUrl(cwd: string, options?: WorkspaceGitReadOptions): Promise<string | null>;
  refresh(cwd: string, options?: { priority?: "normal" | "high" }): Promise<void>;
  requestWorkingTreeWatch(
    cwd: string,
    onChange: () => void,
  ): Promise<{ repoRoot: string | null; unsubscribe: () => void }>;
  scheduleRefreshForCwd(cwd: string): void;
  onWorkspaceStateMayHaveChanged(cwd: string): void;
  /**
   * The workspace the client is currently in. Periodic refresh and background fetch run
   * only for this one; everything else stays observed through its filesystem watchers but
   * costs nothing while idle.
   */
  setActiveWorkspace(cwd: string | null): void;
  invalidateForge(cwd: string): void;
  invalidateAuxiliaryReads(cwd: string): void;
  getMetrics(): WorkspaceGitServiceMetrics;
  dispose(): void;
}

export interface WorkspaceGitServiceMetrics {
  workspaceTargetCount: number;
  workspaceListenerCount: number;
  repositoryTargetCount: number;
  repositoryWorkspaceLinkCount: number;
  workingTreeWatchTargetCount: number;
  workingTreeWatchListenerCount: number;
  workspaceObservationSetupInFlightCount: number;
  workingTreeWatchSetupInFlightCount: number;
  workspaceRefreshInFlightCount: number;
  workspaceRefreshQueuedCount: number;
  fetchInFlightCount: number;
  snapshotUpdatedListenerCount: number;
}

/**
 * What a snapshot emission actually refreshed.
 *
 * `prStatusOnly` marks the hosting PR-status poll's re-broadcast: it refreshed the
 * PR/check block only, and the git block it carries is whatever the last git
 * measurement left behind. Consumers must not treat that git block as news.
 */
export interface WorkspaceGitSnapshotMeta {
  prStatusOnly: boolean;
}

export type WorkspaceGitListener = (
  snapshot: WorkspaceGitRuntimeSnapshot,
  meta: WorkspaceGitSnapshotMeta,
) => void;
export type WorkspaceGitSnapshotUpdatedListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;

export interface WorkspaceGitSubscription {
  unsubscribe: () => void;
}

export type WorkspaceGitReadOptions =
  | {
      force?: false;
      reason?: string;
    }
  | {
      force: true;
      reason: string;
    };

export interface WorkspaceGitBranchSuggestionsOptions {
  query?: string;
  limit?: number;
}

export interface WorkspaceGitStashListOptions {
  ottoOnly?: boolean;
}

export interface WorkspaceGitStashEntry {
  index: number;
  message: string;
  branch: string | null;
  isOtto: boolean;
}

export type WorkspaceGitBranchValidationResult = BranchCheckoutResolution;
export type WorkspaceGitBranchSuggestion = BranchSuggestion;
export type WorkspaceGitWorktreeInfo = OttoWorktreeInfo;

export type WorkspaceGitSnapshotOptions =
  | {
      force?: false;
      includeForge?: boolean;
      reason?: string;
    }
  | {
      force: true;
      includeForge?: boolean;
      reason: string;
    };

interface WorkspaceGitRefreshRequest {
  force: boolean;
  includeForge: boolean;
  reason: string;
  notify: boolean;
  /**
   * True when this request carries a one-shot "the checkout changed" signal - a
   * watcher event, a self-heal tick, a finished fetch - rather than a caller
   * merely wanting to read the snapshot.
   *
   * The distinction decides what happens when a refresh is already in flight. A
   * read can safely join it; a change signal cannot, because the in-flight pass
   * may have already run its git read before the change landed, so joining it
   * means the change is never observed at all. Change signals are queued behind
   * the running pass instead.
   */
  changeSignal: boolean;
}

interface ScheduledWorkspaceGitRefreshOptions {
  force?: boolean;
  includeForge?: boolean;
  reason?: string;
  /**
   * Defaults to true: the scheduled path exists for watcher events and the like.
   * Pass false for a catch-up read that nothing is known to have invalidated.
   */
  changeSignal?: boolean;
}

type WorkspaceGitRefreshState =
  | {
      status: "idle";
    }
  | {
      status: "in-flight";
      promise: Promise<WorkspaceGitRuntimeSnapshot>;
      force: boolean;
      includeForge: boolean;
      queued: WorkspaceGitRefreshRequest | null;
    };

interface WorkspaceGitServiceDependencies {
  watch: typeof watch;
  readdir: typeof readdir;
  getCheckoutSnapshotFacts: typeof getCheckoutSnapshotFacts;
  getCheckoutStatus: typeof getCheckoutStatus;
  getCheckoutIdentity: typeof getCheckoutIdentity;
  getCheckoutShortstat: typeof getCheckoutShortstat;
  getCheckoutDiff: typeof getCheckoutDiff;
  getPullRequestStatus: typeof getPullRequestStatus;
  resolveBranchCheckout: typeof resolveBranchCheckout;
  resolveRepositoryDefaultBranch: typeof resolveRepositoryDefaultBranch;
  listBranchSuggestions: typeof listBranchSuggestions;
  listOttoWorktrees: typeof listOttoWorktrees;
  /**
   * Adapter instances to bind by forge id instead of building from the registry
   * - the injection seam for the daemon's shared GitHub adapter and for test
   * fakes. Any forge not listed here is built (and cached once) by the registry.
   */
  forgeOverrides?: Record<string, ForgeService>;
  /**
   * Otto's provider-neutral hosting layer (docs/git-providers.md). Upstream's forge
   * registry has no equivalent, so this stays a separate seam: it supplies the typed
   * provider id, its capabilities and the credentials state that the wire projection
   * reports. Absent in tests and on hosts with no hosting config.
   */
  resolveHostingForCwd?: (cwd: string) => Promise<{
    providerId: GitHostingProviderId;
    capabilities: GitHostingCapabilities;
    credentialsMissing: boolean;
  }>;
  resolveAbsoluteGitDir: (cwd: string) => Promise<string | null>;
  hasOriginRemote: (cwd: string) => Promise<boolean>;
  runGitFetch: (cwd: string) => Promise<void>;
  runGitCommand: typeof runGitCommand;
  now: () => Date;
}

interface WorkspaceGitServiceOptions {
  logger: pino.Logger;
  ottoHome: string;
  worktreesRoot?: string;
  deps?: Partial<WorkspaceGitServiceDependencies>;
}

interface WorkspaceGitTarget {
  cwd: string;
  listeners: Set<WorkspaceGitListener>;
  watchers: FSWatcher[];
  debounceTimer: NodeJS.Timeout | null;
  pendingDebounceRequest: WorkspaceGitRefreshRequest | null;
  throttleTimer: NodeJS.Timeout | null;
  pendingThrottledRequest: WorkspaceGitRefreshRequest | null;
  selfHealTimer: NodeJS.Timeout | null;
  forgePrStatusPollSubscription: { unsubscribe: () => void } | null;
  forgePrStatusPollKey: string | null;
  refreshState: WorkspaceGitRefreshState;
  latestGit: WorkspaceGitRuntimeSnapshot["git"] | null;
  latestGitLoadedAtMs: number | null;
  latestForge: WorkspaceGitRuntimeSnapshot["forge"] | null;
  latestForgeLoadedAtMs: number | null;
  latestSnapshot: WorkspaceGitRuntimeSnapshot | null;
  latestSnapshotLoadedAtMs: number | null;
  latestFacts: CheckoutSnapshotFacts | null;
  latestFactsLoadedAtMs: number | null;
  factsPromise: Promise<CheckoutSnapshotFacts> | null;
  latestFingerprint: string | null;
  lastShellOutAtMs: number | null;
  /**
   * When this target's git watchers started, or null while it has none.
   *
   * A snapshot measured before this instant is not covered by them: whatever
   * moved in between produced no event and never will. Trusting the cache
   * indefinitely is only sound for a snapshot taken at or after this point.
   */
  watchersStartedAtMs: number | null;
  /**
   * Whether the refresh currently in flight has already read git. Decides
   * whether an incoming change signal can ride along with it or has to queue
   * behind it; see requestWorkspaceSnapshot.
   */
  currentPassReadGit: boolean;
  repoGitRoot: string | null;
  observationSetupPromise: Promise<void> | null;
  observationSetupComplete: boolean;
  closed: boolean;
}

interface RepoGitTarget {
  repoGitRoot: string;
  cwd: string;
  workspaceKeys: Set<string>;
  intervalId: NodeJS.Timeout | null;
  fetchInFlight: boolean;
}

interface WorkingTreeWatchTarget {
  cwd: string;
  repoRoot: string | null;
  repoWatchPath: string | null;
  watchers: FSWatcher[];
  watchedPaths: Set<string>;
  fallbackRefreshInterval: NodeJS.Timeout | null;
  linuxTreeRefreshPromise: Promise<void> | null;
  linuxTreeRefreshQueued: boolean;
  listeners: Set<() => void>;
}

interface WorkspaceGitAuxiliaryReadCacheEntry<T> {
  value: T | null;
  loadedAtMs: number | null;
  lastShellOutAtMs: number | null;
  inFlight: Promise<T> | null;
}

interface WorkspaceForgePrStatusPollTarget {
  headRef: string;
  headSha?: string;
  headRepositoryOwner?: string;
}

/**
 * A path reduced to a form two different producers can be compared on.
 *
 * Auxiliary cache keys are built from two sources that disagree about how a
 * Windows path is spelled: `resolve()` yields backslashes, while anything read
 * out of git (`rev-parse`, and so the repo root every worktree list is keyed by)
 * yields forward slashes. Matching keys as raw text therefore missed exactly the
 * entries that came from git, which is how an archived worktree went on being
 * listed after its directory was removed.
 */
function canonicalPathCacheToken(value: string): string {
  const normalized = resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Whether a cache key is scoped to `canonicalPath`. Keys are JSON arrays of a
 * label plus the read's parameters; only absolute elements can be the directory,
 * so labels and refs ("uncommitted", "main") are never resolved against the
 * process cwd and mistaken for it.
 */
function auxiliaryCacheKeyScopesToPath(key: string, canonicalPath: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) {
    return false;
  }
  return parsed.some(
    (element) =>
      typeof element === "string" &&
      isAbsolute(element) &&
      canonicalPathCacheToken(element) === canonicalPath,
  );
}

function buildDefaultWorkspaceGitServiceDeps(): WorkspaceGitServiceDependencies {
  return {
    watch,
    readdir,
    getCheckoutSnapshotFacts,
    getCheckoutStatus,
    getCheckoutIdentity,
    getCheckoutShortstat,
    getCheckoutDiff,
    getPullRequestStatus,
    resolveBranchCheckout,
    resolveRepositoryDefaultBranch,
    listBranchSuggestions,
    listOttoWorktrees,
    resolveAbsoluteGitDir,
    hasOriginRemote,
    runGitFetch,
    runGitCommand,
    now: () => new Date(),
  };
}

function resolveWorkspaceGitServiceDeps(
  deps: Partial<WorkspaceGitServiceDependencies> | undefined,
): WorkspaceGitServiceDependencies {
  return { ...buildDefaultWorkspaceGitServiceDeps(), ...deps };
}

export class WorkspaceGitServiceImpl implements WorkspaceGitService {
  private readonly logger: pino.Logger;
  private readonly ottoHome: string;
  private readonly worktreesRoot: string | undefined;
  private readonly deps: WorkspaceGitServiceDependencies;
  private readonly forgeResolver: ForgeResolver;
  private readonly snapshotUpdatedListeners = new Set<WorkspaceGitSnapshotUpdatedListener>();
  private readonly workspaceTargets = new Map<string, WorkspaceGitTarget>();
  private readonly repoTargets = new Map<string, RepoGitTarget>();
  /** Resolved cwd of the workspace the client is in; see `setActiveWorkspace`. */
  private activeWorkspaceCwd: string | null = null;
  private readonly workingTreeWatchTargets = new Map<string, WorkingTreeWatchTarget>();
  private readonly workingTreeWatchSetups = new Map<string, Promise<WorkingTreeWatchTarget>>();
  private readonly linuxIgnoredDirsCache = new Map<
    string,
    { ignored: Set<string>; ignoredRelative: Set<string>; ts: number }
  >();
  private readonly linuxIgnoredDirsInFlight = new Map<string, Promise<Set<string>>>();
  private readonly branchValidationCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitBranchValidationResult>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly localBranchCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<boolean>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly branchSuggestionsCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitBranchSuggestion[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly stashListCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitStashEntry[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly worktreeListCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<WorkspaceGitWorktreeInfo[]>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly defaultBranchCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<string>
  >({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
  private readonly checkoutDiffCache = new LRUCache<
    string,
    WorkspaceGitAuxiliaryReadCacheEntry<CheckoutDiffResult>
  >({ max: WORKSPACE_GIT_CHECKOUT_DIFF_CACHE_MAX });
  constructor(options: WorkspaceGitServiceOptions) {
    this.logger = options.logger.child({ module: "workspace-git-service" });
    this.ottoHome = options.ottoHome;
    this.worktreesRoot = options.worktreesRoot;
    this.deps = resolveWorkspaceGitServiceDeps(options.deps);
    this.forgeResolver = createForgeResolver({
      createService: (forge) => this.deps.forgeOverrides?.[forge] ?? createForgeService(forge),
    });
  }

  resolveForge(cwd: string): Promise<ForgeResolution | null> {
    return this.forgeResolver.resolve(resolve(cwd));
  }

  registerWorkspace(
    params: { cwd: string },
    listener: WorkspaceGitListener,
  ): WorkspaceGitSubscription {
    const cwd = resolve(params.cwd);
    const target = this.ensureWorkspaceTarget(cwd);
    target.listeners.add(listener);
    if (target.listeners.size === 1) {
      this.startWorkspaceSubscriptionTimers(target);
    }
    if (!target.latestSnapshot) {
      this.scheduleInitialWorkspaceRefresh(target);
    }
    this.scheduleWorkspaceObservationSetup(target);

    return {
      unsubscribe: () => {
        this.removeWorkspaceListener(cwd, listener);
      },
    };
  }

  onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription {
    this.snapshotUpdatedListeners.add(listener);
    return {
      unsubscribe: () => {
        this.snapshotUpdatedListeners.delete(listener);
      },
    };
  }

  getMetrics(): WorkspaceGitServiceMetrics {
    let workspaceListenerCount = 0;
    let repositoryWorkspaceLinkCount = 0;
    let workingTreeWatchListenerCount = 0;
    let workspaceRefreshInFlightCount = 0;
    let workspaceRefreshQueuedCount = 0;
    let workspaceObservationSetupInFlightCount = 0;
    let fetchInFlightCount = 0;

    for (const target of this.workspaceTargets.values()) {
      workspaceListenerCount += target.listeners.size;
      if (target.observationSetupPromise) {
        workspaceObservationSetupInFlightCount += 1;
      }
      if (target.refreshState.status === "in-flight") {
        workspaceRefreshInFlightCount += 1;
        if (target.refreshState.queued) {
          workspaceRefreshQueuedCount += 1;
        }
      }
    }
    for (const target of this.repoTargets.values()) {
      repositoryWorkspaceLinkCount += target.workspaceKeys.size;
      if (target.fetchInFlight) {
        fetchInFlightCount += 1;
      }
    }
    for (const target of this.workingTreeWatchTargets.values()) {
      workingTreeWatchListenerCount += target.listeners.size;
    }

    return {
      workspaceTargetCount: this.workspaceTargets.size,
      workspaceListenerCount,
      repositoryTargetCount: this.repoTargets.size,
      repositoryWorkspaceLinkCount,
      workingTreeWatchTargetCount: this.workingTreeWatchTargets.size,
      workingTreeWatchListenerCount,
      workspaceObservationSetupInFlightCount,
      workingTreeWatchSetupInFlightCount: this.workingTreeWatchSetups.size,
      workspaceRefreshInFlightCount,
      workspaceRefreshQueuedCount,
      fetchInFlightCount,
      snapshotUpdatedListenerCount: this.snapshotUpdatedListeners.size,
    };
  }

  async getSnapshot(
    cwd: string,
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    cwd = resolve(cwd);
    const request = this.normalizeRefreshRequest(options, "getSnapshot", true);
    const target = this.ensureWorkspaceTarget(cwd);
    if (!request.force && target.latestSnapshot) {
      if (this.isSnapshotCacheTrustworthy(target)) {
        return target.latestSnapshot;
      }
      // Watched, but by watchers that started after this entry was measured.
      // Re-read once so the entry the watchers vouch for is one they could
      // actually have seen change. Forced deliberately: an unforced read passes
      // `allowRecent` down to loadCheckoutFacts, which reuses facts on its own
      // window, so it would hand back the same stale branch it is replacing.
      return this.requestWorkspaceSnapshot(target, {
        ...request,
        force: true,
        reason: "snapshot-predates-watchers",
      });
    }

    return this.requestWorkspaceSnapshot(target, request);
  }

  async getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload> {
    const normalizedCwd = resolve(cwd);
    const status = await this.deps.getCheckoutStatus(normalizedCwd, {
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      logger: this.logger,
    });
    if (!status.isGit) {
      return checkoutLiteFromGitSnapshot(normalizedCwd, {
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        repoRoot: null,
        isOttoOwnedWorktree: false,
        mainRepoRoot: null,
      });
    }
    return checkoutLiteFromGitSnapshot(normalizedCwd, {
      isGit: true,
      currentBranch: status.currentBranch,
      remoteUrl: status.remoteUrl,
      repoRoot: status.repoRoot,
      isOttoOwnedWorktree: status.isOttoOwnedWorktree,
      mainRepoRoot: status.mainRepoRoot,
    });
  }

  async getCheckoutLite(cwd: string): Promise<ProjectCheckoutLitePayload> {
    const normalizedCwd = resolve(cwd);
    const identity = await this.deps.getCheckoutIdentity(normalizedCwd, {
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      logger: this.logger,
    });
    if (!identity.isGit) {
      return checkoutLiteFromGitSnapshot(normalizedCwd, {
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        repoRoot: null,
        isOttoOwnedWorktree: false,
        mainRepoRoot: null,
      });
    }
    return checkoutLiteFromGitSnapshot(normalizedCwd, {
      isGit: true,
      currentBranch: identity.currentBranch,
      remoteUrl: identity.remoteUrl,
      repoRoot: identity.repoRoot,
      isOttoOwnedWorktree: identity.isOttoOwnedWorktree,
      mainRepoRoot: identity.mainRepoRoot,
    });
  }

  peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null {
    cwd = resolve(cwd);
    return this.workspaceTargets.get(cwd)?.latestSnapshot ?? null;
  }

  getCheckoutDiff(
    cwd: string,
    options: CheckoutDiffCompare,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<CheckoutDiffResult> {
    const normalizedCwd = resolve(cwd);
    const normalizedOptions = this.normalizeCheckoutDiffOptions(options);
    const key = this.buildCheckoutDiffCacheKey(normalizedCwd, normalizedOptions);
    return this.readAuxiliaryCache(this.checkoutDiffCache, key, readOptions, () =>
      this.deps.getCheckoutDiff(normalizedCwd, normalizedOptions, {
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
      }),
    );
  }

  private normalizeCheckoutDiffOptions(options: CheckoutDiffCompare): CheckoutDiffCompare {
    return {
      mode: options.mode,
      ...(options.mode === "base" && options.baseRef !== undefined
        ? { baseRef: options.baseRef }
        : {}),
      ...(options.ignoreWhitespace === true ? { ignoreWhitespace: true } : {}),
      ...(options.includeStructured === true ? { includeStructured: true } : {}),
    };
  }

  private buildCheckoutDiffCacheKey(cwd: string, options: CheckoutDiffCompare): string {
    // Diff content varies by compare signature. Keep the cache per exact diff read shape so
    // hot diff panes coalesce while base refs and rendering options never share stale patches.
    return JSON.stringify([
      "checkout-diff",
      cwd,
      options.mode,
      options.mode === "base" ? (options.baseRef ?? null) : null,
      options.ignoreWhitespace === true,
      options.includeStructured === true,
    ]);
  }

  validateBranchRef(
    cwd: string,
    ref: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchValidationResult> {
    const normalizedCwd = resolve(cwd);
    const normalizedRef = ref.trim();
    const key = JSON.stringify(["branch-validation", normalizedCwd, normalizedRef]);
    return this.readAuxiliaryCache(this.branchValidationCache, key, options, () =>
      this.deps.resolveBranchCheckout(normalizedCwd, normalizedRef),
    );
  }

  hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean> {
    const normalizedCwd = resolve(cwd);
    const normalizedBranch = branch.trim();
    const ref = `refs/heads/${normalizedBranch}`;
    const key = JSON.stringify(["local-branch", normalizedCwd, ref]);
    return this.readAuxiliaryCache(this.localBranchCache, key, options, async () => {
      const result = await this.deps.runGitCommand(["rev-parse", "--verify", "--quiet", ref], {
        cwd: normalizedCwd,
        envOverlay: READ_ONLY_GIT_ENV,
        acceptExitCodes: [0, 1],
      });
      return result.exitCode === 0;
    });
  }

  suggestBranchesForCwd(
    cwd: string,
    options?: WorkspaceGitBranchSuggestionsOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitBranchSuggestion[]> {
    const normalizedCwd = resolve(cwd);
    const query = options?.query ?? "";
    const limit = options?.limit;
    const key = JSON.stringify(["branch-suggestions", normalizedCwd, query, limit ?? null]);
    return this.readAuxiliaryCache(this.branchSuggestionsCache, key, readOptions, () =>
      this.deps.listBranchSuggestions(normalizedCwd, options),
    );
  }

  listStashes(
    cwd: string,
    options?: WorkspaceGitStashListOptions,
    readOptions?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitStashEntry[]> {
    const normalizedCwd = resolve(cwd);
    const ottoOnly = options?.ottoOnly !== false;
    const key = JSON.stringify(["stashes", normalizedCwd, ottoOnly]);
    return this.readAuxiliaryCache(this.stashListCache, key, readOptions, async () => {
      const { stdout } = await this.deps.runGitCommand(["stash", "list", "--format=%gd%x00%s"], {
        cwd: normalizedCwd,
        envOverlay: READ_ONLY_GIT_ENV,
      });
      return parseWorkspaceGitStashList(stdout, { ottoOnly });
    });
  }

  async listWorktrees(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<WorkspaceGitWorktreeInfo[]> {
    const repoRoot = await this.resolveRepoRoot(cwdOrRepoRoot, options);
    const key = JSON.stringify(["worktrees", repoRoot]);
    return this.readAuxiliaryCache(this.worktreeListCache, key, options, () =>
      this.deps.listOttoWorktrees({
        cwd: repoRoot,
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
      }),
    );
  }

  async resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string> {
    const snapshot = await this.getSnapshot(cwd, options);
    if (!snapshot.git.isGit) {
      throw new Error("Create worktree requires a git repository");
    }

    return snapshot.git.isOttoOwnedWorktree
      ? (snapshot.git.mainRepoRoot ?? snapshot.git.repoRoot ?? resolve(cwd))
      : (snapshot.git.repoRoot ?? resolve(cwd));
  }

  async resolveDefaultBranch(
    cwdOrRepoRoot: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<string> {
    const cwd = resolve(cwdOrRepoRoot);
    const key = JSON.stringify(["default-branch", cwd]);
    return this.readAuxiliaryCache(this.defaultBranchCache, key, options, async () => {
      const defaultBranch = await this.deps.resolveRepositoryDefaultBranch(cwd);
      if (!defaultBranch) {
        throw new Error("Unable to resolve repository default branch");
      }
      return defaultBranch;
    });
  }

  async getProjectSlug(cwd: string, options?: WorkspaceGitReadOptions): Promise<string> {
    const snapshot = await this.getSnapshot(cwd, options);
    return deriveProjectSlug(resolve(cwd), snapshot.git.isGit ? snapshot.git.remoteUrl : null);
  }

  async resolveRepoRemoteUrl(
    cwd: string,
    options?: WorkspaceGitReadOptions,
  ): Promise<string | null> {
    const snapshot = await this.getSnapshot(cwd, options);
    return snapshot.git.remoteUrl;
  }

  async refresh(cwd: string, _options?: { priority?: "normal" | "high" }): Promise<void> {
    cwd = resolve(cwd);
    const target = this.ensureWorkspaceTarget(cwd);
    await this.refreshWorkspaceTarget(target, {
      force: false,
      includeForge: false,
      reason: "refresh",
      notify: true,
      changeSignal: true,
    });
    this.scheduleWorkspaceObservationSetup(target);
  }

  async requestWorkingTreeWatch(
    cwd: string,
    onChange: () => void,
  ): Promise<{ repoRoot: string | null; unsubscribe: () => void }> {
    cwd = resolve(cwd);
    const target = await this.ensureWorkingTreeWatchTarget(cwd);
    target.listeners.add(onChange);

    return {
      repoRoot: target.repoRoot,
      unsubscribe: () => {
        this.removeWorkingTreeWatchListener(cwd, onChange);
      },
    };
  }

  scheduleRefreshForCwd(cwd: string): void {
    cwd = resolve(cwd);
    const target = this.workspaceTargets.get(cwd);
    if (target) {
      this.scheduleWorkspaceRefresh(target);
    }
  }

  onWorkspaceStateMayHaveChanged(cwd: string): void {
    const normalizedCwd = resolve(cwd);
    const target = this.workspaceTargets.get(normalizedCwd);
    if (!target || target.closed) {
      return;
    }
    this.invalidateForge(normalizedCwd);
    this.scheduleWorkspaceRefresh(target, {
      force: true,
      includeForge: true,
      reason: "external-state-change",
    });
  }

  /**
   * Drop the resolved forge adapter's cached state for a cwd. Goes through the
   * resolver so it targets the same adapter instance the poller reads - used by
   * git mutations to force a fresh forge status on the next refresh.
   */
  invalidateForge(cwd: string): void {
    this.forgeResolver.invalidate(resolve(cwd));
  }

  /**
   * Drop every cwd-scoped auxiliary read (diffs, stash list, branch lookups).
   *
   * These caches have a 15s TTL and no invalidation, which is fine for reads
   * the daemon does not cause. A mutation it performs itself is different: the
   * daemon knows the answer just changed, so serving the pre-mutation value is
   * a straight lie. Committing and then reading the uncommitted diff returned
   * the files that had just been committed for the rest of the window.
   *
   * Snapshot state is not touched here; mutation callers force-refresh that
   * separately.
   */
  invalidateAuxiliaryReads(cwd: string): void {
    const target = canonicalPathCacheToken(cwd);
    const caches = [
      this.checkoutDiffCache,
      this.branchValidationCache,
      this.localBranchCache,
      this.branchSuggestionsCache,
      this.stashListCache,
      this.worktreeListCache,
      this.defaultBranchCache,
    ];
    for (const cache of caches) {
      const staleKeys: string[] = [];
      for (const key of cache.keys()) {
        if (auxiliaryCacheKeyScopesToPath(key, target)) {
          staleKeys.push(key);
        }
      }
      for (const key of staleKeys) {
        cache.delete(key);
      }
    }
  }

  dispose(): void {
    for (const target of this.workspaceTargets.values()) {
      this.closeWorkspaceTarget(target);
    }
    this.workspaceTargets.clear();

    for (const target of this.repoTargets.values()) {
      this.closeRepoTarget(target);
    }
    this.repoTargets.clear();

    for (const target of this.workingTreeWatchTargets.values()) {
      this.closeWorkingTreeWatchTarget(target);
    }
    this.workingTreeWatchTargets.clear();
    this.workingTreeWatchSetups.clear();
    this.snapshotUpdatedListeners.clear();
  }

  private ensureWorkspaceTarget(cwd: string): WorkspaceGitTarget {
    const existingTarget = this.workspaceTargets.get(cwd);
    if (existingTarget) {
      return existingTarget;
    }

    return this.createWorkspaceTarget(cwd);
  }

  private readAuxiliaryCache<T>(
    cache: LRUCache<string, WorkspaceGitAuxiliaryReadCacheEntry<T>>,
    key: string,
    options: WorkspaceGitReadOptions | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    if (options?.force && !options.reason) {
      throw new Error("WorkspaceGitService forced read requires a reason");
    }

    const entry = this.ensureAuxiliaryCacheEntry(cache, key);
    const nowMs = this.deps.now().getTime();
    if (!options?.force && entry.value !== null && entry.loadedAtMs !== null) {
      const ageMs = nowMs - entry.loadedAtMs;
      if (ageMs <= WORKSPACE_GIT_AUXILIARY_READ_TTL_MS) {
        return Promise.resolve(entry.value);
      }
      if (
        entry.lastShellOutAtMs !== null &&
        nowMs - entry.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS
      ) {
        return Promise.resolve(entry.value);
      }
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    entry.lastShellOutAtMs = nowMs;
    entry.inFlight = load()
      .then((value) => {
        entry.value = value;
        entry.loadedAtMs = this.deps.now().getTime();
        return value;
      })
      .finally(() => {
        entry.inFlight = null;
      });
    return entry.inFlight;
  }

  private ensureAuxiliaryCacheEntry<T>(
    cache: LRUCache<string, WorkspaceGitAuxiliaryReadCacheEntry<T>>,
    key: string,
  ): WorkspaceGitAuxiliaryReadCacheEntry<T> {
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }

    const entry: WorkspaceGitAuxiliaryReadCacheEntry<T> = {
      value: null,
      loadedAtMs: null,
      lastShellOutAtMs: null,
      inFlight: null,
    };
    cache.set(key, entry);
    return entry;
  }

  private async ensureWorkingTreeWatchTarget(cwd: string): Promise<WorkingTreeWatchTarget> {
    const existingTarget = this.workingTreeWatchTargets.get(cwd);
    if (existingTarget) {
      return existingTarget;
    }

    const existingSetup = this.workingTreeWatchSetups.get(cwd);
    if (existingSetup) {
      return existingSetup;
    }

    const setup = this.createWorkingTreeWatchTarget(cwd).finally(() => {
      this.workingTreeWatchSetups.delete(cwd);
    });
    this.workingTreeWatchSetups.set(cwd, setup);
    return setup;
  }

  private createWorkspaceTarget(cwd: string): WorkspaceGitTarget {
    const target: WorkspaceGitTarget = {
      cwd,
      listeners: new Set(),
      watchers: [],
      debounceTimer: null,
      pendingDebounceRequest: null,
      throttleTimer: null,
      pendingThrottledRequest: null,
      selfHealTimer: null,
      forgePrStatusPollSubscription: null,
      forgePrStatusPollKey: null,
      refreshState: { status: "idle" },
      latestGit: null,
      latestGitLoadedAtMs: null,
      latestForge: null,
      latestForgeLoadedAtMs: null,
      latestSnapshot: null,
      latestSnapshotLoadedAtMs: null,
      latestFacts: null,
      latestFactsLoadedAtMs: null,
      factsPromise: null,
      latestFingerprint: null,
      lastShellOutAtMs: null,
      watchersStartedAtMs: null,
      currentPassReadGit: false,
      repoGitRoot: null,
      observationSetupPromise: null,
      observationSetupComplete: false,
      closed: false,
    };

    this.workspaceTargets.set(cwd, target);
    return target;
  }

  private scheduleInitialWorkspaceRefresh(target: WorkspaceGitTarget): void {
    queueMicrotask(() => {
      if (!this.isActiveObservedWorkspaceTarget(target) || target.latestSnapshot) {
        return;
      }
      void this.refreshWorkspaceTarget(target, {
        force: false,
        // Git only. Forge facts arrive on their own poll cadence
        // (retainCurrentPullRequestStatusPoll), so registering a workspace -
        // which the sidebar does for every row it lists - never blocks on a
        // forge CLI round-trip.
        includeForge: false,
        reason: "initial",
        notify: true,
        // Nothing to coalesce behind: this only runs when the target has no
        // snapshot at all.
        changeSignal: false,
      });
    });
  }

  private scheduleWorkspaceObservationSetup(target: WorkspaceGitTarget): void {
    if (
      target.observationSetupComplete ||
      target.observationSetupPromise ||
      !this.isActiveObservedWorkspaceTarget(target)
    ) {
      return;
    }

    target.observationSetupPromise = Promise.resolve()
      .then(() => this.setupWorkspaceObservation(target))
      .catch((error) => {
        this.logger.warn(
          { err: error, cwd: target.cwd },
          "Failed to set up workspace git observation",
        );
      })
      .finally(() => {
        target.observationSetupPromise = null;
      });
  }

  private async setupWorkspaceObservation(target: WorkspaceGitTarget): Promise<void> {
    const facts = await this.getFactsForObservation(target);
    const gitDir = facts?.isGit ? facts.absoluteGitDir : null;
    if (!this.isActiveObservedWorkspaceTarget(target)) {
      return;
    }
    if (!gitDir) {
      target.observationSetupComplete = true;
      return;
    }

    const repoGitRoot =
      facts?.isGit && facts.gitCommonDir
        ? facts.gitCommonDir
        : await this.resolveWorkspaceGitRefsRoot(gitDir);
    if (!this.isActiveObservedWorkspaceTarget(target)) {
      return;
    }
    target.repoGitRoot = repoGitRoot;
    this.startWorkspaceWatchers(target, gitDir, repoGitRoot);
    // Any snapshot taken before the watchers existed describes a checkout the
    // watchers never saw. Re-measure it, or a branch that moved during setup -
    // registration is asynchronous and lands well after the first status read -
    // stays cached forever, since from here on the entry is authoritative.
    // Scheduled rather than awaited, so registering a workspace still returns
    // without blocking on git.
    if (target.latestSnapshot && !this.isSnapshotCoveredByWatchers(target)) {
      this.scheduleWorkspaceRefresh(target, { reason: "observation-started" });
    }
    await this.ensureRepoTarget(target);
    if (this.isActiveObservedWorkspaceTarget(target)) {
      target.observationSetupComplete = true;
    }
  }

  private async getFactsForObservation(
    target: WorkspaceGitTarget,
  ): Promise<CheckoutSnapshotFacts | null> {
    return this.loadCheckoutFacts(target, {
      ottoHome: this.ottoHome,
      logger: this.logger,
      allowRecent: true,
    });
  }

  private loadCheckoutFacts(
    target: WorkspaceGitTarget,
    options: CheckoutContext & { allowRecent: boolean },
  ): Promise<CheckoutSnapshotFacts> {
    if (options.allowRecent && target.latestFacts && target.latestFactsLoadedAtMs !== null) {
      const ageMs = this.deps.now().getTime() - target.latestFactsLoadedAtMs;
      if (ageMs < WORKSPACE_GIT_FACTS_REUSE_TTL_MS) {
        return Promise.resolve(target.latestFacts);
      }
    }

    if (target.factsPromise) {
      return target.factsPromise;
    }

    const { allowRecent: _allowRecent, ...context } = options;
    const promise = this.deps
      .getCheckoutSnapshotFacts(target.cwd, context)
      .then((facts) => {
        target.latestFacts = facts;
        target.latestFactsLoadedAtMs = this.deps.now().getTime();
        return facts;
      })
      .finally(() => {
        if (target.factsPromise === promise) {
          target.factsPromise = null;
        }
      });
    target.factsPromise = promise;
    return promise;
  }

  /**
   * Whether `target.latestSnapshot` can be returned without re-reading git.
   *
   * Snapshots do not expire on read: a caller that needs a fresh measurement
   * forces one, and an unwatched target has nobody promising it anything. The
   * single exception is a target that IS watched but whose entry predates its
   * own watchers. There the daemon is making a promise it cannot keep, because
   * whatever moved before the watchers started produced no event and never
   * will.
   */
  private isSnapshotCacheTrustworthy(target: WorkspaceGitTarget): boolean {
    if (!this.isActiveObservedWorkspaceTarget(target) || !target.observationSetupComplete) {
      return true;
    }
    return this.isSnapshotCoveredByWatchers(target);
  }

  /**
   * Whether the cached snapshot was measured while the watchers were already
   * running. Only then does "no event since" actually mean "nothing changed".
   */
  private isSnapshotCoveredByWatchers(target: WorkspaceGitTarget): boolean {
    return (
      target.watchersStartedAtMs !== null &&
      target.latestSnapshotLoadedAtMs !== null &&
      target.latestSnapshotLoadedAtMs >= target.watchersStartedAtMs
    );
  }

  private isActiveObservedWorkspaceTarget(target: WorkspaceGitTarget): boolean {
    return (
      !target.closed &&
      target.listeners.size > 0 &&
      this.workspaceTargets.get(target.cwd) === target
    );
  }

  private async createWorkingTreeWatchTarget(cwd: string): Promise<WorkingTreeWatchTarget> {
    const repoRoot = await this.resolveCheckoutWatchRoot(cwd);
    const target: WorkingTreeWatchTarget = {
      cwd,
      repoRoot,
      repoWatchPath: null,
      watchers: [],
      watchedPaths: new Set<string>(),
      fallbackRefreshInterval: null,
      linuxTreeRefreshPromise: null,
      linuxTreeRefreshQueued: false,
      listeners: new Set(),
    };

    const repoWatchPath = repoRoot ?? cwd;
    target.repoWatchPath = repoWatchPath;
    const watchPaths = new Set<string>([repoWatchPath]);
    const gitDir = await this.deps.resolveAbsoluteGitDir(cwd);
    if (gitDir) {
      watchPaths.add(gitDir);
    }

    let hasRecursiveRepoCoverage = false;
    const allowRecursiveRepoWatch = process.platform !== "linux";
    if (process.platform === "linux") {
      hasRecursiveRepoCoverage = await this.ensureLinuxRepoTreeWatchers(target, repoWatchPath);
    }
    for (const watchPath of watchPaths) {
      if (process.platform === "linux" && watchPath === repoWatchPath) {
        continue;
      }
      const shouldTryRecursive = watchPath === repoWatchPath && allowRecursiveRepoWatch;
      const watcherIsRecursive = this.addWorkingTreeWatcher(target, watchPath, shouldTryRecursive);
      if (watchPath === repoWatchPath && watcherIsRecursive) {
        hasRecursiveRepoCoverage = true;
        // Arm the recursive watcher's ignore filter now rather than on its first event, so
        // a build that starts churning immediately is filtered from the first write.
        void this.loadLinuxIgnoredDirs(repoWatchPath).catch(() => {});
      }
    }

    const missingRepoCoverage = repoRoot === null || !hasRecursiveRepoCoverage;
    if (target.watchers.length === 0 || missingRepoCoverage) {
      target.fallbackRefreshInterval = setInterval(() => {
        this.scheduleWorkspaceRefresh(cwd, {
          force: true,
          reason: "working-tree-watch-fallback",
        });
        for (const listener of target.listeners) {
          listener();
        }
      }, WORKING_TREE_WATCH_FALLBACK_REFRESH_MS);
      this.logger.warn(
        {
          cwd,
          intervalMs: WORKING_TREE_WATCH_FALLBACK_REFRESH_MS,
          reason:
            target.watchers.length === 0 ? "no_watchers" : "missing_recursive_repo_root_coverage",
        },
        "Working tree watchers unavailable; using timed refresh fallback",
      );
    }

    this.workingTreeWatchTargets.set(cwd, target);
    return target;
  }

  private async resolveCheckoutWatchRoot(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await this.deps.runGitCommand(["rev-parse", "--show-toplevel"], {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
      });
      return parseGitRevParsePath(stdout);
    } catch {
      return null;
    }
  }

  private async resolveWorkspaceGitRefsRoot(gitDir: string): Promise<string> {
    try {
      const commonDir = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
      if (commonDir.length > 0) {
        return resolve(gitDir, commonDir);
      }
    } catch {
      return gitDir;
    }

    return gitDir;
  }

  private startWorkspaceWatchers(
    target: WorkspaceGitTarget,
    gitDir: string,
    repoGitRoot: string,
  ): void {
    // Watch the *directories*, never `HEAD` itself.
    //
    // Git does not edit HEAD in place: `git checkout` writes `HEAD.lock` and renames it
    // over HEAD. A watch on the file path binds to the inode, so after the first
    // checkout the watcher was holding an unlinked file and went permanently deaf -
    // which is why switching branches in a terminal never reached the Changes sidebar.
    // A directory watch sees the rename, because the rename is an event *in* the
    // directory. `filename` is filtered so the rest of `.git`'s churn (index.lock,
    // COMMIT_EDITMSG, ORIG_HEAD) does not schedule a refresh; a null filename is rare
    // and refreshes anyway, since a missed branch switch costs more than a debounced
    // extra snapshot.
    const watchTargets: { path: string; matches: (filename: string | null) => boolean }[] = [
      { path: gitDir, matches: (filename) => filename === null || filename === "HEAD" },
      { path: join(repoGitRoot, "refs", "heads"), matches: () => true },
    ];

    for (const { path: watchPath, matches } of watchTargets) {
      let watcher: FSWatcher | null = null;
      try {
        watcher = this.deps.watch(watchPath, { recursive: false }, (_event, filename) => {
          if (!matches(typeof filename === "string" ? filename : null)) {
            return;
          }
          this.scheduleWorkspaceRefresh(target);
        });
      } catch (error) {
        this.logger.warn(
          { err: error, cwd: target.cwd, watchPath },
          "Failed to start workspace git watcher",
        );
      }

      if (!watcher) {
        continue;
      }

      watcher.on("error", (error) => {
        this.logger.warn({ err: error, cwd: target.cwd, watchPath }, "Workspace git watcher error");
      });
      target.watchers.push(watcher);
    }

    // Stamped only when a watcher actually took. A target whose watches all
    // failed keeps `null` here and falls back to the unobserved TTL rather than
    // silently pretending it is covered.
    if (target.watchers.length > 0) {
      target.watchersStartedAtMs = this.deps.now().getTime();
    }
  }

  private async ensureRepoTarget(workspaceTarget: WorkspaceGitTarget): Promise<void> {
    const repoGitRoot = workspaceTarget.repoGitRoot;
    if (!repoGitRoot || !this.isActiveObservedWorkspaceTarget(workspaceTarget)) {
      return;
    }

    const existingTarget = this.repoTargets.get(repoGitRoot);
    if (existingTarget) {
      existingTarget.workspaceKeys.add(workspaceTarget.cwd);
      return;
    }

    const facts = workspaceTarget.latestFacts;
    const hasOrigin =
      facts?.isGit === true
        ? facts.remoteUrl !== null
        : await this.deps.hasOriginRemote(workspaceTarget.cwd);
    if (!this.isActiveObservedWorkspaceTarget(workspaceTarget)) {
      return;
    }
    if (!hasOrigin) {
      return;
    }

    const targetAfterProbe = this.repoTargets.get(repoGitRoot);
    if (targetAfterProbe) {
      targetAfterProbe.workspaceKeys.add(workspaceTarget.cwd);
      return;
    }

    const repoTarget: RepoGitTarget = {
      repoGitRoot,
      cwd: workspaceTarget.cwd,
      workspaceKeys: new Set([workspaceTarget.cwd]),
      intervalId: null,
      fetchInFlight: false,
    };
    this.repoTargets.set(repoGitRoot, repoTarget);
    // A background `git fetch` is the most expensive periodic thing here - it is network
    // I/O, not just process spawning - so it is the last thing that should run for a repo
    // the user is not in. Both the timer and the immediate first fetch are gated.
    if (this.isActiveWorkspaceTarget(workspaceTarget)) {
      this.startRepoFetchTimer(repoTarget);
      void this.runRepoFetch(repoTarget);
    }
  }

  private startRepoFetchTimer(target: RepoGitTarget): void {
    if (target.intervalId) {
      return;
    }
    target.intervalId = setInterval(() => {
      void this.runRepoFetch(target);
    }, BACKGROUND_GIT_FETCH_INTERVAL_MS);
  }

  private stopRepoFetchTimer(target: RepoGitTarget): void {
    if (!target.intervalId) {
      return;
    }
    clearInterval(target.intervalId);
    target.intervalId = null;
  }

  private stopWorkspacePeriodicWork(target: WorkspaceGitTarget): void {
    if (target.selfHealTimer) {
      clearInterval(target.selfHealTimer);
      target.selfHealTimer = null;
    }
    this.stopForgePrStatusPollForTarget(target);
  }

  setActiveWorkspace(cwd: string | null): void {
    const next = cwd === null ? null : resolve(cwd);
    if (next === this.activeWorkspaceCwd) {
      return;
    }
    this.activeWorkspaceCwd = next;
    this.applyActiveWorkspacePolicy();
  }

  private isActiveWorkspaceTarget(target: WorkspaceGitTarget): boolean {
    return this.activeWorkspaceCwd !== null && target.cwd === this.activeWorkspaceCwd;
  }

  /**
   * Start periodic work on whatever is now active and stop it everywhere else. The newly
   * active workspace also gets one refresh, because it may have gone stale while dormant
   * and the user is looking at it right now.
   */
  private applyActiveWorkspacePolicy(): void {
    for (const target of this.workspaceTargets.values()) {
      if (this.isActiveWorkspaceTarget(target)) {
        this.startWorkspaceSubscriptionTimers(target);
        // A catch-up read, not a change signal: nothing is known to have moved,
        // this workspace is simply the one being looked at now. If the throttle
        // turns it away because a measurement was just taken, that measurement
        // is the catch-up, and re-firing it later would restart polling the user
        // has since navigated away from.
        this.scheduleWorkspaceRefresh(target, { reason: "became-active", changeSignal: false });
      } else {
        this.stopWorkspacePeriodicWork(target);
      }
    }

    for (const repoTarget of this.repoTargets.values()) {
      const holdsActive = [...repoTarget.workspaceKeys].some(
        (key) => key === this.activeWorkspaceCwd,
      );
      if (holdsActive) {
        this.startRepoFetchTimer(repoTarget);
      } else {
        this.stopRepoFetchTimer(repoTarget);
      }
    }
  }

  private scheduleWorkspaceRefresh(
    targetOrCwd: WorkspaceGitTarget | string,
    options?: ScheduledWorkspaceGitRefreshOptions,
  ): void {
    const target =
      typeof targetOrCwd === "string"
        ? this.workspaceTargets.get(resolve(targetOrCwd))
        : targetOrCwd;
    if (!target || target.closed || this.workspaceTargets.get(target.cwd) !== target) {
      return;
    }

    const request = this.buildScheduledRefreshRequest(options);
    target.pendingDebounceRequest = this.mergeRefreshRequests(
      target.pendingDebounceRequest,
      request,
    );

    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
    }

    target.debounceTimer = setTimeout(() => {
      if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
        return;
      }
      target.debounceTimer = null;
      const merged = target.pendingDebounceRequest;
      target.pendingDebounceRequest = null;
      if (merged) {
        void this.refreshWorkspaceTarget(target, merged);
      }
    }, WORKSPACE_GIT_WATCH_DEBOUNCE_MS);
  }

  private startWorkspaceSubscriptionTimers(target: WorkspaceGitTarget): void {
    // A workspace nobody is looking at does not poll. `applyActiveWorkspacePolicy` starts
    // this the moment it becomes active, so nothing is lost, only deferred.
    if (!this.isActiveWorkspaceTarget(target)) {
      return;
    }
    if (!target.selfHealTimer) {
      target.selfHealTimer = setInterval(() => {
        this.scheduleWorkspaceObservationSetup(target);
        this.refreshWorkspaceTarget(target, {
          force: false,
          includeForge: false,
          reason: "self-heal-git",
          notify: true,
          // A poll, not a signal. It re-reads on a timer to catch anything the
          // watchers missed, so a throttled tick has lost nothing the next tick
          // will not pick up.
          changeSignal: false,
        }).catch((error) => {
          this.logger.warn(
            { err: error, cwd: target.cwd, reason: "self-heal-git" },
            "Failed to run workspace git self-heal refresh",
          );
        });
      }, WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS);
    }

    this.updateForgePrStatusPollForTarget(target);
  }

  private updateForgePrStatusPollForTarget(target: WorkspaceGitTarget): void {
    if (target.listeners.size === 0) {
      this.stopForgePrStatusPollForTarget(target);
      return;
    }

    const git = target.latestGit;
    if (!git?.remoteUrl) {
      this.stopForgePrStatusPollForTarget(target);
      return;
    }

    const resolution = this.forgeResolver.resolveFromRemoteUrl(git.remoteUrl);
    if (!resolution) {
      this.stopForgePrStatusPollForTarget(target);
      return;
    }

    const pollTarget = this.resolveForgePrStatusPollTarget(target);
    const remoteUrl = git.remoteUrl;
    if (!pollTarget) {
      this.stopForgePrStatusPollForTarget(target);
      return;
    }
    const pollKey = buildWorkspaceForgePrStatusPollKey({
      forge: resolution.forge,
      remoteUrl,
      target: pollTarget,
    });
    const previousPollKey = target.forgePrStatusPollKey;
    if (target.forgePrStatusPollKey === pollKey && target.forgePrStatusPollSubscription) {
      return;
    }
    const pollImmediately = previousPollKey !== null && previousPollKey !== pollKey;

    this.stopForgePrStatusPollForTarget(target);
    target.forgePrStatusPollKey = pollKey;
    if (resolution.service.retainCurrentPullRequestStatusPoll) {
      target.forgePrStatusPollSubscription = resolution.service.retainCurrentPullRequestStatusPoll({
        cwd: target.cwd,
        headRef: pollTarget.headRef,
        ...(pollTarget.headSha ? { headSha: pollTarget.headSha } : {}),
        ...(pollTarget.headRepositoryOwner
          ? { headRepositoryOwner: pollTarget.headRepositoryOwner }
          : {}),
        onStatus: (status) => {
          if (!this.isActiveObservedWorkspaceTarget(target)) {
            return;
          }
          this.rememberForgePrStatusSnapshot(
            target,
            buildForgeSnapshotFromStatus(status, resolution.forge),
            {
              notify: true,
            },
          );
        },
        onError: (error) => {
          this.logger.warn(
            {
              err: error,
              cwd: target.cwd,
              forge: resolution.forge,
              headRef: pollTarget.headRef,
              headRepositoryOwner: pollTarget.headRepositoryOwner,
              reason: "self-heal-forge-pr-status",
            },
            "Failed to run forge PR status self-heal refresh",
          );
        },
      });
      return;
    }

    target.forgePrStatusPollSubscription = this.retainGenericForgePrStatusPoll({
      target,
      forge: resolution.forge,
      service: resolution.service,
      pollTarget,
      pollImmediately,
    });
  }

  private retainGenericForgePrStatusPoll({
    target,
    forge,
    service,
    pollTarget,
    pollImmediately,
  }: {
    target: WorkspaceGitTarget;
    forge: string;
    service: ForgeService;
    pollTarget: WorkspaceForgePrStatusPollTarget;
    pollImmediately: boolean;
  }): { unsubscribe: () => void } {
    let closed = false;
    let timer: NodeJS.Timeout | null = null;
    let latestStatus: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"] =
      target.latestForge?.pullRequest ?? null;
    let consecutiveErrors = 0;

    const schedule = (delayMs: number) => {
      if (closed) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (closed || !this.isActiveObservedWorkspaceTarget(target)) {
        return;
      }
      try {
        const status = await service.getCurrentPullRequestStatus({
          cwd: target.cwd,
          headRef: pollTarget.headRef,
          ...(pollTarget.headSha ? { headSha: pollTarget.headSha } : {}),
          ...(pollTarget.headRepositoryOwner
            ? { headRepositoryOwner: pollTarget.headRepositoryOwner }
            : {}),
          reason: "self-heal-forge-pr-status",
        });
        if (!closed && this.isActiveObservedWorkspaceTarget(target)) {
          latestStatus = status;
          consecutiveErrors = 0;
          this.rememberForgePrStatusSnapshot(target, buildForgeSnapshotFromStatus(status, forge), {
            notify: true,
          });
        }
      } catch (error) {
        consecutiveErrors += 1;
        this.logger.warn(
          {
            err: error,
            cwd: target.cwd,
            forge,
            headRef: pollTarget.headRef,
            headRepositoryOwner: pollTarget.headRepositoryOwner,
            reason: "self-heal-forge-pr-status",
          },
          "Failed to run forge PR status self-heal refresh",
        );
      } finally {
        schedule(computeGenericForgeNextInterval(latestStatus, consecutiveErrors));
      }
    };

    // A git-only refresh clears forge state when the commit-aware poll identity
    // changes. Revalidate that new identity immediately instead of leaving the
    // PR panel empty for the full stable polling interval.
    schedule(
      pollImmediately ? 0 : computeGenericForgeNextInterval(latestStatus, consecutiveErrors),
    );
    return {
      unsubscribe: () => {
        closed = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    };
  }

  private resolveForgePrStatusPollTarget(
    target: WorkspaceGitTarget,
  ): WorkspaceForgePrStatusPollTarget | null {
    const git = target.latestGit;
    if (!git?.currentBranch) {
      return null;
    }

    const lookupTarget =
      target.latestFacts?.isGit && target.latestFacts.currentBranch === git.currentBranch
        ? target.latestFacts.pullRequestLookupTarget
        : null;
    if (lookupTarget) {
      return lookupTarget;
    }

    return { headRef: git.currentBranch };
  }

  private stopForgePrStatusPollForTarget(target: WorkspaceGitTarget): void {
    target.forgePrStatusPollSubscription?.unsubscribe();
    target.forgePrStatusPollSubscription = null;
    target.forgePrStatusPollKey = null;
  }

  private addWorkingTreeWatcher(
    target: WorkingTreeWatchTarget,
    watchPath: string,
    shouldTryRecursive: boolean,
  ): boolean {
    if (target.watchedPaths.has(watchPath)) {
      return false;
    }

    const { cwd } = target;
    const onChange = () => {
      if (process.platform === "linux" && target.repoWatchPath) {
        void this.refreshLinuxRepoTreeWatchers(target);
      }
      this.scheduleWorkspaceRefresh(cwd, {
        force: true,
        reason: "working-tree-watch",
      });
      for (const listener of target.listeners) {
        listener();
      }
    };
    const createWatcher = (recursive: boolean): FSWatcher =>
      this.deps.watch(watchPath, { recursive }, (_event, filename) => {
        // Only the recursive watcher sees the whole tree, so it is the only one that can
        // see ignored churn. The non-recursive watchers are already scoped to directories
        // that were chosen because they matter.
        if (recursive && this.shouldSkipRecursiveWatchEvent(watchPath, filename)) {
          return;
        }
        onChange();
      });

    let watcher: FSWatcher | null = null;
    let watcherIsRecursive = false;
    try {
      if (shouldTryRecursive) {
        watcher = createWatcher(true);
        watcherIsRecursive = true;
      } else {
        watcher = createWatcher(false);
      }
    } catch (error) {
      if (shouldTryRecursive) {
        try {
          watcher = createWatcher(false);
          this.logger.warn(
            { err: error, watchPath, cwd },
            "Working tree recursive watch unavailable; using non-recursive fallback",
          );
        } catch (fallbackError) {
          this.logger.warn(
            { err: fallbackError, watchPath, cwd },
            "Failed to start working tree watcher",
          );
        }
      } else {
        this.logger.warn({ err: error, watchPath, cwd }, "Failed to start working tree watcher");
      }
    }

    if (!watcher) {
      return false;
    }

    watcher.on("error", (error) => {
      this.logger.warn({ err: error, watchPath, cwd }, "Working tree watcher error");
    });
    target.watchers.push(watcher);
    target.watchedPaths.add(watchPath);
    return watcherIsRecursive;
  }

  private async ensureLinuxRepoTreeWatchers(
    target: WorkingTreeWatchTarget,
    rootPath: string,
  ): Promise<boolean> {
    const directories = await this.listLinuxWatchDirectories(rootPath);
    let complete = true;
    for (const directory of directories) {
      const watcherWasRecursive = this.addWorkingTreeWatcher(target, directory, false);
      if (!watcherWasRecursive && !target.watchedPaths.has(directory)) {
        complete = false;
      }
    }
    return complete && target.watchedPaths.has(rootPath);
  }

  private async refreshLinuxRepoTreeWatchers(target: WorkingTreeWatchTarget): Promise<void> {
    if (process.platform !== "linux" || !target.repoWatchPath) {
      return;
    }
    const rootPath = target.repoWatchPath;
    if (target.linuxTreeRefreshPromise) {
      target.linuxTreeRefreshQueued = true;
      return;
    }

    target.linuxTreeRefreshPromise = (async () => {
      do {
        target.linuxTreeRefreshQueued = false;
        try {
          await this.ensureLinuxRepoTreeWatchers(target, rootPath);
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              cwd: target.cwd,
              rootPath,
            },
            "Failed to refresh Linux working tree watchers",
          );
        }
        if (target.linuxTreeRefreshQueued) {
          await new Promise((r) => setTimeout(r, LINUX_WATCH_REFRESH_COOLDOWN_MS));
        }
      } while (target.linuxTreeRefreshQueued);
    })();

    try {
      await target.linuxTreeRefreshPromise;
    } finally {
      target.linuxTreeRefreshPromise = null;
    }
  }

  private async listLinuxWatchDirectories(rootPath: string): Promise<string[]> {
    const ignored = await this.loadLinuxIgnoredDirs(rootPath);
    const directories: string[] = [];
    let currentLevel: string[] = [rootPath];
    let capped = false;

    while (currentLevel.length > 0) {
      directories.push(...currentLevel);
      if (directories.length >= LINUX_WATCH_MAX_DIRS) {
        capped = true;
        break;
      }
      const readResults = await Promise.all(
        currentLevel.map((directory) =>
          linuxWatchReaddirLimit(async () => {
            try {
              return await this.deps.readdir(directory, { withFileTypes: true });
            } catch {
              return null;
            }
          }),
        ),
      );
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 1) {
        const directory = currentLevel[i];
        const entries = readResults[i];
        if (!directory || !entries) continue;
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === ".git") {
            continue;
          }
          const childPath = join(directory, entry.name);
          if (ignored.has(childPath)) {
            continue;
          }
          nextLevel.push(childPath);
        }
      }
      currentLevel = nextLevel;
    }

    if (capped) {
      this.logger.warn(
        { rootPath, limit: LINUX_WATCH_MAX_DIRS, walked: directories.length },
        "Linux working tree exceeds watcher cap; skipping deeper directories",
      );
    }

    return directories;
  }

  // Also feeds the recursive (Windows/macOS) watcher's event filter, which needs the same
  // answer synchronously - hence the relative-path twin and the in-flight dedupe below.
  private async loadLinuxIgnoredDirs(rootPath: string): Promise<Set<string>> {
    const cached = this.linuxIgnoredDirsCache.get(rootPath);
    if (cached && Date.now() - cached.ts < LINUX_WATCH_IGNORE_TTL_MS) {
      return cached.ignored;
    }

    const inFlight = this.linuxIgnoredDirsInFlight.get(rootPath);
    if (inFlight) {
      return inFlight;
    }

    const load = (async () => {
      const ignored = new Set<string>();
      const ignoredRelative = new Set<string>();
      try {
        const result = await this.deps.runGitCommand(
          ["ls-files", "-o", "-i", "--directory", "--exclude-standard"],
          { cwd: rootPath, env: READ_ONLY_GIT_ENV },
        );
        for (const raw of result.stdout.split("\n")) {
          if (!raw.endsWith("/")) {
            continue;
          }
          const rel = raw.replace(/\/+$/, "");
          if (!rel) {
            continue;
          }
          ignored.add(resolve(rootPath, rel));
          ignoredRelative.add(rel);
        }
      } catch (error) {
        this.logger.debug(
          { err: error, rootPath },
          "Failed to load gitignore directories; falling back to name-based skip only",
        );
      }

      this.linuxIgnoredDirsCache.set(rootPath, { ignored, ignoredRelative, ts: Date.now() });
      return ignored;
    })().finally(() => {
      this.linuxIgnoredDirsInFlight.delete(rootPath);
    });

    this.linuxIgnoredDirsInFlight.set(rootPath, load);
    return load;
  }

  /**
   * The recursive watcher fires from a sync callback, so it reads whatever the ignore cache
   * already holds and warms it in the background when it is missing or stale. Until the
   * first load lands nothing is filtered, which is the conservative direction: an extra
   * debounced refresh costs far less than a missed edit.
   */
  private peekIgnoredRelativeDirs(rootPath: string): Set<string> | null {
    const cached = this.linuxIgnoredDirsCache.get(rootPath);
    if (!cached || Date.now() - cached.ts >= LINUX_WATCH_IGNORE_TTL_MS) {
      void this.loadLinuxIgnoredDirs(rootPath).catch(() => {});
    }
    return cached?.ignoredRelative ?? null;
  }

  /**
   * Decide whether a recursive `fs.watch` event can be dropped without missing a working
   * tree change. Everything the repo ignores is churn the diff will never show - an
   * `npm install` or a build writing thousands of `node_modules`/`dist` entries used to
   * force a full snapshot refresh plus a re-highlighted diff per 150 ms quiet gap.
   *
   * `.git` is handled separately: the working tree target watches the git dir directly, so
   * the deep churn under it (`objects/`, `index.lock`, `COMMIT_EDITMSG`) is pure noise here,
   * while `HEAD` and `refs/` stay through because a branch switch has to reach subscribers.
   */
  private shouldSkipRecursiveWatchEvent(rootPath: string, filename: unknown): boolean {
    // A null filename carries no information, so it always refreshes.
    if (typeof filename !== "string" || filename.length === 0) {
      return false;
    }

    const segments = filename.split(/[\\/]/).filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return false;
    }

    if (segments[0] === ".git") {
      return segments.length > 1 && segments[1] !== "HEAD" && segments[1] !== "refs";
    }

    const ignoredRelative = this.peekIgnoredRelativeDirs(rootPath);
    if (!ignoredRelative || ignoredRelative.size === 0) {
      return false;
    }

    let prefix = "";
    for (const segment of segments) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      if (ignoredRelative.has(prefix)) {
        return true;
      }
    }
    return false;
  }

  private async refreshWorkspaceTarget(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<void> {
    if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
      return;
    }
    try {
      await this.requestWorkspaceSnapshot(target, request);
    } catch (error) {
      this.logger.warn(
        { err: error, cwd: target.cwd, reason: request.reason },
        "Failed to refresh workspace git snapshot",
      );
    }
  }

  private requestWorkspaceSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    if (target.refreshState.status === "in-flight") {
      const refreshState = target.refreshState;
      const needsForcedRefresh = request.force && !refreshState.force;
      // A cold workspace registration begins with a git-only refresh so a
      // workspace list never waits on the forge. A direct PR-status read that
      // joins that pass still needs its forge facts, though. Upgrade the pass
      // in place: the git read has not yet been followed by the forge read, so
      // this costs no extra shell-out and lets the caller receive the PR rather
      // than cache the temporary git-only snapshot indefinitely.
      const needsForgeRefresh = request.includeForge && !refreshState.includeForge;
      const canUpgradeCurrentPass = needsForgeRefresh && !request.force;
      if (canUpgradeCurrentPass) {
        refreshState.includeForge = true;
      }
      // A change signal queues when the running pass has already taken its git
      // measurement. Each pass reads git first and the forge second, and a forge
      // round-trip is a `gh` process plus a network call - seconds. A branch
      // that moves during that tail was already missed by this pass's read, so
      // joining its promise reports the old branch and discards the only signal
      // that would have corrected it. While the read is still pending there is
      // nothing to miss, so the signal rides along for free and a watcher burst
      // still costs exactly one shell-out.
      const missedByRunningPass = request.changeSignal && target.currentPassReadGit;
      if (needsForcedRefresh || (needsForgeRefresh && request.force) || missedByRunningPass) {
        refreshState.queued = this.mergeRefreshRequests(refreshState.queued, request);
      }
      return refreshState.promise;
    }

    if (!request.force && this.shouldThrottleNonForcedRefresh(target)) {
      // Defer the throttled request, never drop it. Most non-forced refreshes
      // carry a one-shot signal - a watcher saw `.git/HEAD` or `refs/heads`
      // move - and handing back the cached snapshot without re-arming loses
      // that signal permanently: the watcher does not fire twice, and an
      // observed target's cache is trusted indefinitely on read. Because the
      // watch debounce (1s) is shorter than this gap (2s), a branch switch
      // within two seconds of any prior git read landed exactly in that hole
      // and the daemon reported the old branch forever.
      this.scheduleThrottledRefresh(target, request);
      return Promise.resolve(target.latestSnapshot);
    }

    const promise = this.runWorkspaceRefreshLoop(target, request).finally(() => {
      const state = target.refreshState;
      if (state.status !== "in-flight" || state.promise !== promise) {
        return;
      }
      // Anything enqueued between the loop's last drain and this callback would
      // otherwise be thrown away with the state. Re-fire it instead.
      const leftover = state.queued;
      target.refreshState = { status: "idle" };
      target.currentPassReadGit = false;
      if (leftover) {
        void this.refreshWorkspaceTarget(target, leftover);
      }
    });
    target.refreshState = {
      status: "in-flight",
      promise,
      force: request.force,
      includeForge: request.includeForge,
      queued: null,
    };

    return promise;
  }

  private normalizeRefreshRequest(
    options: WorkspaceGitSnapshotOptions | undefined,
    defaultReason: string,
    notify: boolean,
  ): WorkspaceGitRefreshRequest {
    if (options?.force && !options.reason) {
      throw new Error("WorkspaceGitService.getSnapshot force refresh requires a reason");
    }

    const force = options?.force === true;
    return {
      force,
      includeForge: options?.includeForge ?? true,
      reason: options?.reason ?? defaultReason,
      notify,
      // A read, not a signal: these callers want the current snapshot and are
      // happy to join whatever pass is already running.
      changeSignal: false,
    };
  }

  private shouldThrottleNonForcedRefresh(
    target: WorkspaceGitTarget,
  ): target is WorkspaceGitTarget & {
    latestSnapshot: WorkspaceGitRuntimeSnapshot;
  } {
    if (!target.latestSnapshot || target.lastShellOutAtMs === null) {
      return false;
    }

    return this.deps.now().getTime() - target.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS;
  }

  /**
   * Re-arm a refresh that the minimum-gap throttle just turned away, for the
   * moment that gap expires. Requests merge, so a burst still costs one git
   * read, and a single timer is kept so repeated turn-aways cannot pile up.
   *
   * Only change signals are re-armed. A throttled poll (self-heal, a read) is
   * redundant by construction - it asked for a measurement that was just taken -
   * so re-firing it would only resurrect periodic work the caller has since
   * paused.
   */
  private scheduleThrottledRefresh(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): void {
    if (!request.changeSignal) {
      return;
    }
    target.pendingThrottledRequest = this.mergeRefreshRequests(
      target.pendingThrottledRequest,
      request,
    );
    if (target.throttleTimer) {
      return;
    }

    const elapsedMs =
      target.lastShellOutAtMs === null
        ? WORKSPACE_GIT_INTERNAL_MIN_GAP_MS
        : this.deps.now().getTime() - target.lastShellOutAtMs;
    const waitMs = Math.max(0, WORKSPACE_GIT_INTERNAL_MIN_GAP_MS - elapsedMs);

    target.throttleTimer = setTimeout(() => {
      target.throttleTimer = null;
      const pending = target.pendingThrottledRequest;
      target.pendingThrottledRequest = null;
      if (!pending || target.closed || this.workspaceTargets.get(target.cwd) !== target) {
        return;
      }
      void this.refreshWorkspaceTarget(target, pending);
    }, waitMs);
    target.throttleTimer.unref?.();
  }

  private buildScheduledRefreshRequest(
    options: ScheduledWorkspaceGitRefreshOptions | undefined,
  ): WorkspaceGitRefreshRequest {
    return {
      force: options?.force === true,
      includeForge: options?.includeForge ?? false,
      reason: options?.reason ?? "watch",
      notify: true,
      changeSignal: options?.changeSignal ?? true,
    };
  }

  private mergeRefreshRequests(
    pending: WorkspaceGitRefreshRequest | null,
    request: WorkspaceGitRefreshRequest,
  ): WorkspaceGitRefreshRequest {
    if (!pending) {
      return request;
    }

    const force = pending.force || request.force;
    const upgradesForce = request.force && !pending.force;
    const upgradesForge = request.includeForge && !pending.includeForge;
    return {
      force,
      includeForge: pending.includeForge || request.includeForge,
      reason: upgradesForce || upgradesForge ? request.reason : pending.reason,
      notify: pending.notify || request.notify,
      changeSignal: pending.changeSignal || request.changeSignal,
    };
  }

  private async runWorkspaceRefreshLoop(
    target: WorkspaceGitTarget,
    initialRequest: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    let request = initialRequest;
    let snapshot!: WorkspaceGitRuntimeSnapshot;

    while (true) {
      snapshot = await this.refreshSnapshot(target, request);
      this.rememberSnapshot(target, snapshot, {
        notify: request.notify,
        forceEmit: request.force,
      });

      const state = target.refreshState;
      if (state.status !== "in-flight" || !state.queued) {
        break;
      }

      request = state.queued;
      state.queued = null;
      state.force = request.force;
      state.includeForge = request.includeForge;
    }

    return snapshot;
  }

  private async refreshSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<WorkspaceGitRuntimeSnapshot> {
    target.currentPassReadGit = false;
    const facts = await this.refreshGitSnapshot(target, request);
    // Past this line the git half of this pass is fixed, so a change landing now
    // cannot be reported by it.
    target.currentPassReadGit = true;
    const inFlightRefreshIncludesForge =
      target.refreshState.status === "in-flight" && target.refreshState.includeForge;
    if (request.includeForge || inFlightRefreshIncludesForge) {
      await this.refreshForgeSnapshot(target, request, facts);
    }

    const snapshot = this.combineSnapshot(target);
    target.latestSnapshotLoadedAtMs = this.deps.now().getTime();
    return snapshot;
  }

  private async refreshGitSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
  ): Promise<CheckoutSnapshotFacts> {
    const now = this.deps.now();
    target.lastShellOutAtMs = now.getTime();

    const cwd = target.cwd;
    const previousForgePrStatusPollKey = this.getForgePrStatusPollKey(target);
    const baseContext: CheckoutContext = {
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      logger: this.logger,
    };
    const facts = await this.loadCheckoutFacts(target, {
      ...baseContext,
      allowRecent: !request.force,
    });
    const context: CheckoutContext = { ...baseContext, facts };
    const checkoutStatus = await this.deps.getCheckoutStatus(cwd, context);
    if (!checkoutStatus.isGit) {
      target.latestGit = buildNotGitSnapshot(cwd).git;
      target.latestGitLoadedAtMs = this.deps.now().getTime();
      target.latestForge = buildForgeUnavailableSnapshot();
      target.latestForgeLoadedAtMs = target.latestGitLoadedAtMs;
      return facts;
    }

    const diffStat = await this.deps
      .getCheckoutShortstat(cwd, context, { force: request.force })
      .catch(() => null);

    target.latestGit = {
      isGit: true,
      repoRoot: checkoutStatus.repoRoot,
      mainRepoRoot: checkoutStatus.mainRepoRoot,
      currentBranch: checkoutStatus.currentBranch,
      remoteUrl: checkoutStatus.remoteUrl,
      isOttoOwnedWorktree: checkoutStatus.isOttoOwnedWorktree,
      isDirty: checkoutStatus.isDirty,
      baseRef: checkoutStatus.baseRef,
      aheadBehind: checkoutStatus.aheadBehind,
      aheadOfOrigin: checkoutStatus.aheadOfOrigin,
      behindOfOrigin: checkoutStatus.behindOfOrigin,
      hasRemote: checkoutStatus.hasRemote,
      diffStat,
    };
    target.latestGitLoadedAtMs = this.deps.now().getTime();

    if (previousForgePrStatusPollKey !== this.getForgePrStatusPollKey(target)) {
      target.latestForge = buildForgeUnavailableSnapshot();
      target.latestForgeLoadedAtMs = target.latestGitLoadedAtMs;
    }
    return facts;
  }

  private async refreshForgeSnapshot(
    target: WorkspaceGitTarget,
    request: WorkspaceGitRefreshRequest,
    facts: CheckoutSnapshotFacts,
  ): Promise<void> {
    const remoteUrl = target.latestGit?.remoteUrl ?? null;
    const resolution = await this.forgeResolver.resolveFromRemoteUrlAsync(remoteUrl);
    // Every forge gates on the resolver alone: a cloud host matches synchronously
    // and a self-hosted/Enterprise host is recognized by the adapter probe (which
    // this async resolution populates), so GitHub Enterprise is no longer gated
    // out by a cloud-only identity check.
    if (!resolution) {
      target.latestForge = buildUnresolvedRemoteForgeSnapshot(remoteUrl);
      target.latestForgeLoadedAtMs = this.deps.now().getTime();
      return;
    }
    const forgeService: ForgeService = resolution.service;
    const forceForge = request.force && request.includeForge;
    if (forceForge) {
      forgeService.invalidate({ cwd: target.cwd });
    }

    const forgeSnapshot = await loadForgeSnapshot({
      cwd: target.cwd,
      forgeService,
      now: this.deps.now(),
      deps: this.deps,
      force: forceForge,
      reason: request.reason,
      facts,
    });
    // Carry the resolved forge (probe-aware) so the wire projection labels
    // self-managed GitLab hosts correctly instead of falling back to "github".
    // Otto: layer the provider-neutral hosting facts onto upstream's forge snapshot
    // so the wire projection keeps reporting the typed provider id and capabilities
    // (Bitbucket Cloud included). A failure here must not lose the forge snapshot.
    const hosting = this.deps.resolveHostingForCwd
      ? await this.deps.resolveHostingForCwd(target.cwd).catch(() => null)
      : null;
    target.latestForge = {
      ...forgeSnapshot,
      forge: resolution.forge,
      ...(hosting
        ? {
            provider: hosting.providerId,
            capabilities: hosting.capabilities,
            ...(hosting.credentialsMissing ? { credentialsMissing: true } : {}),
          }
        : {}),
    };
    target.latestForgeLoadedAtMs = this.deps.now().getTime();
  }

  private combineSnapshot(target: WorkspaceGitTarget): WorkspaceGitRuntimeSnapshot {
    if (!target.latestGit) {
      return target.latestSnapshot ?? buildNotGitSnapshot(target.cwd);
    }

    return {
      cwd: target.cwd,
      // Stamped from the same measurement that produced `git`. The target has
      // tracked this all along and the wire projection reads it as `gitStateAt`,
      // but combineSnapshot never carried it across, so the field was always
      // undefined and clients had nothing to reject an out-of-order status push
      // with. It is excluded from the emission fingerprint on purpose (see
      // rememberSnapshot), so stamping it cannot cause spurious emissions.
      gitLoadedAtMs: target.latestGitLoadedAtMs,
      git: target.latestGit,
      forge: target.latestForge ?? buildForgeUnavailableSnapshot(),
    };
  }

  private getForgePrStatusPollKey(target: WorkspaceGitTarget): string | null {
    const git = target.latestGit;
    if (!git?.currentBranch || !git.remoteUrl) {
      return null;
    }

    const resolution = this.forgeResolver.resolveFromRemoteUrl(git.remoteUrl);
    if (!resolution) {
      return null;
    }

    const pollTarget = this.resolveForgePrStatusPollTarget(target);
    if (!pollTarget) {
      return null;
    }

    return buildWorkspaceForgePrStatusPollKey({
      forge: resolution.forge,
      remoteUrl: git.remoteUrl,
      target: pollTarget,
    });
  }

  private rememberForgePrStatusSnapshot(
    target: WorkspaceGitTarget,
    github: WorkspaceGitRuntimeSnapshot["forge"],
    options?: { notify?: boolean },
  ): void {
    if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
      return;
    }

    target.latestForge = github;
    target.latestForgeLoadedAtMs = this.deps.now().getTime();
    // Tagged PR-only: downstream projections must not rebuild a whole checkout
    // status from the last git measurement and publish it as news.
    this.rememberSnapshot(target, this.combineSnapshot(target), {
      notify: options?.notify,
      forceEmit: false,
      prStatusOnly: true,
    });
  }

  private rememberSnapshot(
    target: WorkspaceGitTarget,
    snapshot: WorkspaceGitRuntimeSnapshot,
    options?: { forceEmit?: boolean; notify?: boolean; prStatusOnly?: boolean },
  ): void {
    target.latestSnapshot = snapshot;
    if (target.listeners.size > 0) {
      this.updateForgePrStatusPollForTarget(target);
    }
    const { gitLoadedAtMs: _gitLoadedAtMs, ...fingerprintSource } = snapshot;
    const fingerprint = JSON.stringify(fingerprintSource);
    const fingerprintMatches = target.latestFingerprint === fingerprint;
    if (fingerprintMatches && !options?.forceEmit) {
      return;
    }
    target.latestFingerprint = fingerprint;
    if (!options?.notify || target.listeners.size === 0) {
      return;
    }
    const meta: WorkspaceGitSnapshotMeta = { prStatusOnly: options?.prStatusOnly === true };
    for (const listener of target.listeners) {
      listener(snapshot, meta);
    }
    for (const listener of this.snapshotUpdatedListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn(
          { err: error, cwd: snapshot.cwd },
          "Workspace git snapshot listener threw",
        );
      }
    }
  }

  private async runRepoFetch(target: RepoGitTarget): Promise<void> {
    if (target.fetchInFlight) {
      return;
    }

    target.fetchInFlight = true;
    this.logger.debug(
      { repoGitRoot: target.repoGitRoot, cwd: target.cwd },
      "Running background git fetch",
    );

    try {
      await this.deps.runGitFetch(target.cwd);
    } catch (error) {
      this.logger.warn(
        { err: error, repoGitRoot: target.repoGitRoot, cwd: target.cwd },
        "Background git fetch failed",
      );
    } finally {
      target.fetchInFlight = false;
      await Promise.all(
        Array.from(target.workspaceKeys, async (workspaceKey) => {
          const workspaceTarget = this.workspaceTargets.get(workspaceKey);
          if (!workspaceTarget) {
            return;
          }
          await this.refreshWorkspaceTarget(workspaceTarget, {
            force: false,
            includeForge: false,
            reason: "repo-fetch",
            notify: true,
            changeSignal: true,
          });
        }),
      );
    }
  }

  private removeWorkspaceListener(cwd: string, listener: WorkspaceGitListener): void {
    const target = this.workspaceTargets.get(cwd);
    if (!target) {
      return;
    }

    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }

    this.removeWorkspaceTarget(target);
  }

  private removeWorkspaceTarget(target: WorkspaceGitTarget): void {
    if (target.repoGitRoot) {
      const repoTarget = this.repoTargets.get(target.repoGitRoot);
      repoTarget?.workspaceKeys.delete(target.cwd);
      if (repoTarget && repoTarget.workspaceKeys.size === 0) {
        this.closeRepoTarget(repoTarget);
        this.repoTargets.delete(target.repoGitRoot);
      }
    }

    this.closeWorkspaceTarget(target);
    this.workspaceTargets.delete(target.cwd);
  }

  private removeWorkingTreeWatchListener(cwd: string, listener: () => void): void {
    const target = this.workingTreeWatchTargets.get(cwd);
    if (!target) {
      return;
    }

    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }

    this.closeWorkingTreeWatchTarget(target);
    this.workingTreeWatchTargets.delete(cwd);
  }

  private closeWorkspaceTarget(target: WorkspaceGitTarget): void {
    target.closed = true;
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
      target.debounceTimer = null;
    }
    if (target.throttleTimer) {
      clearTimeout(target.throttleTimer);
      target.throttleTimer = null;
      target.pendingThrottledRequest = null;
    }
    if (target.selfHealTimer) {
      clearInterval(target.selfHealTimer);
      target.selfHealTimer = null;
    }
    this.stopForgePrStatusPollForTarget(target);

    for (const watcher of target.watchers) {
      watcher.close();
    }
    target.watchers = [];
    target.listeners.clear();
  }

  private closeWorkingTreeWatchTarget(target: WorkingTreeWatchTarget): void {
    if (target.fallbackRefreshInterval) {
      clearInterval(target.fallbackRefreshInterval);
      target.fallbackRefreshInterval = null;
    }

    for (const watcher of target.watchers) {
      watcher.close();
    }
    target.watchers = [];
    target.watchedPaths.clear();
    target.listeners.clear();
    if (target.repoWatchPath) {
      this.linuxIgnoredDirsCache.delete(target.repoWatchPath);
    }
  }

  private closeRepoTarget(target: RepoGitTarget): void {
    if (target.intervalId) {
      clearInterval(target.intervalId);
      target.intervalId = null;
    }
    target.workspaceKeys.clear();
  }
}

async function loadForgeSnapshot(options: {
  cwd: string;
  forgeService: ForgeService | null;
  now: Date;
  deps: Pick<WorkspaceGitServiceDependencies, "getPullRequestStatus">;
  force?: boolean;
  reason?: string;
  facts?: CheckoutSnapshotFacts;
}): Promise<WorkspaceGitRuntimeSnapshot["forge"]> {
  const forgeService = options.forgeService;
  if (!forgeService) {
    return buildForgeSnapshot("no_remote", null, null);
  }

  // GitHub's isAuthenticated throws the precise CLI-missing / auth error; GitLab's
  // and Gitea's return false without throwing (the precise kind surfaces from
  // the PR-status lookup below instead), so probing them here can't change the
  // outcome and would just be a wasted CLI spawn on every refresh.
  if (forgeService.authProbeCanThrow) {
    try {
      await forgeService.isAuthenticated({ cwd: options.cwd });
    } catch (error) {
      return buildForgeSnapshot(forgeAuthStateFromError(error), null, null);
    }
  }

  try {
    const result = await options.deps.getPullRequestStatus(
      options.cwd,
      forgeService,
      {
        force: options.force,
        reason: options.reason,
      },
      { facts: options.facts },
    );
    return buildForgeSnapshot(result.authState, result.status, null);
  } catch (error) {
    // The auth probe succeeded, so a failure here is a command error, not an
    // auth problem - surface it as an error while keeping features enabled.
    return buildForgeSnapshot("authenticated", null, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildForgeSnapshot(
  authState: ForgeAuthState,
  pullRequest: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
  error: WorkspaceGitRuntimeSnapshot["forge"]["error"],
): WorkspaceGitRuntimeSnapshot["forge"] {
  return {
    featuresEnabled: authState === "authenticated",
    authState,
    pullRequest,
    error,
  };
}

function parseWorkspaceGitStashList(
  stdout: string,
  options: { ottoOnly: boolean },
): WorkspaceGitStashEntry[] {
  const entries: WorkspaceGitStashEntry[] = [];
  const lines = stdout.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    const sepIdx = line.indexOf("\0");
    if (sepIdx < 0) {
      continue;
    }

    const refPart = line.slice(0, sepIdx);
    const subject = line.slice(sepIdx + 1);
    const indexMatch = refPart.match(/\{(\d+)\}/);
    if (!indexMatch) {
      continue;
    }

    const index = Number(indexMatch[1]);
    const prefix = "otto-auto-stash:";
    const prefixIdx = subject.indexOf(prefix);
    const isOtto = prefixIdx >= 0;
    const branch = isOtto ? subject.slice(prefixIdx + prefix.length).trim() || null : null;

    if (options.ottoOnly && !isOtto) {
      continue;
    }

    entries.push({ index, message: subject, branch, isOtto });
  }

  return entries;
}

function buildNotGitSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: false,
      repoRoot: null,
      mainRepoRoot: null,
      currentBranch: null,
      remoteUrl: null,
      isOttoOwnedWorktree: false,
      isDirty: null,
      baseRef: null,
      aheadBehind: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
      diffStat: null,
    },
    forge: buildForgeUnavailableSnapshot(),
  };
}

function buildForgeUnavailableSnapshot(): WorkspaceGitRuntimeSnapshot["forge"] {
  return buildForgeSnapshot("no_remote", null, null);
}

/**
 * Snapshot for a remote whose host matched no registered forge and no
 * CLI-authenticated host. Deliberate choice: expose the hostname as the open
 * `forge` id with `authState: "unauthenticated"`, because a self-hosted
 * GitLab/Gitea becomes resolvable the moment its CLI is authenticated for
 * that host - so "authenticate" is the actionable next step. The trade-off:
 * a genuinely unsupported host (e.g. Bitbucket) also reads as a login
 * problem; clients that want to distinguish can check the id against the
 * forge registry.
 */
function buildUnresolvedRemoteForgeSnapshot(
  remoteUrl: string | null,
): WorkspaceGitRuntimeSnapshot["forge"] {
  const host = remoteUrl ? parseGitRemoteLocation(remoteUrl)?.host : null;
  if (!host) {
    return buildForgeUnavailableSnapshot();
  }
  return { ...buildForgeSnapshot("unauthenticated", null, null), forge: host };
}

function buildForgeSnapshotFromStatus(
  status: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
  forge: string,
): WorkspaceGitRuntimeSnapshot["forge"] {
  return { ...buildForgeSnapshot("authenticated", status, null), forge };
}

function buildWorkspaceForgePrStatusPollKey({
  forge,
  remoteUrl,
  target,
}: {
  forge: string;
  remoteUrl: string;
  target: WorkspaceForgePrStatusPollTarget;
}): string {
  return JSON.stringify([
    forge,
    remoteUrl,
    target.headRef,
    target.headSha ?? null,
    target.headRepositoryOwner ?? null,
  ]);
}

function computeGenericForgeNextInterval(
  status: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
  consecutiveErrors: number,
): number {
  const isPending =
    status?.checksStatus === "pending" ||
    status?.checks?.some((check) => check.status === "pending") === true;
  const baseInterval = isPending
    ? FORGE_PR_STATUS_POLL_FAST_INTERVAL_MS
    : FORGE_PR_STATUS_POLL_SLOW_INTERVAL_MS;
  if (consecutiveErrors <= 1) {
    return baseInterval;
  }
  return Math.min(
    baseInterval * 2 ** (consecutiveErrors - 1),
    FORGE_PR_STATUS_POLL_ERROR_BACKOFF_CAP_MS,
  );
}

async function runGitFetch(cwd: string): Promise<void> {
  await runGitCommand(["fetch", "origin", "--prune"], {
    cwd,
    envOverlay: { GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
}
