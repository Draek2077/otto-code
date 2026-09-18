import { getUntrustedWorktreeSource } from "../utils/otto-worktree-automation.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { WorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import { resolve } from "node:path";
import {
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import { generateWorkspaceId } from "./workspace-registry-model.js";
import { classifyDirectoryForProjectMembership } from "./workspace-registry-bootstrap-legacy.js";
import {
  createWorktreeCore,
  type CreateWorktreeCoreDeps,
  type CreateWorktreeCoreInput,
} from "./worktree-core.js";
import {
  isOttoOwnedWorktreeCwd,
  mapWorkspaceRelativeCwdToWorktree,
  validateBranchSlug,
  type WorktreeConfig,
} from "../utils/worktree.js";
import { getRealpathAwareRelativePath } from "../utils/path.js";
import { stat as statPath } from "node:fs/promises";
import { getCurrentBranch, localBranchExists, renameCurrentBranch } from "../utils/checkout-git.js";
import {
  markOttoWorktreeFirstAgentBranchAutoNameAttempted,
  normalizeBaseRefName,
  readOttoWorktreeMetadata,
  writeOttoWorktreeFirstAgentBranchAutoNameMetadata,
} from "../utils/worktree-metadata.js";
import type { WorktreeCreationIntent } from "./resolve-worktree-creation-intent.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import { buildAgentBranchNameSeed } from "./agent/prompt-attachments.js";
import type { FirstAgentContext } from "@otto-code/protocol/messages";
import { runWithGitCommandPriority } from "../utils/run-git-command.js";

export interface CreateOttoWorktreeInput extends CreateWorktreeCoreInput {
  projectId?: string;
  // Otto names a worktree workspace at creation time (agent-provided or
  // user-typed) rather than deriving it from the branch alone.
  title?: string | null;
}

export interface CreateOttoWorktreeResult {
  worktree: WorktreeConfig;
  intent: WorktreeCreationIntent;
  workspace: PersistedWorkspaceRecord;
  repoRoot: string;
  created: boolean;
}

export type CreateOttoWorktreeFn = (
  input: CreateOttoWorktreeInput,
  options?: {
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  },
) => Promise<CreateOttoWorktreeResult>;

export interface AttemptFirstAgentBranchAutoNameResult {
  attempted: boolean;
  renamed: boolean;
  branchName: string | null;
}

export interface CreateOttoWorktreeDeps extends CreateWorktreeCoreDeps {
  // Records the workspace a new worktree lands in. It keeps the source
  // project's record intact, refreshing only kind and key from the project
  // root, so an explicitly chosen non-Git project stays non-Git and keeps its
  // settings; rebuilding the record here used to wipe them.
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "createWorkspaceForWorktree">;
  projectRegistry: Pick<ProjectRegistry, "get" | "upsert">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "list" | "upsert">;
  workspaceGitService: WorkspaceGitService;
}

export async function createOttoWorktree(
  input: CreateOttoWorktreeInput,
  deps: CreateOttoWorktreeDeps,
): Promise<CreateOttoWorktreeResult> {
  return runWithGitCommandPriority("high", () => createOttoWorktreeWithPriority(input, deps));
}

async function createOttoWorktreeWithPriority(
  input: CreateOttoWorktreeInput,
  deps: CreateOttoWorktreeDeps,
): Promise<CreateOttoWorktreeResult> {
  // Planned against the SOURCE checkout before the new worktree exists. A
  // workspace opened on a subdirectory of a monorepo (packages/app) has to land
  // on the same subdirectory of the worktree we create from it; pinning the
  // workspace to the worktree root instead silently moved the agent up to the
  // repo root, which is a different project.
  const workspaceCwdPlan = await planWorkspaceCwdForWorktree(input.cwd, deps.workspaceGitService);
  const createdWorktree = await createWorktreeCore(input, deps);
  maybeMarkFirstAgentBranchAutoNameEligible({ createdWorktree });
  const workspaceCwd = mapWorkspaceRelativeCwdToWorktree({
    relativeWorkspaceCwd: workspaceCwdPlan.relativeWorkspaceCwd,
    targetWorktreePath: createdWorktree.worktree.worktreePath,
  });
  if (!(await isDirectory(workspaceCwd))) {
    throw new Error(`Selected project directory is missing from the worktree: ${workspaceCwd}`);
  }
  // Creation never deduplicates by directory: every call mints a fresh
  // workspace record, resolving its project from the originating checkout.
  const untrustedSource = getUntrustedWorktreeSource(createdWorktree.intent);
  const workspace = await deps.workspaceProvisioning.createWorkspaceForWorktree({
    sourceCwd: workspaceCwdPlan.inputCwd,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    repoRoot: createdWorktree.repoRoot,
    // cwd is where the workspace opens (possibly a subdirectory); worktreeRoot
    // is the checkout that backs it. Collapsing the two lost nested placement.
    cwd: workspaceCwd,
    worktreeRoot: createdWorktree.worktree.worktreePath,
    branch: createdWorktree.worktree.branchName || null,
    baseBranch: resolveIntentBaseBranch(createdWorktree.intent) ?? null,
    title: input.title?.trim() || resolveFirstAgentPromptTitle(input.firstAgentContext) || null,
    expectsInitialAgent: Boolean(input.firstAgentContext),
    ...(untrustedSource ? { untrustedSource } : {}),
    hidden: input.hidden ?? false,
  });

  deps.github.invalidate({ cwd: createdWorktree.worktree.worktreePath });

  return {
    worktree: createdWorktree.worktree,
    intent: createdWorktree.intent,
    workspace,
    repoRoot: createdWorktree.repoRoot,
    created: createdWorktree.created,
  };
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await statPath(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve where inside its own checkout the requested cwd sits, so the same
 * relative position can be reproduced inside the worktree we are about to
 * create. Must run BEFORE `createWorktreeCore`, while the source checkout is
 * still the one `getCheckout` resolves for this path.
 */
async function planWorkspaceCwdForWorktree(
  inputCwd: string,
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout">,
): Promise<{ inputCwd: string; relativeWorkspaceCwd: string }> {
  const normalizedInputCwd = resolve(inputCwd);
  const sourceCheckout = await workspaceGitService.getCheckout(normalizedInputCwd);
  const sourceWorktreePath = sourceCheckout.worktreeRoot ?? normalizedInputCwd;
  const relativeWorkspaceCwd = getRealpathAwareRelativePath(sourceWorktreePath, normalizedInputCwd);
  if (relativeWorkspaceCwd === null) {
    throw new Error(`Workspace cwd is outside its source worktree: ${normalizedInputCwd}`);
  }
  return { inputCwd: normalizedInputCwd, relativeWorkspaceCwd };
}

/**
 * Where this worktree's auto-name metadata actually lives.
 *
 * A workspace can be opened on a subdirectory of an Otto worktree, and
 * `readOttoWorktreeMetadata` builds its path from whatever it is handed rather
 * than walking up. Handing it the raw cwd made the read miss, and a miss is
 * indistinguishable from "nothing to do", so the branch silently kept its
 * placeholder name. Git resolves the worktree from any depth, so only the
 * metadata reads and writes need this; a cwd outside an Otto worktree falls
 * back to itself and behaves exactly as before.
 */
async function resolveAutoNameMetadataRoot(
  cwd: string,
  resolveOwnership: typeof isOttoOwnedWorktreeCwd,
): Promise<string> {
  const ownership = await resolveOwnership(cwd);
  return ownership.allowed ? (ownership.worktreePath ?? cwd) : cwd;
}

export async function attemptFirstAgentBranchAutoName(options: {
  cwd: string;
  firstAgentContext: FirstAgentContext | undefined;
  generateBranchNameFromContext: (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
  }) => Promise<string | null>;
  getCurrentBranch?: typeof getCurrentBranch;
  renameCurrentBranch?: typeof renameCurrentBranch;
  localBranchExists?: typeof localBranchExists;
  isOttoOwnedWorktreeCwd?: typeof isOttoOwnedWorktreeCwd;
}): Promise<AttemptFirstAgentBranchAutoNameResult> {
  const firstAgentContext = options.firstAgentContext;
  if (!firstAgentContext || !buildAgentBranchNameSeed(firstAgentContext)) {
    return { attempted: false, renamed: false, branchName: null };
  }

  const metadataRoot = await resolveAutoNameMetadataRoot(
    options.cwd,
    options.isOttoOwnedWorktreeCwd ?? isOttoOwnedWorktreeCwd,
  );

  let metadata: ReturnType<typeof readOttoWorktreeMetadata>;
  try {
    metadata = readOttoWorktreeMetadata(metadataRoot);
  } catch {
    return { attempted: false, renamed: false, branchName: null };
  }
  if (
    !metadata ||
    metadata.version !== 2 ||
    metadata.firstAgentBranchAutoName?.status !== "pending"
  ) {
    return { attempted: false, renamed: false, branchName: null };
  }

  const getCurrentBranchImpl = options.getCurrentBranch ?? getCurrentBranch;
  const placeholderBranchName = metadata.firstAgentBranchAutoName.placeholderBranchName;
  if ((await getCurrentBranchImpl(options.cwd)) !== placeholderBranchName) {
    markOttoWorktreeFirstAgentBranchAutoNameAttempted(metadataRoot);
    return { attempted: true, renamed: false, branchName: null };
  }

  markOttoWorktreeFirstAgentBranchAutoNameAttempted(metadataRoot);

  const branchName = await options.generateBranchNameFromContext({
    cwd: options.cwd,
    firstAgentContext,
  });
  if (!branchName) {
    return { attempted: true, renamed: false, branchName: null };
  }
  const validation = validateBranchSlug(branchName);
  if (!validation.valid || branchName === placeholderBranchName) {
    return { attempted: true, renamed: false, branchName: null };
  }
  if ((await getCurrentBranchImpl(options.cwd)) !== placeholderBranchName) {
    return { attempted: true, renamed: false, branchName: null };
  }

  const localBranchExistsImpl = options.localBranchExists ?? localBranchExists;
  const targetName = await findAvailableBranchName({
    cwd: options.cwd,
    desiredName: branchName,
    placeholderBranchName,
    localBranchExists: localBranchExistsImpl,
  });
  if (!targetName) {
    return { attempted: true, renamed: false, branchName: null };
  }

  const renameCurrentBranchImpl = options.renameCurrentBranch ?? renameCurrentBranch;
  const renamedBranch = await renameCurrentBranchImpl(options.cwd, targetName);
  return {
    attempted: true,
    renamed: true,
    branchName: renamedBranch.currentBranch ?? targetName,
  };
}

const MAX_BRANCH_NAME_SUFFIX_ATTEMPTS = 50;

async function findAvailableBranchName(options: {
  cwd: string;
  desiredName: string;
  placeholderBranchName: string;
  localBranchExists: (cwd: string, branchName: string) => Promise<boolean>;
}): Promise<string | null> {
  const { cwd, desiredName, placeholderBranchName } = options;
  if (!(await options.localBranchExists(cwd, desiredName))) {
    return desiredName;
  }
  for (let suffix = 2; suffix <= MAX_BRANCH_NAME_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${desiredName}-${suffix}`;
    if (candidate === placeholderBranchName) {
      continue;
    }
    if (!(await options.localBranchExists(cwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

function maybeMarkFirstAgentBranchAutoNameEligible(options: {
  createdWorktree: Awaited<ReturnType<typeof createWorktreeCore>>;
}): void {
  const { createdWorktree } = options;
  if (!createdWorktree.created || createdWorktree.intent.kind !== "branch-off") {
    return;
  }

  writeOttoWorktreeFirstAgentBranchAutoNameMetadata(createdWorktree.worktree.worktreePath, {
    placeholderBranchName: createdWorktree.worktree.branchName,
  });
}

// The base branch is normalized to match worktree.json's baseRefName (origin/
// stripped). checkout-branch worktrees have no distinct base, so they stay null.
function resolveIntentBaseBranch(intent: WorktreeCreationIntent): string | null {
  switch (intent.kind) {
    case "branch-off":
      return normalizeBaseRefName(intent.baseBranch);
    case "checkout-change-request":
    case "checkout-github-pr":
      return normalizeBaseRefName(intent.baseRefName);
    case "checkout-branch":
      return null;
  }
}

export interface CreateLocalCheckoutWorkspaceDeps {
  projectRegistry: Pick<ProjectRegistry, "get" | "list" | "upsert">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list" | "upsert">;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout">;
}

/**
 * Creating a directory/local_checkout workspace on a directory that already
 * backs a live, visible workspace is rejected: one directory is one physical
 * git checkout, so two "independent" workspaces on it can never actually be
 * independent (branch/diff/status fan out to every same-cwd workspace via
 * `workspaceIdsOnCheckout`). Maps to wire errorCode
 * `workspace_directory_occupied` on `workspace.create.response`.
 */
export class WorkspaceDirectoryOccupiedError extends Error {
  readonly cwd: string;
  readonly existingWorkspaceId: string;

  constructor(params: { cwd: string; existingWorkspaceId: string; existingWorkspaceName: string }) {
    super(
      `This directory already backs the workspace "${params.existingWorkspaceName}". ` +
        `Open that workspace instead, or archive it before creating a new one here.`,
    );
    this.name = "WorkspaceDirectoryOccupiedError";
    this.cwd = params.cwd;
    this.existingWorkspaceId = params.existingWorkspaceId;
  }
}

/**
 * The live, visible workspace already backing `cwd`, if any. Uses the same
 * resolved-path equality as `workspaceIdsOnCheckout` (workspace-directory.ts),
 * which is how all persisted cwds are normalized at creation time. Hidden
 * workspaces (transient schedule-run records) do not count as occupants:
 * they are invisible and archived/revealed by their own run lifecycle.
 */
export function findOccupyingWorkspaceForCwd(
  workspaces: Iterable<PersistedWorkspaceRecord>,
  cwd: string,
): PersistedWorkspaceRecord | null {
  const resolvedCwd = resolve(cwd);
  for (const workspace of workspaces) {
    if (workspace.archivedAt || workspace.hidden) {
      continue;
    }
    if (resolve(workspace.cwd) === resolvedCwd) {
      return workspace;
    }
  }
  return null;
}

// Create a NEW workspace record backed by the existing directory `cwd`.
// Used by explicit user creation. Rejects when a live visible workspace
// already backs the directory (see WorkspaceDirectoryOccupiedError); hidden
// per-run workspaces (schedule runs) are exempt from the guard - they are
// transient, never shown while hidden, and disposed by their run lifecycle.
// Existing persisted duplicates from before this guard are left untouched.
export async function createLocalCheckoutWorkspace(
  options: { cwd: string; title?: string | null; hidden?: boolean },
  deps: CreateLocalCheckoutWorkspaceDeps,
): Promise<PersistedWorkspaceRecord> {
  const normalizedCwd = resolve(options.cwd);
  if (!options.hidden) {
    const occupant = findOccupyingWorkspaceForCwd(
      await deps.workspaceRegistry.list(),
      normalizedCwd,
    );
    if (occupant) {
      throw new WorkspaceDirectoryOccupiedError({
        cwd: normalizedCwd,
        existingWorkspaceId: occupant.workspaceId,
        existingWorkspaceName: occupant.title?.trim() || occupant.displayName,
      });
    }
  }
  const checkout = await deps.workspaceGitService.getCheckout(normalizedCwd);
  const membership = classifyDirectoryForProjectMembership({ cwd: normalizedCwd, checkout });
  const now = new Date().toISOString();
  const projectRecord = await resolveProjectRecordForMembership({
    membership,
    timestamp: now,
    projectRegistry: deps.projectRegistry,
  });
  await deps.projectRegistry.upsert(projectRecord);

  const trimmedTitle = options.title?.trim();
  // Persist the live git branch into the dedicated `branch` field so
  // buildWorkspaceCheckout reports the real branch for directory/local_checkout
  // workspaces too (it reads workspace.branch). Same source deriveWorkspaceDisplayName
  // reads. HEAD/detached resolves to null - there is no branch to report.
  const currentBranch = checkout.currentBranch?.trim() ?? null;
  const branch = currentBranch && currentBranch.toUpperCase() !== "HEAD" ? currentBranch : null;
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: generateWorkspaceId(),
    projectId: projectRecord.projectId,
    cwd: normalizedCwd,
    kind: membership.workspaceKind,
    displayName: membership.workspaceDisplayName,
    branch,
    title: trimmedTitle ? trimmedTitle : null,
    hidden: options.hidden ?? false,
    createdAt: now,
    updatedAt: now,
  });
  await deps.workspaceRegistry.upsert(workspace);
  return workspace;
}

async function resolveProjectRecordForMembership(options: {
  membership: ReturnType<typeof classifyDirectoryForProjectMembership>;
  timestamp: string;
  projectRegistry: Pick<ProjectRegistry, "get" | "list">;
}) {
  const rootPath = options.membership.projectRootPath;
  const projects = await options.projectRegistry.list();
  const existingProject =
    projects.find((project) => !project.archivedAt && project.rootPath === rootPath) ??
    projects.find((project) => project.rootPath === rootPath) ??
    null;

  if (!existingProject) {
    return createPersistedProjectRecord({
      projectId: options.membership.projectKey,
      rootPath,
      kind: options.membership.projectKind,
      displayName: options.membership.projectName,
      createdAt: options.timestamp,
      updatedAt: options.timestamp,
    });
  }

  return {
    ...existingProject,
    rootPath,
    kind: options.membership.projectKind,
    archivedAt: null,
    updatedAt: options.timestamp,
  };
}
