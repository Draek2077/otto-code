import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CloudDownload } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { GitAction } from "@/git/policy";
import { useToast } from "@/contexts/toast-context";
import { useGitFetchPort } from "./use-port";
import { ManualGitFetch } from "./manual";

export type OttoGitActionId = "fetch";
const FetchIcon = withUnistyles(CloudDownload, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
export function useGitFetchAction(
  serverId: string,
  workspaceId: string | null | undefined,
  hasRemote: boolean,
): GitAction | null {
  const { port, connected } = useGitFetchPort(serverId);
  const toast = useToast();
  const model = useMemo(() => new ManualGitFetch(port, workspaceId), [port, workspaceId]);
  const { status, error } = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const fetch = useCallback(async () => {
    if (model.getSnapshot().status === "pending") return;
    await model.run();
    const result = model.getSnapshot();
    if (result.error) toast.error(result.error);
    else if (result.status === "success") toast.show("Fetched origin.");
  }, [model, toast]);
  const handler = useCallback(() => {
    void fetch();
  }, [fetch]);
  return useMemo(() => {
    if (!workspaceId || !hasRemote) return null;
    return {
      id: "fetch",
      label: error ? "Fetch failed; try again" : "Fetch",
      pendingLabel: "Fetching...",
      successLabel: "Fetched",
      status,
      disabled: !connected || status === "pending",
      unavailableMessage: port ? undefined : "Update the host to use manual Git fetch.",
      startsGroup: true,
      icon: <FetchIcon size={16} />,
      handler,
    };
  }, [workspaceId, hasRemote, status, error, connected, port, handler]);
}
