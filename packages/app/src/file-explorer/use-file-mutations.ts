import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { FileEntryKind } from "@otto-code/protocol/messages";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { explorerParentPath, joinExplorerPath } from "@/utils/explorer-paths";
import {
  resolveDeleteEntryDialog,
  resolveDeleteFolderContentsDialog,
} from "@/file-explorer/mutation-dialogs";

export interface FileMutationEntry {
  path: string;
  name: string;
  kind: FileEntryKind;
}

export interface UseFileMutationsParams {
  serverId: string;
  workspaceRoot: string;
  /** Re-listed after a successful mutation so the tree shows what is actually there. */
  refreshDirectory: (path: string) => void;
}

/**
 * Create, rename and delete, bound to one workspace.
 *
 * Two shapes on purpose. Create and rename return an error **string** so the
 * name sheet can show it next to the field the user is still editing - a
 * "there is already a file called that" toast that fires after the sheet closes
 * is a worse version of the same sentence. Delete has no field to sit next to,
 * so it confirms first and toasts on failure.
 *
 * Every path here is workspace-relative; the daemon re-validates containment and
 * is the only thing that decides what is reachable.
 */
export function useFileMutations({
  serverId,
  workspaceRoot,
  refreshDirectory,
}: UseFileMutationsParams) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  const createEntry = useCallback(
    async (input: {
      parentPath: string;
      name: string;
      kind: FileEntryKind;
    }): Promise<string | null> => {
      if (!client) {
        return t("workspace.terminal.hostDisconnected");
      }
      const path = joinExplorerPath(input.parentPath, input.name);
      try {
        const result = await client.createFileEntry({ cwd: workspaceRoot, path, kind: input.kind });
        if (result.status === "exists") {
          return t("workspace.fileExplorer.errors.alreadyExists", { name: input.name });
        }
        if (result.status === "error") {
          return result.message;
        }
        refreshDirectory(input.parentPath);
        return null;
      } catch (error) {
        return toErrorMessage(error);
      }
    },
    [client, refreshDirectory, t, workspaceRoot],
  );

  const renameEntry = useCallback(
    async (input: { path: string; newName: string }): Promise<string | null> => {
      if (!client) {
        return t("workspace.terminal.hostDisconnected");
      }
      const parentPath = explorerParentPath(input.path);
      const newPath = joinExplorerPath(parentPath, input.newName);
      try {
        const result = await client.renameFileEntry({
          cwd: workspaceRoot,
          path: input.path,
          newPath,
        });
        if (result.status === "exists") {
          return t("workspace.fileExplorer.errors.alreadyExists", { name: input.newName });
        }
        if (result.status === "not_found") {
          return t("workspace.fileExplorer.errors.noLongerExists");
        }
        if (result.status === "error") {
          return result.message;
        }
        refreshDirectory(parentPath);
        return null;
      } catch (error) {
        return toErrorMessage(error);
      }
    },
    [client, refreshDirectory, t, workspaceRoot],
  );

  /**
   * Confirm, delete, and - when the target turns out to be a non-empty folder -
   * confirm a second time before recursing. The daemon refuses to recurse unless
   * asked, so nothing has been removed at the point the second dialog appears:
   * "this folder is not empty" is discovered by trying, not by pre-counting.
   */
  const deleteEntry = useCallback(
    async (entry: FileMutationEntry): Promise<void> => {
      if (!client) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      const confirmed = await confirmDialog(
        resolveDeleteEntryDialog({ name: entry.name, kind: entry.kind }),
      );
      if (!confirmed) {
        return;
      }

      const parentPath = explorerParentPath(entry.path);
      try {
        let result = await client.deleteFileEntry({ cwd: workspaceRoot, path: entry.path });

        if (result.status === "not_empty") {
          const recurse = await confirmDialog(
            resolveDeleteFolderContentsDialog({ name: entry.name }),
          );
          if (!recurse) {
            return;
          }
          result = await client.deleteFileEntry({
            cwd: workspaceRoot,
            path: entry.path,
            recursive: true,
          });
        }

        if (result.status === "error") {
          toast.error(result.message);
          return;
        }
        // `not_found` is a success as far as the user is concerned: the thing
        // they asked to be gone is gone. Refresh so the stale row disappears.
        refreshDirectory(parentPath);
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [client, refreshDirectory, t, toast, workspaceRoot],
  );

  return { createEntry, renameEntry, deleteEntry };
}
