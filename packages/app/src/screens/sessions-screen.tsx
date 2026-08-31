/* oxlint-disable complexity -- this screen owns the cross-host search, archive, storage, and paginated empty-state matrix. */
import { useMemo, useState, useCallback, useEffect, useRef, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, Trash2 } from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList, AgentListColumnHeader } from "@/components/agent-list";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { ProjectFilter, type ProjectFilterOption } from "@/components/project-filter";
import { type AgentHistoryHostError, useAgentHistory } from "@/hooks/use-agent-history";
import { useProjects } from "@/hooks/use-projects";
import {
  resolveInitialAggregateProjectScope,
  usePreferredWorkspaceProjectScope,
} from "@/hooks/use-preferred-workspace-project-scope";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useClearArchivedAgents } from "@/history/use-clear-archived-agents";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import { formatFileSize } from "@/utils/format-file-size";
import { useSessionStore } from "@/stores/session-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { artifactBelongsToWorkspace } from "@/artifacts/artifact-derivation";
import { buildScheduleProjectTargets } from "@/schedules/schedule-project-targets";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

type ArchiveFilter = "all" | "active" | "archived";

const ThemedDestructiveTrash = withUnistyles(Trash2, (theme) => ({
  color: theme.colors.destructive,
  size: theme.iconSize.sm,
}));

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
  hasProjectFilter: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  if (input.hasProjectFilter) return "No sessions for this project";
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

export function SessionsScreen() {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent />;
}

function SessionsScreenContent() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { projects } = useProjects();
  const preferredWorkspaceScope = usePreferredWorkspaceProjectScope();
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
  const hasExplicitScopeSelection = useRef(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isSearchTruncated,
    searchMatchesByAgentKey,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverId: historyServerId,
    search,
  });
  const isSearching = isSearchSupported && search.length > 0;
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
  const destructiveTrash = useMemo(() => <ThemedDestructiveTrash />, []);
  const scheduleProjectTargets = useMemo(() => buildScheduleProjectTargets(projects), [projects]);

  // Reuse the same project roots as Artifacts, Schedules, and Workflows. A
  // project stays selectable even when it has no History rows, which makes the
  // picker a dependable way to narrow the all-host view instead of a summary
  // of whatever happens to be loaded.
  const projectOptions = useMemo<ProjectFilterOption[]>(() => {
    const byId = new Map<string, ProjectFilterOption>();
    for (const target of scheduleProjectTargets) {
      if (!byId.has(target.cwd)) {
        byId.set(target.cwd, { id: target.cwd, label: target.projectName });
      }
    }
    return Array.from(byId.values());
  }, [scheduleProjectTargets]);

  useEffect(() => {
    const initialScope = resolveInitialAggregateProjectScope({
      hasExplicitSelection: hasExplicitScopeSelection.current,
      preferredScope: preferredWorkspaceScope,
      availableHostIds: hosts.map((host) => host.serverId),
      projectTargets: scheduleProjectTargets,
    });
    if (!initialScope) return;
    setSelectedHost(initialScope.serverId);
    setProjectFilter(initialScope.cwd);
  }, [hosts, preferredWorkspaceScope, scheduleProjectTargets]);

  const handleSelectHost = useCallback((serverId: string) => {
    hasExplicitScopeSelection.current = true;
    setSelectedHost(serverId);
  }, []);
  const handleProjectFilterChange = useCallback((cwd: string | undefined) => {
    hasExplicitScopeSelection.current = true;
    setProjectFilter(cwd);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  // `useAgentHistory` owns the order: recency at rest, relevance under a query.
  // Local project/archive filters retain that order while narrowing the rows.
  const filteredAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          (projectFilter === undefined || artifactBelongsToWorkspace(agent.cwd, projectFilter)) &&
          (archiveFilter === "all" ||
            (archiveFilter === "archived" ? Boolean(agent.archivedAt) : !agent.archivedAt)),
      ),
    [agents, archiveFilter, projectFilter],
  );
  const emptyText = useMemo(() => {
    if (isSearching) {
      return resolveEmptyText({
        t,
        isSearching: true,
        isAllHosts: false,
        hasProjectFilter: projectFilter !== undefined,
      });
    }
    if (archiveFilter === "archived") return t("sessions.emptyArchived");
    if (archiveFilter === "active") return t("sessions.emptyActive");
    return resolveEmptyText({
      t,
      isSearching: false,
      isAllHosts: selectedHost === ALL_HOSTS_OPTION_ID,
      hasProjectFilter: projectFilter !== undefined,
    });
  }, [archiveFilter, isSearching, projectFilter, selectedHost, t]);
  const showHostFilter = hosts.length > 1;
  const showHostColumn = selectedHost === ALL_HOSTS_OPTION_ID;
  const showLoadError = isError && filteredAgents.length === 0;

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
      if (outcome && outcome.deleted > 0) void refreshAll();
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

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  const listFooterComponent = useMemo(() => {
    // A ranked result set has no next page — reaching a weaker match means
    // narrowing the query, so the footer says that instead of offering a button.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

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
                onSelectHost={handleSelectHost}
                optionDescriptions={hostOptionDescriptions}
                triggerTestID="sessions-host-filter-trigger"
                hostOptionTestID={sessionsHostOptionTestID}
              />
            ) : null}
            <ProjectFilter
              options={projectOptions}
              value={projectFilter}
              onChange={handleProjectFilterChange}
            />
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
              leftIcon={destructiveTrash}
              textStyle={styles.clearArchivedText}
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
        {isSearchSupported ? (
          <View style={styles.searchRow}>
            <SearchField
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder={t("sessions.searchPlaceholder")}
              clearAccessibilityLabel={t("sessions.actions.clearSearch")}
              testID="sessions-search-input"
              clearTestID="sessions-search-clear"
            />
          </View>
        ) : null}
        <AgentListColumnHeader showHostColumn={showHostColumn} />
      </View>
      {hostErrors.length > 0 ? <SessionHostErrorsBanner errors={hostErrors} t={t} /> : null}
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <ThemedLoadingSpinner size="large" />
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
      {!isInitialLoad && !showLoadError && filteredAgents.length === 0 ? (
        <View style={styles.emptyContainer} testID="sessions-empty">
          <Text style={styles.emptyText}>{emptyText}</Text>
          {isSearching ? (
            <Button variant="ghost" onPress={handleClearSearch}>
              {t("sessions.actions.clearSearch")}
            </Button>
          ) : null}
          {!isSearching && hasMore ? (
            <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
            </Button>
          ) : null}
          {!isSearching ? (
            <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
              Back
            </Button>
          ) : null}
        </View>
      ) : null}
      {!isInitialLoad && !showLoadError && filteredAgents.length > 0 ? (
        <AgentList
          agents={filteredAgents}
          showCheckoutInfo={false}
          isRefreshing={isManualRefresh}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          showAttentionIndicator={false}
          showHostColumn={showHostColumn}
          searchMatchesByAgentKey={isSearching ? searchMatchesByAgentKey : undefined}
          flat={isSearching}
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
  // Navigation and filter controls lead the page; the destructive action stays
  // in the opposite corner. Search is intentionally a second, dedicated row
  // so it does not compete with scope selection.
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
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
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  searchRow: {
    flexDirection: "row",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
    // The header's bottom rule is drawn by `historyHeader`, so without this the
    // search field sits flush on the line with nothing between them.
    paddingBottom: theme.spacing[3],
  },
  clearArchivedText: {
    color: theme.colors.destructive,
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
    fontSize: theme.fontSize.base,
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
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
