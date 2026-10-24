import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import {
  usePaseo,
  useRpc,
  type PluginScreenProps,
  type PluginSurfaceProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  mutateKnowledge,
  readKnowledgeCatalog,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { KnowledgeCatalogView } from "./catalog";
import { KnowledgeDocument, type KnowledgeSelection } from "./document";
import { KnowledgeEditor } from "./editor";
import type { EditorSeed } from "./editor-model";
import { KnowledgeStorage } from "./storage";
import { styles } from "./styles";
import { useKnowledgeChanges } from "./use-knowledge-changes";
import { KnowledgeLinkHealth } from "./link-health";
import { KnowledgeFormat } from "./format";
import { KnowledgeHostDefaults } from "./host-defaults";

function KnowledgeBody({
  scope,
  active,
  settingsOnly = false,
}: {
  scope: KnowledgeScope;
  active: boolean;
  settingsOnly?: boolean;
}) {
  const readCatalog = useRpc(readKnowledgeCatalog);
  const mutate = useRpc(mutateKnowledge);
  const cache = useQueryClient();
  const [query, updateQuery] = useState("");
  const [inactive, updateInactive] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<KnowledgeSelection | null>(null);
  const [editor, setEditor] = useState<EditorSeed | null>(null);
  const [actionError, setActionError] = useState("");
  const [initializing, setInitializing] = useState(false);
  const catalog = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: [
      "ottoKnowledge",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "catalog",
      query,
      inactive,
      offset,
    ],
    enabled: active,
    retry: false,
    queryFn: async () => {
      const result = await readCatalog({
        scope,
        includeInactive: inactive,
        query,
        offset,
        limit: 50,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const observationError = useKnowledgeChanges(
    scope.hostId,
    catalog.data?.settings.projectId,
    active,
  );
  const setQuery = useCallback((value: string) => {
    updateQuery(value);
    setOffset(0);
  }, []);
  const setInactive = useCallback((value: boolean) => {
    updateInactive(value);
    setOffset(0);
  }, []);
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ["ottoKnowledge", scope.hostId] });
  }, [cache, scope.hostId]);
  const closeEditor = useCallback(() => setEditor(null), []);
  const saved = useCallback(() => {
    setEditor(null);
    refresh();
  }, [refresh]);
  const create = useCallback(() => setEditor({}), []);
  const back = useCallback(() => setSelection(null), []);
  const initialize = useCallback(async () => {
    if (initializing) return;
    setInitializing(true);
    setActionError("");
    try {
      const result = await mutate({ scope, command: { action: "initialize" } });
      if (!result.ok) setActionError(result.error.message);
      else refresh();
    } catch {
      setActionError("The initialization outcome is unknown. Reload before another attempt.");
    } finally {
      setInitializing(false);
    }
  }, [initializing, mutate, scope, refresh]);
  if (editor)
    return <KnowledgeEditor scope={scope} seed={editor} onSaved={saved} onCancel={closeEditor} />;
  if (catalog.error)
    return (
      <>
        <Alert variant="error" description={catalog.error.message} />
        <Button variant="outline" onPress={refresh}>
          Retry
        </Button>
        <KnowledgeFormat key="format" scope={scope} active={active} />
      </>
    );
  if (!catalog.data) return <SettingsRow label="Loading Project Knowledge..." />;
  if (settingsOnly)
    return (
      <>
        <KnowledgeStorage scope={scope} settings={catalog.data.settings} onChanged={refresh} />
        <KnowledgeFormat key="format" scope={scope} active={active} />
      </>
    );
  return (
    <>
      <SettingsSection title={catalog.data.settings.label}>
        <View style={styles.actions}>
          <Button variant="outline" size="sm" onPress={refresh}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" onPress={create}>
            New entry
          </Button>
          <Button variant="outline" size="sm" onPress={initialize} disabled={initializing}>
            {initializing ? "Initializing..." : "Initialize roots"}
          </Button>
          {selection ? (
            <Button variant="outline" size="sm" onPress={back}>
              Back to pages
            </Button>
          ) : null}
        </View>
      </SettingsSection>
      {actionError ? <Alert variant="error" description={actionError} /> : null}
      {observationError ? <Alert variant="warning" description={observationError} /> : null}
      {selection ? (
        <KnowledgeDocument
          scope={scope}
          selection={selection}
          active={active}
          onEdit={setEditor}
          onMissing={back}
        />
      ) : (
        <KnowledgeCatalogView
          catalog={catalog.data}
          query={query}
          inactive={inactive}
          offset={offset}
          setQuery={setQuery}
          setInactive={setInactive}
          setOffset={setOffset}
          onSelect={setSelection}
        />
      )}
      <KnowledgeLinkHealth scope={scope} active={active} onSelect={setSelection} />
      <KnowledgeStorage scope={scope} settings={catalog.data.settings} onChanged={refresh} />
      <KnowledgeFormat key="format" scope={scope} active={active} />
    </>
  );
}

function ScopeFrame({
  scope,
  settingsOnly = false,
  embedded = false,
}: {
  scope: KnowledgeScope;
  settingsOnly?: boolean;
  embedded?: boolean;
}) {
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={embedded ? undefined : styles.content}
      testID="otto-knowledge-page"
    >
      <KnowledgeBody scope={scope} active={retained && visible} settingsOnly={settingsOnly} />
    </ScrollView>
  );
}

export function ProjectKnowledgeWorkspace(props: PluginWorkspacePanelProps) {
  const scope = useMemo<KnowledgeScope>(
    () => ({ hostId: props.host.id, target: { kind: "workspace", id: props.workspaceId } }),
    [props.host.id, props.workspaceId],
  );
  return <ScopeFrame scope={scope} key={`${props.host.id}/${props.workspaceId}`} />;
}

function ProjectPicker({
  hostId,
  settingsOnly = false,
}: {
  hostId: string;
  settingsOnly?: boolean;
}) {
  const paseo = usePaseo();
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const active = retained && visible;
  const [projectId, setProjectId] = useState("");
  const projects = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    enabled: active,
    queryKey: ["ottoKnowledge", hostId, "projects"],
    queryFn: () => paseo.projects.list(),
    retry: false,
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
  const scope = useMemo<KnowledgeScope>(
    () => ({ hostId, target: { kind: "project", id: projectId } }),
    [hostId, projectId],
  );
  const body = (
    <>
      {settingsOnly ? <KnowledgeHostDefaults hostId={hostId} active={active} /> : null}
      <SettingsSelect
        label="Project"
        value={projectId}
        options={options}
        onValueChange={setProjectId}
      />
      {projects.error ? (
        <Alert variant="error" description="Projects could not be loaded from the selected host." />
      ) : null}
      {projectId ? (
        <KnowledgeBody key={projectId} scope={scope} active={active} settingsOnly={settingsOnly} />
      ) : (
        <SettingsRow label="Choose the project whose Knowledge you want to open." />
      )}
    </>
  );
  if (settingsOnly) return <View>{body}</View>;
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {body}
    </ScrollView>
  );
}
export function ProjectKnowledgeScreen(props: PluginScreenProps) {
  return <ProjectPicker key={props.host.id} hostId={props.host.id} />;
}
export function ProjectKnowledgeSettings(props: PluginSurfaceProps) {
  return <ProjectPicker key={props.host.id} hostId={props.host.id} settingsOnly />;
}
