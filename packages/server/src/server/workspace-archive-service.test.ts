import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino, { type Logger } from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { GitHubService } from "../services/github-service.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";
import { createWorktree, type WorktreeConfig } from "../utils/worktree.js";
import type { ManagedAgent } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import {
  archiveByScope,
  type ActiveWorkspaceRef,
  type ArchiveDependencies,
  type ArchiveResult,
  resolveWorkspaceIdAtPath,
} from "./workspace-archive-service.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function createLogger(): Logger {
  const logger = pino({ level: "silent" });
  vi.spyOn(logger, "info").mockImplementation(() => undefined);
  vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
  return logger;
}

function createGitHubServiceStub(): GitHubService {
  return {
    listPullRequests: async () => [],
    listIssues: async () => [],
    searchIssuesAndPrs: async () => ({ items: [], githubFeaturesEnabled: true }),
    getPullRequest: async ({ number }) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/repo/pull/${number}`,
      state: "OPEN",
      body: null,
      baseRefName: "main",
      headRefName: `pr-${number}`,
      labels: [],
    }),
    getPullRequestHeadRef: async ({ number }) => `pr-${number}`,
    getCurrentPullRequestStatus: async () => null,
    createPullRequest: async () => ({
      number: 1,
      url: "https://github.com/acme/repo/pull/1",
    }),
    mergePullRequest: async () => ({ success: true }),
    isAuthenticated: async () => true,
    invalidate: () => {},
  };
}

function createGitRepo(): { tempDir: string; repoDir: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), "workspace-archive-service-"));
  cleanupPaths.push(tempDir);
  const repoDir = path.join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@otto-code.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Otto Test"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return { tempDir, repoDir };
}

// Teardown commands are read from the otto.json sitting AT the teardown cwd, so a
// nested workspace only ever runs its own teardown when the archive tears down from
// that exact directory rather than from the worktree root.
function writeTeardownConfig(repoDir: string, relativeDir: string, command: string): void {
  const targetDir = path.join(repoDir, relativeDir);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    path.join(targetDir, "otto.json"),
    JSON.stringify({ worktree: { teardown: [command] } }),
  );
}

function commitAll(repoDir: string, message: string): void {
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", message], {
    cwd: repoDir,
    stdio: "pipe",
  });
}

function listBranch(repoDir: string, branchName: string): string {
  return execFileSync("git", ["branch", "--list", branchName], {
    cwd: repoDir,
    stdio: "pipe",
  })
    .toString()
    .trim();
}

async function createOttoOwnedWorktree(
  repoDir: string,
  ottoHome: string,
  worktreeSlug: string,
): Promise<WorktreeConfig> {
  return createWorktree({
    cwd: repoDir,
    worktreeSlug,
    source: {
      kind: "branch-off",
      baseBranch: "main",
      branchName: worktreeSlug,
    },
    runSetup: false,
    ottoHome,
  });
}

interface ArchiveDepsInput {
  ottoHome: string;
  activeWorkspaces: ActiveWorkspaceRef[];
  ottoWorktreesBaseRoot?: string;
  findWorkspaceIdForCwd?: (cwd: string) => Promise<string | null>;
}

interface ArchiveTestDependencies extends ArchiveDependencies {
  activeWorkspaces: ActiveWorkspaceRef[];
  archivedAgentIds: string[];
  archivedSnapshotIds: string[];
  stoppedLanguageServerRoots: string[];
  droppedGitLogCwds: string[];
}

function createArchiveDeps(input: ArchiveDepsInput): ArchiveTestDependencies {
  const archivedWorkspaceIds = new Set<string>();
  const active = [...input.activeWorkspaces];
  const archivedAgentIds: string[] = [];
  const archivedSnapshotIds: string[] = [];
  const stoppedLanguageServerRoots: string[] = [];
  const droppedGitLogCwds: string[] = [];

  return {
    ottoHome: input.ottoHome,
    ottoWorktreesBaseRoot: input.ottoWorktreesBaseRoot,
    github: createGitHubServiceStub(),
    workspaceGitService: {
      getSnapshot: vi.fn(async () => null),
      invalidateAuxiliaryReads: vi.fn(),
    } as unknown as Pick<WorkspaceGitService, "getSnapshot" | "invalidateAuxiliaryReads">,
    agentManager: {
      listAgents: () => [],
      archiveAgent: vi.fn(async (agentId: string) => {
        archivedAgentIds.push(agentId);
        return { archivedAt: new Date().toISOString() };
      }),
      archiveSnapshot: vi.fn(async (agentId: string, _archivedAt: string) => {
        archivedSnapshotIds.push(agentId);
        return {};
      }),
    },
    agentStorage: {
      list: async (): Promise<StoredAgentRecord[]> => [],
    } as Pick<AgentStorage, "list">,
    findWorkspaceIdForCwd: input.findWorkspaceIdForCwd ?? vi.fn(async () => null),
    listActiveWorkspaces: async () =>
      active.filter((workspace) => !archivedWorkspaceIds.has(workspace.workspaceId)),
    archiveWorkspaceRecord: async (workspaceId: string) => {
      archivedWorkspaceIds.add(workspaceId);
      const index = active.findIndex((workspace) => workspace.workspaceId === workspaceId);
      if (index !== -1) {
        active.splice(index, 1);
      }
    },
    emitWorkspaceUpdatesForWorkspaceIds: vi.fn(async () => {}),
    markWorkspaceArchiving: vi.fn(),
    clearWorkspaceArchiving: vi.fn(),
    killTerminalsForWorkspace: vi.fn(async () => {}),
    stopLanguageServers: async (rootPath: string) => {
      stoppedLanguageServerRoots.push(rootPath);
    },
    deleteGitOperationLogs: (cwd: string) => {
      droppedGitLogCwds.push(cwd);
    },
    sessionLogger: createLogger(),
    activeWorkspaces: active,
    archivedAgentIds,
    archivedSnapshotIds,
    stoppedLanguageServerRoots,
    droppedGitLogCwds,
  };
}

function assertArchiveResult(
  result: ArchiveResult,
  expected: {
    archivedWorkspaceIds: string[];
    removedDirectory: boolean;
  },
): void {
  expect(result.archivedWorkspaceIds).toEqual(expected.archivedWorkspaceIds);
  expect(result.removedDirectory).toBe(expected.removedDirectory);
}

describe("archiveByScope", () => {
  test("workspace scope archives the record and removes the directory on last reference", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "last-ref-workspace");
    const workspaceId = "ws-last-ref";

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          {
            workspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        repoRoot: repoDir,
        requestId: "req-last-ref-workspace",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceId],
      removedDirectory: true,
    });
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  // The git operation log buffers are keyed by cwd and never shed keys on their
  // own, so an archived record has to take them with it or they stay resident
  // for the daemon's lifetime.
  test("workspace scope drops the archived record's git operation log buffers", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "git-log-drop");
    const workspaceId = "ws-git-log-drop";
    const dependencies = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [{ workspaceId, cwd: worktree.worktreePath, kind: "worktree" }],
    });

    await archiveByScope(dependencies, {
      scope: { kind: "workspace", workspaceId },
      repoRoot: repoDir,
      requestId: "req-git-log-drop",
    });

    expect(dependencies.droppedGitLogCwds).toEqual([worktree.worktreePath]);
  });

  // Two records can sit on one cwd, and they SHARE the buffers under that key.
  // Archiving one must not blank the survivor's log pane.
  test("workspace scope keeps git operation log buffers a sibling at the same cwd still uses", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "git-log-shared");
    const workspaceA = "ws-git-log-a";
    const workspaceB = "ws-git-log-b";
    const dependencies = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [
        { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
        { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "local_checkout" },
      ],
    });

    await archiveByScope(dependencies, {
      scope: { kind: "workspace", workspaceId: workspaceA },
      repoRoot: repoDir,
      requestId: "req-git-log-shared",
    });

    expect(dependencies.droppedGitLogCwds).toEqual([]);
  });

  // The workspace is going away whether or not its directory survives, so its
  // teardown commands owe the same run either way. Only the directory removal is
  // gated on being the last reference.
  test("workspace scope runs teardown while keeping a directory referenced by a sibling", async () => {
    const { tempDir, repoDir } = createGitRepo();
    writeTeardownConfig(
      repoDir,
      ".",
      "node -e \"require('fs').writeFileSync(process.env.OTTO_SOURCE_CHECKOUT_PATH + '/shared-teardown.log', 'ok')\"",
    );
    commitAll(repoDir, "shared teardown");
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "sibling-workspace");
    const workspaceA = "ws-sibling-a";
    const workspaceB = "ws-sibling-b";

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
          { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "local_checkout" },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId: workspaceA },
        repoRoot: repoDir,
        requestId: "req-sibling-workspace",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceA],
      removedDirectory: false,
    });
    expect(existsSync(worktree.worktreePath)).toBe(true);
    expect(readFileSync(path.join(repoDir, "shared-teardown.log"), "utf8")).toBe("ok");
  });

  // Otto puts a workspace at the package it was opened on, so a worktree commonly
  // backs a record whose cwd is <worktreeRoot>/packages/app. Comparing cwds alone
  // misses that sibling and deletes the directory out from under it.
  test("workspace scope keeps a worktree for an active workspace in a subdirectory", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "subdirectory-sibling");
    const sourceWorkspaceId = "ws-subdirectory-source";
    const siblingWorkspaceId = "ws-subdirectory-sibling";
    const siblingDirectory = path.join(worktree.worktreePath, "packages", "app");
    mkdirSync(siblingDirectory, { recursive: true });

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          {
            workspaceId: sourceWorkspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
          {
            workspaceId: siblingWorkspaceId,
            cwd: siblingDirectory,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId: sourceWorkspaceId },
        repoRoot: repoDir,
        requestId: "req-subdirectory-sibling",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [sourceWorkspaceId],
      removedDirectory: false,
    });
    expect(existsSync(worktree.worktreePath)).toBe(true);
  });

  // The mirror image: archiving the nested record must not take the whole worktree
  // with it, even though ownership resolution widens that cwd to the worktree root.
  test("archiving a subdirectory workspace keeps its active worktree root", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "subdirectory-target");
    const rootWorkspaceId = "ws-subdirectory-root";
    const subdirectoryWorkspaceId = "ws-subdirectory-target";
    const subdirectory = path.join(worktree.worktreePath, "packages", "app");
    mkdirSync(subdirectory, { recursive: true });

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          {
            workspaceId: rootWorkspaceId,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
          {
            workspaceId: subdirectoryWorkspaceId,
            cwd: subdirectory,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId: subdirectoryWorkspaceId },
        repoRoot: repoDir,
        requestId: "req-subdirectory-target",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [subdirectoryWorkspaceId],
      removedDirectory: false,
    });
    expect(existsSync(worktree.worktreePath)).toBe(true);
  });

  test("workspace scope runs teardown from the exact nested workspace before deleting its worktree", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const nestedRelative = path.join("packages", "app");
    writeTeardownConfig(
      repoDir,
      nestedRelative,
      "node -e \"require('fs').writeFileSync(process.env.OTTO_SOURCE_CHECKOUT_PATH + '/nested-teardown.log', process.cwd())\"",
    );
    commitAll(repoDir, "nested teardown");

    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "nested-teardown");
    const workspaceCwd = path.join(worktree.worktreePath, nestedRelative);
    const matchesWorkspaceCwd = createRealpathAwarePathMatcher(workspaceCwd);
    const workspaceId = "ws-nested-teardown";

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          {
            workspaceId,
            cwd: workspaceCwd,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
            mainRepoRoot: repoDir,
          },
        ],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        requestId: "req-nested-teardown",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceId],
      removedDirectory: true,
    });
    expect(existsSync(worktree.worktreePath)).toBe(false);
    expect(
      matchesWorkspaceCwd(readFileSync(path.join(repoDir, "nested-teardown.log"), "utf8").trim()),
    ).toBe(true);
  });

  // A language server is a child process keyed by directory, so nothing else in the
  // system stops it: no session owns it and its idle allowance would keep it resident
  // for minutes serving a workspace that no longer exists.
  test("workspace scope stops the language servers rooted at the archived directory", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "lsp-last-ref");
    const workspaceId = "ws-lsp-last-ref";
    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [{ workspaceId, cwd: worktree.worktreePath, kind: "worktree" }],
    });

    await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      repoRoot: repoDir,
      requestId: "req-lsp-last-ref",
    });

    expect(deps.stoppedLanguageServerRoots).toEqual([path.resolve(worktree.worktreePath)]);
  });

  test("workspace scope leaves language servers running when a sibling still references the directory", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "lsp-sibling");
    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [
        { workspaceId: "ws-lsp-sibling-a", cwd: worktree.worktreePath, kind: "worktree" },
        { workspaceId: "ws-lsp-sibling-b", cwd: worktree.worktreePath, kind: "local_checkout" },
      ],
    });

    await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: "ws-lsp-sibling-a" },
      repoRoot: repoDir,
      requestId: "req-lsp-sibling",
    });

    expect(deps.stoppedLanguageServerRoots).toEqual([]);
  });

  // Teardown is per distinct directory, not per record: two workspaces sharing the
  // worktree root owe ONE root teardown (the command exits 2 on a second run), while
  // the nested record owes its own.
  test("worktree scope archives root and subdirectory workspaces before removing the backing worktree", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const nestedRelative = path.join("packages", "app");
    writeTeardownConfig(
      repoDir,
      ".",
      "node -e \"const fs=require('fs');const out=process.env.OTTO_SOURCE_CHECKOUT_PATH+'/root-scope-teardown.log';if(fs.existsSync(out))process.exit(2);fs.writeFileSync(out,'ok')\"",
    );
    writeTeardownConfig(
      repoDir,
      nestedRelative,
      "node -e \"require('fs').writeFileSync(process.env.OTTO_SOURCE_CHECKOUT_PATH+'/nested-scope-teardown.log','ok')\"",
    );
    commitAll(repoDir, "scope teardown");
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "worktree-scope");
    const workspaceA = "ws-worktree-a";
    const workspaceB = "ws-worktree-b";
    const workspaceC = "ws-worktree-subdirectory";
    const subdirectory = path.join(worktree.worktreePath, nestedRelative);

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          {
            workspaceId: workspaceA,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
          {
            workspaceId: workspaceB,
            cwd: worktree.worktreePath,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
          {
            workspaceId: workspaceC,
            cwd: subdirectory,
            kind: "worktree",
            worktreeRoot: worktree.worktreePath,
            isOttoOwnedWorktree: true,
          },
        ],
      }),
      {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        repoRoot: repoDir,
        requestId: "req-worktree-scope",
      },
    );

    expect(result.archivedWorkspaceIds).toEqual(
      expect.arrayContaining([workspaceA, workspaceB, workspaceC]),
    );
    expect(result.archivedWorkspaceIds).toHaveLength(3);
    expect(result.removedDirectory).toBe(true);
    expect(existsSync(worktree.worktreePath)).toBe(false);
    expect(readFileSync(path.join(repoDir, "root-scope-teardown.log"), "utf8")).toBe("ok");
    expect(readFileSync(path.join(repoDir, "nested-scope-teardown.log"), "utf8")).toBe("ok");
  });

  test("workspace scope never removes a non-Otto-owned directory", async () => {
    const { tempDir } = createGitRepo();
    const localCheckoutDir = mkdtempSync(path.join(tempDir, "local-checkout-"));
    const workspaceId = "ws-local-checkout";

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome: path.join(tempDir, ".otto"),
        activeWorkspaces: [{ workspaceId, cwd: localCheckoutDir, kind: "local_checkout" }],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        repoRoot: null,
        requestId: "req-local-checkout",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [workspaceId],
      removedDirectory: false,
    });
    expect(existsSync(localCheckoutDir)).toBe(true);
  });

  test("worktree scope keeps the directory when one record teardown fails", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "partial-failure");
    const workspaceA = "ws-partial-a";
    const workspaceB = "ws-partial-b";

    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [
        { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
        { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "worktree" },
      ],
    });
    const originalArchiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = async (workspaceId: string) => {
      if (workspaceId === workspaceA) {
        throw new Error("intentional teardown failure");
      }
      return originalArchiveWorkspaceRecord(workspaceId);
    };

    const result = await archiveByScope(deps, {
      scope: { kind: "worktree", targetPath: worktree.worktreePath },
      repoRoot: repoDir,
      requestId: "req-partial-failure",
    });

    expect(result.archivedWorkspaceIds).toEqual([workspaceB]);
    expect(result.archivedWorkspaceIds).not.toContain(workspaceA);
    expect(result.removedDirectory).toBe(false);
    expect(existsSync(worktree.worktreePath)).toBe(true);
  });

  test("workspace scope with unknown workspace id is a clean no-op", async () => {
    const { tempDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");

    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [],
    });
    const originalArchiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = vi.fn(async (workspaceId: string) => {
      return originalArchiveWorkspaceRecord(workspaceId);
    });

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: "ws-does-not-exist" },
      repoRoot: null,
      requestId: "req-unknown-workspace",
    });

    assertArchiveResult(result, {
      archivedWorkspaceIds: [],
      removedDirectory: false,
    });
    expect(deps.markWorkspaceArchiving).not.toHaveBeenCalled();
    expect(deps.archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(deps.emitWorkspaceUpdatesForWorkspaceIds).not.toHaveBeenCalled();
  });

  test("worktree scope removes an owned directory with zero matching records", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "zero-records");

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [],
      }),
      {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        repoRoot: repoDir,
        requestId: "req-zero-records",
      },
    );

    assertArchiveResult(result, {
      archivedWorkspaceIds: [],
      removedDirectory: true,
    });
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("marks archiving, emits an upsert carrying the archiving state, then clears it and emits a remove", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "lifecycle");
    const workspaceId = "ws-lifecycle";

    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [{ workspaceId, cwd: worktree.worktreePath, kind: "worktree" }],
    });

    const archivingByWorkspaceId = new Map<string, string>();
    type LifecycleEvent =
      | { type: "mark"; workspaceIds: string[]; archivingAt: string }
      | {
          type: "emit";
          workspaceIds: string[];
          updates: Array<{
            kind: "upsert" | "remove";
            workspaceId: string;
            archivingAt: string | null;
          }>;
        }
      | { type: "archive"; workspaceId: string }
      | { type: "clear"; workspaceIds: string[] };
    const events: LifecycleEvent[] = [];

    const originalArchiveWorkspaceRecord = deps.archiveWorkspaceRecord;
    deps.archiveWorkspaceRecord = async (id: string) => {
      await originalArchiveWorkspaceRecord(id);
      events.push({ type: "archive", workspaceId: id });
    };
    deps.markWorkspaceArchiving = vi.fn((workspaceIds: Iterable<string>, archivingAt: string) => {
      for (const id of workspaceIds) {
        archivingByWorkspaceId.set(id, archivingAt);
      }
      events.push({ type: "mark", workspaceIds: Array.from(workspaceIds), archivingAt });
    });
    deps.clearWorkspaceArchiving = vi.fn((workspaceIds: Iterable<string>) => {
      for (const id of workspaceIds) {
        archivingByWorkspaceId.delete(id);
      }
      events.push({ type: "clear", workspaceIds: Array.from(workspaceIds) });
    });
    deps.emitWorkspaceUpdatesForWorkspaceIds = vi.fn(async (workspaceIds: Iterable<string>) => {
      const ids = Array.from(workspaceIds);
      const activeIds = new Set<string>();
      for (const workspace of deps.activeWorkspaces) {
        activeIds.add(workspace.workspaceId);
      }
      const updates: Array<{
        kind: "upsert" | "remove";
        workspaceId: string;
        archivingAt: string | null;
      }> = [];
      for (const id of ids) {
        const archivingAt = archivingByWorkspaceId.get(id) ?? null;
        if (archivingAt && activeIds.has(id)) {
          updates.push({ kind: "upsert", workspaceId: id, archivingAt });
        } else {
          updates.push({ kind: "remove", workspaceId: id, archivingAt: null });
        }
      }
      events.push({ type: "emit", workspaceIds: ids, updates });
    });

    await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      repoRoot: repoDir,
      requestId: "req-lifecycle",
    });

    expect(events.map((event) => event.type)).toEqual(["mark", "emit", "archive", "clear", "emit"]);

    const firstEmit = events[1] as Extract<LifecycleEvent, { type: "emit" }>;
    expect(firstEmit.workspaceIds).toEqual([workspaceId]);
    expect(firstEmit.updates).toEqual([
      { kind: "upsert", workspaceId, archivingAt: expect.any(String) },
    ]);

    const secondEmit = events[4] as Extract<LifecycleEvent, { type: "emit" }>;
    expect(secondEmit.workspaceIds).toEqual([workspaceId]);
    expect(secondEmit.updates).toEqual([{ kind: "remove", workspaceId, archivingAt: null }]);
  });

  test("archives stored snapshots only for the target workspace", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "snapshot-scope");
    const targetWorkspaceId = "ws-snapshot-target";
    const otherWorkspaceId = "ws-snapshot-other";
    const liveAgentId = "agent-live";
    const targetStoredAgentId = "agent-stored-target";
    const otherStoredAgentId = "agent-stored-other";

    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [
        { workspaceId: targetWorkspaceId, cwd: worktree.worktreePath, kind: "worktree" },
      ],
    });
    deps.agentManager = {
      listAgents: () => [{ id: liveAgentId, workspaceId: targetWorkspaceId }] as ManagedAgent[],
      archiveAgent: vi.fn(async (agentId: string) => {
        deps.archivedAgentIds.push(agentId);
        return { archivedAt: new Date().toISOString() };
      }),
      archiveSnapshot: vi.fn(async (agentId: string, _archivedAt: string) => {
        deps.archivedSnapshotIds.push(agentId);
        return {};
      }),
    };
    deps.agentStorage = {
      list: async () =>
        [
          { id: targetStoredAgentId, workspaceId: targetWorkspaceId, archivedAt: null },
          { id: otherStoredAgentId, workspaceId: otherWorkspaceId, archivedAt: null },
        ] as StoredAgentRecord[],
    } as Pick<AgentStorage, "list">;

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: targetWorkspaceId },
      repoRoot: repoDir,
      requestId: "req-snapshot-scope",
    });

    assertArchiveResult(result, {
      archivedWorkspaceIds: [targetWorkspaceId],
      removedDirectory: true,
    });
    expect(result.archivedAgentIds).toContain(liveAgentId);
    expect(result.archivedAgentIds).toContain(targetStoredAgentId);
    expect(result.archivedAgentIds).not.toContain(otherStoredAgentId);
    expect(deps.archivedSnapshotIds).toEqual([targetStoredAgentId]);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("worktree scope archives three workspaces on the directory and removes it", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "worktree-scope-n3");
    const workspaceA = "ws-worktree-n3-a";
    const workspaceB = "ws-worktree-n3-b";
    const workspaceC = "ws-worktree-n3-c";

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [
          { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
          { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "worktree" },
          { workspaceId: workspaceC, cwd: worktree.worktreePath, kind: "local_checkout" },
        ],
      }),
      {
        scope: { kind: "worktree", targetPath: worktree.worktreePath },
        repoRoot: repoDir,
        requestId: "req-worktree-scope-n3",
      },
    );

    expect(result.archivedWorkspaceIds).toEqual(
      expect.arrayContaining([workspaceA, workspaceB, workspaceC]),
    );
    expect(result.archivedWorkspaceIds).toHaveLength(3);
    expect(result.removedDirectory).toBe(true);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  test("branchCleanup deletes the leftover local branch after the worktree is removed", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "cleanup-branch");
    const workspaceId = "ws-cleanup-branch";

    expect(listBranch(repoDir, "cleanup-branch")).not.toBe("");

    const result = await archiveByScope(
      createArchiveDeps({
        ottoHome,
        activeWorkspaces: [{ workspaceId, cwd: worktree.worktreePath, kind: "worktree" }],
      }),
      {
        scope: { kind: "workspace", workspaceId },
        repoRoot: repoDir,
        branchCleanup: { branchName: "cleanup-branch" },
        requestId: "req-cleanup-branch",
      },
    );

    expect(result.removedDirectory).toBe(true);
    expect(result.deletedBranch).toBe("cleanup-branch");
    expect(existsSync(worktree.worktreePath)).toBe(false);
    expect(listBranch(repoDir, "cleanup-branch")).toBe("");
  });

  test("branchCleanup leaves the branch when the directory is not removed", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "kept-branch");
    const workspaceA = "ws-kept-a";
    const workspaceB = "ws-kept-b";

    const deleteLocalBranch = vi.fn(async () => ({ deleted: true }));
    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [
        { workspaceId: workspaceA, cwd: worktree.worktreePath, kind: "worktree" },
        { workspaceId: workspaceB, cwd: worktree.worktreePath, kind: "local_checkout" },
      ],
    });
    deps.deleteLocalBranch = deleteLocalBranch;

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId: workspaceA },
      repoRoot: repoDir,
      branchCleanup: { branchName: "kept-branch" },
      requestId: "req-kept-branch",
    });

    expect(result.removedDirectory).toBe(false);
    expect(result.deletedBranch).toBeNull();
    expect(deleteLocalBranch).not.toHaveBeenCalled();
    expect(listBranch(repoDir, "kept-branch")).not.toBe("");
  });

  test("branchCleanup reports null when the branch delete fails but archives anyway", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoOwnedWorktree(repoDir, ottoHome, "stubborn-branch");
    const workspaceId = "ws-stubborn-branch";

    const deps = createArchiveDeps({
      ottoHome,
      activeWorkspaces: [{ workspaceId, cwd: worktree.worktreePath, kind: "worktree" }],
    });
    deps.deleteLocalBranch = vi.fn(async () => ({ deleted: false }));

    const result = await archiveByScope(deps, {
      scope: { kind: "workspace", workspaceId },
      repoRoot: repoDir,
      branchCleanup: { branchName: "stubborn-branch" },
      requestId: "req-stubborn-branch",
    });

    expect(result.removedDirectory).toBe(true);
    expect(result.deletedBranch).toBeNull();
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });
});

describe("resolveWorkspaceIdAtPath", () => {
  test("prefers the worktree-kind record on an exact cwd tie", async () => {
    const targetPath = "/worktrees/repo/feature";

    const result = await resolveWorkspaceIdAtPath(
      {
        listActiveWorkspaces: async () => [
          { workspaceId: "ws-local", cwd: targetPath, kind: "local_checkout" },
          { workspaceId: "ws-worktree", cwd: targetPath, kind: "worktree" },
        ],
        findWorkspaceIdForCwd: vi.fn(async () => "ws-local"),
      },
      targetPath,
    );

    expect(result).toBe("ws-worktree");
  });

  test("falls back to the path resolver when there is no exact match", async () => {
    const targetPath = "/worktrees/repo/feature";

    const result = await resolveWorkspaceIdAtPath(
      {
        listActiveWorkspaces: async () => [
          { workspaceId: "ws-nested", cwd: "/worktrees/repo", kind: "worktree" },
        ],
        findWorkspaceIdForCwd: vi.fn(async () => "ws-nested"),
      },
      targetPath,
    );

    expect(result).toBe("ws-nested");
  });
});
