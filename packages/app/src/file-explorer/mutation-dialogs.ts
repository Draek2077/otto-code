import { i18n } from "@/i18n/i18next";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

/**
 * Copy for the one destructive gesture in the file explorer.
 *
 * Delete in Otto is an **unlink**, not a move to the OS trash. The daemon may be
 * headless, remote, or inside WSL, where there is no trash to move to — a
 * "deleted" file that quietly survived on one host and vanished on another would
 * be worse than either behaviour. So the dialog says permanently, and it says it
 * before the file is gone rather than in a docs page afterwards.
 *
 * Deleting a folder is the same act with a bigger blast radius, so it gets a
 * second dialog — but only once the daemon has reported the folder is not empty.
 * A user who believed it was empty learns that here, before anything is removed,
 * rather than from a tree that lost more than they meant.
 *
 * Pure helpers reading their sentences from `workspace.fileExplorer.dialogs.*`:
 * confirmations are inside docs/i18n.md's translation scope, and a destructive
 * dialog is the last place to make someone read a second language. Resolvers are
 * pure, so they call `i18n.t(...)` directly (docs/i18n.md, Batch 4Y).
 */

export interface DeleteEntryDialogInput {
  /** The entry's display name — the leaf, not the whole path. */
  name: string;
  kind: "file" | "directory";
}

export function resolveDeleteEntryDialog(input: DeleteEntryDialogInput): ConfirmDialogInput {
  const isDirectory = input.kind === "directory";
  return {
    title: isDirectory
      ? i18n.t("workspace.fileExplorer.dialogs.delete.titleFolder")
      : i18n.t("workspace.fileExplorer.dialogs.delete.titleFile"),
    message: [
      isDirectory
        ? i18n.t("workspace.fileExplorer.dialogs.delete.subjectFolder", { name: input.name })
        : i18n.t("workspace.fileExplorer.dialogs.delete.subjectFile", { name: input.name }),
      i18n.t("workspace.fileExplorer.dialogs.delete.permanentLine"),
    ].join("\n\n"),
    confirmLabel: i18n.t("workspace.fileExplorer.dialogs.delete.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: true,
  };
}

/**
 * The second gate, reached only when the first delete came back `not_empty`. The
 * daemon refuses to recurse unless asked, which is what makes this dialog
 * possible: nothing has been removed yet at the point it is shown.
 */
export function resolveDeleteFolderContentsDialog(input: { name: string }): ConfirmDialogInput {
  return {
    title: i18n.t("workspace.fileExplorer.dialogs.deleteContents.title"),
    message: [
      i18n.t("workspace.fileExplorer.dialogs.deleteContents.subject", { name: input.name }),
      i18n.t("workspace.fileExplorer.dialogs.delete.permanentLine"),
    ].join("\n\n"),
    confirmLabel: i18n.t("workspace.fileExplorer.dialogs.deleteContents.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: true,
  };
}
