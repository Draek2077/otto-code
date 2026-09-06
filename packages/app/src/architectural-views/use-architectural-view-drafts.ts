import { useCallback, useEffect, useState } from "react";
import type { DaemonClient } from "@otto-code/client";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import type { ArchitecturalViewKnowledgeReference } from "./use-architectural-views";

export type ArchitecturalViewDraft = Extract<
  SessionOutboundMessage,
  { type: "architectural-views.draft.list.response" }
>["payload"]["drafts"][number];

/** Lightweight durable-draft discovery for the selected Knowledge document. */
export function useArchitecturalViewDrafts(
  serverId: string,
  workspaceId: string,
  knowledgeReference: ArchitecturalViewKnowledgeReference | null,
): {
  supported: boolean;
  drafts: ArchitecturalViewDraft[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const daemonSupportsDraftDiscovery = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.architecturalViewDraftDiscovery === true,
  );
  // Fast Refresh preserves the existing client instance. A new app bundle can
  // therefore briefly run against the previous client class, even after the
  // daemon advertises the new capability.
  const supported = daemonSupportsDraftDiscovery && hasDraftDiscoveryMethod(client);
  const [drafts, setDrafts] = useState<ArchitecturalViewDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const referenceKind = knowledgeReference?.kind;
  const referenceId = knowledgeReference?.id;

  useEffect(() => {
    if (!client || !supported || !referenceKind || !referenceId) {
      setDrafts([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .listArchitecturalViewDrafts({
        workspaceId,
        knowledgeReference: { kind: referenceKind, id: referenceId },
      })
      .then((result) => {
        if (cancelled) return undefined;
        if (!result.success) throw new Error(result.error ?? "Could not list Interactive Views.");
        setDrafts(result.drafts);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setDrafts([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, referenceId, referenceKind, refreshRevision, supported, workspaceId]);

  const refresh = useCallback(() => {
    setRefreshRevision((revision) => revision + 1);
  }, []);

  return { supported, drafts, loading, error, refresh };
}

function hasDraftDiscoveryMethod(
  client: DaemonClient | null,
): client is DaemonClient & Pick<DaemonClient, "listArchitecturalViewDrafts"> {
  return typeof client?.listArchitecturalViewDrafts === "function";
}
