import type { GitHostingCapabilities, GitHostingProviderId } from "@otto-code/protocol/messages";
import type { HostingCurrentPullRequestStatus, GitHubService } from "../github-service.js";

// A git hosting service is the existing GitHubService shape (every method
// already takes a cwd) tagged with which provider it is and what it can do.
// The GitHub implementation adapts the gh-CLI service; Bitbucket Cloud is a
// native REST implementation. Consumers that don't care about the provider
// keep depending on the untagged shape.
export interface GitHostingService extends GitHubService {
  readonly providerId: GitHostingProviderId;
  readonly capabilities: GitHostingCapabilities;
}

// Short neutral synonym for the provider-agnostic PR status shape (defined as
// HostingCurrentPullRequestStatus in github-service.ts).
export type CurrentPullRequestStatus = HostingCurrentPullRequestStatus;

export interface BitbucketPullRequestStatusFacts {
  mergeStrategiesAllowed: string[];
  defaultMergeStrategy: string | null;
  approvalCount: number;
  changesRequestedCount: number;
}

export const GITHUB_CAPABILITIES: GitHostingCapabilities = {
  autoMerge: true,
  mergeQueue: true,
  checkAnnotations: true,
  checkDetails: true,
  draftPrs: true,
  reviewDecisions: true,
  issues: true,
};

export const BITBUCKET_CLOUD_CAPABILITIES: GitHostingCapabilities = {
  autoMerge: false,
  mergeQueue: false,
  checkAnnotations: false,
  checkDetails: false,
  draftPrs: true,
  reviewDecisions: true,
  // Most Bitbucket Cloud teams track issues in Jira; the native tracker is
  // deprecated and off by default, so v1 exposes PR search only.
  issues: false,
};

// Provider credentials are absent (not an auth failure): features off, no
// error surfaced — mirrors GitHubCliMissingError semantics.
export class GitHostingCredentialsMissingError extends Error {
  readonly kind = "missing-credentials";

  constructor(providerId: GitHostingProviderId) {
    super(`No credentials configured for git hosting provider ${providerId}`);
    this.name = "GitHostingCredentialsMissingError";
  }
}

// Credentials exist but the provider rejected them — mirrors
// GitHubAuthenticationError semantics.
export class GitHostingAuthenticationError extends Error {
  readonly kind = "auth-failure";

  constructor(providerId: GitHostingProviderId) {
    super(`Git hosting provider ${providerId} rejected the configured credentials`);
    this.name = "GitHostingAuthenticationError";
  }
}

export class GitHostingRateLimitError extends Error {
  readonly kind = "rate-limited";
  readonly retryAfterMs: number | null;

  constructor(params: { providerId: GitHostingProviderId; retryAfterMs: number | null }) {
    super(`Git hosting provider ${params.providerId} rate limited the request`);
    this.name = "GitHostingRateLimitError";
    this.retryAfterMs = params.retryAfterMs;
  }
}

// A capability the provider doesn't implement was invoked (e.g. auto-merge or
// server-side rebase on Bitbucket Cloud). Typed so callers can discriminate on
// `kind` like every other hosting error, instead of matching a bare message.
export class GitHostingUnsupportedCapabilityError extends Error {
  readonly kind = "unsupported-capability";
  readonly capability: string;

  constructor(params: { providerId: GitHostingProviderId; capability: string }) {
    super(`Git hosting provider ${params.providerId} does not support ${params.capability}`);
    this.name = "GitHostingUnsupportedCapabilityError";
    this.capability = params.capability;
  }
}

export class GitHostingRequestError extends Error {
  readonly kind = "request-error";
  readonly status: number | null;
  readonly method: string;
  readonly path: string;

  // Never include request headers or bodies: they can carry credentials.
  constructor(params: { method: string; path: string; status: number | null; detail?: string }) {
    super(
      `Git hosting request failed: ${params.method} ${params.path}` +
        (params.status !== null ? ` (HTTP ${params.status})` : "") +
        (params.detail ? `: ${params.detail}` : ""),
    );
    this.name = "GitHostingRequestError";
    this.status = params.status;
    this.method = params.method;
    this.path = params.path;
  }
}

export function isGitHostingFeatureDisabledError(error: unknown): boolean {
  return (
    error instanceof GitHostingCredentialsMissingError ||
    error instanceof GitHostingAuthenticationError
  );
}
