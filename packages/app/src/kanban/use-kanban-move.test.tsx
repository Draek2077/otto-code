/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KanbanBoard, KanbanCard } from "@otto-code/protocol/kanban";
import { useKanbanMove } from "./use-kanban-move";

const card: KanbanCard = {
  id: "card-1",
  title: "Check the move",
  status: "Ready",
  assignees: [],
  rawProviderId: "item-1",
};

function boardWithCard(columnId: "ready" | "done"): KanbanBoard {
  return {
    id: "board-1",
    title: "Board",
    columns: [
      { id: "ready", name: "Ready", cards: columnId === "ready" ? [card] : [] },
      { id: "done", name: "Done", cards: columnId === "done" ? [card] : [] },
    ],
  };
}

describe("useKanbanMove", () => {
  it("keeps the move pending through the provider write and until the board confirms it", async () => {
    let resolveWrite!: () => void;
    const requestMove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const onStaleMove = vi.fn();
    const { result, rerender } = renderHook(
      ({ board }: { board: KanbanBoard }) => useKanbanMove(board, null, requestMove, onStaleMove),
      { initialProps: { board: boardWithCard("ready") } },
    );

    let move!: Promise<void>;
    act(() => {
      move = result.current.performMove(card.id, "done");
    });
    expect(result.current.pendingMove).toMatchObject({
      cardId: card.id,
      targetColumnName: "Done",
      phase: "writing",
    });
    await expect(result.current.performMove(card.id, "done")).rejects.toThrow(/current card move/);
    expect(requestMove).toHaveBeenCalledOnce();

    await act(async () => {
      resolveWrite();
      await move;
    });
    expect(result.current.pendingMove?.phase).toBe("refreshing");

    rerender({ board: boardWithCard("ready") });
    expect(result.current.pendingMove?.phase).toBe("refreshing");
    rerender({ board: boardWithCard("done") });
    expect(result.current.pendingMove).toBeNull();
    expect(onStaleMove).not.toHaveBeenCalled();
  });

  it("clears the pending state when the provider rejects the move", async () => {
    const requestMove = vi.fn(async () => {
      throw new Error("Transition unavailable");
    });
    const { result } = renderHook(() =>
      useKanbanMove(boardWithCard("ready"), null, requestMove, vi.fn()),
    );

    await act(async () => {
      await expect(result.current.performMove(card.id, "done")).rejects.toThrow(
        "Transition unavailable",
      );
    });
    expect(result.current.pendingMove).toBeNull();
  });

  it("does not restart the confirmation timeout when a stale board is polled", async () => {
    vi.useFakeTimers();
    try {
      const onStaleMove = vi.fn();
      const requestMove = vi.fn(async () => undefined);
      const { result, rerender } = renderHook(
        ({ board }: { board: KanbanBoard }) => useKanbanMove(board, null, requestMove, onStaleMove),
        { initialProps: { board: boardWithCard("ready") } },
      );
      await act(async () => {
        await result.current.performMove(card.id, "done");
      });
      expect(result.current.pendingMove?.phase).toBe("refreshing");

      act(() => vi.advanceTimersByTime(30_000));
      rerender({ board: boardWithCard("ready") });
      act(() => vi.advanceTimersByTime(15_000));
      expect(result.current.pendingMove).toBeNull();
      expect(onStaleMove).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
