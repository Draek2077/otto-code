import type { CodeDefinitionLocation } from "@otto-code/protocol/messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * Every reference to one symbol, with the honesty the daemon's three-valued status buys.
 *
 * `indexing` is the state that matters here and the reason this is a hook rather than a
 * one-shot query. Measured on this repo: for the first ~12 seconds after a language server
 * spawns, `references` returns a *partial* set - 2 hits in 1 file where the truth was 14 in
 * 4 - and the old code reported that as a complete `ok`. The daemon now says `indexing`
 * whenever a bound server is still building its project model, even with results in hand,
 * so this hook shows what it has, marks it provisional, and re-asks until it settles.
 *
 * Polling rather than a push channel because the settle moment is a property of the server,
 * not an event Otto is told about. The interval backs off and the whole thing gives up after
 * a ceiling - a server that never goes idle must not mean a tab that polls forever.
 */

const FIRST_RETRY_MS = 600;
const MAX_RETRY_MS = 4_000;
/** Past this, stop asking and say plainly that it never settled. */
const SETTLE_CEILING_MS = 90_000;

export interface CodeReferencesGroup {
  path: string;
  hits: CodeDefinitionLocation[];
}

export interface CodeReferencesState {
  groups: CodeReferencesGroup[];
  hitCount: number;
  fileCount: number;
  /** First load, nothing to show yet. */
  loading: boolean;
  /**
   * A server is still building its project model, so the list above may be short. The
   * results are real - they are just not all of them yet.
   */
  provisional: boolean;
  /** The project never settled inside the ceiling; the list is final but suspect. */
  gaveUp: boolean;
  /** No language server covers this file, or every one of them failed. */
  unavailable: boolean;
  error: string | null;
  refresh: () => void;
}

/** Hits grouped by file, files alphabetical, hits in position order within each. */
function groupByFile(locations: readonly CodeDefinitionLocation[]): CodeReferencesGroup[] {
  const byPath = new Map<string, CodeDefinitionLocation[]>();
  for (const hit of locations) {
    const existing = byPath.get(hit.path);
    if (existing) {
      existing.push(hit);
    } else {
      byPath.set(hit.path, [hit]);
    }
  }

  return [...byPath.entries()]
    .map(([path, hits]) => ({
      path,
      hits: [...hits].sort((a, b) => a.line - b.line || a.column - b.column),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface UseCodeReferencesInput {
  serverId: string;
  /** Absolute workspace root. */
  cwd: string;
  /** The file the symbol was asked about, as the tab holds it. */
  path: string;
  line: number;
  column: number;
  enabled: boolean;
}

export function useCodeReferences(input: UseCodeReferencesInput): CodeReferencesState {
  const { serverId, cwd, path, line, column, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  const [groups, setGroups] = useState<CodeReferencesGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisional, setProvisional] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled || client === null || cwd.length === 0) {
      return;
    }

    // Every run of this effect owns its own generation. Without it a late reply from the
    // previous position would overwrite the current one's results - the classic async-state
    // bug, and especially easy here because a retry can be seconds behind.
    let cancelled = false;
    let attemptMs = FIRST_RETRY_MS;
    const startedAt = Date.now();

    setLoading(true);
    setGaveUp(false);
    setError(null);

    const ask = async (): Promise<void> => {
      try {
        const result = await client.findCodeReferences({ cwd, path, line, column });
        if (cancelled) {
          return;
        }

        setGroups(groupByFile(result.locations));
        setUnavailable(result.status === "unavailable");
        setError(result.error);
        setLoading(false);

        if (result.status !== "indexing") {
          setProvisional(false);
          return;
        }

        setProvisional(true);
        if (Date.now() - startedAt > SETTLE_CEILING_MS) {
          setGaveUp(true);
          return;
        }
        timerRef.current = setTimeout(() => void ask(), attemptMs);
        attemptMs = Math.min(attemptMs * 2, MAX_RETRY_MS);
      } catch (caught) {
        if (!cancelled) {
          setLoading(false);
          setProvisional(false);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };

    void ask();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [client, column, cwd, enabled, line, path, reloadToken]);

  return {
    groups,
    hitCount: groups.reduce((total, group) => total + group.hits.length, 0),
    fileCount: groups.length,
    loading,
    provisional,
    gaveUp,
    unavailable,
    error,
    refresh,
  };
}
