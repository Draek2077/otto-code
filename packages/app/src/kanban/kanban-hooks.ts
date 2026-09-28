import { useEffect, useState } from "react";
import type {
  KanbanBoard,
  KanbanBoardRef,
  KanbanCardFieldValue,
  KanbanField,
  KanbanRemediation,
} from "@otto-code/protocol/kanban";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/**
 * The single detection point for the Kanban board capability.
 * COMPAT(kanbanBoard): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
 */
export function useKanbanBoardFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.kanbanBoard === true,
  );
}

/** COMPAT(kanbanConnectionScope): added in v0.9.27, remove after 2027-03-27. */
export function useKanbanConnectionScope(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.kanbanConnectionScope === true,
  );
}

/**
 * Live board list for one project. Fetched once per (host, project) pair and
 * re-fetched when refreshKey bumps (the screen's refresh action). The app
 * never picks a provider: it names a project, and the daemon resolves that
 * project's configured target to a provider and a board list.
 */
export function useKanbanBoards(
  serverId: string | null,
  projectId: string | null,
  projectKey: string | null,
  refreshKey: number,
): {
  boards: KanbanBoardRef[];
  isLoading: boolean;
  error: string | null;
  /** The daemon's recovery route for `error`, when it can name one. */
  remediation: KanbanRemediation | null;
} {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useKanbanBoardFeature(serverId ?? "");
  const enabled = Boolean(serverId && projectId && client && isConnected && supported);

  const [boards, setBoards] = useState<KanbanBoardRef[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remediation, setRemediation] = useState<KanbanRemediation | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !client) {
      setBoards([]);
      setIsLoading(false);
      setError(null);
      setRemediation(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setRemediation(null);
    const load = async (): Promise<void> => {
      try {
        // providerId is an inert default: the project-scoped request is
        // authoritative and the daemon overrides it from the resolved target.
        const payload = await client.kanbanListBoards({
          providerId: "github",
          projectId,
          ...(projectKey ? { projectKey } : {}),
        });
        if (cancelled) return;
        setBoards(payload.boards ?? []);
        setError(payload.error);
        setRemediation(payload.remediation ?? null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, projectKey, client, refreshKey]);

  return { boards, isLoading, error, remediation };
}

/**
 * The board snapshot for one (provider, board) pair. The screen re-fetches on
 * refreshKey after every mutation, so a failed move re-renders from the
 * provider's truth rather than a stale optimistic state.
 */
export function useKanbanBoard(
  serverId: string | null,
  providerId: string | null,
  boardId: string | null,
  refreshKey: number,
  projectId: string | null,
): {
  board: KanbanBoard | null;
  fields: KanbanField[];
  cardFields: Record<string, KanbanCardFieldValue[]>;
  canDeleteCards: boolean;
  isLoading: boolean;
  error: string | null;
  remediation: KanbanRemediation | null;
} {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useKanbanBoardFeature(serverId ?? "");
  const enabled = Boolean(serverId && providerId && boardId && client && isConnected && supported);

  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [fields, setFields] = useState<KanbanField[]>([]);
  const [cardFields, setCardFields] = useState<Record<string, KanbanCardFieldValue[]>>({});
  const [canDeleteCards, setCanDeleteCards] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remediation, setRemediation] = useState<KanbanRemediation | null>(null);

  useEffect(() => {
    if (!enabled || !client || !providerId || !boardId) {
      setBoard(null);
      setFields([]);
      setCardFields({});
      setCanDeleteCards(false);
      setIsLoading(false);
      setError(null);
      setRemediation(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setRemediation(null);
    const load = async (): Promise<void> => {
      try {
        const payload = await client.kanbanGetBoard(
          providerId,
          boardId,
          undefined,
          projectId ?? undefined,
        );
        if (cancelled) return;
        setBoard(payload.board);
        setFields(payload.fields ?? []);
        setCardFields(payload.cardFields ?? {});
        setCanDeleteCards(payload.canDeleteCards === true);
        setError(payload.error);
        setRemediation(payload.remediation ?? null);
      } catch (err: unknown) {
        if (cancelled) return;
        setBoard(null);
        setFields([]);
        setCardFields({});
        setCanDeleteCards(false);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, providerId, boardId, projectId, client, refreshKey]);

  return { board, fields, cardFields, canDeleteCards, isLoading, error, remediation };
}
