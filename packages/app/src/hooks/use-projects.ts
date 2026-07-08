import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useInvalidateOnHostConnectivityChange } from "@/hooks/use-invalidate-on-host-connectivity";
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

export const projectsQueryKey = ["projects"] as const;

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

  // Refetch when a host's connection status changes — a host coming online
  // must surface its projects, one dropping must surface its host error.
  useInvalidateOnHostConnectivityChange(projectsQueryKey);

  const projectsQuery = useQuery({
    queryKey: [...projectsQueryKey, projectsQueryRuntimeKey(hostInputs)] as const,
    queryFn: () => fetchAggregatedProjects({ hosts: hostInputs, runtime }),
    staleTime: 5_000,
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
