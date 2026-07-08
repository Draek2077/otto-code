import { beforeEach, describe, expect, it } from "vitest";
import { confirmDialog, confirmDialogWithCheckbox, useConfirmDialogStore } from "./confirm-dialog";

function resetStore(): void {
  useConfirmDialogStore.setState({ queue: [] });
}

describe("confirmDialog", () => {
  beforeEach(() => {
    resetStore();
  });

  it("enqueues a request and resolves true when the active request is confirmed", async () => {
    const promise = confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    });

    const active = useConfirmDialogStore.getState().queue[0];
    expect(active).toMatchObject({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      destructive: true,
    });

    useConfirmDialogStore.getState().resolveActive({ confirmed: true, checkboxChecked: false });

    await expect(promise).resolves.toBe(true);
    expect(useConfirmDialogStore.getState().queue).toHaveLength(0);
  });

  it("resolves false when the active request is cancelled", async () => {
    const promise = confirmDialog({ title: "Delete", message: "Are you sure?" });

    useConfirmDialogStore.getState().resolveActive({ confirmed: false, checkboxChecked: false });

    await expect(promise).resolves.toBe(false);
  });

  it("returns the checkbox state from confirmDialogWithCheckbox", async () => {
    const promise = confirmDialogWithCheckbox({
      title: "Archive chat?",
      message: "Archiving a chat puts it in History.",
      checkboxLabel: "Suppress this warning next time",
    });

    useConfirmDialogStore.getState().resolveActive({ confirmed: true, checkboxChecked: true });

    await expect(promise).resolves.toEqual({ confirmed: true, checkboxChecked: true });
  });

  it("queues overlapping requests and resolves them in order", async () => {
    const first = confirmDialog({ title: "First", message: "one" });
    const second = confirmDialog({ title: "Second", message: "two" });

    expect(useConfirmDialogStore.getState().queue.map((request) => request.title)).toEqual([
      "First",
      "Second",
    ]);

    useConfirmDialogStore.getState().resolveActive({ confirmed: true, checkboxChecked: false });
    await expect(first).resolves.toBe(true);

    expect(useConfirmDialogStore.getState().queue.map((request) => request.title)).toEqual([
      "Second",
    ]);

    useConfirmDialogStore.getState().resolveActive({ confirmed: false, checkboxChecked: false });
    await expect(second).resolves.toBe(false);
  });
});
