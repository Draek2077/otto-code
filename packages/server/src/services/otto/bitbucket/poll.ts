import type { CurrentPullRequestStatus, ForgeService } from "../../forge-service.js";
import { BitbucketError } from "./http.js";
type Target = Parameters<NonNullable<ForgeService["retainCurrentPullRequestStatusPoll"]>>[0];
interface Entry {
  input: Target;
  listeners: Set<Target>;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  pending: boolean;
}
/** One sequential demand-owned poll per checkout/head, regardless of UI consumers. */
export function createBitbucketPoller(
  read: (input: Target) => Promise<CurrentPullRequestStatus | null>,
) {
  const entries = new Map<string, Entry>();
  function schedule(entry: Entry, delay: number) {
    entry.timer = setTimeout(() => void run(entry), delay);
    entry.timer.unref();
  }
  async function run(entry: Entry) {
    const authority = entry.generation;
    entry.pending = true;
    entry.timer = null;
    let delay = 60_000;
    try {
      const value = await read(entry.input);
      delay = value?.checksStatus === "pending" ? 30_000 : 180_000;
      if (authority === entry.generation)
        for (const listener of entry.listeners) listener.onStatus?.(value);
    } catch (error) {
      if (authority === entry.generation)
        for (const listener of entry.listeners) listener.onError?.(error);
    } finally {
      entry.pending = false;
      if (entry.listeners.size > 0) schedule(entry, authority === entry.generation ? delay : 0);
    }
  }
  return {
    retain(input: Target) {
      const key = JSON.stringify([
        input.cwd,
        input.headRef,
        input.headSha,
        input.headRepositoryOwner,
      ]);
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= 128)
          throw new BitbucketError(
            "unavailable",
            "Too many active Bitbucket checkout observers. Close an unused checkout first.",
          );
        entry = { input, listeners: new Set(), generation: 0, timer: null, pending: false };
        entries.set(key, entry);
      }
      const owned = entry;
      const listener = { ...input };
      owned.listeners.add(listener);
      if (!owned.pending && !owned.timer) schedule(owned, 0);
      let released = false;
      return {
        unsubscribe() {
          if (released) return;
          released = true;
          owned.listeners.delete(listener);
          if (owned.listeners.size) return;
          owned.generation++;
          if (owned.timer) clearTimeout(owned.timer);
          if (entries.get(key) === owned) entries.delete(key);
        },
      };
    },
    invalidate() {
      for (const entry of entries.values()) {
        entry.generation++;
        if (entry.timer) clearTimeout(entry.timer);
        if (!entry.pending) schedule(entry, 0);
      }
    },
    dispose() {
      for (const entry of entries.values()) {
        entry.generation++;
        entry.listeners.clear();
        if (entry.timer) clearTimeout(entry.timer);
      }
      entries.clear();
    },
  };
}
