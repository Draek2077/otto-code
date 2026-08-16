/**
 * The Kanban screen's body-state machine, isolated from React so it is
 * unit-testable without mounting the component tree (same shape as
 * schedules-screen-state.ts).
 */
export type KanbanScreenBodyState = { kind: "loading" } | { kind: "empty" } | { kind: "picker" };

/**
 * Maps the board-option load state to the body the screen renders.
 * - Loading with nothing fetched yet: spinner.
 * - Nothing loaded and nothing to load: empty state (no hosts / no feature).
 * - Any known board (even mid-refresh): the picker.
 */
export function resolveKanbanScreenBodyState(input: {
  isLoading: boolean;
  boardCount: number;
}): KanbanScreenBodyState {
  if (input.isLoading && input.boardCount === 0) {
    return { kind: "loading" };
  }
  if (input.boardCount === 0) {
    return { kind: "empty" };
  }
  return { kind: "picker" };
}
