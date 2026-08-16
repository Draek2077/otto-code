import { useEffect, useState } from "react";
import type { KanbanBoard, KanbanBoardRef } from "@otto-code/protocol/kanban";
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

/**
 * Live board list for one host + provider. Fetched once per (host, provider)
 * pair and re-fetched when refreshKey bumps (the screen's refresh action).
 */
export function useKanbanBoards(
  serverId: string | null,
  providerId: string | null,
  refreshKey: number,
): {
  boards: KanbanBoardRef[];
  isLoading: boolean;
  error: string | null;
} {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useKanbanBoardFeature(serverId ?? "");
  const enabled = Boolean(serverId && providerId && client && isConnected && supported);

  const [boards, setBoards] = useState<KanbanBoardRef[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !providerId || !client) {
      setBoards([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const load = async (): Promise<void> => {
      try {
        const payload = await client.kanbanListBoards(providerId);
        if (cancelled) return;
        setBoards(payload.boards ?? []);
        setError(payload.error);
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
  }, [enabled, providerId, client, refreshKey]);

  return { boards, isLoading, error };
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
): { board: KanbanBoard | null; isLoading: boolean; error: string | null } {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useKanbanBoardFeature(serverId ?? "");
  const enabled = Boolean(serverId && providerId && boardId && client && isConnected && supported);

  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !client || !providerId || !boardId) {
      setBoard(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const load = async (): Promise<void> => {
      try {
        const payload = await client.kanbanGetBoard(providerId, boardId);
        if (cancelled) return;
        setBoard(payload.board);
        setError(payload.error);
      } catch (err: unknown) {
        if (cancelled) return;
        setBoard(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, providerId, boardId, client, refreshKey]);

  return { board, isLoading, error };
}
