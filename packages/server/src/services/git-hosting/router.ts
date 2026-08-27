import type { ForgeService } from "../github-service.js";
import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import type { GitHostingResolver } from "./resolver.js";
import { GitHostingCredentialsMissingError, type GitHostingService } from "./types.js";

// A ForgeService-shaped facade that routes every call to the provider the
// target directory's project selects. Every method on the service interface
// already carries a cwd, so existing consumers (session, checkout,
// auto-archive, agent tools) become multi-provider by swapping the singleton
// injection for this router - no per-call-site changes.
export function createGitHostingRouter(resolver: GitHostingResolver): ForgeService {
  return createGitHostingForgeAdapter({
    serviceFor: async (cwd) => serviceFromResolution(await resolver.resolveForCwd(cwd)),
    invalidate: (cwd) => resolver.invalidate(cwd),
    dispose: () => resolver.dispose(),
  });
}

/**
 * Bind a Forge adapter to one configured hosting provider. Bitbucket Cloud is
 * resolved by its Forge id, so it must not re-derive a provider from cwd as the
 * historical cross-provider router does.
 */
export function createGitHostingProviderForgeAdapter(
  resolver: GitHostingResolver,
  providerId: GitHostingProviderId,
): ForgeService {
  return createGitHostingForgeAdapter({
    serviceFor: async () => serviceFromResolution(resolver.resolveForProvider(providerId)),
    invalidate: (cwd) => resolver.invalidate(cwd),
    // The resolver is daemon-owned and shared with the general hosting router.
    // This adapter is an injected Forge binding, not its lifecycle owner.
    dispose: () => {},
  });
}

function serviceFromResolution(resolved: {
  providerId: GitHostingProviderId;
  service: GitHostingService | null;
}): GitHostingService {
  if (!resolved.service) {
    throw new GitHostingCredentialsMissingError(resolved.providerId);
  }
  return resolved.service;
}

function createGitHostingForgeAdapter(options: {
  serviceFor: (cwd: string) => Promise<GitHostingService>;
  invalidate: (cwd: string) => void;
  dispose: () => void;
}): ForgeService {
  const serviceFor = options.serviceFor;

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

    async setPullRequestThreadResolved(input) {
      const service = await serviceFor(input.cwd);
      if (!service.setPullRequestThreadResolved) {
        throw new Error("Pull request thread resolution is not supported by this provider");
      }
      return service.setPullRequestThreadResolved(input);
    },

    async setPullRequestCommentReaction(input) {
      const service = await serviceFor(input.cwd);
      if (!service.setPullRequestCommentReaction) {
        throw new Error("Pull request comment reactions are not supported by this provider");
      }
      return service.setPullRequestCommentReaction(input);
    },

    async getCheckDetails(input) {
      return (await serviceFor(input.cwd)).getCheckDetails(input);
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
        const service = await serviceFor(input.cwd);
        if (cancelled) {
          return;
        }
        if (!service.retainCurrentPullRequestStatusPoll) {
          return;
        }
        inner = service.retainCurrentPullRequestStatusPoll(input);
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
      options.invalidate(input.cwd);
    },

    dispose() {
      options.dispose();
    },
  };
}
