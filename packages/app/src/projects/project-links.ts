import { useMemo } from "react";
import type { ProjectLink } from "@otto-code/protocol/messages";
import { useReplicaQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";

/**
 * Project links (the gated-multi-root permission) for one host. A link between
 * two projects lets a user open/edit a file that lives in the other project;
 * without a link, an out-of-project open is refused. Links are undirected and
 * bidirectional — see `docs`/the gated-multi-root project.
 *
 * Cached per host via react-query and kept fresh by the daemon's
 * `project.links.changed` push, mirroring the artifacts notification pattern.
 */
export function projectLinksQueryKey(serverId: string) {
  return ["project-links", serverId] as const;
}

/**
 * Canonical, order-independent key for a pair of project ids. In-memory only
 * (Set membership) — never persisted or sent over the wire. Project ids for
 * local projects are raw filesystem paths that routinely contain spaces, so a
 * plain space-join would let different pairs collide; JSON.stringify of the
 * ordered pair delimits the ids unambiguously. Kept consistent with the
 * daemon's `pairKey` in `packages/server/src/server/project-links.ts`.
 */
export function canonicalLinkKey(projectA: string, projectB: string): string {
  const [a, b] = projectA <= projectB ? [projectA, projectB] : [projectB, projectA];
  return JSON.stringify([a, b]);
}

/** True when the two distinct projects are linked in the given set. */
export function areProjectsLinkedInSet(
  linkSet: ReadonlySet<string>,
  projectA: string,
  projectB: string,
): boolean {
  if (projectA === projectB) {
    return false;
  }
  return linkSet.has(canonicalLinkKey(projectA, projectB));
}

function toLinkSet(links: ProjectLink[]): Set<string> {
  return new Set(links.map((link) => canonicalLinkKey(link.projectAId, link.projectBId)));
}

const EMPTY_LINK_SET: ReadonlySet<string> = new Set<string>();

export interface UseProjectLinkSetResult {
  linkSet: ReadonlySet<string>;
  isLoading: boolean;
}

/**
 * The set of canonical link keys for a host, or an empty set when the host does
 * not advertise the `projectLinks` capability (old daemon → no cross-project
 * access, matching today's this-project-only behavior; no fallback path).
 */
export function useProjectLinkSet(serverId: string): UseProjectLinkSetResult {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supported = useHostFeature(serverId, "projectLinks");

  // Replica of the host's link set: fetched once, then kept fresh by the
  // daemon's `project.links.changed` push (handled by the replica infra).
  const query = useReplicaQuery<ProjectLink[]>({
    queryKey: projectLinksQueryKey(serverId),
    queryFn: async () => {
      if (!client) {
        return [];
      }
      return client.listProjectLinks();
    },
    enabled: supported && client !== null,
    pushEvent: "project.links.changed",
  });

  const linkSet = useMemo(() => {
    if (!supported || !query.data) {
      return EMPTY_LINK_SET;
    }
    return toLinkSet(query.data);
  }, [supported, query.data]);

  return { linkSet, isLoading: query.isLoading };
}
