import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectKnowledgeListResponseMessage } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";

export type ProjectDeliveryStatus =
  | "charter"
  | "in_build"
  | "partial"
  | "blocked"
  | "complete"
  | "reference"
  | "deferred"
  | "cancelled";
export type ProjectReferenceDisposition =
  | "unevaluated"
  | "read"
  | "adopted"
  | "rejected"
  | "dependency";

export function useProjectKnowledgeEnabled(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.projectKnowledge === true,
  );
}

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

export function useProjectKnowledge(
  serverId: string,
  workspaceId: string,
): {
  view: ProjectKnowledgeListResponseMessage["payload"] | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  readRecord: (
    id: string,
  ) => Promise<ProjectKnowledgeListResponseMessage["payload"]["records"][number] | null>;
  setStatus: (
    id: string,
    status: "proposed" | "confirmed" | "superseded",
  ) => Promise<string | null>;
  createProposal: (input: {
    kind:
      | "decision"
      | "constraint"
      | "requirement"
      | "architecture"
      | "finding"
      | "project"
      | "reference";
    title: string;
    statement: string;
    evidence?: string;
    tags?: string[];
    deliveryStatus?: ProjectDeliveryStatus;
    progress?: { completed: number; total: number; unit: string };
    referenceDisposition?: ProjectReferenceDisposition;
    sourceUrl?: string;
  }) => Promise<string | null>;
  updateProject: (input: {
    id: string;
    deliveryStatus: ProjectDeliveryStatus;
    progress?: { completed: number; total: number; unit: string } | null;
    reason: string;
    expectedUpdatedAt: string;
  }) => Promise<string | null>;
  updateReference: (input: {
    id: string;
    disposition: ProjectReferenceDisposition;
    sourceUrl?: string | null;
    reason: string;
    expectedUpdatedAt: string;
  }) => Promise<string | null>;
  updateTruth: (input: {
    id: string;
    statement: string;
    reason: string;
    expectedUpdatedAt: string;
  }) => Promise<string | null>;
  deleteRecord: (input: { id: string; expectedUpdatedAt: string }) => Promise<string | null>;
} {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const enabled = useProjectKnowledgeEnabled(serverId);
  const [view, setView] = useState<ProjectKnowledgeListResponseMessage["payload"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const retryAttemptRef = useRef(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const readRecord = useCallback(
    async (id: string) => {
      if (!client) return null;
      const result = await client.getProjectKnowledge({ workspaceId, id });
      return result.record;
    },
    [client, workspaceId],
  );
  useEffect(() => {
    if (!client || !enabled) {
      setView(null);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    setError(null);
    void client
      .listProjectKnowledge(workspaceId)
      .then((result) => {
        if (!cancelled) {
          retryAttemptRef.current = 0;
          setView(result);
        }
        return undefined;
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (isRetryableHostWait(cause)) {
          retryTimer = retryAfterHostWait(retryAttemptRef, () => {
            if (!cancelled) reload();
          });
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled && !retryTimer) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [client, enabled, nonce, reload, workspaceId]);
  const setStatus = useCallback(
    async (id: string, status: "proposed" | "confirmed" | "superseded") => {
      if (!client) return "Not connected.";
      try {
        await client.setProjectKnowledgeStatus({ workspaceId, id, status });
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, reload, workspaceId],
  );
  const createProposal = useCallback(
    async (input: {
      kind:
        | "decision"
        | "constraint"
        | "requirement"
        | "architecture"
        | "finding"
        | "project"
        | "reference";
      title: string;
      statement: string;
      evidence?: string;
      tags?: string[];
      deliveryStatus?: ProjectDeliveryStatus;
      progress?: { completed: number; total: number; unit: string };
      referenceDisposition?: ProjectReferenceDisposition;
      sourceUrl?: string;
    }) => {
      if (!client) return "Not connected.";
      try {
        await client.createProjectKnowledge({ workspaceId, ...input });
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, reload, workspaceId],
  );
  const updateTruth = useCallback(
    async (input: { id: string; statement: string; reason: string; expectedUpdatedAt: string }) => {
      if (!client) return "Not connected.";
      try {
        const result = await client.applyProjectKnowledge({
          workspaceId,
          id: input.id,
          statement: input.statement,
          provenanceText: input.reason,
          expectedUpdatedAt: input.expectedUpdatedAt,
        });
        if (result.error) return result.error;
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, reload, workspaceId],
  );
  const updateProject = useCallback(
    async (input: {
      id: string;
      deliveryStatus: ProjectDeliveryStatus;
      progress?: { completed: number; total: number; unit: string } | null;
      reason: string;
      expectedUpdatedAt: string;
    }) => {
      if (!client) return "Not connected.";
      try {
        const result = await client.applyProjectKnowledgeProject({ workspaceId, ...input });
        if (result.error) return result.error;
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, reload, workspaceId],
  );
  const updateReference = useCallback(
    async (input: {
      id: string;
      disposition: ProjectReferenceDisposition;
      sourceUrl?: string | null;
      reason: string;
      expectedUpdatedAt: string;
    }) => {
      if (!client) return "Not connected.";
      try {
        const result = await client.applyProjectKnowledgeReference({ workspaceId, ...input });
        if (result.error) return result.error;
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, reload, workspaceId],
  );
  const deleteRecord = useCallback(
    async (input: { id: string; expectedUpdatedAt: string }) => {
      if (!client) return "Not connected.";
      try {
        const result = await client.deleteProjectKnowledge({
          workspaceId,
          id: input.id,
          reason: "Deleted through Manage knowledge.",
          expectedUpdatedAt: input.expectedUpdatedAt,
        });
        if (result.error) return result.error;
        if (!result.deleted) return "Project knowledge was not deleted.";
        reload();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    [client, reload, workspaceId],
  );
  return useMemo(
    () => ({
      view,
      loading,
      error,
      reload,
      readRecord,
      setStatus,
      createProposal,
      updateTruth,
      updateProject,
      updateReference,
      deleteRecord,
    }),
    [
      createProposal,
      deleteRecord,
      error,
      loading,
      reload,
      readRecord,
      setStatus,
      updateProject,
      updateReference,
      updateTruth,
      view,
    ],
  );
}
