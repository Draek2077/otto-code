import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createGitHubService,
  type CurrentPullRequestStatus,
  type GitHubService,
} from "../services/github-service.js";
import {
  getCheckoutDiff as getCheckoutDiffUncached,
  getCheckoutSnapshotFacts as getCheckoutSnapshotFactsUncached,
  getCheckoutStatus as getCheckoutStatusUncached,
  resolveAbsoluteGitDir as resolveAbsoluteGitDirReal,
  type CheckoutDiffCompare,
  type CheckoutDiffResult,
  type CheckoutSnapshotFacts,
  type CheckoutStatusGit,
  type PullRequestStatusResult,
} from "../utils/checkout-git.js";
import { runGitCommand as runGitCommandReal } from "../utils/run-git-command.js";
import {
  WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS,
  WorkspaceGitServiceImpl,
  type WorkspaceGitRuntimeSnapshot,
} from "./workspace-git-service.js";
import { isPlatform } from "../test-utils/platform.js";

const REPO_CWD = resolvePath("/tmp/repo");

function createLogger() {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    warn: vi.fn(),
  };
  return logger;
}

function createWatcher() {
  return {
    close: vi.fn(),
    on: vi.fn().mockReturnThis(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

/** How many git reads a given workspace has cost so far. */
function callsForCwd(spy: { mock: { calls: unknown[][] } }, cwd: string): number {
  return spy.mock.calls.filter((call) => call[0] === cwd).length;
}

function createCheckoutFacts(
  cwd: string,
  overrides?: Partial<Extract<CheckoutSnapshotFacts, { isGit: true }>>,
): CheckoutSnapshotFacts {
  return {
    isGit: true,
    worktreeRoot: cwd,
    currentBranch: "main",
    remoteUrl: "https://github.com/acme/repo.git",
    absoluteGitDir: join(cwd, ".git"),
    gitCommonDir: join(cwd, ".git"),
    ottoWorktree: { isOttoOwnedWorktree: false },
    storedBaseRef: null,
    resolvedBaseRef: "main",
    mainRepoRoot: null,
    comparisonBaseRef: null,
    branchRemoteName: null,
    branchMergeRef: null,
    pullRequestLookupTarget: { headRef: "main" },
    ...overrides,
  };
}

function createCheckoutStatus(
  cwd: string,
  overrides?: Partial<CheckoutStatusGit>,
): CheckoutStatusGit {
  return {
    isGit: true,
    repoRoot: cwd,
    mainRepoRoot: null,
    currentBranch: "main",
    isDirty: false,
    baseRef: "main",
    aheadBehind: { ahead: 0, behind: 0 },
    aheadOfOrigin: 0,
    behindOfOrigin: 0,
    hasRemote: true,
    remoteUrl: "https://github.com/acme/repo.git",
    isOttoOwnedWorktree: false,
    ...overrides,
  };
}

function createPullRequestStatusResult(title = "Update feature"): PullRequestStatusResult {
  return {
    status: {
      url: "https://github.com/acme/repo/pull/123",
      title,
      state: "open",
      baseRefName: "main",
      headRefName: "feature",
      isMerged: false,
    },
    // Otto's forge layer decides feature availability from authState, and keeps
    // githubFeaturesEnabled only as its derived back-compat mirror. A result
    // carrying just the boolean leaves authState undefined, and the snapshot
    // then reports features off no matter what the boolean says.
    authState: "authenticated",
    githubFeaturesEnabled: true,
  };
}

function currentPullRequestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 123,
    url: "https://github.com/acme/repo/pull/123",
    title: "Update feature",
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    mergedAt: null,
    statusCheckRollup: [],
    reviewDecision: "REVIEW_REQUIRED",
    ...overrides,
  });
}

