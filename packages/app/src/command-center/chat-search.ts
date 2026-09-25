import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { useChatSearchJumpStore } from "@/agent-stream/chat-search-jump";
import type { CommandCenterMessageResult, CommandCenterResultSection } from "./results";
import { PINNED_SECTION_BAND } from "./results";

type Payload = Awaited<ReturnType<DaemonClient["searchChatMessages"]>>;
interface State {
  key: string;
  results: CommandCenterMessageResult[];
  status: string;
  loading: boolean;
}

export function useChatSearch(input: {
  enabled: boolean;
  query: string;
  projectId?: string;
  workspaceId?: string;
  serverId?: string;
  onError(message: string): void;
}) {
  const { onError } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const hosts = useHosts();
  const capabilities = useSessionStore(
    useShallow((state) =>
      hosts.map((host) => {
        const session = state.sessions[host.serverId];
        return `${host.serverId}:${session?.serverInfo?.features?.chatContentSearch === true}`;
      }),
    ),
  );
  const capabilityKey = capabilities.join("|");
  const key = JSON.stringify([
    input.enabled,
    input.query,
    input.projectId,
    input.workspaceId,
    input.serverId,
    capabilityKey,
  ]);
  const [state, setState] = useState<State>({ key: "", results: [], status: "", loading: false });
  useEffect(() => {
    if (!input.enabled || !input.query.trim()) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function search() {
      const resultsByHost = new Map<string, CommandCenterMessageResult[]>();
      let pending = 0;
      let unavailable = 0;
      let upgrade = 0;
      let more = false;
      const publish = (loading: boolean) => {
        if (canceled) return;
        const status = [
          pending ? t("shell.commandCenter.indexingChats", { count: pending }) : "",
          unavailable ? t("shell.commandCenter.historyUnavailable") : "",
          upgrade ? t("shell.commandCenter.updateHostForChats") : "",
          more ? t("shell.commandCenter.moreChatMatches") : "",
        ]
          .filter(Boolean)
          .join(". ");
        setState({
          key,
          results: hosts.flatMap((host) => resultsByHost.get(host.serverId) ?? []),
          status,
          loading,
        });
      };
      await Promise.all(
        hosts
          .filter((host) => !input.serverId || host.serverId === input.serverId)
          .map(async (host) => {
            const results: CommandCenterMessageResult[] = [];
            resultsByHost.set(host.serverId, results);
            const client = getHostRuntimeStore().getClient(host.serverId);
            if (
              !client ||
              getHostRuntimeStore().getSnapshot(host.serverId)?.connectionStatus !== "online"
            ) {
              unavailable++;
              return;
            }
            // COMPAT(chatContentSearch): added in v0.9.20; remove gate after 2027-03-25.
            if (
              useSessionStore.getState().sessions[host.serverId]?.serverInfo?.features
                ?.chatContentSearch !== true
            ) {
              upgrade++;
              return;
            }
            try {
              const payload: Payload = await client.searchChatMessages({
                query: input.query,
                projectId: input.projectId,
                workspaceId: input.workspaceId,
                archive: "all",
                limit: 50,
              });
              pending += payload.coverage.pending;
              unavailable += payload.coverage.unavailable;
              more ||= payload.hasMore;
              for (const hit of payload.hits)
                results.push({
                  kind: "message",
                  // COMPAT(chatSearchProvider): v0.9.20; remove after 2027-03-25.
                  provider: hit.provider ?? "",
                  serverId: host.serverId,
                  id: `message:${host.serverId}:${hit.id}:${hit.messageKey}`,
                  title: hit.title,
                  subtitle: [
                    hosts.length > 1 ? host.label : null,
                    hit.projectName,
                    t(
                      hit.role === "user"
                        ? "shell.commandCenter.you"
                        : "shell.commandCenter.assistant",
                    ),
                    hit.timestamp ? new Date(hit.timestamp).toLocaleDateString() : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  snippet: hit.snippet,
                  archived: hit.archived,
                  run: async () => {
                    try {
                      if (hit.archived) {
                        // Match History's open behavior. Restore first: hydration may replace
                        // the timeline epoch, so an anchor resolved beforehand is already stale.
                        await client.refreshAgent(hit.id);
                        void queryClient.invalidateQueries({
                          queryKey: agentHistoryQueryKey(host.serverId),
                        });
                      }
                      const resolved = await client.resolveChatSearchMessage(
                        hit.id,
                        hit.messageKey,
                      );
                      if (!resolved.target) {
                        onError(t("shell.commandCenter.messageChanged"));
                        return;
                      }
                      clearCommandCenterFocusRestoreElement();
                      useChatSearchJumpStore.getState().setTarget({
                        serverId: host.serverId,
                        agentId: hit.id,
                        ...resolved.target,
                      });
                      navigateToAgent({
                        serverId: host.serverId,
                        agentId: hit.id,
                        workspaceId: resolved.workspaceId,
                      });
                    } catch (error) {
                      onError(error instanceof Error ? error.message : String(error));
                    }
                  },
                });
            } catch {
              unavailable++;
            }
            publish(true);
          }),
      );
      if (canceled) return;
      publish(false);
      // An open query refreshes while history changes or an unavailable host recovers.
      timer = setTimeout(() => void search(), 5000);
    }
    setState({ key, results: [], status: "", loading: true });
    timer = setTimeout(() => void search(), 200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [
    hosts,
    input.enabled,
    input.query,
    input.projectId,
    input.workspaceId,
    input.serverId,
    onError,
    queryClient,
    key,
    t,
  ]);
  const current = state.key === key ? state : null;
  const sections = useMemo<CommandCenterResultSection[]>(
    () => [
      {
        id: "chat-messages",
        band: PINNED_SECTION_BAND,
        rank: 1,
        title: t("shell.commandCenter.chatMessages"),
        results: current?.results ?? [],
      },
    ],
    [current, t],
  );
  return {
    sections,
    status: current?.status ?? "",
    loading: Boolean(input.enabled && input.query.trim()) && (!current || current.loading),
  };
}
