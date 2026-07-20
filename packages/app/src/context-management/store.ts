import { create } from "zustand";
import type { ContextReport } from "@otto-code/protocol/messages";

/**
 * Client-side state for Context Management.
 *
 * Reports are keyed by `serverId:workspaceId` because context health is a
 * property of the workspace and its provider, not of a chat — every tab in a
 * project sees the same answer, and dismissing it once must silence all of
 * them.
 *
 * Dismissal copies the rate-limit track's mute-with-key idea rather than a
 * permanent hide: a dismissal is bound to how bad things were, so the warning
 * stays gone until context grows past the next bucket, and comes back on its
 * own after a while.
 */

/** Long, because context bloat is important but never urgent. */
export const CONTEXT_MUTE_MS = 8 * 60 * 60 * 1000;

export interface ContextDismissal {
  key: string;
  mutedUntil: number;
}

export function contextWorkspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

/**
 * Buckets the report so a dismissal survives noise but not growth. Five-point
 * bands mean a file creeping from 26% to 31% of the window breaks through,
 * while re-scans that jitter by a few hundred tokens do not.
 */
export function contextDismissKey(report: ContextReport): string {
  const share = report.windowTokens > 0 ? (report.fixedTotal / report.windowTokens) * 100 : 0;
  return `${report.aggregateSeverity}:${Math.floor(share / 5)}`;
}

interface ContextManagementState {
  reports: Record<string, ContextReport | null>;
  dismissals: Record<string, ContextDismissal>;
  setReport: (serverId: string, workspaceId: string, report: ContextReport | null) => void;
  dismiss: (serverId: string, workspaceId: string, report: ContextReport) => void;
  clearServer: (serverId: string) => void;
}

export const useContextManagementStore = create<ContextManagementState>((set) => ({
  reports: {},
  dismissals: {},

  setReport: (serverId, workspaceId, report) => {
    set((prev) => ({
      ...prev,
      reports: { ...prev.reports, [contextWorkspaceKey(serverId, workspaceId)]: report },
    }));
  },

  dismiss: (serverId, workspaceId, report) => {
    set((prev) => ({
      ...prev,
      dismissals: {
        ...prev.dismissals,
        [contextWorkspaceKey(serverId, workspaceId)]: {
          key: contextDismissKey(report),
          mutedUntil: Date.now() + CONTEXT_MUTE_MS,
        },
      },
    }));
  },

  clearServer: (serverId) => {
    set((prev) => {
      const prefix = `${serverId}:`;
      const reports = { ...prev.reports };
      const dismissals = { ...prev.dismissals };
      for (const key of Object.keys(reports)) {
        if (key.startsWith(prefix)) delete reports[key];
      }
      for (const key of Object.keys(dismissals)) {
        if (key.startsWith(prefix)) delete dismissals[key];
      }
      return { ...prev, reports, dismissals };
    });
  },
}));

/**
 * Computed against `Date.now()` at call time — callers must re-render at
 * `mutedUntil` themselves, since nothing else will wake them.
 */
export function isContextWarningMuted(
  dismissal: ContextDismissal | undefined,
  report: ContextReport | null,
): boolean {
  if (!dismissal || !report) return false;
  return dismissal.key === contextDismissKey(report) && Date.now() < dismissal.mutedUntil;
}
