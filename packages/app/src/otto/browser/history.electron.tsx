import { useCallback, useEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useBrowserHistoryPort } from "./history-client";
import { BrowserHistoryModel } from "./history-model";
import { BrowserHistorySuggestions } from "./history-suggestions.electron";

export function useOttoBrowserHistory(input: {
  serverId: string;
  workspaceId: string;
  page:
    | { url: string; title: string; isLoading: boolean; lastError: string | null }
    | null
    | undefined;
  query: string;
  inputRef: RefObject<EditingTextInputHandle | null>;
  active: boolean;
  onNavigate(url: string): void;
}) {
  const port = useBrowserHistoryPort(input.serverId, input.workspaceId);
  const model = useMemo(() => (port ? new BrowserHistoryModel(port) : null), [port]);
  useEffect(() => model?.activate(), [model]);
  const page = input.page;
  const readyUrl = page && !page.isLoading && !page.lastError ? page.url : null;
  const title = page?.title ?? "";
  useEffect(() => {
    model?.visit(readyUrl, title);
  }, [model, readyUrl, title]);
  return {
    menuItem: model ? (
      <HistoryClear model={model} />
    ) : (
      <DropdownMenuItem disabled tooltip="Update this host to use browsing history.">
        Clear browsing history
      </DropdownMenuItem>
    ),
    feedback: model ? <HistoryFeedback model={model} /> : null,
    suggestions: model ? (
      <BrowserHistorySuggestions
        model={model}
        inputRef={input.inputRef}
        query={input.query}
        active={input.active}
        onNavigate={input.onNavigate}
      />
    ) : null,
  };
}
function HistoryClear({ model }: { model: BrowserHistoryModel }) {
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
  let status: "pending" | "success" | "idle" = "idle";
  if (state.clearing) status = "pending";
  else if (state.cleared) status = "success";
  return (
    <DropdownMenuItem
      testID="browser-history-clear"
      onSelect={clear}
      status={status}
      pendingLabel="Clearing browsing history"
      successLabel="Browsing history cleared"
      closeOnSelect={false}
    >
      Clear browsing history
    </DropdownMenuItem>
  );
}
function HistoryFeedback({ model }: { model: BrowserHistoryModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const retry = useCallback(() => model.retryVisit(), [model]);
  if (state.clearError)
    return (
      <Alert
        testID="browser-history-feedback"
        size="sm"
        variant="error"
        description={state.clearError}
      />
    );
  if (state.cleared)
    return (
      <Alert
        testID="browser-history-feedback"
        size="sm"
        variant="success"
        description="Browsing history cleared."
      />
    );
  if (state.visitError)
    return (
      <Alert size="sm" variant="error" description={state.visitError}>
        <Button size="xs" variant="outline" onPress={retry}>
          Retry saving history
        </Button>
      </Alert>
    );
  return null;
}
