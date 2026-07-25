import type {
  SolutionProjectContents,
  SolutionRef,
  SolutionTree,
} from "@otto-code/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSolutionViewFeature } from "./use-solution-view-feature";

/**
 * The Solution lens's three reads, all lazy in the way the charter's cost policy demands:
 *
 * - **`useSolutionsQuery`** runs for every workspace whose host can serve the feature. That is the
 *   one query that is not conditional, so it is also the one the daemon keeps cheap: a bounded
 *   directory walk, no process. An empty answer means no switcher, and that is the answer for a
 *   workspace with no solution, a host with no .NET SDK, and a host with the switch off alike.
 * - **`useSolutionTreeQuery`** runs only once the user is actually looking at the Solution lens.
 *   This is the first thing that spawns the sidecar.
 * - **`useSolutionProjectQuery`** runs per project, on expand. Fifty projects in a collapsed tree
 *   cost nothing; the one you open costs one evaluation against an already-warm process.
 */

const EMPTY_SOLUTIONS: readonly SolutionRef[] = [];

/**
 * Solutions are added and removed about as often as a repository is restructured, so a long
 * staleness is honest here — and the alternative, re-walking on every mount, spends a directory
 * traversal to learn nothing.
 */
const SOLUTION_LIST_STALE_MS = 5 * 60_000;
/**
 * Shorter, because the daemon's own cache is keyed on the solution file's content identity: a
 * repeat request costs a `stat`, not a re-read. Duplicating that judgement with a long client-side
 * staleness would put the freshness decision in two places.
 */
const SOLUTION_MODEL_STALE_MS = 30_000;

export function solutionListQueryKey(serverId: string, cwd: string): unknown[] {
  return ["solution", "list", serverId, cwd];
}

export function solutionTreeQueryKey(
  serverId: string,
  cwd: string,
  solutionPath: string,
): unknown[] {
  return ["solution", "tree", serverId, cwd, solutionPath];
}

export function solutionProjectQueryKey(
  serverId: string,
  cwd: string,
  solutionPath: string,
  projectPath: string,
): unknown[] {
  return ["solution", "project", serverId, cwd, solutionPath, projectPath];
}

export function useSolutionsQuery(input: { serverId: string; cwd: string; enabled?: boolean }): {
  solutions: readonly SolutionRef[];
  isLoading: boolean;
} {
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  const supported = useSolutionViewFeature(input.serverId);

  const query = useFetchQuery<SolutionRef[]>({
    queryKey: solutionListQueryKey(input.serverId, input.cwd),
    dataShape: "list",
    staleTimeMs: SOLUTION_LIST_STALE_MS,
    enabled:
      supported &&
      client !== null &&
      isConnected &&
      input.cwd.length > 0 &&
      input.enabled !== false,
    queryFn: async () => (client === null ? [] : client.listSolutions(input.cwd)),
  });

  return { solutions: query.data ?? EMPTY_SOLUTIONS, isLoading: query.isLoading };
}

export function useSolutionTreeQuery(input: {
  serverId: string;
  cwd: string;
  solutionPath: string | null;
  enabled: boolean;
}): { tree: SolutionTree | null; isLoading: boolean; error: string | null } {
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  const solutionPath = input.solutionPath;

  const query = useFetchQuery<SolutionTree | null>({
    queryKey: solutionTreeQueryKey(input.serverId, input.cwd, solutionPath ?? ""),
    dataShape: "value",
    staleTimeMs: SOLUTION_MODEL_STALE_MS,
    enabled: input.enabled && client !== null && isConnected && solutionPath !== null,
    queryFn: async () =>
      client === null || solutionPath === null
        ? null
        : client.getSolutionTree({ cwd: input.cwd, solutionPath }),
  });

  return {
    tree: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useSolutionProjectQuery(input: {
  serverId: string;
  cwd: string;
  solutionPath: string | null;
  projectPath: string | null;
  enabled: boolean;
}): { project: SolutionProjectContents | null; isLoading: boolean } {
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  const { solutionPath, projectPath } = input;

  const query = useFetchQuery<SolutionProjectContents | null>({
    queryKey: solutionProjectQueryKey(
      input.serverId,
      input.cwd,
      solutionPath ?? "",
      projectPath ?? "",
    ),
    dataShape: "value",
    staleTimeMs: SOLUTION_MODEL_STALE_MS,
    enabled:
      input.enabled &&
      client !== null &&
      isConnected &&
      solutionPath !== null &&
      projectPath !== null,
    // A `failed` status arrives as data, not an exception: the error belongs on that project's
    // own node, and one project MSBuild refused must not blank the tree.
    queryFn: async () =>
      client === null || solutionPath === null || projectPath === null
        ? null
        : client.loadSolutionProject({ cwd: input.cwd, solutionPath, projectPath }),
  });

  return { project: query.data ?? null, isLoading: query.isLoading };
}
