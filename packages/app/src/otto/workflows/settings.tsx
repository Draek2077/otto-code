import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { usePaseo, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { WorkflowScope } from "@getpaseo/plugin/otto/workflows";
import { SettingsCard, SettingsSelect, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useFetchQuery } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useWorkflowApi, WorkflowApiProvider } from "./api";
import { WorkflowStorageForm } from "./settings-model";
import { styles } from "./styles";
const locations = [
  { value: "repository", label: "Repository (.otto/workflows)" },
  { value: "host", label: "Owning daemon host" },
];
const projectLocations = [
  { value: "inherit", label: "Existing repository store or host default" },
  ...locations,
];
interface Seed {
  revision: string;
  value: string;
}
function Storage({
  seed,
  active,
  project,
  read,
  write,
}: {
  seed: Seed;
  active: boolean;
  project: boolean;
  read(): Promise<Seed>;
  write(revision: string, value: string): Promise<Seed>;
}) {
  const [model] = useState(() => new WorkflowStorageForm(seed.revision, seed.value)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const select = useCallback((value: string) => model.select(value), [model]),
    save = useCallback(() => model.save(write), [model, write]),
    reload = useCallback(
      () =>
        model.reload(read, () =>
          confirmDialog({
            title: "Reload Workflow storage?",
            message:
              "Discard the local preference and reload saved settings? Existing documents will not move.",
            confirmLabel: "Reload",
            cancelLabel: "Keep draft",
          }),
        ),
      [model, read],
    );
  return (
    <SettingsSection title={project ? "Project Workflow storage" : "Workflow storage default"}>
      <SettingsCard>
        <SettingsSelect
          label="New Workflow documents"
          hint="Independent of Knowledge, Artifacts and Schedules. Use an explicit transfer to move existing files."
          value={state.value}
          options={project ? projectLocations : locations}
          onValueChange={select}
          disabled={state.busy}
        />
      </SettingsCard>
      <View style={styles.actions}>
        <Button
          variant="outline"
          onPress={save}
          disabled={!active || state.busy || state.blocked || !state.changed}
        >
          Save storage
        </Button>
        <Button variant="ghost" onPress={reload} disabled={!active || state.busy}>
          Reload saved
        </Button>
      </View>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {seed.revision !== state.revision ? (
        <Alert
          variant="warning"
          description="Saved settings changed. This draft keeps its original revision until an explicit reload."
        />
      ) : null}
    </SettingsSection>
  );
}
export function WorkflowProjectStorage({
  scope,
  active,
}: {
  scope: WorkflowScope;
  active: boolean;
}) {
  const api = useWorkflowApi();
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflows", scope.hostId, scope.projectId, "storage"],
    enabled: active,
    retry: false,
    queryFn: () => api.storage(scope),
  });
  const read = useCallback(async () => {
    const value = await api.storage(scope);
    return { revision: value.revision, value: value.override ?? "inherit" };
  }, [api, scope]);
  const write = useCallback(
    async (revision: string, value: string) => {
      if (value !== "inherit" && value !== "repository" && value !== "host")
        throw new Error("Choose a storage location.");
      const saved = await api.setStorage({
        scope,
        expectedRevision: revision,
        location: value === "inherit" ? null : value,
      });
      void query.refetch();
      return { revision: saved.revision, value: saved.override ?? "inherit" };
    },
    [api, scope, query],
  );
  const seed = useMemo(
    () =>
      query.data
        ? { revision: query.data.revision, value: query.data.override ?? "inherit" }
        : null,
    [query.data],
  );
  return (
    <View style={styles.settings}>
      {seed ? <Storage seed={seed} active={active} project read={read} write={write} /> : null}
      {query.error ? <Alert variant="error" description={query.error.message} /> : null}
    </View>
  );
}
function Defaults({ hostId, active }: { hostId: string; active: boolean }) {
  const api = useWorkflowApi();
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflowDefaults", hostId],
    enabled: active,
    retry: false,
    queryFn: () => api.defaults({ hostId }),
  });
  const read = useCallback(async () => {
    const value = await api.defaults({ hostId });
    return { revision: value.revision, value: value.location };
  }, [api, hostId]);
  const write = useCallback(
    async (revision: string, value: string) => {
      if (value !== "repository" && value !== "host") throw new Error("Choose a storage location.");
      const saved = await api.setDefaults({ hostId, expectedRevision: revision, location: value });
      void query.refetch();
      return { revision: saved.revision, value: saved.location };
    },
    [api, hostId, query],
  );
  const seed = useMemo(
    () => (query.data ? { revision: query.data.revision, value: query.data.location } : null),
    [query.data],
  );
  return (
    <View>
      {seed ? (
        <Storage seed={seed} active={active} project={false} read={read} write={write} />
      ) : null}
      {query.error ? <Alert variant="error" description={query.error.message} /> : null}
    </View>
  );
}
export function WorkflowsSettings(props: PluginSurfaceProps) {
  return (
    <WorkflowApiProvider key={props.host.id}>
      <SettingsContent {...props} />
    </WorkflowApiProvider>
  );
}
function SettingsContent(props: PluginSurfaceProps) {
  const paseo = usePaseo(),
    retained = useRetainedPanelActive(),
    visible = useAppVisible(),
    active = retained && visible && props.active === true,
    [projectId, setProject] = useState("");
  const projects = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflowProjects", props.host.id],
    enabled: active,
    retry: false,
    queryFn: () => paseo.projects.list(),
  });
  const options = useMemo(
    () => [
      { value: "", label: "Choose a project" },
      ...(projects.data?.projects ?? []).map((project) => ({
        value: project.projectId,
        label: project.projectDisplayName,
      })),
    ],
    [projects.data],
  );
  const scope = useMemo(() => ({ hostId: props.host.id, projectId }), [props.host.id, projectId]);
  return (
    <ScrollView>
      <View style={styles.settings}>
        <Defaults hostId={props.host.id} active={active} />
        <SettingsSelect
          label="Project override"
          value={projectId}
          options={options}
          onValueChange={setProject}
        />
        {projectId ? (
          <WorkflowProjectStorage key={projectId} scope={scope} active={active} />
        ) : null}
        {projects.error ? <Alert variant="error" description={projects.error.message} /> : null}
      </View>
    </ScrollView>
  );
}
