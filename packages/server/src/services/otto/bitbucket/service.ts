import type {
  ForgeService,
  PullRequestCheckoutTarget,
  ListPullRequestsOptions,
} from "../../forge-service.js";
import { normalizeForgeSearchKinds } from "../../forge-service.js";
import { ForgeAuthenticationError } from "../../forge-cli-command.js";
import { BitbucketError, bitbucketNumber, bitbucketPath, bitbucketText } from "./http.js";
import { PullRequest, summary } from "./models.js";
import { createBitbucketReads, type BitbucketServicePorts } from "./reads.js";
import { readBitbucketTimeline, timelineError } from "./timeline.js";
import { createBitbucketPoller } from "./poll.js";

export interface BitbucketForgeService extends ForgeService {
  setThreadResolved(input: {
    cwd: string;
    number: number;
    commentId: number;
    resolved: boolean;
  }): Promise<void>;
}
/** Native Bitbucket Cloud implementation of Paseo's canonical forge contract. */
export function createBitbucketService(
  ports: BitbucketServicePorts = { credential: async () => null },
): BitbucketForgeService {
  const reads = createBitbucketReads(ports);
  const polls = createBitbucketPoller(reads.current);
  async function list(input: ListPullRequestsOptions) {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 20)));
    return reads.read(
      input.cwd,
      JSON.stringify(["list", input.query, limit]),
      input,
      async (context) => {
        const term = (input.query ?? "").trim().slice(0, 1000);
        let q = 'state="OPEN"';
        if (term)
          q += ` AND (title~"${bitbucketText(term)}" OR description~"${bitbucketText(term)}")`;
        const query = new URLSearchParams({
          q,
          sort: "-updated_on",
          pagelen: String(Math.min(limit, 50)),
        });
        const page = await context.http.page(
          `${context.path}/pullrequests?${query}`,
          PullRequest,
          limit,
        );
        return page.values.map((pr) => summary(pr, context.identity));
      },
    );
  }
  async function checkout(input: {
    cwd: string;
    number: number;
  }): Promise<PullRequestCheckoutTarget> {
    return reads.read(
      input.cwd,
      `checkout:${bitbucketNumber(input.number)}`,
      {},
      async (context) => {
        const pr = await reads.pull(context, input.number);
        const source = pr.source.repository?.full_name;
        if (!source)
          throw new BitbucketError(
            "unavailable",
            "This Bitbucket pull request's source repository is no longer available.",
          );
        const parts = source.split("/");
        if (parts.length !== 2)
          throw new BitbucketError("invalid", "Bitbucket returned an invalid source repository.");
        bitbucketPath(parts[0], parts[1]);
        const cross =
          source.toLowerCase() !==
          `${context.identity.workspace}/${context.identity.repository}`.toLowerCase();
        return {
          number: pr.id,
          baseRefName: pr.destination.branch.name,
          headRefName: pr.source.branch.name,
          headOwnerLogin: parts[0],
          headRepositorySshUrl: `git@bitbucket.org:${source}.git`,
          headRepositoryUrl: `https://bitbucket.org/${source}.git`,
          isCrossRepository: cross,
          checkoutRefs: [{ remoteRef: `refs/heads/${pr.source.branch.name}` }],
        };
      },
    );
  }
  function unsupported(): never {
    throw new BitbucketError(
      "unsupported",
      "Bitbucket Cloud does not expose this operation through Otto's forge adapter.",
    );
  }
  const service: BitbucketForgeService = {
    listPullRequests: list,
    async listIssues() {
      return [];
    },
    async getPullRequest(input) {
      return reads.read(input.cwd, `pull:${input.number}`, input, async (context) =>
        summary(await reads.pull(context, input.number), context.identity),
      );
    },
    async getPullRequestHeadRef(input) {
      return (await checkout(input)).headRefName;
    },
    getPullRequestCheckoutTarget: checkout,
    getCurrentPullRequestStatus: reads.current,
    async getPullRequestTimeline(input) {
      try {
        return await reads.read(input.cwd, `timeline:${input.prNumber}`, input, async (context) => {
          if (
            context.identity.workspace !== input.repoOwner ||
            context.identity.repository !== input.repoName
          )
            throw new BitbucketError(
              "invalid",
              "The pull request belongs to a different repository.",
            );
          return readBitbucketTimeline(context, input.prNumber);
        });
      } catch (error) {
        return {
          prNumber: input.prNumber,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          items: [],
          truncated: false,
          error: timelineError(error),
        };
      }
    },
    async getCheckDetails() {
      return unsupported();
    },
    async searchIssuesAndPrs(input) {
      try {
        const items = normalizeForgeSearchKinds(input.kinds).includes("change_request")
          ? await list(input)
          : [];
        return {
          items: items.map((item) =>
            Object.assign({}, item, { kind: "change_request" as const, forge: "bitbucket-cloud" }),
          ),
          featuresEnabled: true,
          authState: "authenticated",
        };
      } catch (error) {
        if (error instanceof BitbucketError && error.kind === "credentials")
          return { items: [], featuresEnabled: false, authState: "unauthenticated" };
        throw error;
      }
    },
    async createPullRequest(input) {
      if (!input.title.trim() || !input.head.trim() || !input.base.trim())
        throw new BitbucketError(
          "invalid",
          "Enter a title, source branch, and destination branch.",
        );
      const context = await reads.scope(input.cwd);
      const raw = await context.http.request("POST", `${context.path}/pullrequests`, {
        title: input.title,
        description: input.body ?? "",
        source: { branch: { name: input.head } },
        destination: { branch: { name: input.base } },
        close_source_branch: false,
      });
      reads.invalidate();
      const parsed = PullRequest.safeParse(raw);
      if (!parsed.success)
        throw new BitbucketError(
          "uncertain",
          "The pull request may have been created. Refresh Bitbucket before trying again.",
        );
      const row = summary(parsed.data, context.identity);
      return { number: row.number, url: row.url };
    },
    async mergePullRequest(input) {
      if (input.mergeMethod !== "merge" && input.mergeMethod !== "squash") return unsupported();
      const context = await reads.scope(input.cwd);
      const pr = await reads.pull(context, input.prNumber);
      if (pr.state !== "OPEN" || pr.draft)
        throw new BitbucketError(
          "invalid",
          "Only an open, non-draft Bitbucket pull request can be merged.",
        );
      const raw = await context.http.request(
        "POST",
        `${context.path}/pullrequests/${pr.id}/merge`,
        {
          merge_strategy: input.mergeMethod === "merge" ? "merge_commit" : "squash",
          close_source_branch: false,
        },
      );
      reads.invalidate();
      const merged = PullRequest.safeParse(raw);
      if (!merged.success || merged.data.state !== "MERGED")
        throw new BitbucketError(
          "uncertain",
          "Bitbucket has not confirmed a completed merge. Refresh its remote state before trying again.",
        );
      return { success: true };
    },
    async enablePullRequestAutoMerge() {
      return unsupported();
    },
    async disablePullRequestAutoMerge() {
      return unsupported();
    },
    authProbeCanThrow: true,
    async isAuthenticated(input) {
      try {
        await reads.read(input.cwd, "access", input, async (context) =>
          context.http.request("GET", context.path),
        );
        return true;
      } catch (error) {
        if (error instanceof BitbucketError && error.kind === "credentials")
          throw new ForgeAuthenticationError(error.message, { stderr: error.message });
        throw error;
      }
    },
    async setThreadResolved(input) {
      const context = await reads.scope(input.cwd);
      await context.http.request(
        input.resolved ? "POST" : "DELETE",
        `${context.path}/pullrequests/${bitbucketNumber(input.number)}/comments/${bitbucketNumber(input.commentId)}/resolve`,
      );
      reads.invalidate();
    },
    retainCurrentPullRequestStatusPoll: polls.retain,
    invalidate() {
      reads.invalidate();
      polls.invalidate();
    },
    dispose() {
      polls.dispose();
      reads.dispose();
    },
  };
  return service;
}
