import {
  compareTimelineItems,
  parseOptionalTime,
  type PullRequestTimelineItem,
  type PullRequestTimeline,
} from "../../forge-service.js";
import { BitbucketError, bitbucketNumber } from "./http.js";
import { Activity, Comment, publicRepository, safeBitbucketUrl } from "./models.js";
import type { BitbucketReads } from "./reads.js";
import type { z } from "zod";

function commentItem(comment: z.infer<typeof Comment>, url: string): PullRequestTimelineItem {
  const threadId = String(comment.parent?.id ?? comment.id);
  return {
    kind: "comment",
    id: String(comment.id),
    author: comment.user?.display_name ?? "Unknown account",
    authorUrl: comment.user?.links?.html
      ? safeBitbucketUrl(comment.user.links.html.href, "") || null
      : null,
    avatarUrl: null,
    body: comment.content.raw,
    createdAt: parseOptionalTime(comment.created_on),
    url: safeBitbucketUrl(comment.links?.html?.href, `${url}#comment-${comment.id}`),
    threadId,
    threadIsResolved: comment.resolution != null,
    ...(comment.inline
      ? {
          location: {
            path: comment.inline.path,
            ...(comment.inline.to == null ? {} : { line: comment.inline.to }),
            threadId,
            isResolved: comment.resolution != null,
          },
        }
      : {}),
  };
}

export async function readBitbucketTimeline(
  context: Awaited<ReturnType<BitbucketReads["scope"]>>,
  number: number,
): Promise<PullRequestTimeline> {
  const base = `${context.path}/pullrequests/${bitbucketNumber(number)}`;
  const comments = await context.http.page(`${base}/comments?pagelen=100`, Comment, 500);
  const activity = await context.http.page(`${base}/activity?pagelen=100`, Activity, 500);
  const url = `${publicRepository(context.identity)}/pull-requests/${number}`;
  const items: PullRequestTimelineItem[] = [];
  for (const comment of comments.values) {
    if (comment.deleted) continue;
    items.push(commentItem(comment, url));
  }
  for (const entry of activity.values) {
    const event = entry.approval ?? entry.changes_requested;
    if (!event) continue;
    const state = entry.approval ? "approved" : "changes_requested";
    items.push({
      kind: "review",
      reviewState: state,
      id: `${state}:${event.user.nickname ?? event.user.display_name}:${event.date}`,
      author: event.user.display_name,
      authorUrl: event.user.links?.html
        ? safeBitbucketUrl(event.user.links.html.href, "") || null
        : null,
      avatarUrl: null,
      body: "",
      createdAt: parseOptionalTime(event.date),
      url,
    });
  }
  return {
    prNumber: number,
    repoOwner: context.identity.workspace,
    repoName: context.identity.repository,
    items: items.sort(compareTimelineItems),
    truncated: comments.truncated || activity.truncated,
    error: null,
  };
}
export function timelineError(error: unknown): PullRequestTimeline["error"] {
  if (error instanceof BitbucketError) {
    if (error.kind === "not_found") return { kind: "not_found", message: error.message };
    if (error.kind === "forbidden" || error.kind === "credentials")
      return { kind: "forbidden", message: error.message };
    return { kind: "unknown", message: error.message };
  }
  return { kind: "unknown", message: "The host could not read this Bitbucket timeline." };
}
