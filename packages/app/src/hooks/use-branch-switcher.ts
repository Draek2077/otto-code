import { useState, useCallback, useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { ToastApi } from "@/components/toast-host";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import { createBranchSwitcherOperations } from "@/git/branch-switcher-operations";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { confirmDialog } from "@/utils/confirm-dialog";

interface UseBranchSwitcherInput {
  client: DaemonClient | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceDirectory: string | null;
  currentBranchName: string | null;
  isGitCheckout: boolean;
  isConnected: boolean;
  toast: ToastApi;
  queryClient: QueryClient;
}

interface UseBranchSwitcherResult {
  branchOptions: ComboboxOption[];
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  handleBranchSelect: (branchId: string) => void;
  invalidateStashAndCheckout: () => Promise<void>;
  /** True while a `git checkout` for this workspace is in flight daemon-side. */
  isSwitching: boolean;
}

interface BranchSuggestionEntry {
  name: string;
  checkedOutElsewhere?: boolean;
}

type SwitchAttempt = { ok: true } | { ok: false; message: string };

export function useBranchSwitcher({
  client,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceDirectory,
  currentBranchName,
  isGitCheckout,
  isConnected,
  toast,
  queryClient,
}: UseBranchSwitcherInput): UseBranchSwitcherResult {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  // Git operations are bound to the workspace directory; the opaque workspace id is
  // used only for query cache identity below, never as a cwd.
  const operations = useMemo(
    () =>
      client && workspaceDirectory
        ? createBranchSwitcherOperations(client, workspaceDirectory)
        : null,
    [client, workspaceDirectory],
  );

  // The switch itself runs through the checkout-actions store so the rest of the
  // git UI (header action buttons, other checkout mutations) sees one shared
  // "switch-branch is pending" signal and can lock itself while it runs.
  const runSwitchBranch = useCheckoutGitActionsStore((s) => s.switchBranch);
  const isSwitching = useCheckoutGitActionsStore((s) =>
    workspaceDirectory
      ? s.getStatus({
          serverId: normalizedServerId,
          cwd: workspaceDirectory,
          actionId: "switch-branch",
        }) === "pending"
      : false,
  );

  const branchSuggestionsQuery = useQuery({
    queryKey: ["branchSuggestions", normalizedServerId, normalizedWorkspaceId],
    queryFn: async (): Promise<BranchSuggestionEntry[]> => {
      if (!operations) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await operations.getBranchSuggestions(200);
      if (payload.error) {
        throw new Error(payload.error);
      }
      // Older daemons only send the flat name list; without details nothing is
      // disabled, which matches their (post-hoc error) behavior anyway.
      return payload.branchDetails ?? (payload.branches ?? []).map((name) => ({ name }));
    },
    enabled: isOpen && isGitCheckout && Boolean(operations) && isConnected,
    retry: false,
    staleTime: 15_000,
  });

  const branchOptions = useMemo<ComboboxOption[]>(() => {
    const branches = branchSuggestionsQuery.data ?? [];
    const checkedOutElsewhereLabel = t("branchSwitcher.checkedOutElsewhere");
    return branches.map((branch) => {
      // Git refuses to check out a branch that another worktree already has
      // checked out, so surface that up front instead of erroring after.
      const disabled = branch.checkedOutElsewhere === true && branch.name !== currentBranchName;
      const option: ComboboxOption = { id: branch.name, label: branch.name };
      if (disabled) {
        option.disabled = true;
        option.description = checkedOutElsewhereLabel;
      }
      return option;
    });
  }, [branchSuggestionsQuery.data, currentBranchName, t]);

  const disabledBranchIds = useMemo(
    () => new Set(branchOptions.filter((option) => option.disabled).map((option) => option.id)),
    [branchOptions],
  );

  const stashListQueryKey = useMemo(
    () => ["stashList", normalizedServerId, normalizedWorkspaceId] as const,
    [normalizedServerId, normalizedWorkspaceId],
  );

  const invalidateStashAndCheckout = useCallback(async () => {
    if (!workspaceDirectory) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: stashListQueryKey }),
      invalidateCheckoutGitQueriesForClient(queryClient, {
        serverId: normalizedServerId,
        cwd: workspaceDirectory,
      }),
    ]);
  }, [queryClient, stashListQueryKey, normalizedServerId, workspaceDirectory]);

  const performSwitch = useCallback(
    async (branchId: string): Promise<SwitchAttempt> => {
      if (!workspaceDirectory) {
        return { ok: false, message: t("branchSwitcher.failedToSwitch") };
      }
      try {
        await runSwitchBranch({
          serverId: normalizedServerId,
          cwd: workspaceDirectory,
          branch: branchId,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : t("branchSwitcher.failedToSwitch"),
        };
      }
    },
    [normalizedServerId, runSwitchBranch, t, workspaceDirectory],
  );

  const maybeRestoreStashForBranch = useCallback(
    async (branchId: string) => {
      if (!operations) return;
      try {
        const stashPayload = await operations.listOttoStashes();
        const targetStash = stashPayload.entries.find((e) => e.branch === branchId);
        if (!targetStash) return;
        const shouldRestore = await confirmDialog({
          title: t("branchSwitcher.restoreStashTitle"),
          message: t("branchSwitcher.restoreStashMessage"),
          confirmLabel: t("branchSwitcher.restore"),
          cancelLabel: t("branchSwitcher.later"),
        });
        if (!shouldRestore) return;
        const popPayload = await operations.popStash(targetStash.index);
        if (popPayload.error) {
          toast.error(popPayload.error.message);
        } else {
          toast.show(t("branchSwitcher.stashRestored"));
        }
        await invalidateStashAndCheckout();
      } catch {
        // Non-critical — user can still restore on next branch switch
      }
    },
    [operations, invalidateStashAndCheckout, toast, t],
  );

  const stashAndSwitch = useCallback(
    async (branchId: string) => {
      if (!operations) return;
      const shouldStash = await confirmDialog({
        title: t("branchSwitcher.uncommittedTitle"),
        message: t("branchSwitcher.uncommittedMessage"),
        confirmLabel: t("branchSwitcher.stashAndSwitch"),
        cancelLabel: t("common.actions.cancel"),
      });
      if (!shouldStash) return;

      try {
        const stashPayload = await operations.saveStash(currentBranchName ?? undefined);
        if (stashPayload.error) {
          toast.error(stashPayload.error.message);
          return;
        }
        await invalidateStashAndCheckout();
        const switchResult = await performSwitch(branchId);
        if (!switchResult.ok) {
          toast.error(switchResult.message);
          return;
        }
        await invalidateStashAndCheckout();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("branchSwitcher.failedToStash"));
      }
    },
    [operations, currentBranchName, invalidateStashAndCheckout, performSwitch, toast, t],
  );

  const handleBranchSelect = useCallback(
    (branchId: string) => {
      if (branchId === currentBranchName) return;
      // Disabled options are non-pressable, but keyboard selection still lands
      // here — refuse instead of letting git error after the fact.
      if (disabledBranchIds.has(branchId)) return;
      if (!workspaceDirectory) return;
      // Re-entry guard: one switch at a time per checkout. Read the store
      // imperatively so a stale render can't sneak a second switch through.
      const status = useCheckoutGitActionsStore.getState().getStatus({
        serverId: normalizedServerId,
        cwd: workspaceDirectory,
        actionId: "switch-branch",
      });
      if (status === "pending") return;

      void (async () => {
        if (!operations) return;
        const result = await performSwitch(branchId);
        if (!result.ok) {
          // If the error is about uncommitted changes, offer the stash dialog
          if (result.message.toLowerCase().includes("uncommitted")) {
            await stashAndSwitch(branchId);
            return;
          }
          toast.error(result.message);
          return;
        }
        // Success — refresh and check for stashes on the target branch
        await invalidateStashAndCheckout();
        await maybeRestoreStashForBranch(branchId);
      })();
    },
    [
      operations,
      currentBranchName,
      disabledBranchIds,
      invalidateStashAndCheckout,
      maybeRestoreStashForBranch,
      normalizedServerId,
      performSwitch,
      stashAndSwitch,
      toast,
      workspaceDirectory,
    ],
  );

  return {
    branchOptions,
    isOpen,
    setIsOpen,
    handleBranchSelect,
    invalidateStashAndCheckout,
    isSwitching,
  };
}
