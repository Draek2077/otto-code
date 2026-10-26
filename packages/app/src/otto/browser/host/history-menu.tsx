import { useCallback, useSyncExternalStore } from "react";
import { DropdownMenuItem, DropdownMenuHint } from "@/components/ui/dropdown-menu";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { BrowserHistoryModel } from "../history-model";
export function HostHistoryClear({ model }: { model: BrowserHistoryModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const clear = useCallback(() => {
    void model.clear(() =>
      confirmDialog({
        title: "Clear browsing history?",
        message:
          "Clear this project's browsing history on this host? Cookies and sign-in sessions are kept.",
        confirmLabel: "Clear history",
        destructive: true,
      }),
    );
  }, [model]);
  let status: "idle" | "pending" | "success" = "idle";
  if (state.clearing) status = "pending";
  else if (state.cleared) status = "success";
  return (
    <>
      <DropdownMenuItem
        onSelect={clear}
        status={status}
        pendingLabel="Clearing browsing history"
        successLabel="Browsing history cleared"
        closeOnSelect={false}
      >
        Clear browsing history
      </DropdownMenuItem>
      {state.clearError ? <DropdownMenuHint>{state.clearError}</DropdownMenuHint> : null}
    </>
  );
}
