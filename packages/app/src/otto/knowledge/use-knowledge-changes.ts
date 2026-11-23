import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  waitKnowledgeChanges,
  releaseKnowledgeChanges,
} from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeChangeFeed } from "./change-feed";

const installations = new WeakMap<QueryClient, Map<string, KnowledgeChangeFeed>>();
export function useKnowledgeChanges(
  hostId: string,
  projectId: string | undefined,
  active: boolean,
) {
  const cache = useQueryClient();
  const wait = useRpc(waitKnowledgeChanges);
  const release = useRpc(releaseKnowledgeChanges);
  const [feed, setFeed] = useState<KnowledgeChangeFeed | null>(null);
  useEffect(() => {
    if (!projectId || !active) {
      setFeed(null);
      return;
    }
    let feeds = installations.get(cache);
    if (!feeds) {
      feeds = new Map();
      installations.set(cache, feeds);
    }
    const key = JSON.stringify([hostId, projectId]);
    const existing = feeds.get(key);
    if (existing) {
      setFeed(existing);
      return existing.retain();
    }
    const created = new KnowledgeChangeFeed({
      wait: async (leaseId, cursor) => {
        const result = await wait({
          scope: { hostId, target: { kind: "project", id: projectId } },
          leaseId,
          cursor,
        });
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      },
      release: async (leaseId) => {
        await release({ leaseId });
      },
      changed: () => {
        void cache.invalidateQueries({ queryKey: ["ottoKnowledge", hostId] });
      },
      unused: () => {
        if (feeds.get(key) === created) feeds.delete(key);
      },
    });
    feeds.set(key, created);
    setFeed(created);
    return created.retain();
  }, [cache, hostId, projectId, wait, release, active]);
  return useSyncExternalStore(feed?.subscribe ?? noSubscription, feed?.getSnapshot ?? noError);
}
function noSubscription() {
  return () => {};
}
function noError() {
  return null;
}
