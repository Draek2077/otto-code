import { z } from "zod";
import type {
  CurrentPullRequestStatus,
  PullRequestCheck,
  PullRequestSummary,
} from "../../forge-service.js";
import { computeChecksStatus } from "../../forge-service.js";

const Link = z.object({ href: z.string() });
export const User = z.object({
  display_name: z.string(),
  nickname: z.string().optional(),
  links: z.object({ html: Link.optional(), avatar: Link.optional() }).optional(),
});
const RepositoryRef = z.object({ full_name: z.string(), uuid: z.string().optional() });
const Branch = z.object({
  branch: z.object({ name: z.string() }),
  commit: z.object({ hash: z.string() }).nullish(),
  repository: RepositoryRef.nullish(),
});
export const PullRequest = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]),
  draft: z.boolean().optional(),
  description: z.string().nullish(),
  summary: z.object({ raw: z.string() }).nullish(),
  links: z.object({ html: Link.optional() }).optional(),
  source: Branch,
  destination: Branch,
  participants: z
    .array(z.object({ approved: z.boolean(), state: z.string().nullable().optional() }))
    .optional(),
  updated_on: z.string(),
});
export type BitbucketPullRequest = z.infer<typeof PullRequest>;
export const CommitStatus = z.object({
  key: z.string(),
  name: z.string().nullish(),
  state: z.enum(["SUCCESSFUL", "FAILED", "INPROGRESS", "STOPPED"]),
  url: z.string().nullish(),
});
export const Comment = z.object({
  id: z.number().int().positive(),
  user: User.nullish(),
  deleted: z.boolean().optional(),
  content: z.object({ raw: z.string() }),
  created_on: z.string(),
  parent: z.object({ id: z.number().int().positive() }).nullish(),
  inline: z
    .object({ path: z.string(), to: z.number().nullish(), from: z.number().nullish() })
    .nullish(),
  resolution: z.unknown().optional(),
  links: z.object({ html: Link.optional() }).optional(),
});
export const Activity = z.object({
  approval: z.object({ user: User, date: z.string() }).optional(),
  changes_requested: z.object({ user: User, date: z.string() }).optional(),
});
export interface BitbucketRepositoryIdentity {
  workspace: string;
  repository: string;
}
export function safeBitbucketUrl(value: string | null | undefined, fallback: string): string {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol === "https:" &&
      url.hostname === "bitbucket.org" &&
      !url.port &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Missing links use the canonical repository URL. */
  }
  return fallback;
}
export function publicRepository(identity: BitbucketRepositoryIdentity): string {
  return `https://bitbucket.org/${encodeURIComponent(identity.workspace)}/${encodeURIComponent(identity.repository)}`;
}
export function summary(
  pr: BitbucketPullRequest,
  identity: BitbucketRepositoryIdentity,
): PullRequestSummary {
  let state = "closed";
  if (pr.state === "OPEN") state = "open";
  if (pr.state === "MERGED") state = "merged";
  return {
    number: pr.id,
    title: pr.title,
    url: safeBitbucketUrl(
      pr.links?.html?.href,
      `${publicRepository(identity)}/pull-requests/${pr.id}`,
    ),
    state,
    body: pr.description ?? pr.summary?.raw ?? null,
    projectPath: `${identity.workspace}/${identity.repository}`,
    baseRefName: pr.destination.branch.name,
    headRefName: pr.source.branch.name,
    labels: [],
    updatedAt: pr.updated_on,
  };
}
export function status(
  pr: BitbucketPullRequest,
  identity: BitbucketRepositoryIdentity,
  checks: PullRequestCheck[],
): CurrentPullRequestStatus {
  const participants = pr.participants ?? [];
  const approvalCount = participants.filter((person) => person.approved).length;
  const changesRequestedCount = participants.filter(
    (person) => person.state === "changes_requested",
  ).length;
  const row = summary(pr, identity);
  let reviewDecision: CurrentPullRequestStatus["reviewDecision"] = "pending";
  if (approvalCount > 0) reviewDecision = "approved";
  if (changesRequestedCount > 0) reviewDecision = "changes_requested";
  return {
    ...row,
    repoOwner: identity.workspace,
    repoName: identity.repository,
    isMerged: pr.state === "MERGED",
    isDraft: pr.draft ?? false,
    mergeable: "UNKNOWN",
    checks,
    checksStatus: computeChecksStatus(checks),
    reviewDecision,
    forgeSpecific: {
      forge: "bitbucket",
      mergeStrategiesAllowed: ["merge", "squash"],
      defaultMergeStrategy: "merge",
      approvalCount,
      changesRequestedCount,
    },
  };
}
export function commitCheck(value: z.infer<typeof CommitStatus>): PullRequestCheck {
  const states = {
    SUCCESSFUL: "success",
    FAILED: "failure",
    INPROGRESS: "pending",
    STOPPED: "cancelled",
  } as const;
  return {
    name: value.name || value.key,
    status: states[value.state],
    url: checkUrl(value.url),
  };
}
function checkUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
