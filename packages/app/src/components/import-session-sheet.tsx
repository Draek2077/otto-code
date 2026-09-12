import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@otto-code/client/internal/daemon-client";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import { ChevronDown, Inbox, Layers, RotateCw } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { getProviderIcon } from "@/components/provider-icons";
import { formatTimeAgo } from "@/utils/time";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { useImportSessionBatch, sessionKey } from "@/components/use-import-session-batch";
import { Button } from "@/components/ui/button";
import {
  ImportSessionCheckbox,
  ImportSessionCheckmark,
} from "@/components/import-session-checkbox";
import type { Theme } from "@/styles/theme";
import type { IconSizeProp } from "@/components/icons/icon-size";
import { i18n } from "@/i18n/i18next";
import {
  aggregateSessionEntries,
  ALL_FILTER_VALUE,
  buildProviderLabelMap,
  collectErroredProviderLabels,
  computeEmptyState,
  getPromptPreview,
  getSessionTitle,
  PER_PROVIDER_LIMIT,
  resolveProvidersToFetch,
  requiresImportSessionsHostUpgrade,
  sumFilteredAlreadyImportedCount,
} from "@/components/import-session-sheet-view-model";

const IMPORT_SHEET_SNAP_POINTS = ["70%", "92%"];
const MAX_PROVIDER_LIMIT = 200;
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedInbox = withUnistyles(Inbox);
const ThemedLayers = withUnistyles(Layers);
const ThemedRotateCw = withUnistyles(RotateCw);
const mutedIconProps = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const emptyIconProps = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.lg,
});
const ThemedProviderIcon = withUnistyles(function ProviderIcon({
  provider,
  color,
  size,
}: {
  provider: string;
  color?: string;
  size?: IconSizeProp;
}) {
  const Icon = getProviderIcon(provider);
  return <Icon color={color} size={size} />;
});

type RecentProviderSessionsClient = Pick<
  DaemonClient,
  "fetchRecentProviderSessions" | "importAgent"
>;

type ImportedAgent = Awaited<ReturnType<RecentProviderSessionsClient["importAgent"]>>;

interface ImportSessionSheetProps {
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  serverId: string | null;
  cwd?: string | null;
  /**
   * Workspace the sheet was opened from. The imported session is adopted by this
   * workspace instead of the daemon resolving one for the directory - omit it
   * only where there is no workspace context (the home screen).
   */
  workspaceId?: string | null;
  onClose: () => void;
  onImportedAgent?: (agentId: string) => void;
  onImported?: (agent: ImportedAgent) => void;
  onImportedOtherWorkspace?: (agent: ImportedAgent) => void;
}

type RecentSessionsResponse = Awaited<
  ReturnType<RecentProviderSessionsClient["fetchRecentProviderSessions"]>
>;

interface SessionsQueryConfig {
  queryKey: ReadonlyArray<string | number | null>;
  enabled: boolean;
  queryFn: () => Promise<RecentSessionsResponse>;
}

