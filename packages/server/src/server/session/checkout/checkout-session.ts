import type pino from "pino";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { validateBranchSlug } from "@otto-code/protocol/branch-slug";
import type {
  BranchSuggestionsRequest,
  CheckoutGitCommitError,
  CheckoutGitFileError,
  CheckoutRefreshRequest,
  CheckoutRenameBranchRequest,
  CheckoutStatusRequest,
  SessionInboundMessage,
  SessionOutboundMessage,
  SubscribeCheckoutDiffRequest,
  UnsubscribeCheckoutDiffRequest,
  ValidateBranchRequest,
} from "../../messages.js";
import type {
  CheckoutDiffCompareInput,
  CheckoutDiffSnapshotPayload,
} from "../../checkout-diff-manager.js";
import { toCheckoutError } from "../../checkout-git-utils.js";
import {
  buildCheckoutPrStatusPayloadFromSnapshot,
  buildCheckoutStatusPayloadFromSnapshot,
} from "../../checkout/status-projection.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
  WorkspaceGitSnapshotOptions,
} from "../../workspace-git-service.js";
import { assertSafeGitRef } from "../../worktree-session.js";
import type { GitMutationService } from "../git-mutation/git-mutation-service.js";
import type { GitOperationLogService } from "../../git-operation-log.js";
import type { GitHostingResolver } from "../../../services/git-hosting/resolver.js";
import { isGitHostingFeatureDisabledError } from "../../../services/git-hosting/types.js";
import {
  assertPullRequestAutoMergeDisableReady,
  assertPullRequestAutoMergeEnableReady,
  type GitHubService,
  type PullRequestTimelineItem,
} from "../../../services/github-service.js";
import {
  commitChanges,
  commitPaths,
  createPullRequest,
  mergeFromBase,
  mergeToBase,
  NotGitRepoError,
  pullCurrentBranch,
  pushCurrentBranch,
  rollbackPaths,
} from "../../../utils/checkout-git.js";
import {
  getFileBlame,
  getFileCommitDiff,
  getFileHistory,
  getFileOriginCommit,
  InvalidGitFilePathError,
  InvalidGitRevisionError,
} from "../../../utils/git-file-history.js";
import type { ParsedDiffFile } from "../../utils/diff-highlighter.js";
import { parseAndHighlightDiff } from "../../utils/diff-highlighter.js";
import { execCommand } from "../../../utils/spawn.js";
import { expandTilde } from "../../../utils/path.js";
import type { GitMetadataGenerator } from "./git-metadata-generator.js";

/**
 * The collaborators a checkout command reaches that are NOT part of the checkout
 * domain and stay owned by the Session shell: client emit, workspace-update
 * emission, the git branch-snapshot notifier, and the current-branch rename
 * primitive. CheckoutSession orchestrates them but does not own them. The
 * git-mutation primitives it performs (switch branch, force snapshot refresh) are
 * injected separately as `gitMutation`, since they are shared with worktree and
 * workspace creation.
 */
export interface CheckoutSessionHost {
  emit(msg: SessionOutboundMessage): void;
  emitWorkspaceUpdateForCwd(cwd: string): Promise<void>;
  handleWorkspaceGitBranchSnapshot(cwd: string, branchName: string | null): void;
  renameCurrentBranch(
    cwd: string,
    branch: string,
  ): Promise<{ previousBranch: string | null; currentBranch: string | null }>;
}

/**
 * Map a git-file-investigation failure onto the wire error union. These are pure
 * reads, so the interesting distinctions are "you are not in a repo" and "the
 * path or revision was rejected"; everything else is git's own complaint.
 */
function toCheckoutGitFileError(error: unknown): CheckoutGitFileError {
  if (error instanceof NotGitRepoError) {
    return { kind: "not_git_repo" };
  }
  if (error instanceof InvalidGitFilePathError || error instanceof InvalidGitRevisionError) {
    return { kind: "invalid_path", detail: getErrorMessage(error) };
  }
  const detail = getErrorMessage(error);
  if (/not a git repository/i.test(detail)) {
    return { kind: "not_git_repo" };
  }
  return { kind: "git_failed", detail };
}

type CurrentWorkspacePullRequest = NonNullable<
  WorkspaceGitRuntimeSnapshot["github"]["pullRequest"]
> & {
  number: number;
};

/**
 * The slice of CheckoutDiffManager that CheckoutSession needs: open a live diff
 * subscription, and nudge open subscriptions to recompute after a mutation. The
 * real CheckoutDiffManager satisfies this structurally; tests supply a fake.
 */
export interface CheckoutDiffSubscriber {
  subscribe(
    params: { cwd: string; compare: CheckoutDiffCompareInput },
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): Promise<{ initial: CheckoutDiffSnapshotPayload; unsubscribe: () => void }>;
  scheduleRefreshForCwd(cwd: string): void;
}

export interface BusyWorkspaceAgent {
  id: string;
  title: string | null;
}

