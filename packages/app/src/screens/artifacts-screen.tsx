import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { FilePlus, Plus } from "@/components/icons/material-icons";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ArtifactGrid } from "@/components/artifacts/artifact-grid";
import { SearchField } from "@/components/ui/search-field";
import { ProjectFilter, type ProjectFilterOption } from "@/components/project-filter";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import {
  ArtifactCreateSheet,
  type ArtifactEditTarget,
} from "@/components/artifacts/artifact-create-sheet";
import { ArtifactViewDialog } from "@/components/artifacts/artifact-view-dialog";
import { ArtifactDataUpdateSheet } from "@/components/artifacts/artifact-data-update-sheet";
import {
  TranscriptViewDialog,
  type TranscriptViewDialogProps,
} from "@/components/transcript-view-dialog";
import { useArtifacts, type AggregatedArtifact } from "@/artifacts/use-artifacts";
import { useArtifactMutations } from "@/artifacts/use-artifact-mutations";
import { artifactBelongsToWorkspace, artifactMatchesSearch } from "@/artifacts/artifact-derivation";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
} from "@/schedules/schedule-project-targets";
import { useProjects } from "@/hooks/use-projects";
import {
  resolveInitialAggregateProjectScope,
  usePreferredWorkspaceProjectScope,
} from "@/hooks/use-preferred-workspace-project-scope";
import { useHosts } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import type { ArtifactStatus } from "@otto-code/protocol/artifacts/types";

type ArtifactStatusFilter = "all" | ArtifactStatus;

const STATUS_FILTER_OPTIONS: SegmentedControlOption<ArtifactStatusFilter>[] = [
  { value: "all", label: "All", testID: "artifacts-filter-all" },
  { value: "ready", label: "Generated", testID: "artifacts-filter-ready" },
  { value: "generating", label: "In progress", testID: "artifacts-filter-generating" },
  { value: "error", label: "Failed", testID: "artifacts-filter-error" },
];

export function ArtifactsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <ArtifactsScreenContent />;
}

type ArtifactFormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; artifact: AggregatedArtifact };

interface ArtifactMoveFailure {
  artifact: AggregatedArtifact;
  destination: "repository" | "host";
  message: string;
}

function toEditTarget(artifact: AggregatedArtifact): ArtifactEditTarget {
  return {
    id: artifact.id,
    serverId: artifact.serverId,
    projectId: artifact.projectId,
    name: artifact.name,
    description: artifact.description,
    provider: artifact.generationProvider,
    model: artifact.generationModel,
    thinkingOptionId: artifact.generationThinkingOptionId ?? null,
  };
}

