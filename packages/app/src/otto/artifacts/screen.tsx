import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  listArtifacts,
  aggregateArtifacts,
  type ArtifactScope,
  type ArtifactSummary,
} from "@getpaseo/plugin/otto/artifacts";
import { useFetchQuery } from "@/data/query";
import { SettingsSelect } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ArtifactDetail } from "./detail";
import { ArtifactCreate } from "./create";
import { ArtifactDefaults, ArtifactProjectStorage } from "./settings";
import { styles } from "./styles";
type Navigation = PluginSurfaceProps["navigation"];
interface LibraryProps {
  hostId: string;
  scope: ArtifactScope | null;
  active: boolean;
  navigation: Navigation;
}
function useArtifactProjects(hostId: string, active: boolean) {
  const paseo = usePaseo();
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoArtifacts", hostId, "projects"],
    enabled: active,
    retry: false,
    queryFn: () => paseo.projects.list(),
  });
}
function LibraryItem({
  item,
  projectLabel,
  selected,
  open,
}: {
  item: ArtifactSummary;
  projectLabel?: string;
  selected: boolean;
  open(item: ArtifactSummary): void;
}) {
  const select = useCallback(() => open(item), [open, item]);
  return (
    <View style={styles.card} testID={`artifact-card-${item.id}`}>
      <Text style={styles.title}>{`${item.starred ? "★ " : ""}${item.name}`}</Text>
      <Text numberOfLines={2} style={styles.muted}>
        {item.description}
      </Text>
      <Text style={styles.muted}>
        {[item.status, item.location, projectLabel].filter(Boolean).join(" · ")}
      </Text>
      {item.error ? <Text style={styles.muted}>{item.error}</Text> : null}
      <Button variant={selected ? "secondary" : "outline"} size="sm" onPress={select}>
        Open artifact
      </Button>
    </View>
  );
}
function useLibrary(props: LibraryProps, query: string, offset: number) {
  const list = useRpc(listArtifacts),
    aggregate = useRpc(aggregateArtifacts);
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: [
      "ottoArtifacts",
      props.hostId,
      "library",
      props.scope?.target.kind,
      props.scope?.target.id,
      query,
      offset,
    ],
    enabled: props.active,
    retry: false,
    refetchInterval: props.active ? 10000 : false,
    queryFn: async () => {
      const result = props.scope
        ? await list({ scope: props.scope, query, offset })
        : await aggregate({ hostId: props.hostId, query, offset });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
}
function ArtifactList({
  library,
  projectNames,
  selected,
  setSelected,
  offset,
  previous,
  next,
}: {
  library: ReturnType<typeof useLibrary>;
  projectNames: ReadonlyMap<string, string>;
  selected: ArtifactSummary | null;
  setSelected(item: ArtifactSummary): void;
  offset: number;
  previous(): void;
  next(): void;
}) {
  return (
    <View style={styles.content}>
      {library.error ? <Alert variant="error" description={library.error.message} /> : null}
      {!library.data && !library.error ? (
        <Text style={styles.muted}>Loading Artifacts...</Text>
      ) : null}
      {library.data?.diagnostics.map((message) => (
        <Alert key={message} variant="warning" description={message} />
      ))}
      {library.data?.items.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>No artifacts yet</Text>
          <Text style={styles.muted}>
            Create an interactive report, dashboard or visual tool. Each deliverable stays with its
            project.
          </Text>
        </View>
      ) : null}
      {library.data?.items.map((item) => (
        <LibraryItem
          key={`${item.projectId}/${item.location}/${item.id}`}
          item={item}
          projectLabel={projectNames.get(item.projectId)}
          selected={selected?.id === item.id && selected.location === item.location}
          open={setSelected}
        />
      ))}
      <View style={styles.actions}>
        <Button variant="outline" size="sm" disabled={offset === 0} onPress={previous}>
          Previous results
        </Button>
        <Text
          style={styles.muted}
        >{`${offset + 1}–${Math.min(offset + 100, library.data?.total ?? 0)} of ${library.data?.total ?? 0}`}</Text>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + 100 >= (library.data?.total ?? 0)}
          onPress={next}
        >
          Next results
        </Button>
      </View>
    </View>
  );
}
function ArtifactLibrary(props: LibraryProps) {
  const projects = useArtifactProjects(props.hostId, props.active);
  const projectNames = useMemo(
    () =>
      new Map(
        (projects.data?.projects ?? []).map((project) => [
          project.projectId,
          project.projectDisplayName,
        ]),
      ),
    [projects.data],
  );
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<ArtifactSummary | null>(null),
    [creating, setCreating] = useState(false);
  const input = useRef<EditingTextInputHandle | null>(null);
  const compact = useIsCompactFormFactor();
  const library = useLibrary(props, query, offset);
  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    setOffset(0);
  }, []);
  const clear = useCallback(() => {
    input.current?.replaceText("");
    changeQuery("");
  }, [changeQuery]);
  const openCreate = useCallback(() => setCreating(true), []),
    closeCreate = useCallback(() => setCreating(false), []);
  const close = useCallback(() => setSelected(null), []);
  const refresh = useCallback(() => {
    void library.refetch();
  }, [library]);
  const created = useCallback(
    (item: ArtifactSummary) => {
      setCreating(false);
      setSelected(item);
      refresh();
    },
    [refresh],
  );
  const previous = useCallback(() => setOffset((value) => Math.max(0, value - 100)), []),
    next = useCallback(() => setOffset((value) => value + 100), []);
  const reference = useMemo(
    () =>
      selected
        ? {
            scope: {
              hostId: props.hostId,
              target: { kind: "project" as const, id: selected.projectId },
            },
            id: selected.id,
            location: selected.location,
          }
        : null,
    [props.hostId, selected],
  );
  const listContent = (
    <ArtifactList
      library={library}
      projectNames={projectNames}
      selected={selected}
      setSelected={setSelected}
      offset={offset}
      previous={previous}
      next={next}
    />
  );
  const detail = (
    <>
      {creating && props.scope ? (
        <ArtifactCreate
          scope={props.scope}
          active={props.active}
          created={created}
          close={closeCreate}
        />
      ) : null}
      {reference ? (
        <ArtifactDetail
          key={JSON.stringify(reference)}
          reference={reference}
          projectLabel={selected ? projectNames.get(selected.projectId) : undefined}
          active={props.active}
          changed={refresh}
          closed={close}
          navigation={props.navigation}
        />
      ) : null}
      {!reference && !creating ? (
        <View style={styles.content}>
          <Text style={styles.title}>Project deliverables</Text>
          <Text style={styles.muted}>
            Choose an artifact to preview it, refresh only its data, or explicitly regenerate its
            design.
          </Text>
        </View>
      ) : null}
    </>
  );
  return (
    <View style={styles.page} testID="otto-artifacts-page">
      <View style={styles.toolbar}>
        <View style={styles.actions}>
          <View style={styles.column}>
            <FormTextInput
              ref={input}
              accessibilityLabel="Search artifacts"
              initialValue={query}
              onChangeText={changeQuery}
              placeholder="Search artifacts"
            />
          </View>
          <Button variant="ghost" disabled={!query} onPress={clear}>
            Clear search
          </Button>
        </View>
        <View style={styles.actions}>
          <Button disabled={!props.scope || creating} onPress={openCreate}>
            New artifact
          </Button>
          <Button variant="outline" onPress={refresh}>
            Refresh artifacts
          </Button>
          {reference ? (
            <Button variant="ghost" onPress={close}>
              Close selection
            </Button>
          ) : null}
        </View>
        {!props.scope ? (
          <Text style={styles.muted}>
            All projects on this host. Choose a project above to create an artifact.
          </Text>
        ) : null}
      </View>
      {compact ? (
        <ScrollView style={styles.column}>
          {listContent}
          <View style={styles.content}>{detail}</View>
        </ScrollView>
      ) : (
        <View style={styles.columns}>
          <ScrollView style={styles.list} testID="artifact-library-list">
            {listContent}
          </ScrollView>
          <ScrollView style={styles.column}>{detail}</ScrollView>
        </View>
      )}
    </View>
  );
}
function ProjectDirectory({
  hostId,
  active,
  settings = false,
  navigation,
}: {
  hostId: string;
  active: boolean;
  settings?: boolean;
  navigation: Navigation;
}) {
  const [projectId, setProjectId] = useState("");
  const projects = useArtifactProjects(hostId, active);
  const options = useMemo(
    () => [
      { value: "", label: settings ? "Choose a project" : "All projects" },
      ...(projects.data?.projects ?? []).map((project) => ({
        value: project.projectId,
        label: project.projectDisplayName,
      })),
    ],
    [projects.data, settings],
  );
  const scope = useMemo<ArtifactScope | null>(
    () => (projectId ? { hostId, target: { kind: "project", id: projectId } } : null),
    [hostId, projectId],
  );
  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        {settings ? <ArtifactDefaults hostId={hostId} active={active} /> : null}
        <SettingsSelect
          label="Project"
          value={projectId}
          options={options}
          onValueChange={setProjectId}
        />
        {projects.error ? (
          <Alert
            variant="error"
            description="Projects could not be loaded from the selected host."
          />
        ) : null}
      </View>
      {settings && scope ? <ProjectStorageSettings scope={scope} active={active} /> : null}
      {!settings ? (
        <ArtifactLibrary
          key={`${hostId}/${projectId}`}
          hostId={hostId}
          scope={scope}
          active={active}
          navigation={navigation}
        />
      ) : null}
    </View>
  );
}
export function ProjectStorageSettings({
  scope,
  active,
}: {
  scope: ArtifactScope;
  active: boolean;
}) {
  return (
    <View style={styles.settings}>
      <ArtifactProjectStorage scope={scope} active={active} />
    </View>
  );
}
export function ArtifactsScreen(props: PluginScreenProps) {
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  return (
    <ProjectDirectory
      key={props.host.id}
      hostId={props.host.id}
      active={retained && visible && props.active === true}
      navigation={props.navigation}
    />
  );
}
export function ArtifactsWorkspace(props: PluginWorkspacePanelProps) {
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const scope = useMemo<ArtifactScope>(
    () => ({ hostId: props.host.id, target: { kind: "workspace", id: props.workspaceId } }),
    [props.host.id, props.workspaceId],
  );
  return (
    <ArtifactLibrary
      hostId={props.host.id}
      scope={scope}
      active={retained && visible}
      navigation={props.navigation}
    />
  );
}
export function ArtifactsSettings(props: PluginSurfaceProps) {
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  return (
    <ProjectDirectory
      key={props.host.id}
      hostId={props.host.id}
      active={retained && visible && props.active === true}
      settings
      navigation={props.navigation}
    />
  );
}
