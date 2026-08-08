import { useCallback, useEffect, useMemo, useState } from "react";
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
    kind: "decision" | "constraint" | "requirement" | "architecture" | "project" | "reference";
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
} {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const enabled = useProjectKnowledgeEnabled(serverId);
  const [view, setView] = useState<ProjectKnowledgeListResponseMessage["payload"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
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
    setLoading(true);
    setError(null);
    void client
      .listProjectKnowledge(workspaceId)
      .then((result) => {
        if (!cancelled) setView(result);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, enabled, nonce, workspaceId]);
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
      kind: "decision" | "constraint" | "requirement" | "architecture" | "project" | "reference";
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
    }),
    [
      createProposal,
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
