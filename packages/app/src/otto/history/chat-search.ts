import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PINNED_SECTION_BAND, type CommandCenterResultSection } from "@/command-center/results";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "@/hooks/agent-history-query-key";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useChatSearchJumpStore } from "./chat-search-jump";
import type { ChatMessageResult } from "./message-result";

type SearchPayload = Awaited<ReturnType<DaemonClient["searchChatMessages"]>>;
type Hit = SearchPayload["hits"][number];
interface SearchHost {
  serverId: string;
  label: string;
  supported: boolean;
  client: DaemonClient | null;
  epoch: number | undefined;
}
const limitPerHost = 40;
let latestOpen = 0;

function useSearchHosts(enabled: boolean): SearchHost[] {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const support = useSessionStore(
    useShallow((state) =>
      enabled
        ? // COMPAT(chatContentSearch): Otto v0.9.20; remove after 2027-05-11.
          hosts.map(
            (host) =>
              state.sessions[host.serverId]?.serverInfo?.features?.chatContentSearch === true,
          )
        : [],
    ),
  );
  const subscribe = useCallback(
    (fn: () => void) => (enabled ? runtime.subscribeAll(fn) : () => undefined),
    [enabled, runtime],
  );
  const getVersion = useCallback(() => (enabled ? runtime.getVersion() : 0), [enabled, runtime]);
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  return useMemo(() => {
    void version;
    if (!enabled) return [];
    return hosts.map((host, index) => {
      const snapshot = runtime.getSnapshot(host.serverId);
      return Object.assign({}, host, {
        supported: support[index] === true,
        client: snapshot?.connectionStatus === "online" ? snapshot.client : null,
        epoch: snapshot?.connectionEpoch,
      });
    });
  }, [enabled, hosts, runtime, support, version]);
}

async function searchHost(host: SearchHost, query: string) {
  if (!host.client) return { status: "offline" } as const;
  if (!host.supported) return { status: "upgrade" } as const;
  try {
    const payload = await host.client.searchChatMessages({
      query,
      archive: "all",
      limit: limitPerHost,
    });
    return { status: "ok", host, payload } as const;
  } catch {
    return { status: "offline" } as const;
  }
}

function isCurrent(host: SearchHost) {
  const current = getHostRuntimeStore().getSnapshot(host.serverId);
  return (
    current?.connectionStatus === "online" &&
    current.client === host.client &&
    current.connectionEpoch === host.epoch
  );
}

async function findMatches(hosts: readonly SearchHost[], query: string) {
  const hits: { host: SearchHost; hit: Hit }[] = [];
  let pending = 0;
  let unavailable = 0;
  let upgrade = 0;
  let more = false;
  for (const result of await Promise.all(hosts.map((host) => searchHost(host, query)))) {
    if (result.status === "upgrade") {
      upgrade += 1;
    } else if (result.status === "offline" || !isCurrent(result.host)) {
      unavailable += 1;
    } else {
      pending += result.payload.coverage.pending;
      unavailable += result.payload.coverage.unavailable;
      more ||= result.payload.hasMore;
      for (const hit of result.payload.hits) hits.push({ host: result.host, hit });
    }
  }
  return {
    hits: hits.slice(0, 100),
    pending,
    unavailable,
    upgrade,
    more: more || hits.length > 100,
  };
}

function describeCoverage(data: Awaited<ReturnType<typeof findMatches>>) {
  return [
    data.pending ? "Some chats are still being indexed." : "",
    data.unavailable ? "Some chat history is unavailable." : "",
    data.upgrade ? "Update older hosts to search their chat messages." : "",
    data.more ? "More messages match. Narrow your search to see them." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function useChatSearch(open: boolean, rawQuery: string) {
  const hosts = useSearchHosts(open && Boolean(rawQuery.trim()));
  const query = useDebouncedValue(open ? rawQuery.trim().slice(0, 1000) : "", 200);
  const queryClient = useQueryClient();
  const { error: showError } = useToast();
  const enabled = open && Boolean(query) && hosts.length > 0;
  const result = useFetchQuery({
    queryKey: [
      "otto",
      "chatContentSearch",
      query,
      hosts.map((host) => [host.serverId, host.epoch, host.supported, Boolean(host.client)]),
    ],
    enabled,
    dataShape: "value",
    staleTimeMs: 1000,
    gcTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => findMatches(hosts, query),
    refetchInterval: ({ state }) => {
      if (!enabled || !state.data?.pending || state.dataUpdateCount >= 4) return false;
      return 5000;
    },
  });
  const openMessage = useCallback(
    async (host: SearchHost, hit: Hit) => {
      const request = ++latestOpen;
      useChatSearchJumpStore.getState().setTarget(null);
      try {
        if (!host.client || !isCurrent(host)) throw new Error("Host disconnected");
        if (hit.archived) {
          // Follow the existing History open behavior before resolving the new timeline epoch.
          await host.client.refreshAgent(hit.id);
          void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(host.serverId) });
          void queryClient.invalidateQueries({ queryKey: allAgentHistoryQueryRootKey() });
        }
        if (request !== latestOpen || !isCurrent(host)) return;
        const resolved = await host.client.resolveChatSearchMessage(hit.id, hit.messageKey);
        if (request !== latestOpen) return;
        if (!resolved.target || !isCurrent(host)) {
          showError("That message changed or is no longer available.");
          return;
        }
        clearCommandCenterFocusRestoreElement();
        useChatSearchJumpStore.getState().setTarget({
          serverId: host.serverId,
          agentId: hit.id,
          ...resolved.target,
          expiresAt: Date.now() + 20_000,
        });
        navigateToAgent({
          serverId: host.serverId,
          agentId: hit.id,
          workspaceId: resolved.workspaceId,
        });
      } catch {
        if (request !== latestOpen) return;
        useChatSearchJumpStore.getState().setTarget(null);
        showError("Could not open that message on its host.");
      }
    },
    [queryClient, showError],
  );

  const matchesCurrentQuery = enabled && query === rawQuery.trim().slice(0, 1000);
  const data = matchesCurrentQuery ? result.data : undefined;
  const sections = useMemo<CommandCenterResultSection[]>(() => {
    const results =
      data?.hits.map(
        ({ host, hit }): ChatMessageResult => ({
          kind: "message",
          id: `message:${host.serverId}:${hit.id}:${hit.messageKey}`,
          title: hit.title,
          snippet: hit.snippet.replace(/\s+/g, " ").trim(),
          subtitle: [
            hosts.length > 1 ? host.label : "",
            hit.projectName,
            hit.role === "user" ? "You" : "Assistant",
            hit.archived ? "Archived" : "",
          ]
            .filter(Boolean)
            .join(" · "),
          run: () => openMessage(host, hit),
        }),
      ) ?? [];
    return [
      { id: "chat-messages", band: PINNED_SECTION_BAND, rank: 1, title: "Chat messages", results },
    ];
  }, [data, hosts.length, openMessage]);
  return {
    sections,
    status: data ? describeCoverage(data) : "",
    loading: matchesCurrentQuery && result.isLoading,
  };
}