function buildSessionsQueriesConfig(args: {
  providersToFetch: AgentProvider[] | null;
  sessionsQueryRoot: ReadonlyArray<string | number | null>;
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  cwd: string | null | undefined;
  hostDisconnectedMessage?: string;
  limit: number;
}): SessionsQueryConfig[] {
  const {
    providersToFetch,
    sessionsQueryRoot,
    visible,
    client,
    cwd,
    hostDisconnectedMessage,
    limit,
  } = args;
  if (providersToFetch === null) return [];
  const enabled = visible && Boolean(client);
  return providersToFetch.map((provider) => ({
    queryKey: [...sessionsQueryRoot, provider],
    enabled,
    queryFn: async () => {
      if (!client) {
        throw new Error(hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected"));
      }
      return await client.fetchRecentProviderSessions({
        ...(cwd ? { cwd } : {}),
        providers: [provider],
        limit,
      });
    },
  }));
}

interface SheetStatusMessagesProps {
  isClientReady: boolean;
  isSnapshotUnsupported: boolean;
  hasNoImportableProviders: boolean;
  isLoadingSessions: boolean;
  hasRows: boolean;
  allQueriesErrored: boolean;
  erroredProviderLabels: ReadonlyArray<string>;
  importErrored: boolean;
}

function SheetStatusMessages({
  isClientReady,
  isSnapshotUnsupported,
  hasNoImportableProviders,
  isLoadingSessions,
  hasRows,
  allQueriesErrored,
  erroredProviderLabels,
  importErrored,
}: SheetStatusMessagesProps) {
  const { t } = useTranslation();
  if (!isClientReady) {
    return <Text style={styles.statusText}>{t("importSession.status.connectHost")}</Text>;
  }
  if (isSnapshotUnsupported) {
    return <Text style={styles.statusText}>{t("importSession.status.updateHost")}</Text>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <Text style={styles.statusText}>{t("importSession.status.noProviders")}</Text>
      ) : null}
      {isLoadingSessions && !hasRows ? (
        <View style={styles.statusRow}>
          <LoadingSpinner />
          <Text style={styles.statusText}>{t("importSession.status.loading")}</Text>
        </View>
      ) : null}
      {allQueriesErrored ? (
        <Text style={styles.statusText}>{t("importSession.status.failedAll")}</Text>
      ) : null}
      {!allQueriesErrored && erroredProviderLabels.length > 0 ? (
        <Text style={styles.statusText}>
          {t("importSession.status.failedProviders", {
            providers: erroredProviderLabels.join(", "),
          })}
        </Text>
      ) : null}
      {importErrored ? (
        <Text style={styles.statusText}>{t("importSession.status.failedBatch")}</Text>
      ) : null}
    </>
  );
}

function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.refreshButton,
      pressed && styles.refreshButtonPressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={isRefreshing}
      accessibilityLabel={t("importSession.actions.refresh")}
      accessibilityRole="button"
      testID="import-session-refresh"
      style={pressableStyle}
    >
      <View style={styles.refreshIconSlot}>
        {isRefreshing ? <LoadingSpinner /> : <ThemedRotateCw size="md" uniProps={mutedIconProps} />}
      </View>
    </Pressable>
  );
}

function SheetEmptyState({ title }: { title: string }) {
  return (
    <View style={styles.emptyState} testID="import-session-empty-state">
      <View style={styles.emptyStateIcon}>
        <ThemedInbox uniProps={emptyIconProps} />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
    </View>
  );
}

