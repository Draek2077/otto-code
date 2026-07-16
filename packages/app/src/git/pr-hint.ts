import { isBitbucketCloudHost, normalizeHost } from "@otto-code/protocol/git-remote";
import type { GitHostingProviderId } from "@otto-code/protocol/messages";

export interface PrHint {
  url: string;
  number: number;
  state: "open" | "merged" | "closed";
  // Derived from the PR URL host — lets badge UI show the right provider mark
  // without a protocol change (workspace snapshots don't carry the provider).
  provider: GitHostingProviderId;
  checks?: Array<{ name: string; status: string; url: string | null }>;
  checksStatus?: "none" | "pending" | "success" | "failure";
  reviewDecision?: "approved" | "changes_requested" | "pending" | null;
}

interface PrStatusLike {
  url: string;
  state: string;
  isMerged: boolean;
  checks?: Array<{ name: string; status: string; url: string | null }>;
  checksStatus?: string;
  reviewDecision?: string | null;
}

function parsePullRequestNumber(url: string): number | null {
  try {
    const pathname = new URL(url).pathname;
    // GitHub uses /pull/<n>, Bitbucket Cloud uses /pull-requests/<n>.
    const match = pathname.match(/\/(?:pull|pull-requests)\/(\d+)(?:\/|$)/);
    if (!match) {
      return null;
    }

    const number = Number.parseInt(match[1], 10);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

function deriveProviderFromPrUrl(url: string): GitHostingProviderId {
  try {
    const host = normalizeHost(new URL(url).hostname);
    return isBitbucketCloudHost(host) ? "bitbucket-cloud" : "github";
  } catch {
    return "github";
  }
}

export function selectPrHintFromStatus(status: PrStatusLike | null | undefined): PrHint | null {
  if (!status?.url) {
    return null;
  }

  const number = parsePullRequestNumber(status.url);
  if (number === null) {
    return null;
  }

  // COMPAT(bitbucketPrStateCase): daemons <= 0.6.1 sent Bitbucket PR states
  // uppercase ("OPEN"). Drop the lowercasing once the daemon floor >= 0.6.2.
  const rawState = status.state.toLowerCase();
  let state: "merged" | "open" | "closed";
  if (status.isMerged || rawState === "merged") state = "merged";
  else if (rawState === "open") state = "open";
  else state = "closed";

  return {
    url: status.url,
    number,
    state,
    provider: deriveProviderFromPrUrl(status.url),
    checks: status.checks,
    checksStatus: status.checksStatus as PrHint["checksStatus"],
    reviewDecision: status.reviewDecision as PrHint["reviewDecision"],
  };
}