function ArtifactsScreenContent(): ReactElement {
  const { artifacts, isInitialLoad, isError, refetch } = useArtifacts();
  const {
    toggleStar,
    deleteArtifact,
    regenerateArtifact,
    cancelArtifact,
    repairArtifact,
    moveArtifactStore,
  } = useArtifactMutations();
  const { projects } = useProjects();
  const hosts = useHosts();
  const preferredWorkspaceScope = usePreferredWorkspaceProjectScope();

  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
  const hasExplicitScopeSelection = useRef(false);
  const [statusFilter, setStatusFilter] = useState<ArtifactStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState<ArtifactFormState>({ mode: "closed" });
  const [viewingArtifact, setViewingArtifact] = useState<AggregatedArtifact | null>(null);
  const [dataUpdateArtifact, setDataUpdateArtifact] = useState<AggregatedArtifact | null>(null);
  const [transcriptTarget, setTranscriptTarget] =
    useState<TranscriptViewDialogProps["target"]>(null);
  const [movingArtifactId, setMovingArtifactId] = useState<string | null>(null);
  const movingArtifactIdRef = useRef<string | null>(null);
  const [moveFailure, setMoveFailure] = useState<ArtifactMoveFailure | null>(null);
  const openCreate = useCallback(() => setForm({ mode: "create" }), []);
  const handleView = useCallback(
    (artifact: AggregatedArtifact) => setViewingArtifact(artifact),
    [],
  );
  const closeView = useCallback(() => setViewingArtifact(null), []);
  const closeDataUpdate = useCallback(() => setDataUpdateArtifact(null), []);
  const handleViewGenerationChat = useCallback((artifact: AggregatedArtifact) => {
    if (!artifact.generationAgentId) {
      return;
    }
    setTranscriptTarget({
      serverId: artifact.serverId,
      agentId: artifact.generationAgentId,
      title: artifact.name || artifact.id,
    });
  }, []);
  const handleViewSourceChat = useCallback((artifact: AggregatedArtifact) => {
    if (artifact.source?.kind !== "chat") return;
    setTranscriptTarget({
      serverId: artifact.serverId,
      agentId: artifact.source.agentId,
      title: `Source: ${artifact.name || artifact.id}`,
    });
  }, []);
  const closeTranscript = useCallback(() => setTranscriptTarget(null), []);
  const handleEdit = useCallback(
    (artifact: AggregatedArtifact) => setForm({ mode: "edit", artifact }),
    [],
  );
  const closeForm = useCallback(() => setForm({ mode: "closed" }), []);

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const scheduleProjectTargets = useMemo(() => buildScheduleProjectTargets(projects), [projects]);
  const projectNameByCwd = useMemo(
    () => buildProjectNameByCwd(scheduleProjectTargets),
    [scheduleProjectTargets],
  );

  // The picker lists every known project (one entry per repo root), not just the
  // roots that happen to have artifacts - a project with none should still be
  // selectable and show an empty-state watermark.
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

  const visibleArtifacts = useMemo(
    () =>
      artifacts.filter(
        (artifact) =>
          (selectedHost === ALL_HOSTS_OPTION_ID || artifact.serverId === selectedHost) &&
          (projectFilter === undefined ||
            artifactBelongsToWorkspace(artifact.projectId, projectFilter)) &&
          artifactMatchesSearch(artifact, searchQuery) &&
          (statusFilter === "all" || artifact.status === statusFilter),
      ),
    [artifacts, projectFilter, searchQuery, selectedHost, statusFilter],
  );

  const handleStar = useCallback(
    (artifact: AggregatedArtifact) => {
      void toggleStar({
        serverId: artifact.serverId,
        artifactId: artifact.id,
        starred: !artifact.starred,
      });
    },
    [toggleStar],
  );

  const handleDelete = useCallback(
    (artifact: AggregatedArtifact) => {
      void deleteArtifact({ serverId: artifact.serverId, artifactId: artifact.id });
    },
    [deleteArtifact],
  );

  const handleRegenerate = useCallback(
    (artifact: AggregatedArtifact) => {
      void regenerateArtifact({ serverId: artifact.serverId, artifactId: artifact.id });
    },
    [regenerateArtifact],
  );

  const handleCancel = useCallback(
    (artifact: AggregatedArtifact) => {
      void cancelArtifact({ serverId: artifact.serverId, artifactId: artifact.id });
    },
    [cancelArtifact],
  );
  const handleRepair = useCallback(
    (artifact: AggregatedArtifact) => {
      void repairArtifact({ serverId: artifact.serverId, artifactId: artifact.id });
    },
    [repairArtifact],
  );
  const handleUpdateData = useCallback(
    (artifact: AggregatedArtifact) => setDataUpdateArtifact(artifact),
    [],
  );
  const handleMove = useCallback(
    async (artifact: AggregatedArtifact, destination: "repository" | "host") => {
      if (movingArtifactIdRef.current === artifact.id) return;
      setMoveFailure(null);
      movingArtifactIdRef.current = artifact.id;
      setMovingArtifactId(artifact.id);
      try {
        await moveArtifactStore({
          serverId: artifact.serverId,
          artifactId: artifact.id,
          destination,
        });
      } catch (error) {
        setMoveFailure({ artifact, destination, message: toErrorMessage(error) });
      } finally {
        if (movingArtifactIdRef.current === artifact.id) {
          movingArtifactIdRef.current = null;
          setMovingArtifactId(null);
        }
      }
    },
    [moveArtifactStore],
  );
  const retryMove = useCallback(() => {
    if (!moveFailure) return;
    void handleMove(moveFailure.artifact, moveFailure.destination);
  }, [handleMove, moveFailure]);
  const dismissMoveFailure = useCallback(() => setMoveFailure(null), []);

  return (
    <View style={styles.container}>
      <MenuHeader title="Artifacts" />
      <ArtifactsBody
        artifacts={visibleArtifacts}
        hasAny={artifacts.length > 0}
        isInitialLoad={isInitialLoad}
        showLoadError={isError && artifacts.length === 0}
        hosts={hosts}
        selectedHost={selectedHost}
        onSelectHost={handleSelectHost}
        showHostColumn={hosts.length > 1 && selectedHost === ALL_HOSTS_OPTION_ID}
        projectNameByCwd={projectNameByCwd}
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        onProjectFilterChange={handleProjectFilterChange}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onRetry={refetch}
        onCreate={openCreate}
        onView={handleView}
        onViewGenerationChat={handleViewGenerationChat}
        onViewSourceChat={handleViewSourceChat}
        onEdit={handleEdit}
        onRegenerate={handleRegenerate}
        onCancel={handleCancel}
        onRepair={handleRepair}
        onUpdateData={handleUpdateData}
        onMove={handleMove}
        movingArtifactId={movingArtifactId}
        moveFailure={moveFailure}
        onRetryMove={retryMove}
        onDismissMoveFailure={dismissMoveFailure}
        onStar={handleStar}
        onDelete={handleDelete}
      />
      <ArtifactCreateSheet
        visible={form.mode !== "closed"}
        mode={form.mode === "edit" ? "edit" : "create"}
        artifact={form.mode === "edit" ? toEditTarget(form.artifact) : undefined}
        onClose={closeForm}
      />
      <ArtifactViewDialog artifact={viewingArtifact} onClose={closeView} />
      <ArtifactDataUpdateSheet artifact={dataUpdateArtifact} onClose={closeDataUpdate} />
      <TranscriptViewDialog target={transcriptTarget} onClose={closeTranscript} />
    </View>
  );
}