function ImportSessionSheetRow({
  entry,
  disabled,
  importing,
  selected,
  error,
  showCwd,
  onImportSession,
}: {
  entry: FetchRecentProviderSessionEntry;
  disabled: boolean;
  importing: boolean;
  selected: boolean;
  error?: string;
  showCwd: boolean;
  onImportSession: (entry: FetchRecentProviderSessionEntry) => void;
}) {
  const { t } = useTranslation();
  const title = getSessionTitle(entry);
  const promptPreview = getPromptPreview(entry);
  const lastActivity = formatTimeAgo(new Date(entry.lastActivityAt));
  const accessibilityState = useMemo(() => ({ disabled, checked: selected }), [disabled, selected]);
  const [hovered, setHovered] = useState(false);
  const handleEnter = useCallback(() => setHovered(true), []);
  const handleLeave = useCallback(() => setHovered(false), []);
  const handlePress = useCallback(() => {
    onImportSession(entry);
  }, [entry, onImportSession]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      selected && styles.rowSelected,
      hovered && !disabled && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [selected, hovered, disabled],
  );

  return (
    <View onPointerEnter={handleEnter} onPointerLeave={handleLeave}>
      <Pressable
        disabled={disabled}
        onPress={handlePress}
        accessibilityRole="checkbox"
        accessibilityLabel={title}
        accessibilityState={accessibilityState}
        aria-checked={selected}
        style={pressableStyle}
        testID={`import-session-session-${entry.providerId}-${entry.providerHandleId}`}
      >
        <ImportSessionCheckmark checked={selected} />
        <View style={styles.rowIconWrap}>
          <ThemedProviderIcon provider={entry.providerId} size="md" uniProps={mutedIconProps} />
        </View>
        <View style={styles.rowContent}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.rowMeta}>
              {importing ? t("importSession.row.importing") : lastActivity}
            </Text>
          </View>
          <Text style={styles.rowPreview} numberOfLines={2}>
            {promptPreview}
          </Text>
          {showCwd && entry.cwd ? (
            <Text style={styles.rowCwd} numberOfLines={1}>
              {entry.cwd}
            </Text>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </Pressable>
    </View>
  );
}

function ImportSessionFilters({ children }: { children: React.ReactNode }) {
  const controls = React.Children.toArray(children);
  return controls.length > 0 ? <View style={styles.filtersRow}>{controls}</View> : null;
}

export function ImportSessionSheet({
  visible,
  client,
  serverId,
  cwd,
  workspaceId,
  onClose,
  onImportedAgent,
  onImported,
  onImportedOtherWorkspace,
}: ImportSessionSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [limit, setLimit] = useState(PER_PROVIDER_LIMIT);
  const discoveryCwd = showAllProjects ? undefined : cwd;
  useEffect(() => {
    setShowAllProjects(false);
    setLimit(PER_PROVIDER_LIMIT);
  }, [visible, serverId, cwd]);
  const toggleScope = useCallback(() => {
    setShowAllProjects((value) => !value);
    setLimit(PER_PROVIDER_LIMIT);
  }, []);

  const { entries: snapshotEntries, supportsSnapshot } = useProvidersSnapshot(serverId, {
    cwd,
    enabled: visible,
  });
  const supportsWorkspaceTarget = useHostFeature(serverId, "importSessionWorkspaceTarget");
  const requiresHostUpgrade = requiresImportSessionsHostUpgrade({
    supportsSnapshot,
    workspaceId,
    supportsWorkspaceTarget,
  });

  const providersToFetch = useMemo(
    () => (requiresHostUpgrade ? null : resolveProvidersToFetch(supportsSnapshot, snapshotEntries)),
    [requiresHostUpgrade, supportsSnapshot, snapshotEntries],
  );

  const providerLabelById = useMemo(
    () => buildProviderLabelMap(snapshotEntries),
    [snapshotEntries],
  );

  const sessionsQueryRoot = useMemo(
    () => ["recent-provider-sessions", serverId, discoveryCwd ?? null, limit] as const,
    [serverId, discoveryCwd, limit],
  );

  const queriesConfig = useMemo(
    () =>
      buildSessionsQueriesConfig({
        providersToFetch,
        sessionsQueryRoot,
        visible,
        client,
        cwd: discoveryCwd,
        limit,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [providersToFetch, sessionsQueryRoot, visible, client, discoveryCwd, limit, t],
  );

  const queries = useQueries({ queries: queriesConfig });

  const aggregatedEntries = useMemo(() => aggregateSessionEntries(queries), [queries]);
  const totalAlreadyImportedCount = useMemo(
    () => sumFilteredAlreadyImportedCount(queries),
    [queries],
  );

  const filterProviders = useMemo(() => [...(providersToFetch ?? [])].sort(), [providersToFetch]);

  const [selectedProvider, setSelectedProvider] = useState<string>(ALL_FILTER_VALUE);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterAnchorRef = useRef<View>(null);

  useEffect(() => {
    if (
      !visible ||
      (selectedProvider !== ALL_FILTER_VALUE && !filterProviders.includes(selectedProvider))
    ) {
      setSelectedProvider(ALL_FILTER_VALUE);
    }
  }, [visible, filterProviders, selectedProvider]);

  const candidateEntries = useMemo(() => {
    if (selectedProvider === ALL_FILTER_VALUE) return aggregatedEntries;
    return aggregatedEntries.filter((entry) => entry.providerId === selectedProvider);
  }, [aggregatedEntries, selectedProvider]);

  const filterComboboxOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: ALL_FILTER_VALUE, label: t("importSession.filters.all") },
      ...filterProviders.map((provider) => ({
        id: provider,
        label: providerLabelById.get(provider) ?? provider,
      })),
    ],
    [filterProviders, providerLabelById, t],
  );

  const selectedProviderLabel = useMemo(
    () =>
      filterComboboxOptions.find((opt) => opt.id === selectedProvider)?.label ??
      t("importSession.filters.all"),
    [filterComboboxOptions, selectedProvider, t],
  );

  const handleFilterOpen = useCallback(() => setIsFilterOpen(true), []);

  const filterTriggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      Boolean(hovered) && styles.filterTriggerHovered,
      pressed && styles.filterTriggerPressed,
    ],
    [],
  );

  const handleFilterSelect = useCallback((id: string) => {
    setSelectedProvider(id);
    setIsFilterOpen(false);
  }, []);

  const filterOptionIcons = useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    map.set(ALL_FILTER_VALUE, <ThemedLayers size="sm" uniProps={mutedIconProps} />);
    for (const provider of filterProviders) {
      map.set(
        provider,
        <ThemedProviderIcon provider={provider} size="sm" uniProps={mutedIconProps} />,
      );
    }
    return map;
  }, [filterProviders]);

  const renderFilterOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={filterOptionIcons.get(option.id)}
      />
    ),
    [filterOptionIcons],
  );

  const {
    visibleEntries,
    selectedEntries,
    allSelected,
    selectedKeys,
    importErrors,
    progress,
    importMutation,
    toggleSelection,
    toggleAll,
    handleImportSelected,
    handleClose,
  } = useImportSessionBatch({
    client,
    serverId,
    cwd,
    workspaceId,
    visible,
    globalScope: showAllProjects,
    providerFilter: selectedProvider,
    entries: candidateEntries,
    onClose,
    onImported,
    onImportedAgent,
    onImportedOtherWorkspace,
  });
  const handleLoadMore = useCallback(
    () => setLimit((value) => Math.min(MAX_PROVIDER_LIMIT, value + PER_PROVIDER_LIMIT)),
    [],
  );

  const erroredProviderLabels = useMemo(
    () => collectErroredProviderLabels(providersToFetch, queries, providerLabelById),
    [queries, providersToFetch, providerLabelById],
  );

  const isRefreshing = queries.some((query) => query.isFetching);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
  }, [queryClient, sessionsQueryRoot]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("importSession.title"),
      actions: (
        <RefreshAction
          isRefreshing={isRefreshing || importMutation.isPending}
          onPress={handleRefresh}
        />
      ),
    }),
    [isRefreshing, importMutation.isPending, handleRefresh, t],
  );

  const isSnapshotUnsupported = requiresHostUpgrade;
  const isWaitingForSnapshot = supportsSnapshot && snapshotEntries === undefined;
  const hasNoImportableProviders = providersToFetch !== null && providersToFetch.length === 0;
  const isQueryingProviders = queries.length > 0;
  const isLoadingSessions =
    isWaitingForSnapshot ||
    (isQueryingProviders && queries.some((query) => query.isLoading || query.isPending));
  const allQueriesErrored = isQueryingProviders && queries.every((query) => query.isError);
  const allQueriesSettled =
    isQueryingProviders && queries.every((query) => !query.isLoading && !query.isPending);
  const { showEmptyState, emptyStateTitle } = computeEmptyState({
    isLoadingSessions,
    allQueriesErrored,
    isQueryingProviders,
    allQueriesSettled,
    selectedProvider,
    aggregatedCount: aggregatedEntries.length,
    visibleCount: visibleEntries.length,
    totalAlreadyImportedCount,
    providerLabelById,
  });
  const showFilter = filterProviders.length > 1;

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="ghost" size="sm" onPress={handleClose} disabled={importMutation.isPending}>
          {t("common.actions.close")}
        </Button>
        <Button
          variant="default"
          size="sm"
          testID="import-session-import-selected"
          onPress={handleImportSelected}
          disabled={selectedEntries.length === 0 || importMutation.isPending}
          loading={importMutation.isPending}
        >
          {progress
            ? t("importSession.actions.importingBatch", {
                current: progress.index,
                total: progress.total,
              })
            : t("importSession.actions.importSelected", { count: selectedEntries.length })}
        </Button>
      </View>
    ),
    [
      handleClose,
      importMutation.isPending,
      handleImportSelected,
      selectedEntries.length,
      progress,
      t,
    ],
  );
  const hasMore = queries.some(
    (query, index) =>
      (selectedProvider === ALL_FILTER_VALUE || providersToFetch?.[index] === selectedProvider) &&
      (query.data?.entries.length ?? 0) >= limit,
  );
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleClose}
      header={header}
      testID="import-session-sheet"
      desktopMaxWidth={560}
      snapPoints={IMPORT_SHEET_SNAP_POINTS}
      footer={footer}
    >
      <ImportSessionFilters>
        {showFilter ? (
          <View ref={filterAnchorRef} collapsable={false} style={styles.filterTriggerWrap}>
            <Pressable
              onPress={handleFilterOpen}
              disabled={importMutation.isPending}
              style={filterTriggerStyle}
              testID="import-session-filter-trigger"
              accessibilityRole="button"
              accessibilityLabel={`Filter: ${selectedProviderLabel}`}
            >
              {selectedProvider === ALL_FILTER_VALUE ? (
                <ThemedLayers size="sm" uniProps={mutedIconProps} />
              ) : (
                (() => {
                  return (
                    <ThemedProviderIcon
                      provider={selectedProvider}
                      size="sm"
                      uniProps={mutedIconProps}
                    />
                  );
                })()
              )}
              <Text style={styles.filterTriggerText} numberOfLines={1}>
                {selectedProviderLabel}
              </Text>
              <ThemedChevronDown size="sm" uniProps={mutedIconProps} />
            </Pressable>
            <Combobox
              options={filterComboboxOptions}
              value={selectedProvider}
              onSelect={handleFilterSelect}
              renderOption={renderFilterOption}
              searchable={false}
              title="Filter by provider"
              open={isFilterOpen}
              onOpenChange={setIsFilterOpen}
              anchorRef={filterAnchorRef}
              desktopPlacement="bottom-start"
              desktopPreventInitialFlash
            />
          </View>
        ) : null}
        {cwd ? (
          <ImportSessionCheckbox
            checked={showAllProjects}
            disabled={importMutation.isPending}
            label={t("importSession.filters.allProjects")}
            onPress={toggleScope}
            testID="import-session-all-projects"
          />
        ) : null}
      </ImportSessionFilters>
      {!discoveryCwd ? (
        <Text style={styles.scopeHint}>{t("importSession.status.originalFolders")}</Text>
      ) : null}
      <SheetStatusMessages
        isClientReady={Boolean(client)}
        isSnapshotUnsupported={isSnapshotUnsupported}
        hasNoImportableProviders={hasNoImportableProviders}
        isLoadingSessions={isLoadingSessions}
        hasRows={visibleEntries.length > 0}
        allQueriesErrored={allQueriesErrored}
        erroredProviderLabels={erroredProviderLabels}
        importErrored={importMutation.isError || Object.keys(importErrors).length > 0}
      />
      {visibleEntries.length > 0 ? (
        <View style={styles.list}>
          <ImportSessionCheckbox
            row
            checked={allSelected}
            disabled={importMutation.isPending}
            label={t("importSession.actions.selectAll")}
            onPress={toggleAll}
            testID="import-session-select-all"
          />
          {visibleEntries.map((entry) => (
            <ImportSessionSheetRow
              key={`${entry.providerId}:${entry.providerHandleId}`}
              entry={entry}
              disabled={importMutation.isPending}
              importing={progress?.key === sessionKey(entry)}
              selected={selectedKeys.has(sessionKey(entry))}
              error={importErrors[sessionKey(entry)]}
              showCwd={!discoveryCwd}
              onImportSession={toggleSelection}
            />
          ))}
        </View>
      ) : null}
      {hasMore && limit < MAX_PROVIDER_LIMIT ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={handleLoadMore}
          disabled={isRefreshing || importMutation.isPending}
          testID="import-session-load-more"
        >
          {t("importSession.actions.loadMore")}
        </Button>
      ) : null}
      {hasMore && limit >= MAX_PROVIDER_LIMIT ? (
        <Text style={styles.scopeHint}>
          {t("importSession.status.limitReached", { count: MAX_PROVIDER_LIMIT })}
        </Text>
      ) : null}
      {showEmptyState ? <SheetEmptyState title={emptyStateTitle} /> : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  scopeHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
  errorText: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  rowSelected: { backgroundColor: theme.colors.surfaceInteractiveSelected },
  filtersRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  filterTriggerWrap: {
    flexShrink: 0,
  },
  filterTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  filterTriggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  filterTriggerPressed: {
    backgroundColor: theme.colors.surface3,
  },
  filterTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  list: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: -theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceInteractivePressed,
  },
  rowIconWrap: {
    width: theme.iconSize.md,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  rowCwd: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyStateIcon: {
    opacity: 0.6,
    marginBottom: theme.spacing[1],
  },
  emptyStateTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  refreshButton: {
    padding: theme.spacing[2],
    marginRight: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
  },
  refreshButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  refreshIconSlot: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
}));
