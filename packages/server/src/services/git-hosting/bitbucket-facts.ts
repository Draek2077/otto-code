import type { ForgeSpecificStatusFacts } from "../forge-service.js";

// Mirrors the per-adapter facts modules Paseo ships for its own forges
// (github-facts.ts, gitlab-facts.ts, gitea-facts.ts): the adapter owns its
// typed fact shape and its guard, and shared server code only ever sees the
// tagged `forgeSpecific` envelope.
export interface BitbucketPullRequestStatusFacts {
  mergeStrategiesAllowed: string[];
  defaultMergeStrategy: string | null;
  approvalCount: number;
  changesRequestedCount: number;
}

export type BitbucketForgeSpecificStatusFacts = ForgeSpecificStatusFacts & {
  forge: "bitbucket";
} & BitbucketPullRequestStatusFacts;

export function isBitbucketPullRequestStatusFacts(
  facts: ForgeSpecificStatusFacts | null | undefined,
): facts is BitbucketForgeSpecificStatusFacts {
  return facts?.forge === "bitbucket";
}
