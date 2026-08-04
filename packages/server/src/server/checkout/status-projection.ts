import { isBitbucketPullRequestStatusFacts } from "../../services/git-hosting/bitbucket-facts.js";
import { isGitHubPullRequestStatusFacts } from "../../services/github-facts.js";
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
/**
 * Producer-side shapes. `forge` carries `.default("github")` on the wire, which
 * makes it required in the parsed (output) type but optional to send - and a
 * daemon that has not resolved a forge must send nothing rather than assert
 * GitHub. These aliases say that: omit the defaulted field, let the schema fill
 * it in on parse.
 */
type CheckoutPrStatusPayloadStatus = Omit<
  NonNullable<CheckoutPrStatusPayload["status"]>,
  "forge"
> & { forge?: string };
type CheckoutPrStatusEmittedPayload = Omit<
  CheckoutPrStatusResponse["payload"],
  "forge" | "status"
> & {
  forge?: string;
  status: CheckoutPrStatusPayloadStatus | null;
};

/**
 * The one place the producer shape meets the parsed shape.
 *
 * `forge` is `.optional().default("github")` on the wire, so it is optional to
 * send and required once parsed - the default exists so an *old* daemon's
 * omission still reads as GitHub, and it stays until the floor reaches v0.1.106.
 * A new daemon that resolved no forge must send nothing rather than assert
 * GitHub, so omitting it here is correct even though the parsed type says
 * otherwise. Named rather than inlined so this is not mistaken for a
 * convenience cast.
 */
export function asEmittedPrStatusPayload(
  payload: CheckoutPrStatusEmittedPayload,
): CheckoutPrStatusResponse["payload"] {
  return payload as CheckoutPrStatusResponse["payload"];
}

export function buildCheckoutStatusPayloadFromSnapshot(params: {
  cwd: string;
  requestId: string;
  snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutStatusResponse["payload"] {
  const payload = buildCheckoutStatusFields(params);
  const gitStateAt = params.snapshot.gitLoadedAtMs;
  // Stamp when the git-tracking fields were measured so a client can tell an
  // out-of-order push from fresh news. Omitted when the snapshot predates any
  // measurement - an absent stamp reads as "unknown", not "oldest".
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
 * base per branch, so any git checkout can be repointed - the old rule of "Otto worktrees only"
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
}): CheckoutPrStatusEmittedPayload {
  // The resolved brand, which includes self-hosted host names the per-host probe
  // settled on. Left absent when nothing resolved: the wire schema defaults it,
  // and an absent brand reads as "unknown" rather than a wrong one.
  const resolvedForge = snapshot.forge.forge;
  const provider = snapshot.forge.provider ?? "github";
  return {
    cwd,
    ...(resolvedForge === undefined ? {} : { forge: resolvedForge }),
    status: normalizeCheckoutPrStatusPayload(snapshot.forge.pullRequest, resolvedForge),
    // Legacy GitHub-only flag: old clients read this, so it must stay false
    // for non-GitHub providers (they would otherwise render GitHub UI against
    // a Bitbucket workspace).
    githubFeaturesEnabled: provider === "github" && snapshot.forge.featuresEnabled,
    // The richer signal that supersedes the boolean above. It is a required
    // field on the wire and was simply never emitted.
    authState: snapshot.forge.authState,
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

/**
 * `resolvedForge` is the brand the forge resolver settled on for the workspace,
 * and it is deliberately not derived from `forgeSpecific.forge`. Those are two
 * different things: a Codeberg workspace resolves to the Forgejo brand while its
 * facts are tagged with the `gitea` family they follow. Promoting the family tag
 * would label Codeberg as Gitea, and defaulting it to `github` - which this used
 * to do - labels every unresolved forge as GitHub and makes the client render
 * GitHub affordances against a GitLab merge request.
 */
export function normalizeCheckoutPrStatusPayload(
  status: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
  resolvedForge?: string,
): CheckoutPrStatusPayloadStatus | null {
  if (!status) {
    return null;
  }
  const projectPath =
    status.projectPath ??
    (status.repoOwner && status.repoName ? `${status.repoOwner}/${status.repoName}` : undefined);
  const payload: CheckoutPrStatusPayloadStatus = {
    ...(resolvedForge === undefined ? {} : { forge: resolvedForge }),
    number: status.number,
    url: status.url,
    title: status.title,
    state: status.state,
    repoOwner: status.repoOwner,
    repoName: status.repoName,
    // Prefer what the adapter reported: a nested GitLab namespace
    // (group/subgroup/repo) cannot be rebuilt from two fields, which is the
    // whole reason projectPath exists. Fall back to owner/name for adapters
    // that do not report it.
    ...(projectPath === undefined ? {} : { projectPath }),
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
    // COMPAT(forgeSpecific): added in v0.1.106, remove after 2026-12-27. Clients
    // that predate forgeSpecific read GitHub merge facts off `github`, so keep
    // mirroring them there until the daemon floor >= v0.1.106. The forge tag is
    // dropped from the mirror: the old field is GitHub-only by definition.
    if (isGitHubPullRequestStatusFacts(status.forgeSpecific)) {
      const { forge: _forge, ...githubFacts } = status.forgeSpecific;
      payload.github = githubFacts;
    }
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
