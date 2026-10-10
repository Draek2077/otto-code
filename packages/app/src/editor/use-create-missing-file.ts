import { useCallback, useState } from "react";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { canCreateAsTextFile } from "@/components/file-pane-render-mode";
import { useToast } from "@/contexts/toast-context";
import { useFileMutationsFeature } from "@/file-explorer/use-file-mutations-feature";
import { useSessionStore } from "@/stores/session-store";
import { explorerBaseName, explorerParentPath } from "@/utils/explorer-paths";
import { useTextEditorFeature } from "./use-text-editor-feature";

export interface CreateMissingFile {
  /** Null when this host or file type cannot be created from the editor. */
  create: (() => Promise<boolean>) | null;
  creating: boolean;
}

/**
 * Creates an empty file at a path the file tab could not read, so the user can
 * start typing into it. Goes through the Explorer's own create RPC: an exclusive
 * create whose parent the daemon re-validates against the workspace, so a path
 * that escapes the workspace or has no parent folder fails rather than writing.
 *
 * Resolves true once a file exists at the path - including when someone else
 * created it first, which is the same outcome from the user's side.
 */
export function useCreateMissingFile(input: {
  serverId: string;
  workspaceRoot: string;
  path: string;
}): CreateMissingFile {
  const { serverId, workspaceRoot, path } = input;
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const canMutateFiles = useFileMutationsFeature(serverId);
  const canEdit = useTextEditorFeature(serverId);
  const [creating, setCreating] = useState(false);

  const create = useCallback(async (): Promise<boolean> => {
    if (!client) {
      return false;
    }
    setCreating(true);
    try {
      await client.createFileEntry({
        cwd: workspaceRoot,
        parentPath: explorerParentPath(path),
        name: explorerBaseName(path),
        kind: "file",
      });
      // `success: false` only ever means the name is taken: the file now exists.
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error));
      return false;
    } finally {
      setCreating(false);
    }
  }, [client, path, toast, workspaceRoot]);

  const available = Boolean(client) && canMutateFiles && canEdit && canCreateAsTextFile(path);
  return { create: available ? create : null, creating };
}
