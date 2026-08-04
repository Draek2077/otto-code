import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import os from "node:os";
import path, { join } from "node:path";
import type { FSWatcher } from "node:fs";
import type pino from "pino";
import type { ForgeService } from "../services/forge-service.js";
import type {
  CheckoutIdentityResult,
  CheckoutSnapshotFacts,
  CheckoutStatusGit,
  PullRequestStatusResult,
} from "../utils/checkout-git.js";
import {
  WorkspaceGitServiceImpl,
  type WorkspaceGitRuntimeSnapshot,
} from "./workspace-git-service.js";
import { isPlatform } from "../test-utils/platform.js";

const REPO_CWD = path.resolve("/tmp/repo");

function createLogger() {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    warn: vi.fn(),
  };
  return logger;
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
    forge: {
      featuresEnabled: true,
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

  const featuresEnabled = overrides?.forge?.featuresEnabled ?? base.forge.featuresEnabled;
  const authState =
    overrides?.forge?.authState ?? (featuresEnabled ? "authenticated" : "no_remote");
  const forgeName = resolveSnapshotForgeName(featuresEnabled, overrides);
  return {
    cwd,
    // Measurement timestamp, not state - every fixture is an expectation, and the
    // per-test fake clocks differ, so match on shape.
    gitLoadedAtMs: expect.any(Number) as unknown as number,
    git: {
      ...base.git,
      ...overrides?.git,
    },
    forge: {
      ...base.forge,
      ...overrides?.forge,
      featuresEnabled,
      authState,
      ...(forgeName ? { forge: forgeName } : {}),
      pullRequest: resolveSnapshotPullRequest(base, overrides),
      error: resolveSnapshotError(base, overrides),
    },
  };
}

function hasForgeOverride(
  overrides: { forge?: Partial<WorkspaceGitRuntimeSnapshot["forge"]> } | undefined,
  key: keyof WorkspaceGitRuntimeSnapshot["forge"],
): boolean {
  return Boolean(overrides?.forge && key in overrides.forge);
}

function resolveSnapshotForgeName(
  featuresEnabled: boolean,
  overrides: { forge?: Partial<WorkspaceGitRuntimeSnapshot["forge"]> } | undefined,
): string | undefined {
  if (hasForgeOverride(overrides, "forge")) {
    return overrides?.forge?.forge;
  }
  return featuresEnabled ? "github" : undefined;
}

function resolveSnapshotPullRequest(
  base: WorkspaceGitRuntimeSnapshot,
  overrides: { forge?: Partial<WorkspaceGitRuntimeSnapshot["forge"]> } | undefined,
): WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"] {
  if (hasForgeOverride(overrides, "pullRequest")) {
    return overrides?.forge?.pullRequest ?? null;
  }
  return base.forge.pullRequest;
}

function resolveSnapshotError(
  base: WorkspaceGitRuntimeSnapshot,
  overrides: { forge?: Partial<WorkspaceGitRuntimeSnapshot["forge"]> } | undefined,
): WorkspaceGitRuntimeSnapshot["forge"]["error"] {
  if (hasForgeOverride(overrides, "error")) {
    return overrides?.forge?.error ?? null;
  }
  return base.forge.error;
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

function createCheckoutIdentity(
  cwd: string,
  overrides?: Partial<Extract<CheckoutIdentityResult, { isGit: true }>>,
): CheckoutIdentityResult {
  return {
    isGit: true,
    repoRoot: cwd,
    mainRepoRoot: null,
    currentBranch: "main",
    remoteUrl: "https://github.com/acme/repo.git",
    isOttoOwnedWorktree: false,
    ...overrides,
  };
}

function createCheckoutSnapshotFacts(cwd: string): CheckoutSnapshotFacts {
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
    branchRemoteName: "origin",
    branchMergeRef: "refs/heads/main",
    pullRequestLookupTarget: { headRef: "main" },
  };
}

function createPullRequestStatusResult(
  overrides?: Partial<PullRequestStatusResult>,
): PullRequestStatusResult {
  return {
    status: {
      url: "https://github.com/acme/repo/pull/123",
      title: "Update feature",
      state: "open",
      baseRefName: "main",
      headRefName: "feature",
      isMerged: false,
    },
    authState: "authenticated",
    featuresEnabled: true,
    githubFeaturesEnabled: true,
    ...overrides,
  };
}

function createWatcher(): FSWatcher & { close: ReturnType<typeof vi.fn> } {
  const watcher = {
    close: vi.fn(),
    on: vi.fn().mockReturnThis(),
  };
  return watcher as unknown as FSWatcher & { close: ReturnType<typeof vi.fn> };
}

