import { useCallback, useEffect, useRef, useState } from "react";
import type { KanbanBoard } from "@otto-code/protocol/kanban";

interface KanbanMoveTarget {
  cardId: string;
  targetColumnId: string;
  targetColumnName: string;
}

export type PendingKanbanMove = KanbanMoveTarget &
  ({ phase: "writing" } | { phase: "refreshing"; refreshingSince: number });

/** Keep a move visible through the provider write and the ensuing board read. */
export function useKanbanMove(
  board: KanbanBoard | null,
  boardError: string | null,
  requestMove: (cardId: string, targetColumnId: string) => Promise<void>,
  onStaleMove: () => void,
) {
  const [pendingMove, setPendingMove] = useState<PendingKanbanMove | null>(null);
  const pendingCardRef = useRef<string | null>(null);

  const performMove = useCallback(
    async (cardId: string, targetColumnId: string) => {
      if (pendingCardRef.current) throw new Error("Wait for the current card move to finish");
      const targetColumnName = board?.columns.find((column) => column.id === targetColumnId)?.name;
      if (!targetColumnName) throw new Error("Target column is unavailable");
      pendingCardRef.current = cardId;
      setPendingMove({ cardId, targetColumnId, targetColumnName, phase: "writing" });
      try {
        await requestMove(cardId, targetColumnId);
        setPendingMove({
          cardId,
          targetColumnId,
          targetColumnName,
          phase: "refreshing",
          refreshingSince: Date.now(),
        });
      } catch (cause) {
        pendingCardRef.current = null;
        setPendingMove(null);
        throw cause;
      }
    },
    [board, requestMove],
  );

  useEffect(() => {
    if (!pendingMove || pendingMove.phase !== "refreshing") return;
    const target = board?.columns.find((column) => column.id === pendingMove.targetColumnId);
    if (target?.cards.some((card) => card.id === pendingMove.cardId) || boardError) {
      pendingCardRef.current = null;
      setPendingMove(null);
      return;
    }
    // A provider can accept the write before its next board read reflects it.
    // Polling can rerender this hook, so measure from the write rather than resetting the timer.
    const remaining = Math.max(0, 45_000 - (Date.now() - pendingMove.refreshingSince));
    const timeout = setTimeout(() => {
      pendingCardRef.current = null;
      setPendingMove(null);
      onStaleMove();
    }, remaining);
    return () => clearTimeout(timeout);
  }, [board, boardError, onStaleMove, pendingMove]);

  return { pendingMove, performMove };
}
