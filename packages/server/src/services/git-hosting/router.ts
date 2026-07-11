import type { GitHubService } from "../github-service.js";
import type { GitHostingResolver } from "./resolver.js";
import { GitHostingCredentialsMissingError } from "./types.js";

// A GitHubService-shaped facade that routes every call to the provider the
// target directory's project selects. Every method on the service interface
// already carries a cwd, so existing consumers (session, checkout,
// auto-archive, agent tools) become multi-provider by swapping the singleton
// injection for this router — no per-call-site changes.
export function createGitHostingRouter(resolver: GitHostingResolver): GitHubService {
  async function serviceFor(cwd: string) {
    const resolved = await resolver.resolveForCwd(cwd);
    if (!resolved.service) {
      throw new GitHostingCredentialsMissingError(resolved.providerId);
    }
    return resolved.service;
  }

  return {
    async listPullRequests(input) {
      return (await serviceFor(input.cwd)).listPullRequests(input);
    },

    async listIssues(input) {
      return (await serviceFor(input.cwd)).listIssues(input);
    },

    async getPullRequest(input) {
      return (await serviceFor(input.cwd)).getPullRequest(input);
    },

    async getPullRequestHeadRef(input) {
      return (await serviceFor(input.cwd)).getPullRequestHeadRef(input);
    },

    async getPullRequestCheckoutTarget(input) {
      const service = await serviceFor(input.cwd);
      if (!service.getPullRequestCheckoutTarget) {
        throw new Error("Pull request checkout targets are not supported by this provider");
      }
      return service.getPullRequestCheckoutTarget(input);
    },

    async getCurrentPullRequestStatus(input) {
      return (await serviceFor(input.cwd)).getCurrentPullRequestStatus(input);
    },

    async getPullRequestTimeline(input) {
      return (await serviceFor(input.cwd)).getPullRequestTimeline(input);
    },

    async getGitHubCheckDetails(input) {
      return (await serviceFor(input.cwd)).getGitHubCheckDetails(input);
    },

    async searchIssuesAndPrs(input) {
      return (await serviceFor(input.cwd)).searchIssuesAndPrs(input);
    },

    async createPullRequest(input) {
      return (await serviceFor(input.cwd)).createPullRequest(input);
    },

    async mergePullRequest(input) {
      return (await serviceFor(input.cwd)).mergePullRequest(input);
    },

    async enablePullRequestAutoMerge(input) {
      return (await serviceFor(input.cwd)).enablePullRequestAutoMerge(input);
    },

    async disablePullRequestAutoMerge(input) {
      return (await serviceFor(input.cwd)).disablePullRequestAutoMerge(input);
    },

    async isAuthenticated(input) {
      return (await serviceFor(input.cwd)).isAuthenticated(input);
    },

    retainCurrentPullRequestStatusPoll(input) {
      // Resolution is async while retain is sync: subscribe once the provider
      // resolves, and make unsubscribe idempotent across that boundary.
      let inner: { unsubscribe: () => void } | null = null;
      let cancelled = false;
      const subscribe = async () => {
        const resolved = await resolver.resolveForCwd(input.cwd);
        if (cancelled) {
          return;
        }
        if (!resolved.service) {
          input.onError?.(new GitHostingCredentialsMissingError(resolved.providerId));
          return;
        }
        if (!resolved.service.retainCurrentPullRequestStatusPoll) {
          return;
        }
        inner = resolved.service.retainCurrentPullRequestStatusPoll(input);
        if (cancelled) {
          inner.unsubscribe();
        }
      };
      void subscribe().catch((error: unknown) => {
        if (!cancelled) {
          input.onError?.(error);
        }
      });
      return {
        unsubscribe: () => {
          cancelled = true;
          inner?.unsubscribe();
          inner = null;
        },
      };
    },

    invalidate(input) {
      resolver.invalidate(input.cwd);
    },

    dispose() {
      resolver.dispose();
    },
  };
}
