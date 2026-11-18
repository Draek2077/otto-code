import { lazy, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import type { z } from "zod";
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
  readKnowledgePage,
  readKnowledgeRoot,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsRow, SettingsCollapsibleRow } from "@/components/settings";
import { useIsCompactFormFactor } from "@/constants/layout";
import { KnowledgeReadingLayout } from "./reading-layout";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { KnowledgeCatalogView } from "./catalog";
import type { KnowledgeSelection } from "./document";
import { FeatureScopeSelect, featureBrowserStyles } from "../ui/feature-browser";
const KnowledgeDocument = lazy(async () => ({
  default: (await import("./document")).KnowledgeDocument,
}));
const KnowledgeEditor = lazy(async () => ({ default: (await import("./editor")).KnowledgeEditor }));
import type { EditorSeed, EditorReloadTarget } from "./editor-model";
import { KnowledgeStorage } from "./storage";
import { styles } from "./styles";
import { useKnowledgeChanges } from "./use-knowledge-changes";
import { KnowledgeLinkHealth } from "./link-health";
import { KnowledgeFormat } from "./format";
import { KnowledgeHostDefaults } from "./host-defaults";
import { KnowledgeProjectSettings } from "./project-settings";
import { KnowledgeStorageSetup } from "./setup";
import { KnowledgeLockRecovery } from "./lock-recovery";
import { knowledgeEditorDraftsFor } from "./editor-drafts";

async function readEditorSeed(
  scope: KnowledgeScope,
  target: EditorReloadTarget,
  readers: {
    page(
      input: z.input<typeof readKnowledgePage.input>,
    ): Promise<z.output<typeof readKnowledgePage.output>>;
    root(
      input: z.input<typeof readKnowledgeRoot.input>,
    ): Promise<z.output<typeof readKnowledgeRoot.output>>;
  },
): Promise<EditorSeed> {
  if (target.type === "page") {
    const result = await readers.page({ scope, kind: target.kind, id: target.id });
    if (!result.ok) throw new Error("Saved Knowledge could not be read");
    return { page: result.value };
  }
  const result = await readers.root({ scope, slug: target.slug });
  if (!result.ok) throw new Error("Saved Knowledge root could not be read");
  return {
    root: {
      slug: target.slug,
      body: result.value?.body ?? "",
      revision: result.value?.revision ?? null,
    },
  };
}

