import { useMemo, useState, useCallback, useEffect } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, Trash2 } from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AgentList, AgentListColumnHeader } from "@/components/agent-list";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useClearArchivedAgents } from "@/history/use-clear-archived-agents";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import { formatFileSize } from "@/utils/format-file-size";
import { useSessionStore } from "@/stores/session-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";

/**
 * The archive line. History has never had a filter, so an archived chat was only
 * distinguishable by a badge in a mixed list - which made bulk clear impossible to
 * reason about ("clear what, exactly?"). Splitting the list is the prerequisite.
 */
type ArchiveFilter = "all" | "active" | "archived";

export function SessionsScreen() {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent />;
}

function SessionsScreenContent() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const { agents, hasMore, isInitialLoad, isLoadingMore, isError, loadMore, refreshAll } =
    useAgentHistory({
      serverId: historyServerId,
    });
  const historyStorage = useFetchQuery<{
    totalBytes: number;
    byHost: Array<{ serverId: string; totalBytes: number }>;
  } | null>({
    queryKey: [
      "historyStorageUsage",
      historyServerId,
      hosts.map((host) => host.serverId).join(","),
    ],
    enabled: hosts.length > 0,
    dataShape: "value",
    staleTimeMs: 10_000,
    queryFn: async () => {
      const serverIds = historyServerId ? [historyServerId] : hosts.map((host) => host.serverId);
      const payloads = await Promise.all(
        serverIds.map(async (serverId) => {
          const client = getHostRuntimeStore().getSnapshot(serverId)?.client;
          if (
            !client ||
            useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.historyStorage !==
              true
          ) {
            return null;
          }
          return client.getHistoryStorageStats();
        }),
      );
      const valid = payloads.flatMap((payload, index) =>
        payload !== null && !payload.error
          ? [{ serverId: serverIds[index], totalBytes: payload.totalBytes }]
          : [],
      );
      return valid.length === 0
        ? null
        : {
            totalBytes: valid.reduce((total, payload) => total + payload.totalBytes, 0),
            byHost: valid,
          };
    },
  });

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  const sortedAgents = useMemo(() => {
    const filtered =
      archiveFilter === "all"
        ? agents
        : agents.filter((agent) =>
            archiveFilter === "archived" ? Boolean(agent.archivedAt) : !agent.archivedAt,
          );
    return [...filtered].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }, [agents, archiveFilter]);

  // The hosts a sweep would run against - the selected one, or every host the
  // history query is already reading from.
  const targetServerIds = useMemo(
    () => (historyServerId ? [historyServerId] : hosts.map((host) => host.serverId)),
    [historyServerId, hosts],
  );
  // COMPAT(historyDelete): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
  const canClearArchived = useSessionStore((state) =>
    targetServerIds.some(
      (serverId) => state.sessions[serverId]?.serverInfo?.features?.historyDelete === true,
    ),
  );
  const { clearArchived, isClearing } = useClearArchivedAgents();

  const handleClearArchived = useCallback(() => {
    void clearArchived({
      serverIds: targetServerIds,
      scope: historyServerId ? "oneHost" : "allHosts",
    }).then((outcome) => {
      if (outcome && outcome.deleted > 0) {
        // The caches were patched per host already; refetch so the paginated
        // pages the client never held come back consistent.
        void refreshAll();
      }
      return outcome;
    });
  }, [clearArchived, historyServerId, refreshAll, targetServerIds]);

  const archiveFilterOptions = useMemo(
    () => [
      { value: "all" as const, label: t("sessions.filters.all") },
      { value: "active" as const, label: t("sessions.filters.active") },
      { value: "archived" as const, label: t("sessions.filters.archived") },
    ],
    [t],
  );

  const emptyText = useMemo(() => {
    if (archiveFilter === "archived") {
      return t("sessions.emptyArchived");
    }
    if (archiveFilter === "active") {
      return t("sessions.emptyActive");
    }
    return selectedHost === ALL_HOSTS_OPTION_ID ? t("sessions.empty") : t("sessions.emptyForHost");
  }, [archiveFilter, selectedHost, t]);
  const hostOptionDescriptions = useMemo(() => {
    if (!historyStorage.data) return undefined;
    return {
      [ALL_HOSTS_OPTION_ID]: formatFileSize({ size: historyStorage.data.totalBytes }),
      ...Object.fromEntries(
        historyStorage.data.byHost.map(({ serverId, totalBytes }) => [
          serverId,
          formatFileSize({ size: totalBytes }),
        ]),
      ),
    };
  }, [historyStorage.data]);
  const showHostFilter = hosts.length > 1;
  const showHostColumn = selectedHost === ALL_HOSTS_OPTION_ID;
  const showLoadError = isError && sortedAgents.length === 0;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const listFooterComponent = useMemo(
    () =>
      hasMore ? (
        <View style={styles.footer}>
          <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
          </Button>
        </View>
      ) : null,
    [hasMore, loadMore, isLoadingMore, t],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sessions.title")} />
      <View style={styles.historyHeader}>
        <View style={styles.controlsRow}>
          <View style={styles.controlsFilters}>
            {showHostFilter ? (
              <HostFilter
                hosts={hosts}
                selectedHost={selectedHost}
                onSelectHost={setSelectedHost}
                optionDescriptions={hostOptionDescriptions}
                triggerTestID="sessions-host-filter-trigger"
              />
            ) : null}
            <SegmentedControl
              options={archiveFilterOptions}
              value={archiveFilter}
              onValueChange={setArchiveFilter}
              size="sm"
              testID="sessions-archive-filter"
            />
          </View>
          {canClearArchived ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Trash2}
              onPress={handleClearArchived}
              disabled={isClearing}
              testID="sessions-clear-archived"
            >
              {isClearing
                ? t("sessions.actions.clearingArchived")
                : t("sessions.actions.clearArchived")}
            </Button>
          ) : null}
        </View>
        <AgentListColumnHeader showHostColumn={showHostColumn} />
      </View>
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
        </View>
      ) : null}
      {!isInitialLoad && showLoadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Unable to load sessions</Text>
          <Button variant="ghost" onPress={handleRefresh}>
            Try again
          </Button>
        </View>
      ) : null}
      {!isInitialLoad && !showLoadError && sortedAgents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{emptyText}</Text>
          <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
            Back
          </Button>
        </View>
      ) : null}
      {!isInitialLoad && !showLoadError && sortedAgents.length > 0 ? (
        <AgentList
          agents={sortedAgents}
          showCheckoutInfo={false}
          isRefreshing={isManualRefresh}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          showAttentionIndicator={false}
          showHostColumn={showHostColumn}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  // Host and archive filters share one row, with the destructive action pinned
  // to the far corner at every breakpoint.
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  historyHeader: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  controlsFilters: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
}));
