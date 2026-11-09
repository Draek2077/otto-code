import { useEffect, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  waitViewChanges,
  releaseViewChanges,
  type ViewOrigin,
} from "@getpaseo/plugin/otto/architectural-views";
import { KnowledgeChangeFeed } from "../knowledge/change-feed";
import { useViewClient, unwrapView } from "./data";
import { styles } from "./styles";
const installations = new WeakMap<QueryClient, Map<string, KnowledgeChangeFeed>>();
const noSubscription = () => () => {};
const noError = () => null;
export function ViewChangeLease({
  hostId,
  projectId,
  origin,
  active,
}: {
  hostId: string;
  projectId: string;
  origin: ViewOrigin;
  active: boolean;
}) {
  const client = useViewClient(hostId),
    cache = useQueryClient();
  const [feed, setFeed] = useState<KnowledgeChangeFeed | null>(null);
  const { location, storeKey } = origin;
  const key = JSON.stringify([hostId, projectId, origin]);
  useEffect(() => {
    if (!active) {
      setFeed(null);
      return;
    }
    let feeds = installations.get(cache);
    if (!feeds) {
      feeds = new Map();
      installations.set(cache, feeds);
    }
    let current = feeds.get(key);
    if (!current) {
      const owner = feeds;
      current = new KnowledgeChangeFeed({
        wait: async (leaseId, cursor) =>
          unwrapView(
            await client.call(waitViewChanges, {
              scope: { hostId, target: { kind: "project", id: projectId } },
              origin: { location, storeKey },
              leaseId,
              cursor,
            }),
          ),
        release: async (leaseId) => {
          await client.call(releaseViewChanges, { leaseId });
        },
        changed: () => {
          void cache.invalidateQueries({ queryKey: ["ottoViews", hostId] });
        },
        unused: () => owner.delete(key),
        disconnectedMessage:
          "Live View refresh is disconnected. Refresh manually while Otto reconnects.",
      });
      feeds.set(key, current);
    }
    setFeed(current);
    return current.retain();
  }, [client, cache, hostId, projectId, location, storeKey, active, key]);
  const error = useSyncExternalStore(
    feed?.subscribe ?? noSubscription,
    feed?.getSnapshot ?? noError,
  );
  return error ? <Text style={styles.muted}>{error}</Text> : null;
}