interface ArtifactsBodyProps {
  artifacts: AggregatedArtifact[];
  hasAny: boolean;
  isInitialLoad: boolean;
  showLoadError: boolean;
  hosts: ReturnType<typeof useHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  showHostColumn: boolean;
  projectNameByCwd: ReadonlyMap<string, string>;
  projectOptions: ProjectFilterOption[];
  projectFilter: string | undefined;
  onProjectFilterChange: (projectId: string | undefined) => void;
  statusFilter: ArtifactStatusFilter;
  onStatusFilterChange: (status: ArtifactStatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onRetry: () => void;
  onCreate: () => void;
  onView: (artifact: AggregatedArtifact) => void;
  onViewGenerationChat: (artifact: AggregatedArtifact) => void;
  onViewSourceChat: (artifact: AggregatedArtifact) => void;
  onEdit: (artifact: AggregatedArtifact) => void;
  onRegenerate: (artifact: AggregatedArtifact) => void;
  onCancel: (artifact: AggregatedArtifact) => void;
  onRepair: (artifact: AggregatedArtifact) => void;
  onUpdateData: (artifact: AggregatedArtifact) => void;
  onMove: (artifact: AggregatedArtifact, destination: "repository" | "host") => Promise<void>;
  movingArtifactId: string | null;
  moveFailure: ArtifactMoveFailure | null;
  onRetryMove: () => void;
  onDismissMoveFailure: () => void;
  onStar: (artifact: AggregatedArtifact) => void;
  onDelete: (artifact: AggregatedArtifact) => void;
}

function ArtifactsBody({
  artifacts,
  hasAny,
  isInitialLoad,
  showLoadError,
  hosts,
  selectedHost,
  onSelectHost,
  showHostColumn,
  projectNameByCwd,
  projectOptions,
  projectFilter,
  onProjectFilterChange,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  onRetry,
  onCreate,
  onView,
  onViewGenerationChat,
  onViewSourceChat,
  onEdit,
  onRegenerate,
  onCancel,
  onRepair,
  onUpdateData,
  onMove,
  movingArtifactId,
  moveFailure,
  onRetryMove,
  onDismissMoveFailure,
  onStar,
  onDelete,
}: ArtifactsBodyProps): ReactElement {
  if (isInitialLoad) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }

