import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentPersonality, PersonalityMemoryEntryPayload } from "@otto-code/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";

/**
 * Reading and editing a personality's accrued lessons.
 *
 * Deliberately not in the context-report store: a report is a per-workspace
 * scan with its own cache keys and its own 15s TTL, while lessons are per
 * personality and change the moment someone edits one. Sharing the cache would
 * mean an edit either waited out a TTL or invalidated a filesystem walk that had
 * nothing to do with it.
 */

/**
 * The daemon must be able to store lessons at all. There is no client-side
 * substitute — storage is daemon-side by definition — so an old daemon simply
 * hides the feature rather than showing an empty version of it.
 */
export function usePersonalityMemoryEnabled(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.personalityMemory === true,
  );
}

/** The host's personality roster, for the selector and the transfer picker. */
export function usePersonalityRoster(serverId: string): readonly AgentPersonality[] {
  const { config } = useDaemonConfig(serverId);
  const personalities = config?.agentPersonalities?.personalities;
  return useMemo(() => personalities ?? EMPTY_ROSTER, [personalities]);
}

const EMPTY_ROSTER: readonly AgentPersonality[] = [];

export interface PersonalityMemoryView {
  personalityId: string;
  personalityName: string;
  enabled: boolean;
  entries: readonly PersonalityMemoryEntryPayload[];
  /** The exact text the daemon injects for this workspace's project. */
  brief: string;
  briefTokens: number;
  briefOmittedCount: number;
  /**
   * The project root the brief was composed for. Lets the list mark a
   * project-scoped lesson that belongs somewhere else — otherwise an empty brief
   * sitting above a list of lessons has no explanation. null when the daemon
   * resolved no project (or predates the field).
   */
  projectRoot: string | null;
}

export interface PersonalityMemoryResult {
  view: PersonalityMemoryView | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  /** Rewrite one lesson. Reloads on success. */
  saveEntry: (input: { entryId: string; text?: string; scope?: string }) => Promise<string | null>;
  /** Forget one lesson. Reloads on success. */
  dropEntry: (entryId: string) => Promise<string | null>;
  /** Add a lesson by hand. Reloads on success. */
  addEntry: (input: { text: string; scope: string }) => Promise<string | null>;
}

/**
 * One personality's lessons, scoped to a workspace so the brief shown is the
 * brief that workspace's agents actually receive. `workspaceId` goes to the
 * daemon rather than a client-resolved path: only the daemon can map a worktree
 * back to the repo whose lessons it shares.
 */
export function usePersonalityMemory(
  serverId: string,
  personalityId: string | null,
  workspaceId: string | null,
): PersonalityMemoryResult {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const enabled = usePersonalityMemoryEnabled(serverId);
  const [view, setView] = useState<PersonalityMemoryView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  // A write followed by a reload must not race the in-flight read it replaced,
  // so the effect drops any answer that arrives after its inputs changed.
  const activeRef = useRef(0);

  useEffect(() => {
    if (!client || !enabled || !personalityId) {
      setView(null);
      setError(null);
      return;
    }
    const generation = activeRef.current + 1;
    activeRef.current = generation;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await client.listPersonalityMemory({
          personalityId,
          ...(workspaceId ? { workspaceId } : {}),
        });
        if (activeRef.current !== generation) return;
        setView({
          personalityId: payload.personalityId,
          personalityName: payload.personalityName,
          enabled: payload.enabled,
          entries: payload.entries,
          brief: payload.brief,
          briefTokens: payload.briefTokens,
          briefOmittedCount: payload.briefOmittedCount ?? 0,
          projectRoot: payload.projectRoot ?? null,
        });
      } catch (cause) {
        if (activeRef.current !== generation) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (activeRef.current === generation) setIsLoading(false);
      }
    })();
  }, [client, enabled, personalityId, workspaceId, nonce]);

  /** Returns an error message, or null on success. */
  const write = useCallback(
    async (input: {
      entryId?: string;
      text?: string;
      scope?: string;
      drop?: boolean;
    }): Promise<string | null> => {
      if (!client || !personalityId) return "Not connected.";
      try {
        // The workspace rides along on every write, not just the reads: a
        // project-scoped lesson has to be bound to the same root the brief
        // filters on, and only the daemon can resolve a worktree back to it.
        const result = await client.updatePersonalityMemory({
          personalityId,
          ...(workspaceId ? { workspaceId } : {}),
          ...input,
        });
        if (!result.ok) return result.error ?? "The change could not be saved.";
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, personalityId, reload, workspaceId],
  );

  const saveEntry = useCallback(
    (input: { entryId: string; text?: string; scope?: string }) => write(input),
    [write],
  );
  const dropEntry = useCallback((entryId: string) => write({ entryId, drop: true }), [write]);
  const addEntry = useCallback((input: { text: string; scope: string }) => write(input), [write]);

  return useMemo(
    () => ({ view, isLoading, error, reload, saveEntry, dropEntry, addEntry }),
    [view, isLoading, error, reload, saveEntry, dropEntry, addEntry],
  );
}

export interface PersonalityMemoryTransfer {
  /**
   * Resolve a deleted personality's lessons. Returns an error message, or null
   * on success. MUST be awaited before the roster write: a failed transfer has
   * to leave both the personality and its lessons intact, and a roster entry
   * deleted first would leave an orphaned store with no owner to hand it to.
   */
  run: (input: {
    fromPersonalityId: string;
    toPersonalityId?: string;
    mode: "transfer" | "delete";
  }) => Promise<string | null>;
}

export function usePersonalityMemoryTransfer(serverId: string): PersonalityMemoryTransfer {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const run = useCallback<PersonalityMemoryTransfer["run"]>(
    async (input) => {
      if (!client) return "Not connected to this host.";
      try {
        const result = await client.transferPersonalityMemory(input);
        return result.ok ? null : (result.error ?? "The lessons could not be moved.");
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client],
  );
  return useMemo(() => ({ run }), [run]);
}

const EMPTY_COUNTS: Record<string, number> = {};

/**
 * Per-personality lesson counts. Used by the selector (to mark who has memory)
 * and by the personality editor's accrual indicator. Refetched on mount rather
 * than pushed: a count that is a few seconds stale costs nothing, and a push
 * would fan a message to every client on every recorded lesson.
 */
export function usePersonalityMemoryCounts(
  serverId: string,
  enabled = true,
): Record<string, number> {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const daemonSupports = usePersonalityMemoryEnabled(serverId);
  const [counts, setCounts] = useState<Record<string, number>>(EMPTY_COUNTS);

  useEffect(() => {
    if (!client || !daemonSupports || !enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await client.getPersonalityMemoryStats();
        if (!cancelled) setCounts(payload.counts);
      } catch {
        // A missing count is cosmetic: the indicator is absent rather than wrong.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, daemonSupports, enabled]);

  return counts;
}
