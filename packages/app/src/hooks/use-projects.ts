import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { projectsQueryKey } from "@/query/host-aggregate-query-keys";
import type { ProjectSummary } from "@/utils/projects";
import {
  fetchAggregatedProjects,
  type ProjectHostError,
  type ProjectsHostInput,
} from "@/projects/aggregated-projects";

export type {
  ProjectHostError,
  ProjectsHostInput,
  ProjectsRuntime,
} from "@/projects/aggregated-projects";

export { projectsQueryKey } from "@/query/host-aggregate-query-keys";

function projectsQueryRuntimeKey(hosts: readonly ProjectsHostInput[]) {
  return hosts.map((host) => host.serverId).join("|");
}

export interface UseProjectsResult {
  projects: ProjectSummary[];
  hostErrors: ProjectHostError[];
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

export function useProjects(): UseProjectsResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const hostInputs = useMemo<ProjectsHostInput[]>(
    () =>
      hosts.map((host) => ({
        serverId: host.serverId,
        serverName: host.label,
      })),
    [hosts],
  );

  // Freshness is event-driven: the host runtime store invalidates
  // projectsQueryKey whenever a host's online status flips (see
  // invalidateHostAggregateQueries). refetchOnMount overrides the app-wide
  // `refetchOnMount: false` so a query invalidated while no screen was
  // mounted still heals on the next mount.
  const projectsQuery = useQuery({
    queryKey: [...projectsQueryKey, projectsQueryRuntimeKey(hostInputs)] as const,
    queryFn: () => fetchAggregatedProjects({ hosts: hostInputs, runtime }),
    staleTime: 5_000,
    refetchOnMount: true,
  });

  return {
    projects: projectsQuery.data?.projects ?? [],
    hostErrors: projectsQuery.data?.hostErrors ?? [],
    isLoading: projectsQuery.isLoading,
    isFetching: projectsQuery.isFetching,
    refetch: () => {
      void projectsQuery.refetch();
    },
  };
}