function createSnapshot(
  cwd: string,
  overrides?: {
    git?: Partial<WorkspaceGitRuntimeSnapshot["git"]>;
    forge?: Partial<WorkspaceGitRuntimeSnapshot["forge"]>;
  },
): WorkspaceGitRuntimeSnapshot {
  const base: WorkspaceGitRuntimeSnapshot = {
    cwd,
    git: {
      isGit: true,
      repoRoot: cwd,
      mainRepoRoot: null,
      currentBranch: "main",
      remoteUrl: "https://github.com/acme/repo.git",
      isOttoOwnedWorktree: false,
      isDirty: false,
      baseRef: "main",
      aheadBehind: { ahead: 0, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      diffStat: { additions: 1, deletions: 0 },
    },
    // Otto's provider-neutral hosting layer (docs/git-providers.md) replaced the
    // GitHub-specific `github` block with `forge`, which additionally carries
    // the auth state that `featuresEnabled` is derived from.
    forge: {
      featuresEnabled: true,
      authState: "authenticated",
      pullRequest: {
        url: "https://github.com/acme/repo/pull/123",
        title: "Update feature",
        state: "open",
        baseRefName: "main",
        headRefName: "feature",
        isMerged: false,
      },
      error: null,
    },
  };

  return {
    cwd,
    // A measurement timestamp rather than state — the service itself strips it before
    // fingerprinting a snapshot, precisely so a refresh that changed nothing does not look like
    // a change. Matched on type here for the same reason: pinning the value would tie every
    // assertion in this file to the harness clock without testing anything.
    gitLoadedAtMs: expect.any(Number) as unknown as number,
    git: {
      ...base.git,
      ...overrides?.git,
    },
    forge: {
      ...base.forge,
      ...overrides?.forge,
      pullRequest:
        overrides?.forge && "pullRequest" in overrides.forge
          ? (overrides.forge.pullRequest ?? null)
          : base.forge.pullRequest,
      error:
        overrides?.forge && "error" in overrides.forge
          ? (overrides.forge.error ?? null)
          : base.forge.error,
    },
  };
}

function createGitHubServiceStub(): GitHubService {
  return {
    listPullRequests: vi.fn(async () => []),
    listIssues: vi.fn(async () => []),
    searchIssuesAndPrs: vi.fn(async () => ({ items: [], githubFeaturesEnabled: true })),
    getPullRequest: vi.fn(async () => ({
      number: 1,
      title: "PR",
      url: "https://github.com/acme/repo/pull/1",
      state: "OPEN",
      body: null,
      baseRefName: "main",
      headRefName: "feature",
      labels: [],
    })),
    getPullRequestHeadRef: vi.fn(async () => "feature"),
    getCurrentPullRequestStatus: vi.fn(async () => null),
    getPullRequestTimeline: vi.fn(async () => ({
      pullRequest: null,
      events: [],
    })),
    createPullRequest: vi.fn(async () => ({
      url: "https://github.com/acme/repo/pull/1",
      number: 1,
    })),
    mergePullRequest: vi.fn(async () => ({ success: true })),
    isAuthenticated: vi.fn(async () => true),
    invalidate: vi.fn(),
  };
}

interface CreateServiceOptions {
  getCheckoutSnapshotFacts?: ReturnType<typeof vi.fn>;
  getCheckoutStatus?: ReturnType<typeof vi.fn>;
  getCheckoutShortstat?: ReturnType<typeof vi.fn>;
  getPullRequestStatus?: ReturnType<typeof vi.fn>;
  getCheckoutDiff?: ReturnType<typeof vi.fn>;
  resolveBranchCheckout?: ReturnType<typeof vi.fn>;
  resolveRepositoryDefaultBranch?: ReturnType<typeof vi.fn>;
  listBranchSuggestions?: ReturnType<typeof vi.fn>;
  listOttoWorktrees?: ReturnType<typeof vi.fn>;
  github?: GitHubService;
  resolveAbsoluteGitDir?: ReturnType<typeof vi.fn>;
  hasOriginRemote?: ReturnType<typeof vi.fn>;
  runGitFetch?: ReturnType<typeof vi.fn>;
  runGitCommand?: ReturnType<typeof vi.fn>;
  watch?: ReturnType<typeof vi.fn>;
  readdir?: ReturnType<typeof vi.fn>;
  now?: () => Date;
}

function buildDefaultServiceDeps() {
  return {
    watch: (() => createWatcher()) as never,
    readdir: vi.fn(async () => []),
    getCheckoutSnapshotFacts: vi.fn(async (cwd: string) => createCheckoutFacts(cwd)),
    getCheckoutStatus: vi.fn(async (cwd: string) => createCheckoutStatus(cwd)),
    getCheckoutShortstat: vi.fn(async () => ({
      additions: 1,
      deletions: 0,
    })),
    getPullRequestStatus: vi.fn(async () => createPullRequestStatusResult()),
    getCheckoutDiff: vi.fn(async () => ({ diff: "", structured: [] })),
    resolveBranchCheckout: vi.fn(async () => ({ kind: "not-found" })),
    resolveRepositoryDefaultBranch: vi.fn(async () => "main"),
    listBranchSuggestions: vi.fn(async () => []),
    listOttoWorktrees: vi.fn(async () => []),
    github: createGitHubServiceStub(),
    resolveAbsoluteGitDir: vi.fn(async () => join(REPO_CWD, ".git")),
    hasOriginRemote: vi.fn(async () => false),
    runGitFetch: vi.fn(async () => {}),
    runGitCommand: vi.fn(async () => ({
      stdout: `${REPO_CWD}\n`,
      stderr: "",
      truncated: false,
      exitCode: 0,
      signal: null,
    })),
    now: () => new Date("2026-04-12T00:00:00.000Z"),
  };
}

function buildServiceDeps(options?: CreateServiceOptions) {
  return { ...buildDefaultServiceDeps(), ...options };
}

function createService(options?: CreateServiceOptions) {
  return new WorkspaceGitServiceImpl({
    logger: createLogger() as never,
    ottoHome: "/tmp/otto-test",
    deps: buildServiceDeps(options),
  });
}

describe("WorkspaceGitServiceImpl primitive refresh entrypoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("getSnapshot returns the current snapshot without shelling out", async () => {
    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));
    nowMs += 1_000;
    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getSnapshot cold-loads when no snapshot exists yet with one shell burst", async () => {
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const getCheckoutShortstat = vi.fn(async () => ({ additions: 1, deletions: 0 }));
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getCheckoutStatus,
      getCheckoutShortstat,
      getPullRequestStatus,
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(getCheckoutShortstat).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("registerWorkspace returns a subscription without waiting for a cold snapshot", async () => {
    const checkoutStatusDeferred = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi.fn(async () => checkoutStatusDeferred.promise);
    const service = createService({ getCheckoutStatus });
    const listener = vi.fn();

    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    expect(subscription).toEqual({ unsubscribe: expect.any(Function) });
    expect(getCheckoutStatus).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(service.peekSnapshot(REPO_CWD)).toBeNull();

    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(service.peekSnapshot(REPO_CWD)).toBeNull();

    checkoutStatusDeferred.resolve(createCheckoutStatus(REPO_CWD));

    // The initial (register-triggered) refresh is git-only — GitHub PR status is
    // delivered by the poll, which this stub does not implement — so the warmed
    // snapshot reports GitHub as unavailable until a poll fills it in.
    const gitOnlySnapshot = createSnapshot(REPO_CWD, {
      forge: { featuresEnabled: false, pullRequest: null },
    });
    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(gitOnlySnapshot);
    expect(service.peekSnapshot(REPO_CWD)).toEqual(gitOnlySnapshot);

    subscription.unsubscribe();
    service.dispose();
  });

  test("forced getSnapshot bypasses the internal min-gap and re-shells", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await service.getSnapshot(REPO_CWD);
    nowMs = 1;
    await service.getSnapshot(REPO_CWD, { force: true, reason: "test" });

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("forced getSnapshot emits even when the fingerprint matches", async () => {
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    const listener = vi.fn();
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    await service.getSnapshot(REPO_CWD, { force: true, reason: "test" });

    expect(listener).toHaveBeenCalledTimes(1);
    // Subscribers receive the emit reason alongside the snapshot; a forced refresh is a full
    // emit, not a PR-status-only one.
    expect(listener).toHaveBeenCalledWith(createSnapshot(REPO_CWD), { prStatusOnly: false });

    subscription.unsubscribe();
    service.dispose();
  });

  test("non-forced refresh with a matching fingerprint does not emit", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, { remoteUrl: null }),
    );
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    await service.getSnapshot(REPO_CWD);

    const listener = vi.fn();
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    nowMs = 3_000;
    await service.refresh(REPO_CWD);

    expect(listener).not.toHaveBeenCalled();

    subscription.unsubscribe();
    service.dispose();
  });

  test("two concurrent getSnapshot calls produce one shell burst and share the result", async () => {
    const checkoutStatusDeferred = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi.fn(async () => checkoutStatusDeferred.promise);
    const service = createService({ getCheckoutStatus });

    const first = service.getSnapshot(REPO_CWD);
    const second = service.getSnapshot(join(REPO_CWD, "."));
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    checkoutStatusDeferred.resolve(createCheckoutStatus(REPO_CWD));

    await expect(Promise.all([first, second])).resolves.toEqual([
      createSnapshot(REPO_CWD),
      createSnapshot(REPO_CWD),
    ]);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("non-forced getSnapshot returns the current snapshot during an in-flight refresh", async () => {
    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const refreshStatus = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<(cwd: string) => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async (cwd: string) => createCheckoutStatus(cwd))
      .mockImplementationOnce(async () => {
        const status = await refreshStatus.promise;
        return { ...status, currentBranch: "feature" };
      });
    const getCheckoutShortstat = vi.fn(async () => ({ additions: 4, deletions: 2 }));
    const service = createService({
      getCheckoutStatus,
      getCheckoutShortstat,
      now: () => new Date(nowMs),
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(
      createSnapshot(REPO_CWD, {
        git: { diffStat: { additions: 4, deletions: 2 } },
      }),
    );

    const initialSnapshot = createSnapshot(REPO_CWD, {
      git: { diffStat: { additions: 4, deletions: 2 } },
    });

    nowMs += 3_000;
    const refresh = service.refresh(REPO_CWD);
    await flushPromises();
    const directRead = service.getSnapshot(REPO_CWD);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    expect(getCheckoutShortstat).toHaveBeenCalledTimes(1);
    await expect(directRead).resolves.toEqual(initialSnapshot);

    refreshStatus.resolve(createCheckoutStatus(REPO_CWD, { currentBranch: "feature" }));
    await refresh;
    expect(service.peekSnapshot(REPO_CWD)).toEqual(
      createSnapshot(REPO_CWD, {
        git: {
          currentBranch: "feature",
          diffStat: { additions: 4, deletions: 2 },
        },
        forge: {
          featuresEnabled: false,
          pullRequest: null,
          error: null,
        },
      }),
    );
    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    expect(getCheckoutShortstat).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("five ref-watch-triggered refreshes within debounce produce one shell burst", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    await service.getSnapshot(REPO_CWD);

    nowMs = 3_000;
    for (let index = 0; index < 5; index += 1) {
      service.scheduleRefreshForCwd(REPO_CWD);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("a forced call during an in-flight non-forced refresh queues one forced re-run", async () => {
    let nowMs = 0;
    const secondRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => secondRefresh.promise)
      .mockImplementation(async () => createCheckoutStatus(REPO_CWD));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    await service.getSnapshot(REPO_CWD);

    nowMs = 3_000;
    const refreshPromise = service.refresh(REPO_CWD);
    await flushPromises();
    const forcedPromise = service.getSnapshot(REPO_CWD, { force: true, reason: "test" });
    const duplicateForcedPromise = service.getSnapshot(REPO_CWD, {
      force: true,
      reason: "test",
    });
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    secondRefresh.resolve(createCheckoutStatus(REPO_CWD));
    await Promise.all([refreshPromise, forcedPromise, duplicateForcedPromise]);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(3);

    service.dispose();
  });

  test("a forced call during an in-flight forced refresh does not queue another re-run", async () => {
    const forcedRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => forcedRefresh.promise);
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    const first = service.getSnapshot(REPO_CWD, { force: true, reason: "test" });
    await flushPromises();
    const second = service.getSnapshot(REPO_CWD, { force: true, reason: "test" });
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    forcedRefresh.resolve(createCheckoutStatus(REPO_CWD));
    await Promise.all([first, second]);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("a forced GitHub-inclusive call during an in-flight forced git refresh queues a GitHub refresh", async () => {
    const forcedGitRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => forcedGitRefresh.promise)
      .mockImplementation(async () => createCheckoutStatus(REPO_CWD));
    const getPullRequestStatus = vi.fn(async () =>
      createPullRequestStatusResult("Fresh validation PR"),
    );
    const service = createService({ getCheckoutStatus, getPullRequestStatus });

    const gitRefresh = service.getSnapshot(REPO_CWD, {
      force: true,
      includeGitHub: false,
      reason: "watch",
    });
    await flushPromises();

    const validationRefresh = service.getSnapshot(REPO_CWD, {
      force: true,
      includeGitHub: true,
      reason: "merge-pr-validation",
    });
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    forcedGitRefresh.resolve(createCheckoutStatus(REPO_CWD));

    await expect(validationRefresh).resolves.toEqual(
      createSnapshot(REPO_CWD, {
        forge: {
          pullRequest: {
            url: "https://github.com/acme/repo/pull/123",
            title: "Fresh validation PR",
            state: "open",
            baseRefName: "main",
            headRefName: "feature",
            isMerged: false,
          },
        },
      }),
    );
    await gitRefresh;

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledWith(
      REPO_CWD,
      expect.anything(),
      { force: true, reason: "merge-pr-validation" },
      expect.anything(),
    );

    service.dispose();
  });

  test("ref-watch firing during an in-flight forced refresh does not produce an extra shell burst", async () => {
    const forcedRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => forcedRefresh.promise);
    const service = createService({ getCheckoutStatus });
    await service.getSnapshot(REPO_CWD);

    const forcePromise = service.getSnapshot(REPO_CWD, { force: true, reason: "test" });
    await flushPromises();
    service.scheduleRefreshForCwd(REPO_CWD);
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    forcedRefresh.resolve(createCheckoutStatus(REPO_CWD));
    await forcePromise;

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("internal min-gap throttles back-to-back non-forced refreshes", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    await service.getSnapshot(REPO_CWD);

    nowMs = 3_000;
    await service.refresh(REPO_CWD);
    nowMs = 3_001;
    await service.refresh(REPO_CWD);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("non-forced getSnapshot keeps returning the current snapshot after time passes", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    await service.getSnapshot(REPO_CWD);

    nowMs = 16_000;
    await service.getSnapshot(REPO_CWD);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("initial and self-heal refreshes fetch git without an inline GitHub read", async () => {
    // GitHub PR status is delivered by the per-branch poll
    // (retainCurrentPullRequestStatusPoll), NOT inline in the snapshot refresh.
    // Registering a workspace (via the sidebar listing) must not block on a `gh`
    // round-trip, so neither the initial refresh nor the self-heal refresh calls
    // getPullRequestStatus. (This github stub omits the poll, so the only path
    // that could call getPullRequestStatus is the removed inline fetch.)
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getCheckoutStatus,
      getPullRequestStatus,
      now: () => new Date(nowMs),
    });
    // Periodic refresh follows the active workspace, so a test about self-heal has to say
    // which workspace the user is in. Set before registering, so the timer starts with the
    // subscription rather than through a become-active catch-up.
    service.setActiveWorkspace(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    nowMs = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    expect(getPullRequestStatus).not.toHaveBeenCalled();

    subscription.unsubscribe();
    service.dispose();
  });

  test("self-heal retries workspace observation setup while a listener remains active", async () => {
    let nowMs = 0;
    const getCheckoutSnapshotFacts = vi
      .fn<(cwd: string) => Promise<CheckoutSnapshotFacts>>()
      .mockRejectedValueOnce(new Error("git facts temporarily unavailable"))
      .mockImplementation(async (cwd: string) => createCheckoutFacts(cwd));
    const watch = vi.fn(() => createWatcher() as never);
    const service = createService({
      getCheckoutSnapshotFacts,
      watch,
      now: () => new Date(nowMs),
    });

    service.setActiveWorkspace(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    expect(getCheckoutSnapshotFacts).toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    const factsCallsBeforeSelfHeal = getCheckoutSnapshotFacts.mock.calls.length;

    nowMs = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();

    expect(getCheckoutSnapshotFacts.mock.calls.length).toBeGreaterThan(factsCallsBeforeSelfHeal);
    expect(getCheckoutSnapshotFacts).toHaveBeenLastCalledWith(REPO_CWD, expect.anything());

    subscription.unsubscribe();
    service.dispose();
  });

  test("stale workspace watcher callbacks do not refresh after unsubscribe", async () => {
    const watchCallbacks: Array<() => void> = [];
    const watch = vi.fn(
      (_watchPath: string, _options: { recursive: boolean }, callback: () => void) => {
        watchCallbacks.push(callback);
        return createWatcher() as never;
      },
    );
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      resolveAbsoluteGitDir: vi.fn(async () => join(REPO_CWD, ".git")),
      watch,
    });

    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    await vi.waitFor(() => {
      expect(watchCallbacks.length).toBeGreaterThan(0);
    });
    const callsBeforeStaleCallback = getCheckoutStatus.mock.calls.length;

    subscription.unsubscribe();
    watchCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(callsBeforeStaleCallback);

    service.dispose();
  });

  test("stale GitHub poll callbacks do not refresh after unsubscribe", async () => {
    let pollStatus: (() => void) | null = null;
    const pollUnsubscribe = vi.fn();
    const github = {
      ...createGitHubServiceStub(),
      retainCurrentPullRequestStatusPoll: vi.fn((options: { onStatus: () => void }) => {
        pollStatus = options.onStatus;
        return { unsubscribe: pollUnsubscribe };
      }),
    };
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      github,
    });

    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    await vi.waitFor(() => {
      expect(github.retainCurrentPullRequestStatusPoll).toHaveBeenCalledTimes(1);
    });
    const callsBeforeStaleCallback = getCheckoutStatus.mock.calls.length;

    subscription.unsubscribe();
    pollStatus?.();
    await flushPromises();

    expect(pollUnsubscribe).toHaveBeenCalledTimes(1);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(callsBeforeStaleCallback);

    service.dispose();
  });

  test("subscription starts GitHub self-heal reads within the fast poll window", async () => {
    let nowMs = 0;
    const githubReadCalls: Array<{ reason: string | undefined; tickMs: number }> = [];
    const github = createGitHubService({
      ttlMs: 0,
      runner: vi.fn(async () => ({
        stdout: currentPullRequestJson({
          statusCheckRollup: [{ __typename: "StatusContext", context: "ci", state: "PENDING" }],
        }),
        stderr: "",
      })),
      resolveGhPath: async () => "/usr/bin/gh",
      now: () => nowMs,
    });
    const getCurrentPullRequestStatus = github.getCurrentPullRequestStatus.bind(github);
    github.getCurrentPullRequestStatus = vi.fn(
      async (options): Promise<CurrentPullRequestStatus | null> => {
        githubReadCalls.push({ reason: options.reason, tickMs: nowMs });
        return getCurrentPullRequestStatus(options);
      },
    );
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, { currentBranch: "feature" }),
    );
    const service = createService({
      getCheckoutStatus,
      github,
      now: () => new Date(nowMs),
    });
    const listener = vi.fn();
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    const gitReadsAfterInitialSnapshot = getCheckoutStatus.mock.calls.length;

    nowMs = 20_000;
    await vi.advanceTimersByTimeAsync(20_000);
    await flushPromises();

    expect(githubReadCalls).toContainEqual({
      reason: "self-heal-github",
      tickMs: 20_000,
    });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(gitReadsAfterInitialSnapshot);
    // The self-heal read emits as PR-status-only — it refreshed the pull request, not the git
    // state — which is the second argument subscribers now receive alongside the snapshot.
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        forge: expect.objectContaining({
          pullRequest: expect.objectContaining({
            checksStatus: "pending",
          }),
        }),
      }),
      { prStatusOnly: true },
    );

    subscription.unsubscribe();
    service.dispose();
    github.dispose?.();
  });

  test("GitHub self-heal polling uses the fork PR head branch instead of the owner-prefixed local branch", async () => {
    const retainCurrentPullRequestStatusPoll = vi.fn(() => ({ unsubscribe: vi.fn() }));
    const github = {
      ...createGitHubServiceStub(),
      retainCurrentPullRequestStatusPoll,
    };
    const getCheckoutSnapshotFacts = vi.fn(async (cwd: string) =>
      createCheckoutFacts(cwd, {
        currentBranch: "fork-owner/open-button-targets-active-file",
        branchRemoteName: "otto-pr-1285",
        branchMergeRef: "refs/heads/open-button-targets-active-file",
        pullRequestLookupTarget: {
          headRef: "open-button-targets-active-file",
          headRepositoryOwner: "fork-owner",
        },
      }),
    );
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        currentBranch: "fork-owner/open-button-targets-active-file",
        remoteUrl: "git@github.com:otto-code-ai/otto-code.git",
      }),
    );
    const service = createService({
      getCheckoutSnapshotFacts,
      getCheckoutStatus,
      github,
    });

    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    await vi.waitFor(() => {
      expect(retainCurrentPullRequestStatusPoll).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: REPO_CWD,
          headRef: "open-button-targets-active-file",
          headRepositoryOwner: "fork-owner",
        }),
      );
    });

    subscription.unsubscribe();
    service.dispose();
  });

  test("settled GitHub self-heal reads stay on the slow poll window without refreshing git", async () => {
    let nowMs = 0;
    const githubReadCalls: Array<{ reason: string | undefined; tickMs: number }> = [];
    const github = createGitHubService({
      ttlMs: 0,
      runner: vi.fn(async () => ({
        stdout: currentPullRequestJson(),
        stderr: "",
      })),
      resolveGhPath: async () => "/usr/bin/gh",
      now: () => nowMs,
    });
    const getCurrentPullRequestStatus = github.getCurrentPullRequestStatus.bind(github);
    github.getCurrentPullRequestStatus = vi.fn(
      async (options): Promise<CurrentPullRequestStatus | null> => {
        githubReadCalls.push({ reason: options.reason, tickMs: nowMs });
        return getCurrentPullRequestStatus(options);
      },
    );
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, { currentBranch: "feature" }),
    );
    const service = createService({
      getCheckoutStatus,
      github,
      now: () => new Date(nowMs),
    });
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    const gitReadsAfterInitialSnapshot = getCheckoutStatus.mock.calls.length;

    nowMs = 20_000;
    await vi.advanceTimersByTimeAsync(20_000);
    await flushPromises();

    expect(githubReadCalls).not.toContainEqual({
      reason: "self-heal-github",
      tickMs: 20_000,
    });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(gitReadsAfterInitialSnapshot);

    nowMs = 120_000;
    await vi.advanceTimersByTimeAsync(100_000);
    await flushPromises();

    expect(githubReadCalls).toContainEqual({
      reason: "self-heal-github",
      tickMs: 120_000,
    });

    subscription.unsubscribe();
    service.dispose();
    github.dispose?.();
  });

  test("subscription skips GitHub self-heal polling when the checkout has no GitHub remote", async () => {
    const retainCurrentPullRequestStatusPoll = vi.fn(() => ({ unsubscribe: vi.fn() }));
    const github = {
      ...createGitHubServiceStub(),
      retainCurrentPullRequestStatusPoll,
    };
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        hasRemote: false,
        remoteUrl: null,
      }),
    );
    const service = createService({
      getCheckoutStatus,
      github,
    });
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    expect(retainCurrentPullRequestStatusPoll).not.toHaveBeenCalled();

    subscription.unsubscribe();
    service.dispose();
  });

  test("subscription starts GitHub self-heal polling for ssh.github.com remotes", async () => {
    const retainCurrentPullRequestStatusPoll = vi.fn(() => ({ unsubscribe: vi.fn() }));
    const github = {
      ...createGitHubServiceStub(),
      retainCurrentPullRequestStatusPoll,
    };
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        remoteUrl: "ssh://git@ssh.github.com/acme/repo.git",
      }),
    );
    const service = createService({
      getCheckoutStatus,
      github,
    });
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    await vi.waitFor(() => {
      expect(retainCurrentPullRequestStatusPoll).toHaveBeenCalledTimes(1);
    });

    subscription.unsubscribe();
    service.dispose();
  });

  test("multiple subscribers on the same target share one self-heal timer", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    service.setActiveWorkspace(REPO_CWD);
    const first = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    const second = service.registerWorkspace({ cwd: join(REPO_CWD, ".") }, vi.fn());
    await flushPromises();

    nowMs = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    first.unsubscribe();
    second.unsubscribe();
    service.dispose();
  });

  test("unsubscribe with no remaining subscribers clears the self-heal timer", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());

    subscription.unsubscribe();
    nowMs = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(0);

    service.dispose();
  });

  test("service disposal clears all self-heal timers", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());

    service.dispose();
    nowMs = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(0);
  });

  test("direct getSnapshot returns current snapshot during a self-heal refresh", async () => {
    let nowMs = 0;
    const selfHealRefresh = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockImplementationOnce(async () => createCheckoutStatus(REPO_CWD))
      .mockImplementationOnce(async () => selfHealRefresh.promise);
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });
    service.setActiveWorkspace(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    nowMs = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();
    const directRead = service.getSnapshot(REPO_CWD);
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    // Initial refresh is git-only (GitHub arrives via the poll, unimplemented in
    // this stub), so the current snapshot reports GitHub as unavailable.
    await expect(directRead).resolves.toEqual(
      createSnapshot(REPO_CWD, { forge: { featuresEnabled: false, pullRequest: null } }),
    );

    selfHealRefresh.resolve(createCheckoutStatus(REPO_CWD));
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    subscription.unsubscribe();
    service.dispose();
  });
});