function createDirent(name: string, isDirectory: boolean) {
  return {
    name,
    isDirectory: () => isDirectory,
  };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
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

function createGitHubServiceStub(): ForgeService {
  return {
    listPullRequests: vi.fn(async () => []),
    listIssues: vi.fn(async () => []),
    searchIssuesAndPrs: vi.fn(async () => ({
      items: [],
      featuresEnabled: true,
      githubFeaturesEnabled: true,
    })),
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
    getPullRequestCheckoutTarget: vi.fn(async ({ number }) => ({
      number,
      baseRefName: "main",
      headRefName: "feature",
      headOwnerLogin: null,
      headRepositorySshUrl: null,
      headRepositoryUrl: null,
      isCrossRepository: false,
    })),
    getCurrentPullRequestStatus: vi.fn(async () => null),
    createPullRequest: vi.fn(async () => ({
      url: "https://github.com/acme/repo/pull/1",
      number: 1,
    })),
    mergePullRequest: vi.fn(async () => ({ success: true })),
    isAuthenticated: vi.fn(async () => true),
    authProbeCanThrow: true,
    invalidate: vi.fn(),
  };
}

interface CreateServiceTestOptions {
  getCheckoutStatus?: ReturnType<typeof vi.fn>;
  getCheckoutIdentity?: ReturnType<typeof vi.fn>;
  getCheckoutSnapshotFacts?: ReturnType<typeof vi.fn>;
  getCheckoutShortstat?: ReturnType<typeof vi.fn>;
  getPullRequestStatus?: ReturnType<typeof vi.fn>;
  github?: ForgeService;
  resolveAbsoluteGitDir?: ReturnType<typeof vi.fn>;
  hasOriginRemote?: ReturnType<typeof vi.fn>;
  runGitFetch?: ReturnType<typeof vi.fn>;
  runGitCommand?: ReturnType<typeof vi.fn>;
  readdir?: ReturnType<typeof vi.fn>;
  watch?: ReturnType<typeof vi.fn>;
  now?: () => Date;
}

function buildDefaultTestServiceDeps() {
  return {
    watch: (() => createWatcher()) as unknown as typeof import("node:fs").watch,
    readdir: vi.fn(async () => []),
    getCheckoutSnapshotFacts: vi.fn(async (cwd: string) => createCheckoutSnapshotFacts(cwd)),
    getCheckoutStatus: vi.fn(async (cwd: string) => createCheckoutStatus(cwd)),
    getCheckoutIdentity: vi.fn(async (cwd: string) => createCheckoutIdentity(cwd)),
    getCheckoutShortstat: vi.fn(async () => ({
      additions: 1,
      deletions: 0,
    })),
    getPullRequestStatus: vi.fn(async () => createPullRequestStatusResult()),
    forgeOverrides: { github: createGitHubServiceStub() },
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

function createService(options?: CreateServiceTestOptions) {
  const { github, ...rest } = options ?? {};
  return new WorkspaceGitServiceImpl({
    logger: createLogger() as unknown as pino.Logger,
    ottoHome: "/tmp/otto-test",
    deps: {
      ...buildDefaultTestServiceDeps(),
      ...rest,
      // A `github` option has to land on forgeOverrides, which is where the
      // forge resolver looks. Spread at the top level it becomes an ignored
      // `deps.github` and the caller silently gets the default stub instead of
      // the one it just configured.
      ...(github ? { forgeOverrides: { github } } : {}),
    },
  });
}

describe("WorkspaceGitServiceImpl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Reconciliation calls this for every project root and every workspace cwd on a
  // 5-minute tick and keeps only the identity fields. Paying getCheckoutStatus's
  // dirty check and three rev-list walks for each one is what turned that tick into
  // a multi-second spawn burst on Windows.
  test("getCheckoutLite reads identity only and never pays for the drift half", async () => {
    const getCheckoutIdentity = vi.fn(async (cwd: string) =>
      createCheckoutIdentity(cwd, { currentBranch: "feature/lite" }),
    );
    const getCheckoutStatus = vi.fn(async (cwd: string) => createCheckoutStatus(cwd));
    const getCheckoutSnapshotFacts = vi.fn(async (cwd: string) => createCheckoutSnapshotFacts(cwd));
    const service = createService({
      getCheckoutIdentity,
      getCheckoutStatus,
      getCheckoutSnapshotFacts,
    });

    const checkout = await service.getCheckoutLite(REPO_CWD);

    expect(checkout).toEqual({
      cwd: REPO_CWD,
      isGit: true,
      currentBranch: "feature/lite",
      remoteUrl: "https://github.com/acme/repo.git",
      worktreeRoot: REPO_CWD,
      isOttoOwnedWorktree: false,
      mainRepoRoot: null,
    });
    expect(getCheckoutIdentity).toHaveBeenCalledTimes(1);
    expect(getCheckoutStatus).not.toHaveBeenCalled();
    expect(getCheckoutSnapshotFacts).not.toHaveBeenCalled();

    service.dispose();
  });

  test("getCheckoutLite reports an Otto worktree with its main repo root", async () => {
    const mainRepoRoot = path.resolve("/tmp/main-repo");
    const getCheckoutIdentity = vi.fn(async (cwd: string) =>
      createCheckoutIdentity(cwd, { mainRepoRoot, isOttoOwnedWorktree: true }),
    );
    const service = createService({ getCheckoutIdentity });

    const checkout = await service.getCheckoutLite(REPO_CWD);

    expect(checkout).toMatchObject({
      isGit: true,
      isOttoOwnedWorktree: true,
      worktreeRoot: REPO_CWD,
      mainRepoRoot,
    });

    service.dispose();
  });

  test("getCheckoutLite reports a non-git directory as the empty checkout", async () => {
    const getCheckoutIdentity = vi.fn(async () => ({ isGit: false as const }));
    const service = createService({ getCheckoutIdentity });

    const checkout = await service.getCheckoutLite(REPO_CWD);

    expect(checkout).toEqual({
      cwd: REPO_CWD,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isOttoOwnedWorktree: false,
      mainRepoRoot: null,
    });

    service.dispose();
  });

  test("registerWorkspace returns a subscription without an initial snapshot contract", async () => {
    const service = createService();

    const listener = vi.fn();
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    expect(subscription).toEqual({ unsubscribe: expect.any(Function) });
    expect("initial" in subscription).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(service.peekSnapshot(REPO_CWD)).toBeNull();

    subscription.unsubscribe();
    service.dispose();
  });

  test("onSnapshotUpdated emits only for observed workspace snapshots and can unsubscribe", async () => {
    const service = createService();
    const snapshotListener = vi.fn();
    const snapshotSubscription = service.onSnapshotUpdated(snapshotListener);

    await service.getSnapshot(REPO_CWD, { force: true, reason: "unobserved" });

    expect(snapshotListener).not.toHaveBeenCalled();

    const workspaceSubscription = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await service.getSnapshot(REPO_CWD, { force: true, reason: "observed" });

    expect(snapshotListener).toHaveBeenCalledTimes(1);
    expect(snapshotListener).toHaveBeenCalledWith(createSnapshot(REPO_CWD));

    snapshotSubscription.unsubscribe();
    await service.getSnapshot(REPO_CWD, { force: true, reason: "after-unsubscribe" });

    expect(snapshotListener).toHaveBeenCalledTimes(1);

    workspaceSubscription.unsubscribe();
    service.dispose();
  });

  test("getSnapshot populates github pull request state in the runtime snapshot", async () => {
    const getPullRequestStatus = vi.fn(async () =>
      createPullRequestStatusResult({
        status: {
          url: "https://github.com/acme/repo/pull/999",
          title: "Ship runtime centralization",
          state: "open",
          baseRefName: "main",
          headRefName: "workspace-git-service",
          isMerged: false,
        },
      }),
    );

    const service = createService({
      getPullRequestStatus,
      now: () => new Date("2026-04-12T02:03:04.000Z"),
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(
      createSnapshot(REPO_CWD, {
        forge: {
          pullRequest: {
            url: "https://github.com/acme/repo/pull/999",
            title: "Ship runtime centralization",
            state: "open",
            baseRefName: "main",
            headRefName: "workspace-git-service",
            isMerged: false,
          },
        },
      }),
    );
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getSnapshot does not probe isAuthenticated for a forge adapter that never throws from it", async () => {
    const gitlabIsAuthenticated = vi.fn(async () => false);
    const gitlabStub: ForgeService = {
      ...createGitHubServiceStub(),
      isAuthenticated: gitlabIsAuthenticated,
      authProbeCanThrow: undefined,
    };
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());

    const service = createService({
      getCheckoutStatus: vi.fn(async (cwd: string) =>
        createCheckoutStatus(cwd, { remoteUrl: "https://gitlab.com/acme/repo.git" }),
      ),
      getPullRequestStatus,
      forgeOverrides: { gitlab: gitlabStub },
    });

    await service.getSnapshot(REPO_CWD);

    expect(gitlabIsAuthenticated).not.toHaveBeenCalled();
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("getSnapshot keeps plain git classification when shortstat lookup fails", async () => {
    const getCheckoutShortstat = vi.fn(async () => {
      throw new Error(
        "Missing Otto worktree base metadata: /tmp/repo/.git/worktrees/feature/otto/worktree.json",
      );
    });
    const service = createService({
      getCheckoutStatus: vi.fn(async (cwd: string) =>
        createCheckoutStatus(cwd, {
          repoRoot: cwd,
          currentBranch: "feature/worktree",
          isOttoOwnedWorktree: false,
          mainRepoRoot: "/tmp/main-repo",
        }),
      ),
      getCheckoutShortstat,
    });

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(
      createSnapshot(REPO_CWD, {
        git: {
          repoRoot: REPO_CWD,
          currentBranch: "feature/worktree",
          isOttoOwnedWorktree: false,
          mainRepoRoot: "/tmp/main-repo",
          diffStat: null,
        },
      }),
    );
  });

  test("non-forced workspace refresh does not reload GitHub or emit when state is unchanged", async () => {
    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const service = createService({
      getPullRequestStatus,
      now: () => new Date(nowMs),
    });
    const listener = vi.fn();
    await service.getSnapshot(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    nowMs += 3_000;
    await service.refresh(REPO_CWD);

    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();

    subscription.unsubscribe();
    service.dispose();
  });

  test("cold getSnapshot calls share one workspace target setup and cache the snapshot", async () => {
    const checkoutStatusDeferred = createDeferred<CheckoutStatusGit>();
    const getCheckoutStatus = vi.fn(async () => checkoutStatusDeferred.promise);
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const resolveAbsoluteGitDir = vi.fn(async () => join(REPO_CWD, ".git"));

    const service = createService({
      getCheckoutStatus,
      getPullRequestStatus,
      resolveAbsoluteGitDir,
    });

    const firstSnapshotPromise = service.getSnapshot(REPO_CWD);
    const secondSnapshotPromise = service.getSnapshot(join(REPO_CWD, "."));
    await flushPromises();

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(0);
    expect(resolveAbsoluteGitDir).toHaveBeenCalledTimes(0);

    checkoutStatusDeferred.resolve(createCheckoutStatus(REPO_CWD));

    await expect(Promise.all([firstSnapshotPromise, secondSnapshotPromise])).resolves.toEqual([
      createSnapshot(REPO_CWD),
      createSnapshot(REPO_CWD),
    ]);

    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);
    expect(resolveAbsoluteGitDir).toHaveBeenCalledTimes(0);
    expect(service.peekSnapshot(REPO_CWD)).toEqual(createSnapshot(REPO_CWD));

    await expect(service.getSnapshot(REPO_CWD)).resolves.toEqual(createSnapshot(REPO_CWD));
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("multiple listeners on the same workspace share one observation setup", async () => {
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const getCheckoutSnapshotFacts = vi.fn(async (cwd: string) => createCheckoutSnapshotFacts(cwd));
    const resolveAbsoluteGitDir = vi.fn(async () => join(REPO_CWD, ".git"));

    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const service = createService({
      getCheckoutSnapshotFacts,
      getPullRequestStatus,
      resolveAbsoluteGitDir,
      now: () => new Date(nowMs),
    });

    const first = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    const second = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    expect(getPullRequestStatus).toHaveBeenCalledTimes(0);
    expect(getCheckoutSnapshotFacts).toHaveBeenCalledTimes(1);
    expect(resolveAbsoluteGitDir).toHaveBeenCalledTimes(0);

    first.unsubscribe();
    second.unsubscribe();
    service.dispose();
  });

  test("equivalent cwd strings share one workspace target across service entry points", async () => {
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    const resolveAbsoluteGitDir = vi.fn(async () => join(REPO_CWD, ".git"));

    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const service = createService({
      getPullRequestStatus,
      resolveAbsoluteGitDir,
      now: () => new Date(nowMs),
    });

    const subscription = service.registerWorkspace({ cwd: join(REPO_CWD, ".") }, vi.fn());

    await expect(service.getSnapshot(join(REPO_CWD, "."))).resolves.toEqual(
      createSnapshot(REPO_CWD),
    );
    expect(service.peekSnapshot(REPO_CWD)).toEqual(createSnapshot(REPO_CWD));

    nowMs += 3_000;
    await service.refresh(REPO_CWD);
    await expect(service.getSnapshot(join(REPO_CWD, "."))).resolves.toEqual(
      createSnapshot(REPO_CWD),
    );

    expect(getPullRequestStatus).toHaveBeenCalledTimes(1);
    expect(resolveAbsoluteGitDir).toHaveBeenCalledTimes(0);

    subscription.unsubscribe();
    service.dispose();
  });

  test("repo-level fetch intervals are shared for workspaces in the same repo", async () => {
    const runGitFetch = vi.fn(async () => {});
    const hasOriginRemote = vi.fn(async () => true);
    const getCheckoutSnapshotFacts = vi.fn(async (cwd: string) => ({
      ...createCheckoutSnapshotFacts(cwd),
      gitCommonDir: join(REPO_CWD, ".git"),
      absoluteGitDir: join(REPO_CWD, ".git"),
    }));
    const resolveAbsoluteGitDir = vi.fn(async () => join(REPO_CWD, ".git"));

    const service = createService({
      getCheckoutSnapshotFacts,
      resolveAbsoluteGitDir,
      hasOriginRemote,
      runGitFetch,
    });

    // The background fetch is the most expensive periodic thing in this service, so it runs
    // only for the repo holding the workspace the user is actually in.
    service.setActiveWorkspace(REPO_CWD);
    const first = service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    const second = service.registerWorkspace(
      { cwd: join(REPO_CWD, "packages", "server") },
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(getCheckoutSnapshotFacts).toHaveBeenCalledTimes(2);
      expect(runGitFetch).toHaveBeenCalledTimes(1);
    });

    expect(resolveAbsoluteGitDir).toHaveBeenCalledTimes(0);
    expect(hasOriginRemote).toHaveBeenCalledTimes(0);
    expect(runGitFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(180_000);
    await flushPromises();

    expect(runGitFetch).toHaveBeenCalledTimes(2);

    first.unsubscribe();
    second.unsubscribe();
    service.dispose();
  });

  test("explicit forced snapshot refresh recomputes github state and notifies listeners", async () => {
    const getPullRequestStatus = vi
      .fn<() => Promise<PullRequestStatusResult>>()
      .mockResolvedValueOnce(
        createPullRequestStatusResult({
          status: {
            url: "https://github.com/acme/repo/pull/123",
            title: "Before refresh",
            state: "open",
            baseRefName: "main",
            headRefName: "feature",
            isMerged: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        createPullRequestStatusResult({
          status: {
            url: "https://github.com/acme/repo/pull/123",
            title: "After refresh",
            state: "merged",
            baseRefName: "main",
            headRefName: "feature",
            isMerged: true,
          },
        }),
      );

    const nowValues = [new Date("2026-04-12T00:00:00.000Z"), new Date("2026-04-12T00:05:00.000Z")];
    const service = createService({
      getPullRequestStatus,
      now: () => nowValues.shift() ?? new Date("2026-04-12T00:05:00.000Z"),
    });

    const listener = vi.fn();
    const initialSnapshot = await service.getSnapshot(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    expect(initialSnapshot.forge.pullRequest?.title).toBe("Before refresh");

    await service.getSnapshot(REPO_CWD, {
      force: true,
      reason: "test-force-github-refresh",
    });
    await flushPromises();

    expect(getPullRequestStatus).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      createSnapshot(REPO_CWD, {
        forge: {
          pullRequest: {
            url: "https://github.com/acme/repo/pull/123",
            title: "After refresh",
            state: "merged",
            baseRefName: "main",
            headRefName: "feature",
            isMerged: true,
          },
        },
      }),
      { prStatusOnly: false },
    );

    subscription.unsubscribe();
    service.dispose();
  });

  test("unchanged runtime snapshots do not emit duplicate updates", async () => {
    const getCheckoutStatus = vi
      .fn<() => Promise<CheckoutStatusGit>>()
      .mockResolvedValueOnce(createCheckoutStatus(REPO_CWD, { remoteUrl: null }))
      .mockResolvedValueOnce(
        createCheckoutStatus(REPO_CWD, {
          currentBranch: "feature/runtime-payloads",
          remoteUrl: null,
          aheadBehind: { ahead: 2, behind: 0 },
          aheadOfOrigin: 2,
        }),
      )
      .mockResolvedValueOnce(
        createCheckoutStatus(REPO_CWD, {
          currentBranch: "feature/runtime-payloads",
          remoteUrl: null,
          aheadBehind: { ahead: 2, behind: 0 },
          aheadOfOrigin: 2,
        }),
      );
    const getPullRequestStatus = vi.fn<() => Promise<PullRequestStatusResult>>().mockResolvedValue(
      createPullRequestStatusResult({
        status: {
          url: "https://github.com/acme/repo/pull/123",
          title: "Runtime payloads",
          state: "open",
          baseRefName: "main",
          headRefName: "feature/runtime-payloads",
          isMerged: false,
        },
      }),
    );

    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const service = createService({
      getCheckoutStatus,
      getPullRequestStatus,
      now: () => new Date(nowMs),
    });

    const listener = vi.fn();
    const initialSnapshot = await service.getSnapshot(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    expect(initialSnapshot.git.currentBranch).toBe("main");

    nowMs += 3_000;
    await service.refresh(REPO_CWD);
    await flushPromises();

    nowMs += 3_000;
    await service.refresh(REPO_CWD);
    await flushPromises();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      createSnapshot(REPO_CWD, {
        git: {
          currentBranch: "feature/runtime-payloads",
          remoteUrl: null,
          aheadBehind: { ahead: 2, behind: 0 },
          aheadOfOrigin: 2,
        },
        forge: {
          featuresEnabled: false,
          pullRequest: null,
        },
      }),
      { prStatusOnly: false },
    );

    subscription.unsubscribe();
    service.dispose();
  });

  test("forced snapshot refresh emits even when the fingerprint matches", async () => {
    const getCheckoutStatus = vi.fn(async () => createCheckoutStatus(REPO_CWD));
    const getPullRequestStatus = vi.fn(async () => createPullRequestStatusResult());
    let nowMs = Date.parse("2026-04-12T00:00:00.000Z");
    const service = createService({
      getCheckoutStatus,
      getPullRequestStatus,
      now: () => new Date(nowMs),
    });

    const listener = vi.fn();
    await service.getSnapshot(REPO_CWD);
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);

    await service.getSnapshot(REPO_CWD, {
      force: true,
      reason: "test-force-emit",
    });
    await flushPromises();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(createSnapshot(REPO_CWD), { prStatusOnly: false });

    subscription.unsubscribe();
    service.dispose();
  });

  // The PR-status poll measures no git state, so its emission must be tagged
  // PR-only. Untagged, downstream rebuilds a whole checkout status from the last
  // git measurement and publishes it as news - which right after a commit ships a
  // pre-commit aheadOfOrigin and mutes Push (batch-07-24 #2).
  test("the pull-request status poll emits a PR-status-only update", async () => {
    const github = createGitHubServiceStub() as GitHubService & {
      retainCurrentPullRequestStatusPoll?: unknown;
    };
    type PolledPrStatus = WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"];
    let emitPollStatus: ((status: PolledPrStatus) => void) | null = null;
    github.retainCurrentPullRequestStatusPoll = vi.fn(
      (input: { onStatus: (status: PolledPrStatus) => void }) => {
        emitPollStatus = input.onStatus;
        return { unsubscribe: vi.fn() };
      },
    );
    const service = createService({ github });

    const listener = vi.fn();
    const subscription = service.registerWorkspace({ cwd: REPO_CWD }, listener);
    await service.getSnapshot(REPO_CWD, { force: true, reason: "test-poll-setup" });
    await flushPromises();
    listener.mockClear();

    expect(emitPollStatus).not.toBeNull();
    emitPollStatus?.({
      url: "https://github.com/acme/repo/pull/123",
      title: "Checks finished",
      state: "open",
      baseRefName: "main",
      headRefName: "feature",
      isMerged: false,
    });
    await flushPromises();

    expect(listener).toHaveBeenCalledTimes(1);
    const [snapshot, meta] = listener.mock.calls[0] as [
      WorkspaceGitRuntimeSnapshot,
      { prStatusOnly: boolean },
    ];
    expect(meta).toEqual({ prStatusOnly: true });
    expect(snapshot.forge.pullRequest?.title).toBe("Checks finished");
    // Same git block as before the poll: it refreshed nothing about the tree.
    expect(snapshot.git).toEqual(createSnapshot(REPO_CWD).git);

    subscription.unsubscribe();
    service.dispose();
  });

  // POSIX-only: this asserts Linux recursive-watch fallback behavior.
  test.skipIf(isPlatform("win32"))("watches nested repository directories on Linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "linux",
    });

    const watchCalls: Array<{ path: string; close: ReturnType<typeof vi.fn> }> = [];
    const watch = vi.fn((watchPath: string) => {
      const watcher = createWatcher();
      watchCalls.push({ path: watchPath, close: watcher.close });
      return watcher;
    });
    const readdir = vi.fn(async (directory: string) => {
      if (directory === REPO_CWD) {
        return [
          createDirent("packages", true),
          createDirent(".git", true),
          createDirent("README.md", false),
        ];
      }
      if (directory === path.join(REPO_CWD, "packages")) {
        return [createDirent("server", true), createDirent("app", true)];
      }
      if (directory === path.join(REPO_CWD, "packages", "server")) {
        return [createDirent("src", true)];
      }
      if (directory === path.join(REPO_CWD, "packages", "server", "src")) {
        return [createDirent("server", true)];
      }
      return [];
    });

    const service = createService({ watch, readdir });
    const subscription = await service.requestWorkingTreeWatch(
      path.join(REPO_CWD, "packages", "server"),
      vi.fn(),
    );

    expect(subscription.repoRoot).toBe(REPO_CWD);
    expect(watchCalls.map((entry) => entry.path).sort()).toEqual([
      REPO_CWD,
      join(REPO_CWD, ".git"),
      join(REPO_CWD, "packages"),
      join(REPO_CWD, "packages", "app"),
      join(REPO_CWD, "packages", "server"),
      join(REPO_CWD, "packages", "server", "src"),
      join(REPO_CWD, "packages", "server", "src", "server"),
    ]);

    subscription.unsubscribe();
    service.dispose();
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  test("requestWorkingTreeWatch reference-counts watchers by cwd", async () => {
    const watchers = [createWatcher(), createWatcher()];
    const watch = vi.fn().mockReturnValueOnce(watchers[0]).mockReturnValueOnce(watchers[1]);
    const service = createService({ watch });

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const first = await service.requestWorkingTreeWatch(REPO_CWD, firstListener);
    const second = await service.requestWorkingTreeWatch(join(REPO_CWD, "."), secondListener);

    expect(first.repoRoot).toBe(REPO_CWD);
    expect(second.repoRoot).toBe(REPO_CWD);
    expect(watch).toHaveBeenCalledTimes(2);

    first.unsubscribe();
    expect(watchers[0].close).not.toHaveBeenCalled();
    expect(watchers[1].close).not.toHaveBeenCalled();

    second.unsubscribe();
    expect(watchers[0].close).toHaveBeenCalledTimes(1);
    expect(watchers[1].close).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  test("sets a 5-second fallback polling interval when recursive watch is unavailable", async () => {
    if (process.platform === "linux") {
      // On Linux, recursive watch is never attempted - the service uses per-directory
      // watchers from the start. This scenario only applies to macOS/Windows where
      // recursive watch is tried first and may fail.
      return;
    }

    const recursiveUnsupported = new Error("recursive unsupported");
    const watch = vi
      .fn()
      .mockImplementationOnce((_watchPath: string, options: { recursive: boolean }) => {
        if (options.recursive) {
          throw recursiveUnsupported;
        }
        return createWatcher();
      })
      .mockImplementationOnce(() => createWatcher());

    const service = createService({ watch });
    const subscription = await service.requestWorkingTreeWatch(REPO_CWD, vi.fn());

    expect(vi.getTimerCount()).toBe(1);

    subscription.unsubscribe();
    service.dispose();
  });

  test("non-git directories fall back to watching cwd with polling", async () => {
    const watch = vi.fn(() => createWatcher());
    const runGitCommand = vi.fn(async () => {
      throw new Error("not a git repository");
    });
    const resolveAbsoluteGitDir = vi.fn(async () => null);
    const service = createService({
      watch,
      runGitCommand,
      resolveAbsoluteGitDir,
    });

    const plainCwd = path.join(os.tmpdir(), "plain");
    const subscription = await service.requestWorkingTreeWatch(plainCwd, vi.fn());

    expect(subscription.repoRoot).toBeNull();
    const expectedRecursive = process.platform !== "linux";
    expect(watch).toHaveBeenCalledWith(
      plainCwd,
      { recursive: expectedRecursive },
      expect.any(Function),
    );
    expect(vi.getTimerCount()).toBe(1);

    subscription.unsubscribe();
    service.dispose();
  });

  test("working tree changes notify watch listeners immediately", async () => {
    const watchCallbacks: Array<() => void> = [];
    const watch = vi.fn(
      (_watchPath: string, _options: { recursive: boolean }, callback: () => void) => {
        watchCallbacks.push(callback);
        return createWatcher();
      },
    );
    const service = createService({ watch });
    const listener = vi.fn();

    const subscription = await service.requestWorkingTreeWatch(REPO_CWD, listener);
    expect(watchCallbacks).toHaveLength(2);

    watchCallbacks[0]?.();

    expect(listener).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
    service.dispose();
  });

  test("the recursive working tree watch drops ignored and .git churn", async () => {
    // The recursive watch is the non-Linux shape; Linux watches each directory instead.
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

    try {
      const watchCallbacks: Array<{
        path: string;
        options: { recursive: boolean };
        callback: (event: string, filename: string | null) => void;
      }> = [];
      const watch = vi.fn(
        (
          watchPath: string,
          options: { recursive: boolean },
          callback: (event: string, filename: string | null) => void,
        ) => {
          watchCallbacks.push({ path: watchPath, options, callback });
          return createWatcher();
        },
      );
      const runGitCommand = vi.fn(async (args: string[]) => ({
        stdout:
          args[0] === "ls-files"
            ? "node_modules/\npackages/app/dist/\nnot-a-directory\n"
            : `${REPO_CWD}\n`,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
      }));

      const service = createService({ watch, runGitCommand });
      const listener = vi.fn();
      const subscription = await service.requestWorkingTreeWatch(REPO_CWD, listener);
      await flushPromises();

      const recursiveWatch = watchCallbacks.find(
        (entry) => entry.path === REPO_CWD && entry.options.recursive,
      );
      expect(recursiveWatch).toBeDefined();

      // Ignored build output can never move the diff, so it never wakes a subscriber; the
      // deep churn under .git is covered by the git-dir watcher registered alongside this one.
      recursiveWatch?.callback("change", path.join("node_modules", ".package-lock.json"));
      recursiveWatch?.callback("change", path.join("packages", "app", "dist", "index.js"));
      recursiveWatch?.callback("change", path.join(".git", "index.lock"));
      recursiveWatch?.callback("change", path.join(".git", "objects", "ab", "cdef"));
      expect(listener).not.toHaveBeenCalled();

      // A branch switch, a tracked edit, and an event that named no file all still land.
      recursiveWatch?.callback("rename", path.join(".git", "HEAD"));
      recursiveWatch?.callback("change", path.join(".git", "refs", "heads", "main"));
      recursiveWatch?.callback("change", path.join("packages", "app", "src", "index.ts"));
      recursiveWatch?.callback("change", null);
      expect(listener).toHaveBeenCalledTimes(4);

      subscription.unsubscribe();
      service.dispose();
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  test("working tree changes force a fresh diff stat for workspace subscribers", async () => {
    const watchCallbacks: Array<{ path: string; callback: () => void }> = [];
    const watch = vi.fn(
      (watchPath: string, _options: { recursive: boolean }, callback: () => void) => {
        watchCallbacks.push({ path: watchPath, callback });
        return createWatcher();
      },
    );
    const getCheckoutShortstat = vi
      .fn()
      .mockResolvedValueOnce({ additions: 1, deletions: 0 })
      .mockResolvedValueOnce({ additions: 8, deletions: 3 });
    const service = createService({ getCheckoutShortstat, watch });
    const workspaceListener = vi.fn();

    const initialSnapshot = await service.getSnapshot(REPO_CWD);
    const workspaceSubscription = service.registerWorkspace({ cwd: REPO_CWD }, workspaceListener);
    const diffSubscription = await service.requestWorkingTreeWatch(REPO_CWD, vi.fn());

    expect(initialSnapshot.git.diffStat).toEqual({ additions: 1, deletions: 0 });
    const repoRootWatch = watchCallbacks.find((entry) => entry.path === REPO_CWD);
    expect(repoRootWatch).toBeDefined();

    repoRootWatch?.callback();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(getCheckoutShortstat).toHaveBeenLastCalledWith(
      REPO_CWD,
      expect.objectContaining({ ottoHome: "/tmp/otto-test" }),
      { force: true },
    );
    expect(workspaceListener).toHaveBeenCalledWith(
      createSnapshot(REPO_CWD, {
        git: { diffStat: { additions: 8, deletions: 3 } },
      }),
      { prStatusOnly: false },
    );

    diffSubscription.unsubscribe();
    workspaceSubscription.unsubscribe();
    service.dispose();
  });

  test("checkoutDiffCache evicts least-recently-used entries past its size cap", async () => {
    vi.useRealTimers();
    const getCheckoutDiff = vi.fn(async (cwd: string) => ({
      diff: `diff for ${cwd}`,
    }));
    const service = createService({
      getCheckoutDiff: getCheckoutDiff as unknown as ReturnType<typeof vi.fn>,
    });

    const CACHE_MAX = 64;
    const OVERFLOW = 5;

    for (let i = 0; i < CACHE_MAX + OVERFLOW; i++) {
      await service.getCheckoutDiff(`/tmp/repo-${i}`, { mode: "uncommitted" });
    }
    expect(getCheckoutDiff).toHaveBeenCalledTimes(CACHE_MAX + OVERFLOW);

    await service.getCheckoutDiff(`/tmp/repo-${CACHE_MAX - 1}`, { mode: "uncommitted" });
    expect(getCheckoutDiff).toHaveBeenCalledTimes(CACHE_MAX + OVERFLOW);

    await service.getCheckoutDiff("/tmp/repo-0", { mode: "uncommitted" });
    expect(getCheckoutDiff).toHaveBeenCalledTimes(CACHE_MAX + OVERFLOW + 1);

    service.dispose();
  });
});
