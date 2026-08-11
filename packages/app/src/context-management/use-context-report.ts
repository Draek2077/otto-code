import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ContextReport } from "@otto-code/protocol/messages";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useSessionStore } from "@/stores/session-store";
import { contextQueryKey, contextWorkspaceKey, useContextManagementStore } from "./store";

/**
 * Two ways to read the report, deliberately kept apart:
 *
 * - `useWorkspaceContextReport` - the pushed baseline for this workspace's real
 *   provider and model. The composer warning uses this and nothing else.
 * - `useContextReportQuery` - a what-if fetch with explicit provider/window
 *   overrides, owned by the Context Management tab. Its answers are cached
 *   under their own keys and never overwrite the baseline, so playing with the
 *   window picker cannot change what the warning says.
 *
 * Both cache into the store rather than component state. A scan costs a
 * filesystem walk of every context file, so an answer that has already been
 * paid for must survive the tab closing - the alternative is what this used to
 * do: blank the tab on every open and re-scan from scratch.
 */

/**
 * Both gates must pass: the daemon has to be able to resolve the graph at all
 * (no client-side fallback exists - only the daemon can see the files), and the
 * user has to have left the feature on.
 */
export function useContextManagementEnabled(serverId: string): boolean {
  const daemonSupports = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.contextManagement === true,
  );
  const featureEnabled = useFeatureEnabled("contextManagement");
  return daemonSupports && featureEnabled;
}

export function useWorkspaceContextReport(
  serverId: string,
  workspaceId: string | null,
): ContextReport | null {
  const key = workspaceId ? `${serverId}:${workspaceId}` : null;
  const report = useContextManagementStore((state) => (key ? (state.reports[key] ?? null) : null));
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const setReport = useContextManagementStore((state) => state.setReport);
  const enabled = useContextManagementEnabled(serverId);

  // Prime once per workspace; afterwards context_report_changed keeps it fresh.
  const primedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !client || !workspaceId || !key) return;
    if (primedRef.current === key) return;
    primedRef.current = key;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await client.requestContextReport({ workspaceId });
        if (!cancelled) setReport(serverId, workspaceId, payload.report);
      } catch {
        // A failed prime is not worth surfacing: the tab reports its own errors,
        // and a warning that never appears is the safe direction to fail.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, client, serverId, workspaceId, key, setReport]);

  return report;
}

export interface ContextReportQueryOptions {
  provider?: string | undefined;
  windowTokens?: number | undefined;
  /**
   * Evaluate as if this personality were running here - its injected memory
   * brief joins the fixed weight. Omitted = the personality-agnostic report.
   */
  personalityId?: string | undefined;
}

export interface ContextReportQueryResult {
  report: ContextReport | null;
  /** No report to show at all and a scan is running - the only blank state. */
  isLoading: boolean;
  /** A scan is running over a report already on screen. Never blanks the tab. */
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Coalesces identical scans across every caller in the app. Two panes on the
 * same workspace, and the throwaway request the tab fires before persisted
 * settings hydrate, all used to cost a separate filesystem walk each.
 */
const inFlight = new Map<string, Promise<ContextReport | null>>();
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

function isRetryableHostWait(cause: unknown): boolean {
  return cause instanceof Error && /timeout|timed out/i.test(cause.message);
}

function retryAfterHostWait(
  attemptRef: { current: number },
  retry: () => void,
): ReturnType<typeof setTimeout> {
  const delay = RETRY_DELAYS_MS[Math.min(attemptRef.current, RETRY_DELAYS_MS.length - 1)];
  attemptRef.current += 1;
  return setTimeout(retry, delay);
}

function fetchReport(params: {
  key: string;
  client: DaemonClient;
  workspaceId: string;
  provider: string | undefined;
  windowTokens: number | undefined;
  personalityId: string | undefined;
  force: boolean;
}): Promise<ContextReport | null> {
  const { key, client, workspaceId, provider, windowTokens, personalityId, force } = params;
  // A forced refresh follows a write, so joining a scan that started before the
  // write would hand back the state it was meant to replace.
  if (!force) {
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const request = client
    .requestContextReport({
      workspaceId,
      ...(provider ? { provider } : {}),
      ...(typeof windowTokens === "number" ? { windowTokens } : {}),
      ...(personalityId ? { personalityId } : {}),
    })
    .then((payload) => payload.report)
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

export function useContextReportQuery(
  serverId: string,
  workspaceId: string | null,
  options: ContextReportQueryOptions,
): ContextReportQueryResult {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const { provider, windowTokens, personalityId } = options;

  const key = workspaceId
    ? contextQueryKey({ serverId, workspaceId, provider, windowTokens, personalityId })
    : null;

  // The report lives in the store, not in component state: closing the tab must
  // not throw away an answer that cost a filesystem scan to get. `undefined`
  // means never answered; a stored `null` is a real answer ("this workspace has
  // no report"), and must not be papered over with the previous one.
  const cached = useContextManagementStore((state) => (key ? state.queryReports[key] : undefined));
  const setQueryReport = useContextManagementStore((state) => state.setQueryReport);

  // The pushed baseline is the same answer whenever it was evaluated against the
  // same window, so a workspace the composer already primed opens instantly even
  // the very first time the tab is used.
  const baseline = useContextManagementStore((state) =>
    workspaceId ? (state.reports[contextWorkspaceKey(serverId, workspaceId)] ?? null) : null,
  );
  // The pushed baseline is personality-agnostic, so it can only seed a query
  // that is too: seeding a personality-scoped view with it would show numbers
  // missing that personality's memory under that personality's name.
  const usableBaseline =
    !provider &&
    !personalityId &&
    baseline &&
    (windowTokens === undefined || baseline.windowTokens === windowTokens)
      ? baseline
      : null;
  const seed = cached === undefined ? usableBaseline : cached;

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const retryAttemptRef = useRef(0);

  // Only the run a `refresh()` triggered may bypass the in-flight cache; every
  // other run (a window change, a re-mount) is happy to join a scan already
  // going. The flag is consumed on read so it cannot leak into later runs.
  const forceRef = useRef(false);
  const refresh = useCallback(() => {
    forceRef.current = true;
    setNonce((value) => value + 1);
  }, []);
  const retry = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!client || !workspaceId || !key) return;
    const force = forceRef.current;
    forceRef.current = false;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setScanning(true);
    setError(null);
    void (async () => {
      try {
        const report = await fetchReport({
          key,
          client,
          workspaceId,
          provider,
          windowTokens,
          personalityId,
          force,
        });
        if (cancelled) return;
        setQueryReport({ serverId, key, report });
        retryAttemptRef.current = 0;
        setScanning(false);
      } catch (cause) {
        if (cancelled) return;
        if (isRetryableHostWait(cause)) {
          retryTimer = retryAfterHostWait(retryAttemptRef, () => {
            if (!cancelled) retry();
          });
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
        setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    client,
    serverId,
    workspaceId,
    key,
    provider,
    windowTokens,
    personalityId,
    nonce,
    retry,
    setQueryReport,
  ]);

  return useMemo(
    () => ({
      report: seed,
      isLoading: scanning && !seed,
      isRefreshing: scanning && seed != null,
      error,
      refresh,
    }),
    [seed, scanning, error, refresh],
  );
}