function KnowledgeBody({
  scope,
  active,
  settingsOnly = false,
  leading,
}: {
  leading?: import("react").ReactNode;
  scope: KnowledgeScope;
  active: boolean;
  settingsOnly?: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const readCatalog = useRpc(readKnowledgeCatalog);
  const mutate = useRpc(mutateKnowledge);
  const readPage = useRpc(readKnowledgePage);
  const readRoot = useRpc(readKnowledgeRoot);
  const paseo = usePaseo();
  const drafts = useMemo(() => knowledgeEditorDraftsFor(paseo), [paseo]);
  useSyncExternalStore(drafts.subscribe, drafts.getSnapshot);
  const editor = settingsOnly ? null : drafts.get(scope);
  const cache = useQueryClient();
  const [query, updateQuery] = useState("");
  const [inactive, updateInactive] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<KnowledgeSelection | null>(null);
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
  const closeEditor = useCallback(() => {
    if (editor) drafts.discard(scope, editor);
  }, [drafts, scope, editor]);
  const saved = useCallback(() => {
    if (editor && drafts.discard(scope, editor)) refresh();
  }, [refresh, drafts, scope, editor]);
  const openEditor = useCallback(
    (seed: EditorSeed) => {
      try {
        drafts.open({
          scope,
          seed,
          submit: async (command) => {
            const result = await mutate({ scope, command });
            return result.ok
              ? { ok: true }
              : { ok: false, message: result.error.message, code: result.error.code };
          },
          readSaved: (target) => readEditorSeed(scope, target, { page: readPage, root: readRoot }),
        });
      } catch {
        setActionError("Finish or discard an existing Knowledge draft before opening more.");
      }
    },
    [drafts, scope, mutate, readPage, readRoot],
  );
  const create = useCallback(() => openEditor({}), [openEditor]);
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
  if (editor && compact)
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <KnowledgeEditor
          scope={scope}
          model={editor}
          drafts={drafts}
          onSaved={saved}
          onCancel={closeEditor}
        />
      </ScrollView>
    );
  if (catalog.error)
    return (
      <>
        <Alert variant="error" description={catalog.error.message} />
        <Button variant="outline" onPress={refresh}>
          Retry
        </Button>
        <KnowledgeStorageSetup scope={scope} active={active} />
        <KnowledgeFormat key="format" scope={scope} active={active} />
        <KnowledgeLockRecovery scope={scope} active={active} />
      </>
    );
  if (!catalog.data) return <SettingsRow label="Loading Knowledge..." />;
  if (settingsOnly)
    return (
      <>
        <KnowledgeStorage scope={scope} settings={catalog.data.settings} onChanged={refresh} />
        <KnowledgeFormat key="format" scope={scope} active={active} />
        <KnowledgeLockRecovery scope={scope} active={active} />
      </>
    );
  const catalogPane = (
    <>
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
      <SettingsCollapsibleRow label="Storage and maintenance">
        <Button variant="outline" size="sm" onPress={initialize} disabled={initializing}>
          {initializing ? "Initializing..." : "Initialize roots"}
        </Button>
        <KnowledgeLinkHealth scope={scope} active={active} onSelect={setSelection} />
        <KnowledgeStorage scope={scope} settings={catalog.data.settings} onChanged={refresh} />
        <KnowledgeFormat scope={scope} active={active} />
        <KnowledgeLockRecovery scope={scope} active={active} />
      </SettingsCollapsibleRow>
    </>
  );
  const selectedDocument = selection ? (
    <KnowledgeDocument
      scope={scope}
      selection={selection}
      active={active}
      onEdit={openEditor}
      onMissing={back}
    />
  ) : (
    <SettingsRow label="Choose a Knowledge entry or project-map page." />
  );
  const editingDocument = editor ? (
    <KnowledgeEditor
      scope={scope}
      model={editor}
      drafts={drafts}
      onSaved={saved}
      onCancel={closeEditor}
    />
  ) : null;
  return (
    <View style={styles.page}>
      <View style={featureBrowserStyles.toolbar}>
        {leading ?? <Text style={styles.projectLabel}>{catalog.data.settings.label}</Text>}
        {compact && selection ? (
          <Button variant="ghost" size="sm" onPress={back}>
            Back to pages
          </Button>
        ) : null}
        <View style={styles.toolbarSpacer} />
        <Button variant="outline" size="sm" onPress={create}>
          New entry
        </Button>
        <Button variant="ghost" size="sm" onPress={refresh}>
          Refresh
        </Button>
      </View>
      {actionError ? <Alert variant="error" description={actionError} /> : null}
      {observationError ? <Alert variant="warning" description={observationError} /> : null}
      <KnowledgeReadingLayout
        compact={compact}
        detailOpen={!!selection || !!editor}
        catalog={catalogPane}
        detail={editingDocument ?? selectedDocument}
      />
    </View>
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
  if (settingsOnly)
    return (
      <ScrollView style={styles.page} contentContainerStyle={embedded ? undefined : styles.content}>
        <KnowledgeProjectSettings scope={scope} active={retained && visible} />
      </ScrollView>
    );
  return (
    <View style={styles.page} testID="otto-knowledge-page">
      <KnowledgeBody scope={scope} active={retained && visible} />
    </View>
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
  const picker = useMemo(
    () => (
      <FeatureScopeSelect
        label="Project"
        value={projectId}
        options={options}
        onChange={setProjectId}
      />
    ),
    [projectId, options],
  );
  if (settingsOnly)
    return (
      <View>
        <KnowledgeHostDefaults hostId={hostId} active={active} />
        <View style={featureBrowserStyles.toolbar}>{picker}</View>
        {projectId ? (
          <KnowledgeProjectSettings key={projectId} scope={scope} active={active} />
        ) : null}
      </View>
    );
  return (
    <View style={styles.page} testID="otto-knowledge-page">
      {projects.error ? (
        <Alert variant="error" description="Projects could not be loaded from the selected host." />
      ) : null}
      {projectId ? (
        <KnowledgeBody key={projectId} scope={scope} active={active} leading={picker} />
      ) : (
        <>
          <View style={featureBrowserStyles.toolbar}>{picker}</View>
          <View style={styles.content}>
            <SettingsRow label="Choose the project whose Knowledge you want to open." />
          </View>
        </>
      )}
    </View>
  );
}
export function ProjectKnowledgeScreen(props: PluginScreenProps) {
  return <ProjectPicker key={props.host.id} hostId={props.host.id} />;
}
export function ProjectKnowledgeSettings(props: PluginSurfaceProps) {
  return <ProjectPicker key={props.host.id} hostId={props.host.id} settingsOnly />;
}
