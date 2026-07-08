import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Plus } from "@/components/icons/material-icons";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ArtifactGrid } from "@/components/artifacts/artifact-grid";
import {
  ArtifactProjectFilter,
  type ArtifactProjectFilterOption,
} from "@/components/artifacts/artifact-project-filter";
import {
  ArtifactCreateSheet,
  type ArtifactEditTarget,
} from "@/components/artifacts/artifact-create-sheet";
import { useArtifacts, type AggregatedArtifact } from "@/artifacts/use-artifacts";
import { useArtifactMutations } from "@/artifacts/use-artifact-mutations";
import { artifactBelongsToWorkspace } from "@/artifacts/artifact-derivation";
import { buildScheduleProjectTargets } from "@/schedules/schedule-project-targets";
import { useProjects } from "@/hooks/use-projects";
import { useHosts } from "@/runtime/host-runtime";

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

function toEditTarget(artifact: AggregatedArtifact): ArtifactEditTarget {
  return {
    id: artifact.id,
    serverId: artifact.serverId,
    projectId: artifact.projectId,
    name: artifact.name,
    description: artifact.description,
    provider: artifact.generationProvider,
    model: artifact.generationModel,
  };
}

function ArtifactsScreenContent(): ReactElement {
  const { artifacts, isInitialLoad, isError, refetch } = useArtifacts();
  const { toggleStar, deleteArtifact, regenerateArtifact, cancelArtifact } = useArtifactMutations();
  const { projects } = useProjects();
  const hosts = useHosts();
  const showHost = hosts.length > 1;

  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<ArtifactFormState>({ mode: "closed" });
  const openCreate = useCallback(() => setForm({ mode: "create" }), []);
  const handleEdit = useCallback(
    (artifact: AggregatedArtifact) => setForm({ mode: "edit", artifact }),
    [],
  );
  const closeForm = useCallback(() => setForm({ mode: "closed" }), []);

  // The picker lists every known project (one entry per repo root), not just the
  // roots that happen to have artifacts — a project with none should still be
  // selectable and show an empty-state watermark.
  const projectOptions = useMemo<ArtifactProjectFilterOption[]>(() => {
    const byId = new Map<string, ArtifactProjectFilterOption>();
    for (const target of buildScheduleProjectTargets(projects)) {
      if (!byId.has(target.cwd)) {
        byId.set(target.cwd, { id: target.cwd, label: target.projectName });
      }
    }
    return Array.from(byId.values());
  }, [projects]);

  const visibleArtifacts = useMemo(
    () =>
      projectFilter === undefined
        ? artifacts
        : artifacts.filter((artifact) =>
            artifactBelongsToWorkspace(artifact.projectId, projectFilter),
          ),
    [artifacts, projectFilter],
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

  return (
    <View style={styles.container}>
      <MenuHeader title="Artifacts" />
      <ArtifactsBody
        artifacts={visibleArtifacts}
        hasAny={artifacts.length > 0}
        isInitialLoad={isInitialLoad}
        showLoadError={isError && artifacts.length === 0}
        showHost={showHost}
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
        onRetry={refetch}
        onCreate={openCreate}
        onEdit={handleEdit}
        onRegenerate={handleRegenerate}
        onCancel={handleCancel}
        onStar={handleStar}
        onDelete={handleDelete}
      />
      <ArtifactCreateSheet
        visible={form.mode !== "closed"}
        mode={form.mode === "edit" ? "edit" : "create"}
        artifact={form.mode === "edit" ? toEditTarget(form.artifact) : undefined}
        onClose={closeForm}
      />
    </View>
  );
}

interface ArtifactsBodyProps {
  artifacts: AggregatedArtifact[];
  hasAny: boolean;
  isInitialLoad: boolean;
  showLoadError: boolean;
  showHost: boolean;
  projectOptions: ArtifactProjectFilterOption[];
  projectFilter: string | undefined;
  onProjectFilterChange: (projectId: string | undefined) => void;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (artifact: AggregatedArtifact) => void;
  onRegenerate: (artifact: AggregatedArtifact) => void;
  onCancel: (artifact: AggregatedArtifact) => void;
  onStar: (artifact: AggregatedArtifact) => void;
  onDelete: (artifact: AggregatedArtifact) => void;
}

function ArtifactsBody({
  artifacts,
  hasAny,
  isInitialLoad,
  showLoadError,
  showHost,
  projectOptions,
  projectFilter,
  onProjectFilterChange,
  onRetry,
  onCreate,
  onEdit,
  onRegenerate,
  onCancel,
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

  // The filter is always shown so every project stays selectable — including
  // ones with no artifacts, which fall through to the watermark below.
  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <ArtifactProjectFilter
          options={projectOptions}
          value={projectFilter}
          onChange={onProjectFilterChange}
        />
        <Button leftIcon={Plus} onPress={onCreate} size="sm" testID="artifacts-new">
          New artifact
        </Button>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="artifacts-list"
      >
        {artifacts.length > 0 ? (
          <ArtifactGrid
            artifacts={artifacts}
            showHost={showHost}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onCancel={onCancel}
            onStar={onStar}
            onDelete={onDelete}
          />
        ) : (
          <View style={styles.filterEmpty} testID="artifacts-empty">
            <Text style={styles.filterEmptyText}>
              {projectFilter === undefined ? "No artifacts yet" : "No artifacts for this project"}
            </Text>
            {hasAny ? null : (
              <Button
                variant="ghost"
                leftIcon={Plus}
                onPress={onCreate}
                testID="artifacts-empty-new"
              >
                Create your first artifact
              </Button>
            )}
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
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  filterEmpty: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[6],
    alignItems: "center",
    gap: theme.spacing[4],
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
