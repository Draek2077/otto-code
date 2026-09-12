import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@otto-code/client/internal/daemon-client";

export const sessionKey = (entry: FetchRecentProviderSessionEntry) =>
  `${entry.providerId}:${entry.providerHandleId}`;
type ImportedAgent = Awaited<ReturnType<DaemonClient["importAgent"]>>;
export function useImportSessionBatch({
  client,
  serverId,
  cwd,
  workspaceId,
  visible,
  globalScope,
  providerFilter,
  entries,
  onClose,
  onImportedAgent,
  onImported,
  onImportedOtherWorkspace,
}: {
  client: Pick<DaemonClient, "importAgent"> | null;
  serverId: string | null;
  cwd?: string | null;
  workspaceId?: string | null;
  visible: boolean;
  globalScope: boolean;
  providerFilter: string;
  entries: FetchRecentProviderSessionEntry[];
  onClose: () => void;
  onImportedAgent?: (id: string) => void;
  onImported?: (agent: ImportedAgent) => void;
  onImportedOtherWorkspace?: (agent: ImportedAgent) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(() => new Set());
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ index: number; total: number; key: string } | null>(
    null,
  );
  const batchRunning = useRef(false);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [visible, serverId, cwd, globalScope, providerFilter]);
  useEffect(() => {
    setCompletedKeys(new Set());
    setImportErrors({});
  }, [visible, serverId, cwd]);
  const visibleEntries = entries.filter((entry) => !completedKeys.has(sessionKey(entry)));
  const selectedEntries = visibleEntries.filter((entry) => selectedKeys.has(sessionKey(entry)));
  const allSelected = visibleEntries.length > 0 && selectedEntries.length === visibleEntries.length;
  const toggleSelection = useCallback((entry: FetchRecentProviderSessionEntry) => {
    if (batchRunning.current) return;
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      const key = sessionKey(entry);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    if (batchRunning.current) return;
    setSelectedKeys(new Set(allSelected ? [] : visibleEntries.map(sessionKey)));
  }, [allSelected, visibleEntries]);
  const importMutation = useMutation({
    mutationFn: async (batchEntries: FetchRecentProviderSessionEntry[]) => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const successes: ImportedAgent[] = [];
      const errors: Record<string, string> = {};
      for (const [index, entry] of batchEntries.entries()) {
        const key = sessionKey(entry);
        setProgress({ index: index + 1, total: batchEntries.length, key });
        try {
          if (!entry.cwd) throw new Error("Session is missing a working directory");
          // Scoped discovery has already resolved filesystem aliases on the host.
          // Global discovery preserves a foreign session's cwd and lets the host
          // provision its workspace instead of binding it to the current one.
          const targetWorkspace = !globalScope || entry.cwd === cwd ? workspaceId : undefined;
          const agent = await client.importAgent({
            providerId: entry.providerId,
            providerHandleId: entry.providerHandleId,
            cwd: entry.cwd,
            ...(targetWorkspace ? { workspaceId: targetWorkspace } : {}),
          });
          successes.push(agent);
          setCompletedKeys((previous) => new Set([...previous, key]));
          setSelectedKeys((previous) => {
            const next = new Set(previous);
            next.delete(key);
            return next;
          });
        } catch (error) {
          errors[key] =
            error instanceof Error ? error.message : t("importSession.status.failedImport");
        }
      }
      setImportErrors(errors);
      return { successes, failed: Object.keys(errors).length };
    },
    onSuccess: ({ successes, failed }) => {
      if (failed > 0) return;
      const agent = successes.at(-1);
      if (!agent) return;
      onClose();
      if (workspaceId && agent.workspaceId !== workspaceId) {
        onImportedOtherWorkspace?.(agent);
      } else {
        onImportedAgent?.(agent.id);
      }
      onImported?.(agent);
    },
    onSettled: () => {
      batchRunning.current = false;
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: ["recent-provider-sessions", serverId] });
    },
  });
  const handleImportSelected = useCallback(() => {
    if (batchRunning.current || selectedEntries.length === 0) return;
    batchRunning.current = true;
    setImportErrors({});
    importMutation.mutate(selectedEntries);
  }, [importMutation, selectedEntries]);
  const handleClose = useCallback(() => {
    if (!batchRunning.current) onClose();
  }, [onClose]);

  return {
    visibleEntries,
    selectedEntries,
    allSelected,
    selectedKeys,
    importErrors,
    progress,
    importMutation,
    batchRunning,
    toggleSelection,
    toggleAll,
    handleImportSelected,
    handleClose,
  };
}
