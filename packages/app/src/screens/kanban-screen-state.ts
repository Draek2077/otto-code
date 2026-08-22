/**
 * The Kanban screen's body-state machine, isolated from React so it is
 * unit-testable without mounting the component tree (same shape as
 * schedules-screen-state.ts).
 *
 * The flow the screen renders is: host picker -> project picker (that host's
 * projects) -> board. A project's board is chosen in that project's settings,
 * never on this screen.
 */
export type KanbanScreenBodyState =
  | { kind: "loading" }
  // No connected host advertises the kanban feature.
  | { kind: "no-hosts" }
  // A host is selected but has no projects.
  | { kind: "no-projects" }
  // A project is selected but has no board target configured. Carries what the
  // watermark needs to link into that project's settings.
  | { kind: "unconfigured"; serverId: string; projectId: string }
  // A project is selected and its boards failed to load.
  | { kind: "error"; message: string }
  // Boards are known; render the board picker and the board.
  | { kind: "board" };

/**
 * Chooses a project without surprising someone who has already made a Kanban
 * selection. A workspace-derived preference only supplies the initial project;
 * a valid selection and then the host's first project remain the fallbacks.
 */
export function resolveKanbanProjectSelection(input: {
  selectedProjectId: string | null;
  preferredProjectId: string | null;
  availableProjectIds: readonly string[];
}): string | null {
  if (
    input.selectedProjectId !== null &&
    input.availableProjectIds.includes(input.selectedProjectId)
  ) {
    return input.selectedProjectId;
  }
  if (
    input.preferredProjectId !== null &&
    input.availableProjectIds.includes(input.preferredProjectId)
  ) {
    return input.preferredProjectId;
  }
  return input.availableProjectIds[0] ?? null;
}

/**
 * Maps the selection and board-load state to the body the screen renders.
 * Precedence, in order:
 * - No hosts at all: `no-hosts` (even while loading; there is nothing to wait
 *   for).
 * - Loading with no boards fetched yet: spinner.
 * - Host with no projects, or nothing selected yet: `no-projects`.
 * - Selected project without a configured target: `unconfigured` (carries the
 *   project's ids for the settings link), even if a board fetch also errored.
 * - Boards failed to load: `error`.
 * - Otherwise: the board.
 */
export function resolveKanbanScreenBodyState(input: {
  isLoading: boolean;
  hostCount: number;
  projectCount: number;
  selectedProject: { serverId: string; projectId: string; hasTarget: boolean } | null;
  boardError: string | null;
  boardCount: number;
}): KanbanScreenBodyState {
  if (input.hostCount === 0) {
    return { kind: "no-hosts" };
  }
  if (input.isLoading && input.boardCount === 0) {
    return { kind: "loading" };
  }
  if (input.projectCount === 0) {
    return { kind: "no-projects" };
  }
  if (input.selectedProject === null) {
    return { kind: "no-projects" };
  }
  if (!input.selectedProject.hasTarget) {
    return {
      kind: "unconfigured",
      serverId: input.selectedProject.serverId,
      projectId: input.selectedProject.projectId,
    };
  }
  if (input.boardError) {
    return { kind: "error", message: input.boardError };
  }
  return { kind: "board" };
}
