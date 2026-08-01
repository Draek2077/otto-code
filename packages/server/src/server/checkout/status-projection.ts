import { isBitbucketPullRequestStatusFacts } from "../../services/git-hosting/bitbucket-facts.js";
import type {
  CheckoutPrStatusResponse,
  CheckoutStatusResponse,
  SessionOutboundMessage,
} from "@otto-code/protocol/messages";
import type { CheckoutBaseSource } from "../../utils/checkout-git.js";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";

type CheckoutPrStatusPayload = Extract<
  SessionOutboundMessage,
  { type: "checkout_pr_status_response" }
>["payload"];
type CheckoutPrStatusPayloadStatus = NonNullable<CheckoutPrStatusPayload["status"]>;

export function buildCheckoutStatusPayloadFromSnapshot(params: {
  cwd: string;
  requestId: string;
  snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutStatusResponse["payload"] {
  const payload = buildCheckoutStatusFields(params);
  const gitStateAt = params.snapshot.gitLoadedAtMs;
  // Stamp when the git-tracking fields were measured so a client can tell an
  // out-of-order push from fresh news. Omitted when the snapshot predates any
  // measurement — an absent stamp reads as "unknown", not "oldest".
  return gitStateAt == null ? payload : { ...payload, gitStateAt };
}

function buildCheckoutStatusFields({
  cwd,
  requestId,
  snapshot,
}: {
  cwd: string;
  requestId: string;
  snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutStatusResponse["payload"] {
  if (!snapshot.git.isGit) {
    return {
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
      error: null,
      requestId,
    };
  }

  if (snapshot.git.repoRoot === null || snapshot.git.isDirty === null) {
    throw new Error("Workspace git snapshot is missing required checkout status fields");
  }

  if (snapshot.git.isOttoOwnedWorktree) {
    if (snapshot.git.mainRepoRoot === null || snapshot.git.baseRef === null) {
      throw new Error("Workspace git snapshot is missing required worktree status fields");
    }

    return {
      cwd,
      isGit: true,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch ?? null,
      isDirty: snapshot.git.isDirty,
      baseRef: snapshot.git.baseRef,
      aheadBehind: snapshot.git.aheadBehind ?? null,
      aheadOfOrigin: snapshot.git.aheadOfOrigin ?? null,
      behindOfOrigin: snapshot.git.behindOfOrigin ?? null,
      hasRemote: snapshot.git.hasRemote,
      remoteUrl: snapshot.git.remoteUrl,
      isOttoOwnedWorktree: true,
      ...buildBaseProvenanceFields(snapshot),
      error: null,
      requestId,
    };
  }

  return {
    cwd,
    isGit: true,
    repoRoot: snapshot.git.repoRoot,
    mainRepoRoot: snapshot.git.mainRepoRoot,
    currentBranch: snapshot.git.currentBranch ?? null,
    isDirty: snapshot.git.isDirty,
    baseRef: snapshot.git.baseRef ?? null,
    aheadBehind: snapshot.git.aheadBehind ?? null,
    aheadOfOrigin: snapshot.git.aheadOfOrigin ?? null,
    behindOfOrigin: snapshot.git.behindOfOrigin ?? null,
    hasRemote: snapshot.git.hasRemote,
    remoteUrl: snapshot.git.remoteUrl,
    isOttoOwnedWorktree: false,
    ...buildBaseProvenanceFields(snapshot),
    error: null,
    requestId,
  };
}

/**
 * Says where the base came from and whether the client may change it.
 *
 * `isBaseEditable` is answered here rather than re-derived on the client: this daemon stores the
 * base per branch, so any git checkout can be repointed — the old rule of "Otto worktrees only"
 * was a storage limitation, not a product one, and the client has no way to know which it is.
 */
function buildBaseProvenanceFields(snapshot: WorkspaceGitRuntimeSnapshot): {
  baseSource?: CheckoutBaseSource;
  isBaseEditable: boolean;
} {
  const baseSource = snapshot.git.baseSource ?? null;
  return {
    ...(baseSource ? { baseSource } : {}),
    isBaseEditable: snapshot.git.isGit && snapshot.git.currentBranch !== null,
  };
}

export function buildCheckoutPrStatusPayloadFromSnapshot({
  cwd,
  requestId,
  snapshot,
}: {
  cwd: string;
  requestId: string;
  snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutPrStatusResponse["payload"] {
  const provider = snapshot.forge.provider ?? "github";
  return {
    cwd,
    forge: provider,
    status: normalizeCheckoutPrStatusPayload(snapshot.forge.pullRequest),
    // Legacy GitHub-only flag: old clients read this, so it must stay false
    // for non-GitHub providers (they would otherwise render GitHub UI against
    // a Bitbucket workspace).
    githubFeaturesEnabled: provider === "github" && snapshot.forge.featuresEnabled,
    hosting: {
      provider,
      featuresEnabled: snapshot.forge.featuresEnabled,
      ...(snapshot.forge.capabilities ? { capabilities: snapshot.forge.capabilities } : {}),
    },
    error: snapshot.forge.error
      ? {
          code: "UNKNOWN",
          message: snapshot.forge.error.message,
        }
      : null,
    requestId,
  };
}

export function normalizeCheckoutPrStatusPayload(
  status: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
): CheckoutPrStatusPayloadStatus | null {
  if (!status) {
    return null;
  }
  const payload: CheckoutPrStatusPayloadStatus = {
    forge: status.forgeSpecific?.forge ?? "github",
    number: status.number,
    url: status.url,
    title: status.title,
    state: status.state,
    repoOwner: status.repoOwner,
    repoName: status.repoName,
    baseRefName: status.baseRefName,
    headRefName: status.headRefName,
    isMerged: status.isMerged,
    isDraft: status.isDraft ?? false,
    mergeable: status.mergeable ?? "UNKNOWN",
    checks: status.checks ?? [],
    checksStatus: status.checksStatus,
    reviewDecision: status.reviewDecision,
  };
  if (status.forgeSpecific) {
    payload.forgeSpecific = status.forgeSpecific;
  }
  // The legacy hosting block is Bitbucket-shaped; only a Bitbucket-tagged facts
  // envelope belongs in it. Old clients read this; new ones read forgeSpecific.
  if (isBitbucketPullRequestStatusFacts(status.forgeSpecific)) {
    payload.hosting = {
      provider: "bitbucket-cloud",
      bitbucket: status.forgeSpecific,
    };
  }
  return payload;
}
