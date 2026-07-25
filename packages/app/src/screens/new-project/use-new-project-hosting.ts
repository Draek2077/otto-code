import { useMemo } from "react";
import type { HostingOwnerSummary, HostingRepositorySummary } from "@otto-code/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

// Host-level git-hosting reads the New project page needs before any repository
// exists on disk: which providers are usable, who you can create a repo under,
// and what you could clone. Split out of the screen so the screen renders and
// dispatches rather than orchestrating three async sources.

// Providers Otto can create a remote repository on. Bitbucket Cloud has no
// implicit "authenticated user's namespace" — the workspace is part of the REST
// path — so it is the one provider that must be given an owner up front.
export const REMOTE_CAPABLE_PROVIDERS = ["github", "bitbucket-cloud"] as const;
export const PROVIDERS_REQUIRING_OWNER = ["bitbucket-cloud"] as const;

export type RemoteCapableProvider = (typeof REMOTE_CAPABLE_PROVIDERS)[number];

export function isRemoteCapableProvider(value: string | null): value is RemoteCapableProvider {
  return REMOTE_CAPABLE_PROVIDERS.includes(value as RemoteCapableProvider);
}

const PROVIDER_STALE_MS = 60_000;

export interface NewProjectHosting {
  canScaffold: boolean;
  connectedProviders: string[];
  owners: HostingOwnerSummary[];
  ownersLoading: boolean;
  repositories: HostingRepositorySummary[];
  repositoriesLoading: boolean;
}

export function useNewProjectHosting(input: {
  serverId: string;
  provider: string | null;
  wantsOwners: boolean;
  wantsRepositories: boolean;
}): NewProjectHosting {
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);

  const canScaffold = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.projectScaffold === true,
  );
  const hasGitProviders = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.gitHostingProviders === true,
  );

  // A provider the user has not signed into is hidden rather than offered and
  // then failed at create time.
  const connectedQuery = useFetchQuery({
    dataShape: "list",
    staleTimeMs: PROVIDER_STALE_MS,
    queryKey: ["new-project-connected-providers", input.serverId],
    queryFn: async () => {
      if (!client) return [];
      const results = await Promise.all(
        REMOTE_CAPABLE_PROVIDERS.map(async (provider) => {
          const status = await client
            .getHostingAuthStatus({ provider })
            .catch(() => ({ authenticated: false }));
          return status.authenticated ? provider : null;
        }),
      );
      return results.filter((provider) => provider !== null);
    },
    enabled: Boolean(client) && isConnected && hasGitProviders,
    retry: false,
  });

  const ownersQuery = useFetchQuery({
    dataShape: "list",
    staleTimeMs: PROVIDER_STALE_MS,
    queryKey: ["new-project-owners", input.serverId, input.provider],
    queryFn: async () => {
      if (!client || !isRemoteCapableProvider(input.provider)) return [];
      const payload = await client.listHostingOwners({ provider: input.provider });
      return payload.owners;
    },
    enabled:
      Boolean(client) &&
      isConnected &&
      input.wantsOwners &&
      isRemoteCapableProvider(input.provider),
    retry: false,
  });

  const repositoriesQuery = useFetchQuery({
    dataShape: "list",
    staleTimeMs: PROVIDER_STALE_MS,
    queryKey: ["new-project-repositories", input.serverId, input.provider],
    queryFn: async () => {
      if (!client || !isRemoteCapableProvider(input.provider)) return [];
      const payload = await client.listHostingRepositories({
        provider: input.provider,
        limit: 100,
      });
      return payload.repositories;
    },
    enabled:
      Boolean(client) &&
      isConnected &&
      input.wantsRepositories &&
      isRemoteCapableProvider(input.provider),
    retry: false,
  });

  const connectedProviders = useMemo(() => connectedQuery.data ?? [], [connectedQuery.data]);
  const owners = useMemo(() => ownersQuery.data ?? [], [ownersQuery.data]);
  const repositories = useMemo(() => repositoriesQuery.data ?? [], [repositoriesQuery.data]);

  return {
    canScaffold,
    connectedProviders,
    owners,
    ownersLoading: ownersQuery.isFetching,
    repositories,
    repositoriesLoading: repositoriesQuery.isFetching,
  };
}
