import type { ConfirmDialogInput, ConfirmDialogResult } from "@/utils/confirm-dialog";

/** Wire errorCode the daemon returns when a visible workspace already backs the cwd. */
export const WORKSPACE_DIRECTORY_OCCUPIED_CODE = "workspace_directory_occupied";

/**
 * Thrown instead of a bare `Error` when `workspace.create` is refused because the
 * directory is occupied, so the submit handler can offer a way forward rather
 * than surfacing a dead-end toast. Carries the directory because the occupying
 * workspace is resolved client-side (it is visible, so it is already in the
 * sidebar list) — the daemon does not send its id.
 */
export class WorkspaceDirectoryOccupiedClientError extends Error {
  readonly sourceDirectory: string;

  constructor(message: string, sourceDirectory: string) {
    super(message);
    this.name = "WorkspaceDirectoryOccupiedClientError";
    this.sourceDirectory = sourceDirectory;
  }
}

export function isWorkspaceDirectoryOccupiedError(
  error: unknown,
): error is WorkspaceDirectoryOccupiedClientError {
  return error instanceof WorkspaceDirectoryOccupiedClientError;
}

export interface OccupiedDirectorySteerLabels {
  title: string;
  openExisting: string;
  createWorktree: string;
}

export interface RunOccupiedDirectorySteerInput {
  error: WorkspaceDirectoryOccupiedClientError;
  labels: OccupiedDirectorySteerLabels;
  /** Resolves the visible workspace already backing `sourceDirectory`, if known. */
  findExistingWorkspaceId: (directory: string) => string | null;
  confirm: (input: ConfirmDialogInput) => Promise<ConfirmDialogResult>;
  openWorkspace: (workspaceId: string) => void;
  /** Re-runs creation forcing worktree isolation. */
  createWorktreeInstead: () => Promise<void>;
  /** Fallback surface when there is nothing to steer to, and for retry failures. */
  onError: (message: string) => void;
}

export type OccupiedDirectorySteerOutcome =
  | "opened_existing"
  | "created_worktree"
  | "cancelled"
  | "unresolved";

/**
 * One directory is one live workspace, so the daemon refuses a second visible
 * workspace on an occupied one. Refusing is right; refusing *silently* is not —
 * without this the user gets the daemon's message and no way to act on it, which
 * is why every internal caller grew its own reuse workaround instead.
 *
 * Offers the two things they actually meant: open the workspace that is already
 * there, or take the worktree that gives them the independent branch they were
 * implicitly asking for. Falls back to the plain error only when the occupying
 * workspace cannot be resolved, since there is nothing to open in that case.
 */
export async function runOccupiedDirectorySteer(
  input: RunOccupiedDirectorySteerInput,
): Promise<OccupiedDirectorySteerOutcome> {
  const existingWorkspaceId = input.findExistingWorkspaceId(input.error.sourceDirectory);
  if (!existingWorkspaceId) {
    input.onError(input.error.message);
    return "unresolved";
  }

  const result = await input.confirm({
    title: input.labels.title,
    message: input.error.message,
    confirmLabel: input.labels.openExisting,
    alternateLabel: input.labels.createWorktree,
  });

  if (result.choice === "confirm") {
    input.openWorkspace(existingWorkspaceId);
    return "opened_existing";
  }

  if (result.choice === "alternate") {
    try {
      await input.createWorktreeInstead();
      return "created_worktree";
    } catch (error) {
      input.onError(error instanceof Error ? error.message : String(error));
      return "unresolved";
    }
  }

  return "cancelled";
}