export interface CheckoutSessionOptions {
  host: CheckoutSessionHost;
  gitMutation: Pick<GitMutationService, "checkoutExistingBranch" | "notifyGitMutation">;
  // Guard for checkout.git.commit: which agents are actively working in this
  // cwd right now. Committing under a running agent risks capturing
  // half-finished work, so the handler refuses until the user confirms.
  listBusyAgentsForCwd: (cwd: string) => BusyWorkspaceAgent[];
  gitOperationLog: GitOperationLogService;
  workspaceGitService: WorkspaceGitService;
  github: GitHubService;
  // Present on daemons with the gitHostingProviders feature; absent in legacy
  // test constructions (hosting.search then answers as GitHub).
  gitHostingResolver?: GitHostingResolver;
  checkoutDiffManager: CheckoutDiffSubscriber;
  gitMetadataGenerator: GitMetadataGenerator;
  ottoHome: string;
  worktreesRoot: string | undefined;
  logger: pino.Logger;
}

/**
 * A client's checkout view, both sides: the read & live-stream side (status
 * queries, branch validation/suggestions, manual refresh, live git-diff and
 * checkout-status subscriptions) and the command side (switch/rename/commit/
 * merge/pull/push/stash and the GitHub-PR operations).
 *
 * Command operations keep the live diff in sync by calling scheduleDiffRefresh()
 * and refresh the workspace git snapshot through gitMutation.notifyGitMutation(); the
 * workspace git observer streams branch changes through emitStatusUpdate().
 */
export class CheckoutSession {
  private static readonly OTTO_STASH_PREFIX = "otto-auto-stash:";

  private readonly host: CheckoutSessionHost;
  private readonly gitMutation: Pick<
    GitMutationService,
    "checkoutExistingBranch" | "notifyGitMutation"
  >;
  private readonly listBusyAgentsForCwd: (cwd: string) => BusyWorkspaceAgent[];
  private readonly gitOperationLog: GitOperationLogService;
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly github: GitHubService;
  private readonly gitHostingResolver: GitHostingResolver | null;
  private readonly checkoutDiffManager: CheckoutDiffSubscriber;
  private readonly gitMetadataGenerator: GitMetadataGenerator;
  private readonly ottoHome: string;
  private readonly worktreesRoot: string | undefined;
  private readonly logger: pino.Logger;
  private readonly diffSubscriptions = new Map<string, () => void>();

  constructor(options: CheckoutSessionOptions) {
    this.host = options.host;
    this.gitMutation = options.gitMutation;
    this.listBusyAgentsForCwd = options.listBusyAgentsForCwd;
    this.gitOperationLog = options.gitOperationLog;
    this.workspaceGitService = options.workspaceGitService;
    this.github = options.github;
    this.gitHostingResolver = options.gitHostingResolver ?? null;
    this.checkoutDiffManager = options.checkoutDiffManager;
    this.gitMetadataGenerator = options.gitMetadataGenerator;
    this.ottoHome = options.ottoHome;
    this.worktreesRoot = options.worktreesRoot;
    this.logger = options.logger;
  }

