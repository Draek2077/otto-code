import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { usePaseo, type PluginScreenProps } from "@getpaseo/plugin/client";
import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { BoardPanel } from "./board-panel.js";
import {
  projectHint,
  resolveProjectSelection,
  type ProjectChoice,
  type ProjectSelection,
} from "./project-selection.js";
import { useRead, type ReadState } from "./use-read.js";

export interface KanbanScreenProps extends PluginScreenProps {
  onProjectSelection(selection: ProjectSelection): void;
}

interface ProjectDirectory {
  projects: ProjectChoice[];
}
const panelStyle = { flex: 1, gap: 12 } as const;

function knownProjects(state: ReadState<ProjectDirectory>): ProjectChoice[] {
  return state.status === "ready" ? state.value.projects : (state.previous?.projects ?? []);
}

function useProjectDirectory(hostId: string) {
  const paseo = usePaseo();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const load = useCallback(() => paseo.projects.list(), [paseo]);
  const state = useRead({
    key: `${hostId}/${attempt}`,
    scope: hostId,
    enabled: true,
    load,
    errorMessage: "Projects could not be loaded from the selected host.",
  });
  useEffect(() => paseo.projects.subscribe(retry), [paseo, retry]);
  return { state, retry };
}

function useWorkspaceHint(props: KanbanScreenProps) {
  const paseo = usePaseo();
  const hint = projectHint(props.params);
  const workspaceId = props.params.projectHostId === props.host.id ? props.params.workspaceId : "";
  const load = useCallback(async () => {
    const workspace = await paseo.workspaces.ref(workspaceId ?? "").refresh();
    return workspace ? { hostId: props.host.id, projectId: workspace.projectId } : null;
  }, [paseo, props.host.id, workspaceId]);
  const state = useRead({
    key: `${props.host.id}/${workspaceId ?? ""}`,
    enabled: Boolean(workspaceId) && !hint,
    load,
    errorMessage: "The workspace context could not be read. Choose a project below.",
  });
  return {
    hint: hint ?? (state.status === "ready" ? state.value : null),
    error: state.status === "error" ? state.message : "",
  };
}

function ProjectDirectoryBoundary({
  state,
  retry,
  children,
}: {
  state: ReadState<ProjectDirectory>;
  retry(): void;
  children: ReactNode;
}) {
  if (knownProjects(state).length) return children;
  if (state.status === "loading") return <SettingsRow label="Loading projects..." />;
  if (state.status === "error")
    return (
      <SettingsCard>
        <SettingsRow label="Projects unavailable" error={state.message} />
        <SettingsButton onPress={retry}>Retry</SettingsButton>
      </SettingsCard>
    );
  return (
    <SettingsCard>
      <SettingsRow label="This host has no available projects. Add a project to get started." />
    </SettingsCard>
  );
}

function ProjectPicker({
  projects,
  selectedId,
  locked,
  select,
}: {
  projects: ProjectChoice[];
  selectedId: string | null;
  locked: boolean;
  select(projectId: string): void;
}) {
  const options = useMemo(
    () => [
      { label: "Choose a project", value: "" },
      ...projects.map((project) => ({
        label: project.projectDisplayName,
        value: project.projectId,
      })),
    ],
    [projects],
  );
  return (
    <SettingsSelect
      label="Project"
      value={selectedId ?? ""}
      options={options}
      onValueChange={select}
      disabled={locked}
      hint={locked ? "Save or cancel Project Settings to choose another project." : undefined}
    />
  );
}

export function ProjectScreen(props: KanbanScreenProps) {
  const { host, onProjectSelection } = props;
  const directory = useProjectDirectory(props.host.id);
  const workspace = useWorkspaceHint(props);
  const [explicit, setExplicit] = useState<ProjectSelection | null>(null);
  const [editing, setEditing] = useState<ProjectSelection | null>(null);
  const projects = knownProjects(directory.state);
  const selectedId = resolveProjectSelection({
    hostId: props.host.id,
    projects,
    explicit,
    hint: workspace.hint,
  });
  const selected = projects.find((project) => project.projectId === selectedId);
  const select = useCallback(
    (projectId: string) => {
      const selection = { hostId: host.id, projectId };
      setExplicit(selection);
      onProjectSelection(selection);
    },
    [host.id, onProjectSelection],
  );
  const onEditingChange = useCallback(
    (isEditing: boolean) => {
      setEditing(isEditing && selectedId ? { hostId: props.host.id, projectId: selectedId } : null);
    },
    [props.host.id, selectedId],
  );
  const pickerLocked = editing?.hostId === props.host.id && editing.projectId === selectedId;
  return (
    <ProjectDirectoryBoundary state={directory.state} retry={directory.retry}>
      <View style={panelStyle}>
        <ProjectPicker
          projects={projects}
          selectedId={selectedId}
          locked={pickerLocked}
          select={select}
        />
        {directory.state.status === "error" ? (
          <SettingsCard>
            <SettingsRow label="Project refresh failed" error={directory.state.message} />
            <SettingsButton onPress={directory.retry}>Retry</SettingsButton>
          </SettingsCard>
        ) : null}
        {workspace.error ? <SettingsRow label={workspace.error} /> : null}
        {selected ? (
          <BoardPanel
            key={`${props.host.id}/${selected.projectId}`}
            project={selected}
            host={props.host}
            layout={props.layout}
            theme={props.theme}
            onEditingChange={onEditingChange}
          />
        ) : (
          <SettingsRow label="Choose a project to view its board." />
        )}
      </View>
    </ProjectDirectoryBoundary>
  );
}
