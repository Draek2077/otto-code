import { describe, expect, test, vi } from "vitest";
import type { ConfirmDialogChoice, ConfirmDialogResult } from "@/utils/confirm-dialog";
import {
  isWorkspaceDirectoryOccupiedError,
  runOccupiedDirectorySteer,
  WorkspaceDirectoryOccupiedClientError,
} from "./new-workspace-occupied-directory";

const LABELS = {
  title: "This folder already has a workspace",
  openExisting: "Open it",
  createWorktree: "Create a worktree",
};

const DIRECTORY = "/repos/otto";

function occupiedError(message = 'This directory already backs the workspace "Qwen Development".') {
  return new WorkspaceDirectoryOccupiedClientError(message, DIRECTORY);
}

function confirmReturning(choice: ConfirmDialogChoice) {
  return vi.fn(
    async (): Promise<ConfirmDialogResult> => ({
      confirmed: choice === "confirm",
      checkboxChecked: false,
      choice,
    }),
  );
}

function harness(overrides: Partial<Parameters<typeof runOccupiedDirectorySteer>[0]> = {}) {
  const openExistingWorkspace = vi.fn(async () => {});
  const createWorktreeInstead = vi.fn(async () => {});
  const onError = vi.fn();
  return {
    openExistingWorkspace,
    createWorktreeInstead,
    onError,
    input: {
      error: occupiedError(),
      labels: LABELS,
      findExistingWorkspaceId: () => "wks_existing",
      confirm: confirmReturning("cancel"),
      openExistingWorkspace,
      createWorktreeInstead,
      onError,
      ...overrides,
    },
  };
}

describe("runOccupiedDirectorySteer", () => {
  test("opens the occupying workspace when the user picks the primary action", async () => {
    const h = harness({ confirm: confirmReturning("confirm") });

    const outcome = await runOccupiedDirectorySteer(h.input);

    expect(outcome).toBe("opened_existing");
    expect(h.openExistingWorkspace).toHaveBeenCalledWith("wks_existing");
    expect(h.createWorktreeInstead).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  test("waits for the replayed submission before reporting the outcome", async () => {
    // The primary action starts the user's chat in the occupying workspace, so it
    // is async. Returning before it settles would strand a failure unreported.
    const order: string[] = [];
    const h = harness({
      confirm: confirmReturning("confirm"),
      openExistingWorkspace: async () => {
        await Promise.resolve();
        order.push("submitted");
      },
    });

    const outcome = await runOccupiedDirectorySteer(h.input);
    order.push("returned");

    expect(outcome).toBe("opened_existing");
    expect(order).toEqual(["submitted", "returned"]);
  });

  test("surfaces a failed replay into the existing workspace", async () => {
    const h = harness({
      confirm: confirmReturning("confirm"),
      openExistingWorkspace: async () => {
        throw new Error("Select a model");
      },
    });

    const outcome = await runOccupiedDirectorySteer(h.input);

    expect(outcome).toBe("unresolved");
    expect(h.onError).toHaveBeenCalledWith("Select a model");
  });

  test("retries as a worktree when the user picks the alternate action", async () => {
    const h = harness({ confirm: confirmReturning("alternate") });

    const outcome = await runOccupiedDirectorySteer(h.input);

    expect(outcome).toBe("created_worktree");
    expect(h.createWorktreeInstead).toHaveBeenCalledTimes(1);
    expect(h.openExistingWorkspace).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  test("does nothing on cancel — no navigation, no retry, no error surface", async () => {
    const h = harness({ confirm: confirmReturning("cancel") });

    const outcome = await runOccupiedDirectorySteer(h.input);

    expect(outcome).toBe("cancelled");
    expect(h.openExistingWorkspace).not.toHaveBeenCalled();
    expect(h.createWorktreeInstead).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  test("offers the daemon's message and the steer labels to the dialog", async () => {
    const confirm = confirmReturning("cancel");
    const h = harness({ confirm });

    await runOccupiedDirectorySteer(h.input);

    expect(confirm).toHaveBeenCalledWith({
      title: LABELS.title,
      message: 'This directory already backs the workspace "Qwen Development".',
      confirmLabel: LABELS.openExisting,
      alternateLabel: LABELS.createWorktree,
    });
  });

  test("falls back to the plain error when the occupant cannot be resolved", async () => {
    const confirm = confirmReturning("confirm");
    const h = harness({ findExistingWorkspaceId: () => null, confirm });

    const outcome = await runOccupiedDirectorySteer(h.input);

    expect(outcome).toBe("unresolved");
    // Nothing to steer to, so we must not open a dialog offering to open it.
    expect(confirm).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith(
      'This directory already backs the workspace "Qwen Development".',
    );
  });

  test("surfaces a failed worktree retry instead of swallowing it", async () => {
    const h = harness({
      confirm: confirmReturning("alternate"),
      createWorktreeInstead: async () => {
        throw new Error("Failed to create worktree");
      },
    });

    const outcome = await runOccupiedDirectorySteer(h.input);

    expect(outcome).toBe("unresolved");
    expect(h.onError).toHaveBeenCalledWith("Failed to create worktree");
  });

  test("the typed error is distinguishable from an ordinary create failure", () => {
    expect(isWorkspaceDirectoryOccupiedError(occupiedError())).toBe(true);
    expect(isWorkspaceDirectoryOccupiedError(new Error("Failed to create worktree"))).toBe(false);
    expect(isWorkspaceDirectoryOccupiedError(null)).toBe(false);
    expect(occupiedError().sourceDirectory).toBe(DIRECTORY);
  });
});
