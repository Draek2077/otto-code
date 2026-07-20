import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextReport } from "@otto-code/protocol/messages";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useSessionStore } from "@/stores/session-store";
import { useContextManagementStore } from "./store";

/**
 * Two ways to read the report, deliberately kept apart:
 *
 * - `useWorkspaceContextReport` — the pushed baseline for this workspace's real
 *   provider and model. The composer warning uses this and nothing else.
 * - `useContextReportQuery` — a what-if fetch with explicit provider/window
 *   overrides, owned by the Context Management tab. Its answers never touch the
 *   shared store, so playing with the window picker cannot change what the
 *   warning says.
 */

/**
 * Both gates must pass: the daemon has to be able to resolve the graph at all
 * (no client-side fallback exists — only the daemon can see the files), and the
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
}

export interface ContextReportQueryResult {
  report: ContextReport | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useContextReportQuery(
  serverId: string,
  workspaceId: string | null,
  options: ContextReportQueryOptions,
): ContextReportQueryResult {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [report, setReport] = useState<ContextReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const { provider, windowTokens } = options;
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!client || !workspaceId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const payload = await client.requestContextReport({
          workspaceId,
          ...(provider ? { provider } : {}),
          ...(typeof windowTokens === "number" ? { windowTokens } : {}),
        });
        if (cancelled) return;
        setReport(payload.report);
        setIsLoading(false);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId, provider, windowTokens, nonce]);

  return useMemo(
    () => ({ report, isLoading, error, refresh }),
    [report, isLoading, error, refresh],
  );
}
