/**
 * UNWIRED(fileDownload): this hook has no caller, and that is a gap rather than
 * dead code. The rest of the capability is live: the daemon mints download
 * tokens (`server/file-download/token-store.ts`, constructed in bootstrap.ts)
 * and the client store exists (`@/stores/download-store`). Only the piece that
 * joins them to the file explorer is unreached, so downloading a file from the
 * explorer does nothing today.
 *
 * Kept deliberately when the other unwired v0.2.5 modules were deleted, because
 * deleting this one would strand a working server subsystem. Adopting it is a
 * feature port tracked in projects/paseo-v025-merge/audit-findings.md.
 */
import { useCallback, useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useDownloadStore } from "@/stores/download-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";

interface UseFileDownloadParams {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}

/**
 * Returns a stable callback that downloads a single workspace file by its
 * workspace-relative path. Shared by the file explorer tree and the git diff
 * pane so both surfaces download through the same host token + download-store
 * pipeline instead of duplicating the plumbing.
 */
export function useFileDownload({
  serverId,
  workspaceId,
  workspaceRoot,
}: UseFileDownloadParams): (input: { fileName: string; path: string }) => void {
  const daemons = useHosts();
  const daemonProfile = useMemo(
    () => daemons.find((daemon) => daemon.serverId === serverId),
    [daemons, serverId],
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const workspaceScopeId = useMemo(
    () => workspaceId?.trim() || normalizedWorkspaceRoot,
    [normalizedWorkspaceRoot, workspaceId],
  );
  const { requestFileDownloadToken } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const startDownload = useDownloadStore((state) => state.startDownload);

  return useCallback(
    ({ fileName, path }) => {
      if (!workspaceScopeId) {
        return;
      }
      void startDownload({
        serverId,
        scopeId: workspaceScopeId,
        fileName,
        path,
        daemonProfile,
        requestFileDownloadToken: (targetPath) => requestFileDownloadToken(targetPath),
      });
    },
    [daemonProfile, requestFileDownloadToken, serverId, startDownload, workspaceScopeId],
  );
}