  if (showLoadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Unable to load artifacts</Text>
        <Button variant="ghost" onPress={onRetry} testID="artifacts-retry">
          Try again
        </Button>
      </View>
    );
  }

  if (!hasAny) {
    return (
      <View style={styles.centered} testID="artifacts-empty">
        <Text style={styles.message}>No artifacts yet</Text>
        <Button
          variant="outline"
          size="sm"
          leftIcon={FilePlus}
          onPress={onCreate}
          testID="artifacts-empty-new"
        >
          Create an artifact
        </Button>
      </View>
    );
  }

  let emptyFilterText = "No artifacts for this project";
  if (searchQuery.trim()) {
    emptyFilterText = "No matching artifacts";
  } else if (statusFilter !== "all") {
    const label = STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)?.label;
    emptyFilterText = `No ${label?.toLowerCase()} artifacts`;
  }

  // The filter is always shown so every project stays selectable - including
  // ones with no artifacts, which fall through to the empty text below.
  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.filterControls}>
          <SearchField
            value={searchQuery}
            onChangeText={onSearchQueryChange}
            placeholder="Search artifacts"
            clearAccessibilityLabel="Clear artifact search"
            testID="artifacts-search"
            clearTestID="artifacts-search-clear"
          />
          {hosts.length > 1 ? (
            <HostFilter hosts={hosts} selectedHost={selectedHost} onSelectHost={onSelectHost} />
          ) : null}
          <View style={styles.projectFilterSlot}>
            <ProjectFilter
              options={projectOptions}
              value={projectFilter}
              onChange={onProjectFilterChange}
            />
          </View>
          <SegmentedControl
            size="sm"
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={STATUS_FILTER_OPTIONS}
            testID="artifacts-status-filter"
          />
        </View>
        <Button
          leftIcon={Plus}
          onPress={onCreate}
          size="sm"
          style={styles.newButton}
          testID="artifacts-new"
        >
          New artifact
        </Button>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="artifacts-list"
      >
        {moveFailure ? (
          <View style={styles.moveFailure} testID="artifact-move-failure">
            <Text style={styles.moveFailureText}>
              Couldn&apos;t move {moveFailure.artifact.name || "this artifact"}:{" "}
              {moveFailure.message}
            </Text>
            <View style={styles.moveFailureActions}>
              <Button size="sm" variant="secondary" onPress={onRetryMove}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onPress={onDismissMoveFailure}>
                Dismiss
              </Button>
            </View>
          </View>
        ) : null}
        {artifacts.length > 0 ? (
          <ArtifactGrid
            artifacts={artifacts}
            showHost={showHostColumn}
            projectNameByCwd={projectNameByCwd}
            onView={onView}
            onViewGenerationChat={onViewGenerationChat}
            onViewSourceChat={onViewSourceChat}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onCancel={onCancel}
            onRepair={onRepair}
            onUpdateData={onUpdateData}
            onMove={onMove}
            movingArtifactId={movingArtifactId}
            onStar={onStar}
            onDelete={onDelete}
          />
        ) : (
          <View style={styles.filterEmpty} testID="artifacts-filter-empty">
            <Text style={styles.filterEmptyText}>{emptyFilterText}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  filterControls: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  projectFilterSlot: {
    flexShrink: 1,
  },
  // Tames the compactUp button doubling so the button, the project filter
  // beside it, and the status filter below all share the compact 32px control
  // height at every width.
  newButton: {
    minHeight: 32,
    paddingHorizontal: theme.spacing[4],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  moveFailure: {
    gap: theme.spacing[2],
    marginHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    marginBottom: theme.spacing[3],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.palette.red[500],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  moveFailureText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
  moveFailureActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  filterEmpty: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[6],
    alignItems: "center",
  },
  filterEmptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    textAlign: "center",
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
}));
