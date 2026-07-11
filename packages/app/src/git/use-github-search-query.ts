import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { normalizeGitHostingProviderId } from "@otto-code/protocol/messages";
import type {
  GitHostingProviderId,
  GitHubSearchRequest,
  GitHubSearchResponse,
  HostingSearchRequest,
  HostingSearchResponse,
} from "@otto-code/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";

export const GITHUB_SEARCH_STALE_TIME = 30_000;

// The legacy GitHub payload shape, optionally stamped with the provider that
// actually served the search (present when the daemon has the
// gitHostingProviders feature). All consumers keep reading the legacy fields.
export type GitHubSearchPayload = GitHubSearchResponse["payload"] & {
  provider?: GitHostingProviderId;
};
type HostingSearchPayload = HostingSearchResponse["payload"];

export interface GitHubSearchClient {
  searchGitHub: (
    options: {
      cwd: string;
      query: string;
      limit?: number;
      kinds?: GitHubSearchRequest["kinds"];
    },
    requestId?: string,
  ) => Promise<GitHubSearchResponse["payload"]>;
  // Present on clients built with the gitHostingProviders feature.
  searchHosting?: (
    options: {
      cwd: string;
      query: string;
      limit?: number;
      kinds?: HostingSearchRequest["kinds"];
    },
    requestId?: string,
  ) => Promise<HostingSearchPayload>;
}

interface GitHubSearchQueryInput {
  client: GitHubSearchClient | null;
  serverId: string;
  cwd: string;
  query: string;
  kinds?: GitHubSearchRequest["kinds"];
  enabled: boolean;
  hostDisconnectedMessage?: string;
  // When true the provider-neutral hosting.search RPC is used (daemon resolves
  // the project's provider); callers pass the server_info feature flag.
  hostingSearchEnabled?: boolean;
}

export function githubSearchQueryKey(
  serverId: string,
  cwd: string,
  query: string,
  kinds?: GitHubSearchRequest["kinds"],
) {
  const trimmedQuery = query.trim();
  if (!kinds) {
    return ["github-search", serverId, cwd, trimmedQuery] as const;
  }
  return ["github-search", serverId, cwd, trimmedQuery, [...kinds].sort().join(",")] as const;
}

function toHostingSearchKinds(kinds: GitHubSearchRequest["kinds"]): HostingSearchRequest["kinds"] {
  return kinds?.map((kind) => (kind === "github-issue" ? "issue" : "pr"));
}

function normalizeHostingSearchPayload(payload: HostingSearchPayload): GitHubSearchPayload {
  return {
    items: payload.items,
    githubFeaturesEnabled: payload.featuresEnabled,
    provider: normalizeGitHostingProviderId(payload.provider) ?? undefined,
    error: payload.error,
    requestId: payload.requestId,
  };
}

export function buildGithubSearchQueryOptions(input: GitHubSearchQueryInput) {
  const query = input.query.trim();

  return {
    queryKey: githubSearchQueryKey(input.serverId, input.cwd, query, input.kinds),
    queryFn: async (): Promise<GitHubSearchPayload> => {
      if (!input.client) {
        throw new Error(
          input.hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected"),
        );
      }
      if (input.hostingSearchEnabled && input.client.searchHosting) {
        const request = { cwd: input.cwd, query, limit: 20 };
        const payload = input.kinds
          ? await input.client.searchHosting({
              ...request,
              kinds: toHostingSearchKinds(input.kinds),
            })
          : await input.client.searchHosting(request);
        return normalizeHostingSearchPayload(payload);
      }
      const request = { cwd: input.cwd, query, limit: 20 };
      if (input.kinds) {
        return input.client.searchGitHub({ ...request, kinds: input.kinds });
      }
      return input.client.searchGitHub(request);
    },
    enabled: input.enabled && Boolean(input.client),
    staleTime: GITHUB_SEARCH_STALE_TIME,
  };
}

/**
 * The single detection point for provider-neutral search.
 * COMPAT(gitHostingProviders): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
 */
export function useHostingSearchFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.gitHostingProviders === true,
  );
}

export function useGithubSearchQuery(input: GitHubSearchQueryInput) {
  const { t } = useTranslation();
  const hostingSearchEnabled = useHostingSearchFeature(input.serverId);
  return useQuery(
    buildGithubSearchQueryOptions({
      ...input,
      hostingSearchEnabled: input.hostingSearchEnabled ?? hostingSearchEnabled,
      hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
    }),
  );
}