describe("WorkspaceGitServiceImpl D2 read methods", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("validateBranchRef cold-loads, warms, forces, and coalesces per cwd/ref", async () => {
    let nowMs = 0;
    const branchResolution = createDeferred<{ kind: "local"; name: string }>();
    const resolveBranchCheckout = vi
      .fn()
      .mockImplementationOnce(async () => branchResolution.promise)
      .mockResolvedValue({ kind: "local", name: "feature" });
    const service = createService({
      resolveBranchCheckout,
      now: () => new Date(nowMs),
    });

    const first = service.validateBranchRef(REPO_CWD, "feature");
    const second = service.validateBranchRef(join(REPO_CWD, "."), "feature");
    await flushPromises();

    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);
    branchResolution.resolve({ kind: "local", name: "feature" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "local", name: "feature" },
      { kind: "local", name: "feature" },
    ]);

    nowMs = 1_000;
    await service.validateBranchRef(REPO_CWD, "feature");
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);

    await service.validateBranchRef(REPO_CWD, "feature", { force: true, reason: "test" });
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("hasLocalBranch cold-loads, warms, forces, and coalesces per cwd/ref", async () => {
    let nowMs = 0;
    const branchLookup = createDeferred<{
      stdout: string;
      stderr: string;
      truncated: boolean;
      exitCode: number;
      signal: NodeJS.Signals | null;
    }>();
    const runGitCommand = vi
      .fn()
      .mockImplementationOnce(async () => branchLookup.promise)
      .mockResolvedValue({
        stdout: "",
        stderr: "",
        truncated: false,
        exitCode: 1,
        signal: null,
      });
    const service = createService({
      runGitCommand,
      now: () => new Date(nowMs),
    });

    const first = service.hasLocalBranch(REPO_CWD, "feature");
    const second = service.hasLocalBranch(join(REPO_CWD, "."), "feature");
    await flushPromises();

    expect(runGitCommand).toHaveBeenCalledTimes(1);
    expect(runGitCommand).toHaveBeenCalledWith(
      ["rev-parse", "--verify", "--quiet", "refs/heads/feature"],
      expect.objectContaining({
        cwd: REPO_CWD,
        acceptExitCodes: [0, 1],
      }),
    );
    branchLookup.resolve({
      stdout: "",
      stderr: "",
      truncated: false,
      exitCode: 0,
      signal: null,
    });
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    nowMs = 1_000;
    await expect(service.hasLocalBranch(REPO_CWD, "feature")).resolves.toBe(true);
    expect(runGitCommand).toHaveBeenCalledTimes(1);

    await expect(
      service.hasLocalBranch(REPO_CWD, "feature", { force: true, reason: "test" }),
    ).resolves.toBe(false);
    expect(runGitCommand).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("validateBranchRef serves stale cache during internal min-gap after a failed refresh", async () => {
    let nowMs = 0;
    const resolveBranchCheckout = vi
      .fn()
      .mockResolvedValueOnce({ kind: "local", name: "feature-old" })
      .mockRejectedValueOnce(new Error("git is busy"))
      .mockResolvedValue({ kind: "local", name: "feature-new" });
    const service = createService({
      resolveBranchCheckout,
      now: () => new Date(nowMs),
    });

    await expect(service.validateBranchRef(REPO_CWD, "feature")).resolves.toEqual({
      kind: "local",
      name: "feature-old",
    });

    nowMs = 16_000;
    resolveBranchCheckout.mockClear();
    await expect(service.validateBranchRef(REPO_CWD, "feature")).rejects.toThrow("git is busy");
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);

    nowMs = 16_500;
    await expect(service.validateBranchRef(REPO_CWD, "feature")).resolves.toEqual({
      kind: "local",
      name: "feature-old",
    });
    expect(resolveBranchCheckout).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("suggestBranchesForCwd cold-loads, warms, forces, and coalesces per query", async () => {
    let nowMs = 0;
    const suggestions = [{ name: "feature", committerDate: 1, hasLocal: true, hasRemote: false }];
    const suggestionsDeferred = createDeferred<typeof suggestions>();
    const listBranchSuggestions = vi
      .fn()
      .mockImplementationOnce(async () => suggestionsDeferred.promise)
      .mockResolvedValue(suggestions);
    const service = createService({
      listBranchSuggestions,
      now: () => new Date(nowMs),
    });

    const first = service.suggestBranchesForCwd(REPO_CWD, { query: "feat", limit: 5 });
    const second = service.suggestBranchesForCwd(join(REPO_CWD, "."), {
      query: "feat",
      limit: 5,
    });
    await flushPromises();

    expect(listBranchSuggestions).toHaveBeenCalledTimes(1);
    suggestionsDeferred.resolve(suggestions);
    await expect(Promise.all([first, second])).resolves.toEqual([suggestions, suggestions]);

    nowMs = 1_000;
    await service.suggestBranchesForCwd(REPO_CWD, { query: "feat", limit: 5 });
    expect(listBranchSuggestions).toHaveBeenCalledTimes(1);

    await service.suggestBranchesForCwd(
      REPO_CWD,
      { query: "feat", limit: 5 },
      { force: true, reason: "test" },
    );
    expect(listBranchSuggestions).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("listStashes cold-loads, warms, forces, and coalesces per cwd", async () => {
    let nowMs = 0;
    const stashOutput = "stash@{0}\u0000otto-auto-stash: feature\n";
    const stashDeferred = createDeferred<{
      stdout: string;
      stderr: string;
      truncated: boolean;
      exitCode: number;
      signal: null;
    }>();
    const runGitCommand = vi
      .fn()
      .mockImplementationOnce(async () => stashDeferred.promise)
      .mockResolvedValue({
        stdout: stashOutput,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
      });
    const service = createService({
      runGitCommand,
      now: () => new Date(nowMs),
    });

    const first = service.listStashes(REPO_CWD, { ottoOnly: true });
    const second = service.listStashes(join(REPO_CWD, "."), { ottoOnly: true });
    await flushPromises();

    expect(runGitCommand).toHaveBeenCalledTimes(1);
    stashDeferred.resolve({
      stdout: stashOutput,
      stderr: "",
      truncated: false,
      exitCode: 0,
      signal: null,
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ index: 0, message: "otto-auto-stash: feature", branch: "feature", isOtto: true }],
      [{ index: 0, message: "otto-auto-stash: feature", branch: "feature", isOtto: true }],
    ]);

    nowMs = 1_000;
    await service.listStashes(REPO_CWD, { ottoOnly: true });
    expect(runGitCommand).toHaveBeenCalledTimes(1);

    await service.listStashes(REPO_CWD, { ottoOnly: true }, { force: true, reason: "test" });
    expect(runGitCommand).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("listWorktrees cold-loads, warms, forces, and coalesces per repo root", async () => {
    let nowMs = 0;
    const worktrees = [
      {
        path: "/tmp/otto-home/worktrees/repo/feature",
        createdAt: "2026-04-12T00:00:00.000Z",
        branchName: "feature",
      },
    ];
    const listOttoWorktrees = vi.fn().mockResolvedValue(worktrees);
    const service = createService({
      listOttoWorktrees,
      now: () => new Date(nowMs),
    });

    const first = service.listWorktrees(REPO_CWD);
    const second = service.listWorktrees(join(REPO_CWD, "."));
    await expect(Promise.all([first, second])).resolves.toEqual([worktrees, worktrees]);
    expect(listOttoWorktrees).toHaveBeenCalledTimes(1);

    nowMs = 1_000;
    await service.listWorktrees(REPO_CWD);
    expect(listOttoWorktrees).toHaveBeenCalledTimes(1);

    await service.listWorktrees(REPO_CWD, { force: true, reason: "test" });
    expect(listOttoWorktrees).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("listWorktrees shares one repo-root scoped read across sibling workspace cwds", async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "workspace-git-service-")));
    const repoDir = join(tempDir, "repo");
    const nestedWorkspaceDir = join(repoDir, "packages", "app");
    mkdirSync(nestedWorkspaceDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });

    const worktrees = [
      {
        path: join(tempDir, "otto-home", "worktrees", "repo", "feature"),
        createdAt: "2026-04-12T00:00:00.000Z",
        branchName: "feature",
      },
    ];
    const listOttoWorktrees = vi.fn(async () => worktrees);
    const service = createService({
      getCheckoutSnapshotFacts: getCheckoutSnapshotFactsUncached as never,
      getCheckoutStatus: getCheckoutStatusUncached as never,
      listOttoWorktrees,
    });

    try {
      await expect(
        Promise.all([service.listWorktrees(repoDir), service.listWorktrees(nestedWorkspaceDir)]),
      ).resolves.toEqual([worktrees, worktrees]);
      await expect(service.listWorktrees(nestedWorkspaceDir)).resolves.toEqual(worktrees);

      expect(listOttoWorktrees).toHaveBeenCalledTimes(1);
      expect(listOttoWorktrees).toHaveBeenCalledWith({
        cwd: realpathSync.native(repoDir).replace(/\\/g, "/"),
        ottoHome: "/tmp/otto-test",
      });
    } finally {
      service.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveDefaultBranch cold-loads, warms, forces, and coalesces per cwd", async () => {
    let nowMs = 0;
    const defaultBranch = createDeferred<string | null>();
    const resolveRepositoryDefaultBranch = vi
      .fn()
      .mockImplementationOnce(async () => defaultBranch.promise)
      .mockResolvedValue("trunk");
    const service = createService({
      resolveRepositoryDefaultBranch,
      now: () => new Date(nowMs),
    });

    const first = service.resolveDefaultBranch(REPO_CWD);
    const second = service.resolveDefaultBranch(join(REPO_CWD, "."));
    await flushPromises();

    expect(resolveRepositoryDefaultBranch).toHaveBeenCalledTimes(1);
    defaultBranch.resolve("main");
    await expect(Promise.all([first, second])).resolves.toEqual(["main", "main"]);

    nowMs = 1_000;
    await service.resolveDefaultBranch(REPO_CWD);
    expect(resolveRepositoryDefaultBranch).toHaveBeenCalledTimes(1);

    await service.resolveDefaultBranch(REPO_CWD, { force: true, reason: "test" });
    expect(resolveRepositoryDefaultBranch).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("resolveRepoRoot cold-loads, warms, forces, and coalesces through snapshots", async () => {
    let nowMs = 0;
    const checkoutDeferred = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi
      .fn()
      .mockImplementationOnce(async () => checkoutDeferred.promise)
      .mockResolvedValue(createCheckoutStatus(REPO_CWD));
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    const first = service.resolveRepoRoot(REPO_CWD);
    const second = service.resolveRepoRoot(join(REPO_CWD, "."));
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    checkoutDeferred.resolve(createCheckoutStatus(REPO_CWD));
    await expect(Promise.all([first, second])).resolves.toEqual([REPO_CWD, REPO_CWD]);

    nowMs = 1_000;
    await service.resolveRepoRoot(REPO_CWD);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    await service.resolveRepoRoot(REPO_CWD, { force: true, reason: "test" });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("resolveRepoRemoteUrl reads remote URL through the snapshot cache", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        remoteUrl: "https://github.com/otto-code-ai/otto-code.git",
      }),
    );
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await expect(service.resolveRepoRemoteUrl(REPO_CWD)).resolves.toBe(
      "https://github.com/otto-code-ai/otto-code.git",
    );
    nowMs = 1_000;
    await expect(service.resolveRepoRemoteUrl(join(REPO_CWD, "."))).resolves.toBe(
      "https://github.com/otto-code-ai/otto-code.git",
    );

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getWorkspaceGitMetadata derives reconciliation metadata from the snapshot cache", async () => {
    let nowMs = 0;
    const getCheckoutStatus = vi.fn(async (cwd: string) =>
      createCheckoutStatus(cwd, {
        currentBranch: "feature/service-metadata",
        remoteUrl: "https://github.com/otto-code-ai/otto-code.git",
        repoRoot: REPO_CWD,
      }),
    );
    const service = createService({
      getCheckoutStatus,
      now: () => new Date(nowMs),
    });

    await expect(
      service.getWorkspaceGitMetadata(REPO_CWD, { directoryName: "Local Repo" }),
    ).resolves.toEqual({
      projectKind: "git",
      projectDisplayName: "otto-code-ai/otto-code",
      workspaceDisplayName: "feature/service-metadata",
      gitRemote: "https://github.com/otto-code-ai/otto-code.git",
      isWorktree: false,
      projectSlug: "otto-code",
      repoRoot: REPO_CWD,
      currentBranch: "feature/service-metadata",
      remoteUrl: "https://github.com/otto-code-ai/otto-code.git",
    });

    nowMs = 1_000;
    await service.getWorkspaceGitMetadata(join(REPO_CWD, "."), { directoryName: "Local Repo" });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getCheckoutDiff returns real staged and unstaged changes from a temp git repo", async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "workspace-git-service-diff-")));
    const repoDir = join(tempDir, "repo");
    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
      cwd: repoDir,
      stdio: "pipe",
    });
    writeFileSync(join(repoDir, "tracked.txt"), "before\nafter\n");
    writeFileSync(join(repoDir, "staged.txt"), "staged\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: repoDir, stdio: "pipe" });

    const service = createService({
      getCheckoutDiff: getCheckoutDiffUncached as never,
    });

    try {
      const diff = await service.getCheckoutDiff(repoDir, {
        mode: "uncommitted",
        includeStructured: true,
      });

      expect(diff.diff).toContain("tracked.txt");
      expect(diff.diff).toContain("staged.txt");
      expect(diff.structured?.map((file) => file.path).sort()).toEqual([
        "staged.txt",
        "tracked.txt",
      ]);
    } finally {
      service.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("getCheckoutDiff coalesces concurrent callers per cwd and compare options", async () => {
    const diffDeferred = createDeferred<CheckoutDiffResult>();
    const getCheckoutDiff = vi
      .fn<(cwd: string, compare: CheckoutDiffCompare) => Promise<CheckoutDiffResult>>()
      .mockImplementationOnce(async () => diffDeferred.promise)
      .mockResolvedValue({ diff: "second" });
    const service = createService({ getCheckoutDiff, now: () => new Date(0) });

    const first = service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" });
    const second = service.getCheckoutDiff(join(REPO_CWD, "."), { mode: "uncommitted" });
    await flushPromises();

    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);
    diffDeferred.resolve({ diff: "shared" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { diff: "shared" },
      { diff: "shared" },
    ]);
    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("forced getCheckoutDiff bypasses warm cache and internal min-gap", async () => {
    let nowMs = 0;
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "first" })
      .mockResolvedValueOnce({ diff: "forced" });
    const service = createService({
      getCheckoutDiff,
      now: () => new Date(nowMs),
    });

    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).resolves.toEqual({
      diff: "first",
    });
    nowMs = 1;
    await expect(
      service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" }, { force: true, reason: "test" }),
    ).resolves.toEqual({ diff: "forced" });

    expect(getCheckoutDiff).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("getCheckoutDiff serves cached value within the internal min-gap for non-forced reads", async () => {
    let nowMs = 0;
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "first" })
      .mockRejectedValueOnce(new Error("git is busy"))
      .mockResolvedValueOnce({ diff: "second" });
    const service = createService({
      getCheckoutDiff,
      now: () => new Date(nowMs),
    });

    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).resolves.toEqual({
      diff: "first",
    });
    nowMs = 16_000;
    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).rejects.toThrow(
      "git is busy",
    );
    nowMs = 16_500;
    await expect(service.getCheckoutDiff(REPO_CWD, { mode: "uncommitted" })).resolves.toEqual({
      diff: "first",
    });

    expect(getCheckoutDiff).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("getCheckoutDiff uses different cache keys for different compare arguments", async () => {
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "main" })
      .mockResolvedValueOnce({ diff: "release" })
      .mockResolvedValueOnce({ diff: "main-whitespace" });
    const service = createService({
      getCheckoutDiff,
      now: () => new Date(0),
    });

    await expect(
      service.getCheckoutDiff(REPO_CWD, { mode: "base", baseRef: "main" }),
    ).resolves.toEqual({ diff: "main" });
    await expect(
      service.getCheckoutDiff(REPO_CWD, { mode: "base", baseRef: "release" }),
    ).resolves.toEqual({ diff: "release" });
    await expect(
      service.getCheckoutDiff(REPO_CWD, {
        mode: "base",
        baseRef: "main",
        ignoreWhitespace: true,
      }),
    ).resolves.toEqual({ diff: "main-whitespace" });

    expect(getCheckoutDiff).toHaveBeenCalledTimes(3);

    service.dispose();
  });

  // POSIX-only: this asserts Linux working-tree walker behavior around ignored directories.
  test.skipIf(isPlatform("win32"))(
    "Linux working tree walker excludes gitignored directories",
    async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

      const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "workspace-git-service-ignored-")));
      const repoDir = join(tempDir, "repo");
      mkdirSync(join(repoDir, "ignored", "deep"), { recursive: true });
      mkdirSync(join(repoDir, "kept"), { recursive: true });
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
      writeFileSync(join(repoDir, ".gitignore"), "ignored/\n");
      writeFileSync(join(repoDir, "ignored", "log.txt"), "noise\n");
      writeFileSync(join(repoDir, "ignored", "deep", "log.txt"), "noise\n");
      writeFileSync(join(repoDir, "kept", "file.txt"), "keep\n");

      const watchedPaths: string[] = [];
      const watchSpy = (watchPath: string) => {
        watchedPaths.push(watchPath);
        return { close: vi.fn(), on: vi.fn().mockReturnThis() };
      };

      const service = createService({
        watch: watchSpy as never,
        readdir: readdir as never,
        runGitCommand: runGitCommandReal as never,
        getCheckoutSnapshotFacts: getCheckoutSnapshotFactsUncached as never,
        getCheckoutStatus: getCheckoutStatusUncached as never,
        resolveAbsoluteGitDir: resolveAbsoluteGitDirReal as never,
      });

      try {
        const subscription = await service.requestWorkingTreeWatch(repoDir, vi.fn());

        const ignoredRoot = join(repoDir, "ignored");
        expect(watchedPaths.filter((path) => path.startsWith(ignoredRoot))).toEqual([]);
        expect(watchedPaths).toContain(repoDir);
        expect(watchedPaths).toContain(join(repoDir, "kept"));

        subscription.unsubscribe();
      } finally {
        service.dispose();
        rmSync(tempDir, { recursive: true, force: true });
        Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
      }
    },
  );

  // The cost of Otto used to grow with the size of the workspace catalogue rather than with
  // what the user was doing: every listed workspace got a 60s self-heal refresh of its own,
  // and one refresh is around nine `git` invocations. These lock the scoping that fixed it.
  test("only the active workspace pays the periodic refresh cost", async () => {
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    let clockMs = Date.parse("2026-04-12T00:00:00.000Z");
    const advance = async (ms: number): Promise<void> => {
      clockMs += ms;
      await vi.advanceTimersByTimeAsync(ms);
      await flushPromises();
    };

    const service = createService({
      getCheckoutStatus: getCheckoutStatus as never,
      now: () => new Date(clockMs),
    });

    const active = REPO_CWD;
    const background = resolvePath("/tmp/other-repo");

    try {
      service.registerWorkspace({ cwd: active }, vi.fn());
      service.registerWorkspace({ cwd: background }, vi.fn());
      service.setActiveWorkspace(active);
      await advance(1_000);

      const baseline = new Map<string, number>();
      for (const cwd of [active, background]) {
        baseline.set(cwd, callsForCwd(getCheckoutStatus, cwd));
      }

      // Two self-heal windows. The active workspace refreshes; the dormant one must not
      // spend a single git invocation.
      await advance(WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS * 2 + 5_000);

      expect(callsForCwd(getCheckoutStatus, active)).toBeGreaterThan(baseline.get(active) ?? 0);
      expect(callsForCwd(getCheckoutStatus, background)).toBe(baseline.get(background) ?? 0);
    } finally {
      service.dispose();
    }
  });

  test("switching the active workspace moves the periodic cost with it", async () => {
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    let clockMs = Date.parse("2026-04-12T00:00:00.000Z");
    const advance = async (ms: number): Promise<void> => {
      clockMs += ms;
      await vi.advanceTimersByTimeAsync(ms);
      await flushPromises();
    };

    const service = createService({
      getCheckoutStatus: getCheckoutStatus as never,
      now: () => new Date(clockMs),
    });

    const first = REPO_CWD;
    const second = resolvePath("/tmp/other-repo");

    try {
      service.registerWorkspace({ cwd: first }, vi.fn());
      service.registerWorkspace({ cwd: second }, vi.fn());
      service.setActiveWorkspace(first);
      await advance(WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS + 5_000);

      // Becoming active earns one immediate catch-up refresh, since the workspace may have
      // gone stale while dormant and the user is looking at it now.
      const beforeSwitch = callsForCwd(getCheckoutStatus, second);
      service.setActiveWorkspace(second);
      await advance(5_000);
      expect(callsForCwd(getCheckoutStatus, second)).toBeGreaterThan(beforeSwitch);

      // And the one left behind goes quiet.
      const firstAfterSwitch = callsForCwd(getCheckoutStatus, first);
      await advance(WORKSPACE_GIT_SELF_HEAL_INTERVAL_MS * 2 + 5_000);
      expect(callsForCwd(getCheckoutStatus, first)).toBe(firstAfterSwitch);
    } finally {
      service.dispose();
    }
  });

  // Regression: `.git/HEAD` used to be watched as a file. Git never edits HEAD in place —
  // `git checkout` writes `HEAD.lock` and renames it over HEAD — and a file watch binds to
  // the inode, so after the first checkout the watcher held an unlinked file and went deaf.
  // Switching branches in a terminal then never reached the Changes sidebar.
  test("watches the git directory for HEAD changes, not the HEAD file", async () => {
    const watched: { path: string; listener: (event: string, filename: string | null) => void }[] =
      [];
    const watchSpy = (
      path: string,
      _options: unknown,
      listener: (event: string, filename: string | null) => void,
    ) => {
      watched.push({ path, listener });
      return { close: vi.fn(), on: vi.fn().mockReturnThis() };
    };
    // Status is re-measured by every refresh, so it is the honest probe for "the watcher
    // reached the workspace"; the facts read behind it is cached and answers once.
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));

    // The shared deps freeze `now`, which makes the min-gap that coalesces non-forced
    // refreshes suppress everything and would leave both assertions below vacuous. Drive a
    // real clock alongside the fake timers instead.
    let clockMs = Date.parse("2026-04-12T00:00:00.000Z");
    const advance = async (ms: number): Promise<void> => {
      clockMs += ms;
      await vi.advanceTimersByTimeAsync(ms);
      await flushPromises();
    };

    const service = createService({
      watch: watchSpy as never,
      getCheckoutStatus: getCheckoutStatus as never,
      now: () => new Date(clockMs),
    });

    try {
      service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
      await advance(100);

      const watchedPaths = watched.map((entry) => entry.path);
      expect(watchedPaths).toContain(join(REPO_CWD, ".git"));
      expect(watchedPaths).toContain(join(REPO_CWD, ".git", "refs", "heads"));
      expect(watchedPaths).not.toContain(join(REPO_CWD, ".git", "HEAD"));

      const gitDirWatch = watched.find((entry) => entry.path === join(REPO_CWD, ".git"));
      expect(gitDirWatch).toBeDefined();

      // The rest of `.git`'s churn must not schedule a refresh, or every git command in
      // the workspace would cost a snapshot.
      const baseline = getCheckoutStatus.mock.calls.length;
      gitDirWatch?.listener("change", "index.lock");
      // Comfortably past both the watch debounce and the internal min-gap that coalesces
      // non-forced refreshes, and well short of the 60s self-heal that would refresh anyway.
      await advance(5_000);
      expect(getCheckoutStatus.mock.calls.length).toBe(baseline);

      // A HEAD rename is the branch switch, and it must land.
      gitDirWatch?.listener("rename", "HEAD");
      await advance(5_000);
      expect(getCheckoutStatus.mock.calls.length).toBeGreaterThan(baseline);
    } finally {
      service.dispose();
    }
  });

  test("onWorkspaceStateMayHaveChanged invalidates github cache and schedules a forced github-inclusive refresh", async () => {
    const github = createGitHubServiceStub();
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getCheckoutStatus,
      getPullRequestStatus,
      github,
    });

    await service.getSnapshot(REPO_CWD);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.onWorkspaceStateMayHaveChanged(REPO_CWD);

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(github.invalidate).toHaveBeenCalledWith({ cwd: REPO_CWD });
    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test("onWorkspaceStateMayHaveChanged preserves includeGitHub when a file watcher fires within the debounce window", async () => {
    const github = createGitHubServiceStub();
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getCheckoutStatus,
      getPullRequestStatus,
      github,
    });

    await service.getSnapshot(REPO_CWD);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.onWorkspaceStateMayHaveChanged(REPO_CWD);
    // File watcher fires 200ms later (before debounce expires)
    await vi.advanceTimersByTimeAsync(200);
    service.scheduleRefreshForCwd(REPO_CWD);

    // Advance past the debounce
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    // Should still refresh GitHub because the first signal asked for it
    expect(getPullRequestStatus).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  test("onWorkspaceStateMayHaveChanged is a no-op for unknown cwds", () => {
    const github = createGitHubServiceStub();
    const service = createService({ github });

    service.onWorkspaceStateMayHaveChanged("/unknown/cwd");

    expect(github.invalidate).not.toHaveBeenCalled();
    service.dispose();
  });
});
