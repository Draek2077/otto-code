import type { z } from "zod";
import type { ViewOpenIntent, ViewIdentity } from "@getpaseo/plugin/otto/architectural-views";
import { KnowledgeChangeFeed } from "../knowledge/change-feed";
/** A new lease establishes a baseline; historical intents and reconnects never
 * reopen old tabs. Heartbeats carry no content and cannot trigger navigation. */
export function createViewOpenFeed(ports: {
  wait(leaseId: string, cursor: string | null): Promise<z.infer<typeof ViewOpenIntent>>;
  release(leaseId: string): Promise<void>;
  open(identity: ViewIdentity): void;
  makeId?: () => string;
}) {
  let latest: ViewIdentity | null = null;
  return new KnowledgeChangeFeed({
    wait: async (leaseId, cursor) => {
      const result = await ports.wait(leaseId, cursor);
      latest = cursor !== null && cursor !== result.cursor ? result.identity : null;
      return { cursor: result.cursor, error: null };
    },
    release: ports.release,
    makeId: ports.makeId,
    changed: () => {
      if (latest) ports.open(latest);
      latest = null;
    },
    unused: () => {},
    disconnectedMessage: "Workspace View display requests are disconnected.",
  });
}