  async handleStatusRequest(msg: CheckoutStatusRequest): Promise<void> {
    const { cwd, requestId } = msg;
    const resolvedCwd = expandTilde(cwd);

    try {
      // Git-only: `checkout_status_response` is built purely from `snapshot.git`
      // (buildCheckoutStatusPayloadFromSnapshot never reads `snapshot.github`), so
      // fetching GitHub PR status inline here is wasted work that blocks the
      // workspace-open critical path by 3-4s on a cold snapshot. PR status has its
      // own request (`checkout_pr_status_request`) and push channel.
      const snapshot = await this.workspaceGitService.getSnapshot(resolvedCwd, {
        includeGitHub: false,
        reason: "checkout-status-request",
      });
      this.host.emit({
        type: "checkout_status_response",
        payload: buildCheckoutStatusPayloadFromSnapshot({
          cwd,
          requestId,
          snapshot,
        }),
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_status_response",
        payload: {
          cwd,
          isGit: false,
          repoRoot: null,
          currentBranch: null,
          isDirty: null,
          baseRef: null,
          aheadBehind: null,
          aheadOfOrigin: null,
          behindOfOrigin: null,
          hasRemote: false,
          remoteUrl: null,
          isOttoOwnedWorktree: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleValidateBranchRequest(msg: ValidateBranchRequest): Promise<void> {
    const { cwd, branchName, requestId } = msg;

    try {
      const resolvedCwd = expandTilde(cwd);
      assertSafeGitRef(branchName, "branch");

      const resolution = await this.workspaceGitService.validateBranchRef(resolvedCwd, branchName);
      switch (resolution.kind) {
        case "local":
          this.host.emit({
            type: "validate_branch_response",
            payload: {
              exists: true,
              resolvedRef: resolution.name,
              isRemote: false,
              error: null,
              requestId,
            },
          });
          return;
        case "remote-only":
          this.host.emit({
            type: "validate_branch_response",
            payload: {
              exists: true,
              resolvedRef: resolution.remoteRef,
              isRemote: true,
              error: null,
              requestId,
            },
          });
          return;
        case "not-found":
          this.host.emit({
            type: "validate_branch_response",
            payload: {
              exists: false,
              resolvedRef: null,
              isRemote: false,
              error: null,
              requestId,
            },
          });
          return;
        default: {
          const exhaustiveCheck: never = resolution;
          throw new Error(`Unhandled branch resolution: ${getErrorMessage(exhaustiveCheck)}`);
        }
      }
    } catch (error) {
      this.host.emit({
        type: "validate_branch_response",
        payload: {
          exists: false,
          resolvedRef: null,
          isRemote: false,
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  async handleBranchSuggestionsRequest(msg: BranchSuggestionsRequest): Promise<void> {
    const { cwd, query, limit, requestId } = msg;

    try {
      const resolvedCwd = expandTilde(cwd);
      const branchDetails = await this.workspaceGitService.suggestBranchesForCwd(resolvedCwd, {
        query,
        limit,
      });
      this.host.emit({
        type: "branch_suggestions_response",
        payload: {
          branches: branchDetails.map((branch) => branch.name),
          branchDetails,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "branch_suggestions_response",
        payload: {
          branches: [],
          branchDetails: [],
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  async handleSubscribeDiffRequest(msg: SubscribeCheckoutDiffRequest): Promise<void> {
    const cwd = expandTilde(msg.cwd);
    this.diffSubscriptions.get(msg.subscriptionId)?.();
    this.diffSubscriptions.delete(msg.subscriptionId);
    const subscription = await this.checkoutDiffManager.subscribe(
      { cwd, compare: msg.compare },
      (snapshot) => {
        this.host.emit({
          type: "checkout_diff_update",
          payload: {
            subscriptionId: msg.subscriptionId,
            ...snapshot,
          },
        });
      },
    );
    this.diffSubscriptions.set(msg.subscriptionId, subscription.unsubscribe);

    this.host.emit({
      type: "subscribe_checkout_diff_response",
      payload: {
        subscriptionId: msg.subscriptionId,
        ...subscription.initial,
        requestId: msg.requestId,
      },
    });
  }

  handleUnsubscribeDiffRequest(msg: UnsubscribeCheckoutDiffRequest): void {
    this.diffSubscriptions.get(msg.subscriptionId)?.();
    this.diffSubscriptions.delete(msg.subscriptionId);
  }

  async handleRefreshRequest(msg: CheckoutRefreshRequest): Promise<void> {
    const { cwd, requestId } = msg;
    const resolvedCwd = expandTilde(cwd);

    try {
      this.github.invalidate({ cwd: resolvedCwd });
      await this.workspaceGitService.getSnapshot(resolvedCwd, {
        force: true,
        includeGitHub: true,
        reason: "manual-refresh",
      });
      this.checkoutDiffManager.scheduleRefreshForCwd(resolvedCwd);
      this.host.emit({
        type: "checkout.refresh.response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.refresh.response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  emitStatusUpdate(cwd: string, snapshot: WorkspaceGitRuntimeSnapshot): void {
    try {
      const requestId = `subscription:${cwd}`;
      this.host.emit({
        type: "checkout_status_update",
        payload: {
          ...buildCheckoutStatusPayloadFromSnapshot({
            cwd,
            requestId,
            snapshot,
          }),
          prStatus: buildCheckoutPrStatusPayloadFromSnapshot({
            cwd,
            requestId,
            snapshot,
          }),
        },
      });
    } catch (error) {
      this.logger.warn({ err: error, cwd }, "Failed to emit workspace checkout status update");
    }
  }

  /**
   * Notify the live diff subscriptions that the working tree at `cwd` changed.
   * Called by the command handlers below after they mutate the repository.
   */
  private scheduleDiffRefresh(cwd: string): void {
    this.checkoutDiffManager.scheduleRefreshForCwd(cwd);
  }

  // ---------------------------------------------------------------------------
  // Command operations (writes) and GitHub-PR operations
  // ---------------------------------------------------------------------------

  async handleCheckoutSwitchBranchRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_switch_branch_request" }>,
  ): Promise<void> {
    const { cwd, branch, requestId } = msg;

    try {
      const checkoutResult = await this.gitMutation.checkoutExistingBranch(cwd, branch);
      this.scheduleDiffRefresh(cwd);

      // Push a workspace_update immediately so the sidebar/header reflect
      // the new branch name without waiting for the background git watcher.
      await this.host.emitWorkspaceUpdateForCwd(cwd);

      this.host.emit({
        type: "checkout_switch_branch_response",
        payload: {
          cwd,
          success: true,
          branch,
          source: checkoutResult.source,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_switch_branch_response",
        payload: {
          cwd,
          success: false,
          branch,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutRenameBranchRequest(msg: CheckoutRenameBranchRequest): Promise<void> {
    const { cwd, branch, requestId } = msg;
    const validation = validateBranchSlug(branch);

    if (!validation.valid) {
      this.host.emit({
        type: "checkout.rename_branch.response",
        payload: {
          cwd,
          success: false,
          currentBranch: null,
          error: toCheckoutError(new Error(validation.error ?? "Invalid branch name")),
          requestId,
        },
      });
      return;
    }

    try {
      const result = await this.host.renameCurrentBranch(cwd, branch);
      await this.gitMutation.notifyGitMutation(cwd, "rename-branch", { invalidateGithub: true });
      this.scheduleDiffRefresh(cwd);
      this.host.handleWorkspaceGitBranchSnapshot(cwd, result.currentBranch);

      // Branch is a git fact derived per-descriptor from each workspace's own
      // live git snapshot (id → cwd); the reconciliation pass re-persists the
      // `branch` field per workspace from its own cwd. No cwd → ids fan-out here.
      // TODO(K10): PR-binding on branch rename is deferred — see plan K10.

      // Push a workspace_update immediately so the sidebar/header reflect
      // the new branch name without waiting for the background git watcher.
      await this.host.emitWorkspaceUpdateForCwd(cwd);

      this.host.emit({
        type: "checkout.rename_branch.response",
        payload: {
          cwd,
          success: true,
          currentBranch: result.currentBranch,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.rename_branch.response",
        payload: {
          cwd,
          success: false,
          currentBranch: null,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleStashSaveRequest(
    msg: Extract<SessionInboundMessage, { type: "stash_save_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const branchLabel = msg.branch?.trim() ?? "";
      const message = branchLabel
        ? `${CheckoutSession.OTTO_STASH_PREFIX} ${branchLabel}`
        : `${CheckoutSession.OTTO_STASH_PREFIX} unnamed`;
      await execCommand("git", ["stash", "push", "--include-untracked", "-m", message], {
        cwd,
      });
      await this.gitMutation.notifyGitMutation(cwd, "stash-push");
      this.scheduleDiffRefresh(cwd);
      this.host.emit({
        type: "stash_save_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "stash_save_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  async handleStashPopRequest(
    msg: Extract<SessionInboundMessage, { type: "stash_pop_request" }>,
  ): Promise<void> {
    const { cwd, stashIndex, requestId } = msg;
    try {
      await execCommand("git", ["stash", "pop", `stash@{${stashIndex}}`], {
        cwd,
      });
      await this.gitMutation.notifyGitMutation(cwd, "stash-pop");
      this.scheduleDiffRefresh(cwd);
      this.host.emit({
        type: "stash_pop_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "stash_pop_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  async handleStashListRequest(
    msg: Extract<SessionInboundMessage, { type: "stash_list_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    const ottoOnly = msg.ottoOnly !== false;
    try {
      const entries = await this.workspaceGitService.listStashes(cwd, { ottoOnly });

      this.host.emit({
        type: "stash_list_response",
        payload: { cwd, entries, error: null, requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "stash_list_response",
        payload: { cwd, entries: [], error: toCheckoutError(error), requestId },
      });
    }
  }

  async handleCheckoutCommitRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_commit_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      let message = msg.message?.trim() ?? "";
      if (!message) {
        message = await this.gitMetadataGenerator.generateCommitMessage(cwd);
      }
      if (!message) {
        throw new Error("Commit message is required");
      }

      await this.gitOperationLog.runOperation(
        { cwd, operation: "commit", label: "git commit" },
        () =>
          commitChanges(cwd, {
            message,
            addAll: msg.addAll ?? true,
          }),
      );
      await this.gitMutation.notifyGitMutation(cwd, "commit-changes");
      this.scheduleDiffRefresh(cwd);

      this.host.emit({
        type: "checkout_commit_response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_commit_response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutGitCommitAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.commit_agent.request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const agent = await this.gitMetadataGenerator.resolveCommitMessageAgent(cwd);
      this.host.emit({
        type: "checkout.git.commit_agent.response",
        payload: { cwd, agent, requestId },
      });
    } catch {
      // Resolution failure is treated as "no agent available" so the client
      // refuses the AI commit rather than proceeding on a broken lookup.
      this.host.emit({
        type: "checkout.git.commit_agent.response",
        payload: { cwd, agent: { kind: "none" }, requestId },
      });
    }
  }

  async handleCheckoutGitCommitRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.commit.request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    const respondError = (error: CheckoutGitCommitError) => {
      this.host.emit({
        type: "checkout.git.commit.response",
        payload: { cwd, success: false, commitSha: null, error, requestId },
      });
    };

    try {
      if (!msg.allowWithRunningAgents) {
        const busyAgents = this.listBusyAgentsForCwd(cwd);
        if (busyAgents.length > 0) {
          respondError({ kind: "agents_running", agents: busyAgents });
          return;
        }
      }

      const message = msg.message.trim();
      if (!message) {
        respondError({ kind: "git_failed", detail: "Commit message is required" });
        return;
      }

      const result = await this.gitOperationLog.runOperation(
        { cwd, operation: "commit", label: "git commit" },
        () => commitPaths(cwd, { message, paths: msg.paths }),
      );
      if (result.kind !== "committed") {
        this.gitOperationLog.append({
          cwd,
          operation: "commit",
          level: "error",
          text: `commit not created (${result.kind})`,
        });
        respondError(result);
        return;
      }
      this.gitOperationLog.append({
        cwd,
        operation: "commit",
        level: "info",
        text: `created commit ${result.sha}`,
      });

      await this.gitMutation.notifyGitMutation(cwd, "commit-changes");
      this.scheduleDiffRefresh(cwd);
      this.host.emit({
        type: "checkout.git.commit.response",
        payload: { cwd, success: true, commitSha: result.sha, error: null, requestId },
      });
    } catch (error) {
      respondError({ kind: "git_failed", detail: getErrorMessage(error) });
    }
  }

  async handleCheckoutGitRollbackRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.rollback.request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      // Rollback discards uncommitted edits, so — like commit — refuse while an
      // agent is working in this cwd unless the client confirmed the override.
      if (!msg.allowWithRunningAgents) {
        const busyAgents = this.listBusyAgentsForCwd(cwd);
        if (busyAgents.length > 0) {
          this.host.emit({
            type: "checkout.git.rollback.response",
            payload: {
              cwd,
              success: false,
              rolledBackPaths: [],
              error: { kind: "agents_running", agents: busyAgents },
              requestId,
            },
          });
          return;
        }
      }

      const result = await this.gitOperationLog.runOperation(
        { cwd, operation: "rollback", label: "git rollback" },
        () => rollbackPaths(cwd, { paths: msg.paths }),
      );
      if (result.kind !== "rolled_back") {
        if (result.kind === "git_failed") {
          this.gitOperationLog.append({
            cwd,
            operation: "rollback",
            level: "error",
            text: `rollback failed: ${result.detail}`,
          });
        }
        this.host.emit({
          type: "checkout.git.rollback.response",
          payload: { cwd, success: false, rolledBackPaths: [], error: result, requestId },
        });
        return;
      }
      this.gitOperationLog.append({
        cwd,
        operation: "rollback",
        level: "info",
        text: `rolled back ${result.paths.length} file(s)`,
      });

      await this.gitMutation.notifyGitMutation(cwd, "rollback-changes");
      this.scheduleDiffRefresh(cwd);
      this.host.emit({
        type: "checkout.git.rollback.response",
        payload: {
          cwd,
          success: true,
          rolledBackPaths: result.paths,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.git.rollback.response",
        payload: {
          cwd,
          success: false,
          rolledBackPaths: [],
          error: { kind: "git_failed", detail: getErrorMessage(error) },
          requestId,
        },
      });
    }
  }

  async handleCheckoutGitGetOperationLogRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.get_operation_log.request" }>,
  ): Promise<void> {
    const { cwd, operation, requestId } = msg;
    this.host.emit({
      type: "checkout.git.get_operation_log.response",
      payload: {
        cwd,
        operation,
        entries: this.gitOperationLog.getEntries(cwd, operation),
        requestId,
      },
    });
  }

  // ── Git file investigation ────────────────────────────────────────────────
  // Four read-only local-git queries over one file (or a line range in it):
  // history, per-commit diff, blame, and the commit that created it. They touch
  // no hosting provider and need no remote, and — unusually for this repo —
  // there is no per-provider rollout, because git is the same for every agent
  // provider. See utils/git-file-history.ts.

  async handleCheckoutGitFileHistoryRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.get_file_history.request" }>,
  ): Promise<void> {
    const { cwd, path, requestId } = msg;
    try {
      const result = await getFileHistory(expandTilde(cwd), {
        path,
        limit: msg.limit,
        offset: msg.offset,
        startLine: msg.startLine,
        endLine: msg.endLine,
      });
      this.host.emit({
        type: "checkout.git.get_file_history.response",
        payload: {
          cwd,
          path,
          entries: result.entries,
          hasMore: result.hasMore,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.git.get_file_history.response",
        payload: {
          cwd,
          path,
          entries: [],
          hasMore: false,
          error: toCheckoutGitFileError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutGitFileCommitDiffRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.get_file_commit_diff.request" }>,
  ): Promise<void> {
    const { cwd, path, sha, requestId } = msg;
    try {
      const resolvedCwd = expandTilde(cwd);
      const result = await getFileCommitDiff(resolvedCwd, {
        path,
        sha,
        ignoreWhitespace: msg.ignoreWhitespace,
      });
      // Best-effort structuring: a diff we cannot parse still ships as raw text
      // rather than failing the whole request.
      let structured: ParsedDiffFile[] | undefined;
      try {
        structured = await parseAndHighlightDiff(result.diff, resolvedCwd);
      } catch (parseError) {
        this.logger.debug(
          { err: parseError, path, sha },
          "Failed to structure file commit diff; sending raw text only",
        );
      }
      this.host.emit({
        type: "checkout.git.get_file_commit_diff.response",
        payload: {
          cwd,
          path,
          sha,
          diff: result.diff,
          ...(structured ? { structured } : {}),
          ...(result.previousSha ? { previousSha: result.previousSha } : {}),
          ...(result.previousPath ? { previousPath: result.previousPath } : {}),
          truncated: result.truncated,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.git.get_file_commit_diff.response",
        payload: {
          cwd,
          path,
          sha,
          diff: "",
          truncated: false,
          error: toCheckoutGitFileError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutGitFileBlameRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.get_file_blame.request" }>,
  ): Promise<void> {
    const { cwd, path, requestId } = msg;
    const startLine = msg.startLine ?? 1;
    try {
      const result = await getFileBlame(expandTilde(cwd), {
        path,
        startLine: msg.startLine,
        lineCount: msg.lineCount,
        sha: msg.sha,
      });
      this.host.emit({
        type: "checkout.git.get_file_blame.response",
        payload: {
          cwd,
          path,
          lines: result.lines,
          commits: result.commits,
          startLine: result.startLine,
          endLine: result.endLine,
          reachedEndOfFile: result.reachedEndOfFile,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.git.get_file_blame.response",
        payload: {
          cwd,
          path,
          lines: [],
          commits: [],
          startLine,
          endLine: startLine - 1,
          reachedEndOfFile: true,
          error: toCheckoutGitFileError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutGitFileOriginRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.git.get_file_origin.request" }>,
  ): Promise<void> {
    const { cwd, path, requestId } = msg;
    try {
      const entry = await getFileOriginCommit(expandTilde(cwd), { path });
      this.host.emit({
        type: "checkout.git.get_file_origin.response",
        payload: { cwd, path, entry, error: null, requestId },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.git.get_file_origin.response",
        payload: {
          cwd,
          path,
          entry: null,
          error: toCheckoutGitFileError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutMergeRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_merge_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      const snapshot = await this.workspaceGitService.getSnapshot(cwd);
      if (!snapshot.git.isGit) {
        throw new Error(`Not a git repository: ${cwd}`);
      }

      if (msg.requireCleanTarget) {
        if (snapshot.git.isDirty) {
          throw new Error("Working directory has uncommitted changes.");
        }
      }

      let baseRef = msg.baseRef ?? snapshot.git.baseRef;
      if (!baseRef) {
        throw new Error("Base branch is required for merge");
      }
      if (baseRef.startsWith("origin/")) {
        baseRef = baseRef.slice("origin/".length);
      }

      const mutatedCwd = await mergeToBase(
        cwd,
        {
          baseRef,
          mode: msg.strategy === "squash" ? "squash" : "merge",
        },
        { ottoHome: this.ottoHome, worktreesRoot: this.worktreesRoot },
      );
      await Promise.all([
        this.gitMutation.notifyGitMutation(mutatedCwd, "merge-to-base", { invalidateGithub: true }),
        ...(mutatedCwd !== cwd ? [this.gitMutation.notifyGitMutation(cwd, "merge-to-base")] : []),
      ]);
      this.scheduleDiffRefresh(cwd);

      this.host.emit({
        type: "checkout_merge_response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_merge_response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutMergeFromBaseRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_merge_from_base_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      if (msg.requireCleanTarget ?? true) {
        const snapshot = await this.workspaceGitService.getSnapshot(cwd);
        if (snapshot.git.isDirty) {
          throw new Error("Working directory has uncommitted changes.");
        }
      }

      await mergeFromBase(cwd, {
        baseRef: msg.baseRef,
        requireCleanTarget: msg.requireCleanTarget ?? true,
      });
      await this.gitMutation.notifyGitMutation(cwd, "merge-from-base", { invalidateGithub: true });
      this.scheduleDiffRefresh(cwd);

      this.host.emit({
        type: "checkout_merge_from_base_response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_merge_from_base_response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutPullRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pull_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      await this.gitOperationLog.runOperation({ cwd, operation: "pull", label: "git pull" }, () =>
        pullCurrentBranch(cwd),
      );
      await this.gitMutation.notifyGitMutation(cwd, "pull", { invalidateGithub: true });
      this.scheduleDiffRefresh(cwd);

      this.host.emit({
        type: "checkout_pull_response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_pull_response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutPushRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_push_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      await this.gitOperationLog.runOperation({ cwd, operation: "push", label: "git push" }, () =>
        pushCurrentBranch(cwd),
      );
      await this.gitMutation.notifyGitMutation(cwd, "push", { invalidateGithub: true });
      this.host.emit({
        type: "checkout_push_response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_push_response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutPrCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pr_create_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      let title = msg.title?.trim() ?? "";
      let body = msg.body?.trim() ?? "";

      if (!title || !body) {
        const generated = await this.gitMetadataGenerator.generatePullRequestText(cwd, msg.baseRef);
        if (!title) title = generated.title;
        if (!body) body = generated.body;
      }

      const result = await createPullRequest(
        cwd,
        {
          title,
          body,
          base: msg.baseRef,
        },
        this.github,
      );
      await this.gitMutation.notifyGitMutation(cwd, "create-pr", { invalidateGithub: true });

      this.host.emit({
        type: "checkout_pr_create_response",
        payload: {
          cwd,
          url: result.url ?? null,
          number: result.number ?? null,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_pr_create_response",
        payload: {
          cwd,
          url: null,
          number: null,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handleCheckoutPrMergeRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pr_merge_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      const pullRequest = await this.resolveCurrentPullRequest(cwd, "merge", {
        force: true,
        includeGitHub: true,
        reason: "merge-pr-validation",
      });
      this.assertCurrentPullRequestHasGithubMergeFacts(pullRequest);
      await this.github.mergePullRequest({
        cwd,
        prNumber: pullRequest.number,
        mergeMethod: msg.mergeMethod,
        status: pullRequest,
      });
      await this.gitMutation.notifyGitMutation(cwd, "merge-pr", { invalidateGithub: true });

      this.host.emit({
        type: "checkout_pr_merge_response",
        payload: {
          cwd,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_pr_merge_response",
        payload: {
          cwd,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  private assertCurrentPullRequestHasGithubMergeFacts(
    pullRequest: CurrentWorkspacePullRequest,
  ): void {
    if (!pullRequest.github) {
      throw new Error("GitHub merge facts are unavailable for this pull request");
    }
  }

  async handleCheckoutGithubSetAutoMergeRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.github.set_auto_merge.request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      const pullRequest = await this.resolveCurrentPullRequest(cwd, "auto-merge", {
        force: true,
        includeGitHub: true,
        reason: "auto-merge-validation",
      });
      if (msg.enabled) {
        const mergeMethod = msg.mergeMethod;
        if (!mergeMethod) {
          throw new Error("mergeMethod is required when enabling auto-merge");
        }
        assertPullRequestAutoMergeEnableReady({
          mergeMethod,
          status: pullRequest,
        });
        await this.github.enablePullRequestAutoMerge({
          cwd,
          prNumber: pullRequest.number,
          mergeMethod,
          status: pullRequest,
        });
      } else {
        if (msg.mergeMethod) {
          throw new Error("mergeMethod is not allowed when disabling auto-merge");
        }
        assertPullRequestAutoMergeDisableReady({ status: pullRequest });
        await this.github.disablePullRequestAutoMerge({
          cwd,
          prNumber: pullRequest.number,
          status: pullRequest,
        });
      }
      await this.gitMutation.notifyGitMutation(
        cwd,
        msg.enabled ? "enable-pr-auto-merge" : "disable-pr-auto-merge",
        {
          invalidateGithub: true,
        },
      );

      this.host.emit({
        type: "checkout.github.set_auto_merge.response",
        payload: {
          cwd,
          enabled: msg.enabled,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.github.set_auto_merge.response",
        payload: {
          cwd,
          enabled: msg.enabled,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  private async resolveCurrentPullRequest(
    cwd: string,
    operation: "merge" | "auto-merge",
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<CurrentWorkspacePullRequest> {
    const snapshot = await this.workspaceGitService.getSnapshot(cwd, options);
    const pullRequest = snapshot.github.pullRequest;
    if (!pullRequest || typeof pullRequest.number !== "number") {
      throw new Error(`Unable to determine GitHub pull request number for ${operation}`);
    }
    return { ...pullRequest, number: pullRequest.number };
  }

  async handleCheckoutPrStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pr_status_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;

    try {
      const snapshot = await this.workspaceGitService.getSnapshot(cwd);
      this.host.emit({
        type: "checkout_pr_status_response",
        payload: buildCheckoutPrStatusPayloadFromSnapshot({
          cwd,
          requestId,
          snapshot,
        }),
      });
    } catch (error) {
      this.host.emit({
        type: "checkout_pr_status_response",
        payload: {
          cwd,
          status: null,
          githubFeaturesEnabled: true,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  async handlePullRequestTimelineRequest(
    msg: Extract<SessionInboundMessage, { type: "pull_request_timeline_request" }>,
  ): Promise<void> {
    const { cwd, prNumber, repoOwner, repoName, requestId } = msg;

    if (!isValidPullRequestTimelineIdentity({ prNumber, repoOwner, repoName })) {
      this.host.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber,
          items: [],
          truncated: false,
          error: {
            kind: "unknown",
            message: "Pull request timeline request has invalid PR identity",
          },
          requestId,
          githubFeaturesEnabled: true,
        },
      });
      return;
    }

    // Treat missing CLI/credentials as features-off, not a thrown failure —
    // the router surfaces GitHostingCredentialsMissingError for providers
    // whose project has no token configured yet.
    const githubFeaturesEnabled = await this.github.isAuthenticated({ cwd }).catch(() => false);
    if (!githubFeaturesEnabled) {
      this.host.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber,
          items: [],
          truncated: false,
          error: {
            kind: "unknown",
            message: "GitHub CLI is unavailable or not authenticated",
          },
          requestId,
          githubFeaturesEnabled: false,
        },
      });
      return;
    }

    try {
      const timeline = await this.github.getPullRequestTimeline({
        cwd,
        prNumber,
        repoOwner,
        repoName,
      });
      this.host.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber: timeline.prNumber,
          items: timeline.items.map(toPullRequestTimelinePayloadItem),
          truncated: timeline.truncated,
          error: timeline.error,
          requestId,
          githubFeaturesEnabled: true,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber,
          items: [],
          truncated: false,
          error: {
            kind: "unknown",
            message: error instanceof Error ? error.message : String(error),
          },
          requestId,
          githubFeaturesEnabled: true,
        },
      });
    }
  }

  async handleCheckoutGithubGetCheckDetailsRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.github.get_check_details.request" }>,
  ): Promise<void> {
    const { cwd, repoOwner, repoName, checkRunId, workflowRunId, requestId } = msg;

    try {
      const details = await this.github.getGitHubCheckDetails({
        cwd,
        repoOwner,
        repoName,
        checkRunId,
        workflowRunId,
      });
      this.host.emit({
        type: "checkout.github.get_check_details.response",
        payload: {
          cwd,
          success: true,
          details,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "checkout.github.get_check_details.response",
        payload: {
          cwd,
          success: false,
          details: null,
          error: {
            code: "UNKNOWN",
            message: error instanceof Error ? error.message : String(error),
          },
          requestId,
        },
      });
    }
  }

  async handleGitHubSearchRequest(
    msg: Extract<SessionInboundMessage, { type: "github_search_request" }>,
  ): Promise<void> {
    const { cwd, query, limit, kinds, requestId } = msg;

    try {
      const resolvedCwd = expandTilde(cwd);
      const result = await this.github.searchIssuesAndPrs({
        cwd: resolvedCwd,
        query,
        limit,
        kinds,
      });
      this.host.emit({
        type: "github_search_response",
        payload: {
          items: result.items,
          githubFeaturesEnabled: result.githubFeaturesEnabled,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "github_search_response",
        payload: {
          items: [],
          githubFeaturesEnabled: true,
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  // Provider-neutral successor to handleGitHubSearchRequest: resolves the
  // project's hosting provider from cwd, so a Bitbucket project searches
  // Bitbucket PRs and a GitHub project searches GitHub issues + PRs.
  async handleHostingSearchRequest(
    msg: Extract<SessionInboundMessage, { type: "hosting.search.request" }>,
  ): Promise<void> {
    const { cwd, query, limit, kinds, requestId } = msg;
    const resolvedCwd = expandTilde(cwd);
    const resolved = this.gitHostingResolver
      ? await this.gitHostingResolver.resolveForCwd(resolvedCwd).catch(() => null)
      : null;
    const provider = resolved?.providerId ?? "github";

    if (resolved && !resolved.service) {
      this.host.emit({
        type: "hosting.search.response",
        payload: {
          items: [],
          provider,
          featuresEnabled: false,
          error: null,
          requestId,
        },
      });
      return;
    }

    try {
      const requestedKinds = kinds ?? ["issue", "pr"];
      const result = await this.github.searchIssuesAndPrs({
        cwd: resolvedCwd,
        query,
        limit,
        kinds: requestedKinds.map((kind) => (kind === "issue" ? "github-issue" : "github-pr")),
      });
      this.host.emit({
        type: "hosting.search.response",
        payload: {
          items: result.items,
          provider,
          featuresEnabled: result.githubFeaturesEnabled,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      if (isGitHostingFeatureDisabledError(error)) {
        this.host.emit({
          type: "hosting.search.response",
          payload: {
            items: [],
            provider,
            featuresEnabled: false,
            error: null,
            requestId,
          },
        });
        return;
      }
      this.host.emit({
        type: "hosting.search.response",
        payload: {
          items: [],
          provider,
          featuresEnabled: true,
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  cleanup(): void {
    for (const unsubscribe of this.diffSubscriptions.values()) {
      unsubscribe();
    }
    this.diffSubscriptions.clear();
  }
}

type PullRequestTimelinePayload = Extract<
  SessionOutboundMessage,
  { type: "pull_request_timeline_response" }
>["payload"];
type PullRequestTimelinePayloadItem = PullRequestTimelinePayload["items"][number];

function isValidPullRequestTimelineIdentity(options: {
  prNumber: number;
  repoOwner: string;
  repoName: string;
}): boolean {
  if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) {
    return false;
  }
  return isValidGitHubRepoSegment(options.repoOwner) && isValidGitHubRepoSegment(options.repoName);
}

function isValidGitHubRepoSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function toPullRequestTimelinePayloadItem(
  item: PullRequestTimelineItem,
): PullRequestTimelinePayloadItem {
  return item;
}
