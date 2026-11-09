import { useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import {
  usePaseo,
  type PluginScreenProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  ViewIdentity,
  ViewSelection,
  ViewReference,
  type ViewScope,
} from "@getpaseo/plugin/otto/architectural-views";
import { useFetchQuery } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { SettingsSelect } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { ViewLibrary } from "./library";
import { viewNavigationIntents } from "./navigation";
import { styles } from "./styles";
const destinationSchema = z.object({
  identity: ViewIdentity.optional(),
  selection: ViewSelection.optional(),
  reference: ViewReference.optional(),
});
function parseDestination(raw: string | undefined) {
  if (!raw) return undefined;
  if (raw.length > 8000) return null;
  try {
    const result = destinationSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function useViewWorkspaceOptions(
  hostId: string,
  active: boolean,
  projectId?: string,
  workspaceId?: string,
) {
  const paseo = usePaseo();
  const query = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 2000,
    queryKey: ["ottoViews", hostId, "workspaces"],
    enabled: active,
    retry: false,
    queryFn: async () => (await paseo.workspaces.list()).entries,
  });
  const ownerProjectId =
    projectId || query.data?.find((entry) => entry.id === workspaceId)?.projectId;
  return useMemo(
    () => [
      { value: "", label: "Choose an authoring workspace" },
      ...(query.data ?? [])
        .filter((entry) => ownerProjectId && entry.projectId === ownerProjectId)
        .map((entry) => ({ value: entry.id, label: entry.name })),
    ],
    [query.data, ownerProjectId],
  );
}
export function ArchitecturalViewsScreen(props: PluginScreenProps) {
  const visible = useAppVisible(),
    retained = useRetainedPanelActive(),
    active = visible && retained && props.active === true;
  const paseo = usePaseo();
  const [projectId, setProjectId] = useState(
    props.params.projectHostId === props.host.id ? (props.params.projectId ?? "") : "",
  );
  const projects = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: ["ottoViews", props.host.id, "projects"],
    enabled: active,
    retry: false,
    queryFn: () => paseo.projects.list(),
  });
  const choices = useMemo(
    () => [
      { value: "", label: "Choose a project" },
      ...(projects.data?.projects ?? []).map((entry) => ({
        value: entry.projectId,
        label: entry.projectDisplayName,
      })),
    ],
    [projects.data],
  );
  const scope = useMemo<ViewScope>(
    () => ({ hostId: props.host.id, target: { kind: "project", id: projectId } }),
    [props.host.id, projectId],
  );
  const workspaces = useViewWorkspaceOptions(props.host.id, active, projectId);
  const destination = useMemo(
    () =>
      props.params.projectHostId === props.host.id && props.params.projectId === projectId
        ? parseDestination(props.params.target)
        : undefined,
    [
      props.params.projectHostId,
      props.host.id,
      props.params.projectId,
      props.params.target,
      projectId,
    ],
  );
  const content = () => {
    if (destination === null)
      return (
        <View style={styles.content}>
          <Alert
            variant="error"
            description="This View link is invalid. Choose the owning project and open its library."
          />
        </View>
      );
    if (projectId)
      return (
        <ViewLibrary
          key={`${props.host.id}/${projectId}`}
          scope={scope}
          active={active}
          workspaceId=""
          workspaces={workspaces}
          destination={destination}
        />
      );
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>Choose a project to browse its Architectural Views.</Text>
      </View>
    );
  };
  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <SettingsSelect
          label="Project"
          value={projectId}
          options={choices}
          onValueChange={setProjectId}
        />
        {projects.error ? <Alert variant="error" description={projects.error.message} /> : null}
      </View>
      {content()}
    </View>
  );
}
export function ArchitecturalViewsWorkspace(props: PluginWorkspacePanelProps) {
  const visible = useAppVisible(),
    retained = useRetainedPanelActive(),
    active = visible && retained;
  useSyncExternalStore(viewNavigationIntents.subscribe, viewNavigationIntents.getSnapshot);
  const destination = viewNavigationIntents.get(props.host.id, props.workspaceId);
  const scope = useMemo<ViewScope>(
    () => ({ hostId: props.host.id, target: { kind: "workspace", id: props.workspaceId } }),
    [props.host.id, props.workspaceId],
  );
  const workspaces = useViewWorkspaceOptions(props.host.id, active, undefined, props.workspaceId);
  return (
    <ViewLibrary
      key={`${props.host.id}/${props.workspaceId}`}
      scope={scope}
      active={active}
      workspaceId={props.workspaceId}
      workspaces={workspaces}
      destination={destination}
    />
  );
}
