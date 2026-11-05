import { useState, useCallback, useMemo, useContext, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  usePaseo,
  type PluginScreenProps,
  type PluginWorkspacePanelProps,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  WorkflowRef,
  WorkflowAuthoredDocument as Authored,
  DEFAULT_WORKFLOW_LIMITS,
  workflowRefKey,
  type WorkflowScope,
  type WorkflowSummary,
  type WorkflowEntry,
  type WorkflowAuthoredDocument,
  type PromptTemplate,
  type WorkflowKind,
} from "@getpaseo/plugin/otto/workflows";
import { SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useFetchQuery } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useWorkflowApi, WorkflowApiProvider } from "./api";
import { workflowQueryRoot, useWorkflowObservation } from "./data";
import { WorkflowEditor } from "./editor";
import { draftFor } from "./draft-store";
import type { WorkflowDraft } from "./draft";
import { WorkflowDraftSurface, WorkflowDraftList } from "./draft-surface";
import { WorkflowRun } from "./run";
import { WorkflowLaunch } from "./launch";
import { WorkflowImport } from "./import";
import { WorkflowProjectStorage } from "./settings";
import { Recovery } from "./recovery";
import { STARTER_GRAPHS } from "./starter-graphs";
import { STARTER_TEMPLATES } from "./starter-prompt-templates";
import { styles } from "./styles";
type Navigation = PluginSurfaceProps["navigation"];
type Selection =
  | { kind: "retained"; model: WorkflowDraft }
  | { kind: "entry"; ref: WorkflowRef }
  | { kind: "draft"; document: WorkflowAuthoredDocument; key: string }
  | null;
const kinds = [
  { value: "definition", label: "AI and Graph definitions" },
  { value: "run", label: "Run history" },
  { value: "template", label: "Prompt templates" },
];
function newDocument(kind: "ai" | "graph" | "template"): WorkflowAuthoredDocument {
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    now = new Date().toISOString();
  if (kind === "ai") {
    const seat = { provider: "" };
    return {
      kind,
      value: {
        format: "otto.workflow.ai",
        formatVersion: 1,
        id,
        title: "New AI Workflow",
        prompt: "",
        seats: { conductor: { ...seat }, worker: { ...seat }, judge: { ...seat } },
        limits: { ...DEFAULT_WORKFLOW_LIMITS },
        autopilot: false,
        createdAt: now,
        updatedAt: now,
      },
    };
  }
  if (kind === "graph")
    return {
      kind,
      value: {
        format: "otto.workflow.graph",
        formatVersion: 1,
        id,
        name: "New Graph Workflow",
        nodes: [
          { id: "root", kind: "orchestrator", title: "Conductor", position: { x: 40, y: 160 } },
        ],
        edges: [],
        inputs: [],
        createdAt: now,
        updatedAt: now,
      },
    };
  return {
    kind,
    value: {
      id,
      name: "New prompt template",
      content: "",
      variables: [],
      createdAt: now,
      updatedAt: now,
    },
  };
}
function LibraryRow({
  item,
  select,
  selected,
}: {
  item: WorkflowSummary;
  select(ref: WorkflowRef): void;
  selected: boolean;
}) {
  const open = useCallback(() => select(item.ref), [select, item.ref]);
  return (
    <View style={styles.card}>
      <Button variant={selected ? "secondary" : "ghost"} onPress={open}>
        {item.title}
      </Button>
      <Text numberOfLines={2} style={styles.muted}>
        {item.description}
      </Text>
      <Text style={styles.muted}>
        {[item.ref.kind, item.status, item.ref.location].filter(Boolean).join(" · ")}
      </Text>
      {item.error ? <Text style={styles.muted}>{item.error}</Text> : null}
    </View>
  );
}
const galleryDocuments: WorkflowAuthoredDocument[] = [
  ...STARTER_GRAPHS.map((value) => ({ kind: "graph" as const, value })),
  ...STARTER_TEMPLATES.map((value) => ({ kind: "template" as const, value })),
];
function Gallery({ copy }: { copy(document: WorkflowAuthoredDocument): void }) {
  return (
    <View style={styles.content}>
      <Text style={styles.title}>Starter gallery</Text>
      {galleryDocuments.map((document) => (
        <GalleryItem key={document.value.id} document={document} copy={copy} />
      ))}
    </View>
  );
}
function GalleryItem({
  document,
  copy,
}: {
  document: WorkflowAuthoredDocument;
  copy(document: WorkflowAuthoredDocument): void;
}) {
  const open = useCallback(() => {
    const value = structuredClone(document);
    value.value.id = `${value.value.id}-${Date.now().toString(36)}`;
    delete value.value.builtIn;
    delete value.value.workflowStorage;
    copy(value);
  }, [document, copy]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {document.kind === "ai" ? document.value.title : document.value.name}
      </Text>
      <Text style={styles.muted}>{document.value.description ?? ""}</Text>
      <Button onPress={open} variant="outline">
        Copy into a local draft
      </Button>
    </View>
  );
}
function SavedDetail({
  reference,
  owner,
  active,
  templates,
  saved,
  run,
  copy,
  navigation,
}: {
  reference: WorkflowRef;
  owner: object;
  active: boolean;
  templates: PromptTemplate[];
  saved(entry: WorkflowEntry): void;
  run(entry: WorkflowEntry): void;
  copy(document: WorkflowAuthoredDocument): void;
  navigation: Navigation;
}) {
  const api = useWorkflowApi();
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: [...workflowQueryRoot(reference.scope), "document", reference],
    enabled: active && reference.kind !== "run",
    retry: false,
    queryFn: () => api.read(reference),
  });
  if (reference.kind === "run")
    return (
      <WorkflowRun reference={reference} active={active} navigation={navigation} changed={saved} />
    );
  if (!query.data)
    return (
      <View style={styles.content}>
        {query.error ? (
          <Alert variant="error" description={query.error.message} />
        ) : (
          <Text style={styles.muted}>Loading Workflow document...</Text>
        )}
        <Recovery reference={reference} active={active} changed={saved} />
      </View>
    );
  return (
    <DocumentEditor
      key={workflowRefKey(reference)}
      document={Authored.parse(query.data.document)}
      origin={query.data}
      owner={owner}
      scope={reference.scope}
      active={active}
      templates={templates}
      saved={saved}
      run={run}
      copy={copy}
    />
  );
}
function DocumentEditor({
  document,
  origin,
  owner,
  scope,
  ...props
}: {
  document: WorkflowAuthoredDocument;
  origin: WorkflowEntry | null;
  owner: object;
  scope: WorkflowScope;
  active: boolean;
  templates: PromptTemplate[];
  saved(entry: WorkflowEntry): void;
  run(entry: WorkflowEntry): void;
  copy(document: WorkflowAuthoredDocument): void;
}) {
  const surface = useContext(WorkflowDraftSurface);
  const [draft] = useState(() => {
    try {
      return { model: draftFor(owner, scope, surface, document, origin), error: "" };
    } catch (error) {
      return {
        model: null,
        error: error instanceof Error ? error.message : "Draft could not be opened.",
      };
    }
  });
  return draft.model ? (
    <WorkflowEditor model={draft.model} {...props} />
  ) : (
    <Alert variant="error" description={draft.error} />
  );
}
function useTemplates(scope: WorkflowScope, active: boolean) {
  const api = useWorkflowApi();
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 5000,
    queryKey: [...workflowQueryRoot(scope), "templates"],
    enabled: active,
    retry: false,
    queryFn: async () => {
      const page = await api.list({ scope, kind: "template", includeLegacy: true });
      const docs = await Promise.all(
        page.items
          .filter((item) => item.status !== "unreadable")
          .map(async (item) => (await api.read(item.ref)).document),
      );
      return docs.flatMap((doc) => (doc.kind === "template" ? [doc.value] : []));
    },
  });
}
function WorkflowLibrary({
  scope,
  workspaceId,
  workspaces,
  active,
  navigation,
  initial,
}: {
  scope: WorkflowScope;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  active: boolean;
  navigation: Navigation;
  initial?: WorkflowRef;
}) {
  const owner = usePaseo(),
    api = useWorkflowApi(),
    compact = useIsCompactFormFactor(),
    refresh = useWorkflowObservation(scope, active);
  const [kind, setKind] = useState("definition"),
    [offset, setOffset] = useState(0),
    [selection, setSelection] = useState<Selection>(
      initial ? { kind: "entry", ref: initial } : null,
    ),
    [launch, setLaunch] = useState<WorkflowEntry | null>(null),
    [importing, setImporting] = useState(false),
    [gallery, setGallery] = useState(false),
    [storage, setStorage] = useState(false),
    [drafts, setDrafts] = useState(false);
  const surface = workspaceId ? `workspace:${workspaceId}` : "library";
  const showDrafts = useCallback(() => setDrafts((value) => !value), []);
  const openDraft = useCallback((model: WorkflowDraft) => {
    setSelection({ kind: "retained", model });
    setLaunch(null);
    setImporting(false);
    setGallery(false);
    setDrafts(false);
  }, []);
  const library = useFetchQuery({
      dataShape: "value",
      staleTimeMs: 1000,
      queryKey: [...workflowQueryRoot(scope), "library", kind, offset],
      enabled: active,
      retry: false,
      queryFn: () =>
        api.list({ scope, kind: kind as WorkflowKind | "definition", offset, includeLegacy: true }),
    }),
    templates = useTemplates(scope, active);
  const select = useCallback((ref: WorkflowRef) => {
    setSelection({ kind: "entry", ref });
    setLaunch(null);
    setImporting(false);
    setGallery(false);
  }, []);
  const copy = useCallback((document: WorkflowAuthoredDocument) => {
    setSelection({ kind: "draft", document, key: document.value.id });
    setLaunch(null);
    setImporting(false);
    setGallery(false);
  }, []);
  const ai = useCallback(() => copy(newDocument("ai")), [copy]),
    graph = useCallback(() => copy(newDocument("graph")), [copy]),
    template = useCallback(() => copy(newDocument("template")), [copy]);
  const changeKind = useCallback((value: string) => {
      setKind(value);
      setOffset(0);
    }, []),
    next = useCallback(() => {
      if (library.data?.nextOffset !== null && library.data?.nextOffset !== undefined)
        setOffset(library.data.nextOffset);
    }, [library.data?.nextOffset]),
    previous = useCallback(() => setOffset((value) => Math.max(0, value - 50)), []);
  const saved = useCallback(() => {
    void refresh();
  }, [refresh]);
  const started = useCallback(
    (entry: WorkflowEntry) => {
      select(entry.ref);
      setKind("run");
      void refresh();
    },
    [select, refresh],
  );
  const closeLaunch = useCallback(() => setLaunch(null), []),
    showImport = useCallback(() => {
      setImporting((value) => !value);
      setGallery(false);
    }, []),
    showGallery = useCallback(() => {
      setGallery((value) => !value);
      setImporting(false);
    }, []),
    showStorage = useCallback(() => setStorage((value) => !value), []),
    back = useCallback(() => {
      setSelection(null);
      setLaunch(null);
    }, []);
  const detail = useMemo(
    () => (
      <LibraryDetail
        launch={launch}
        selection={selection}
        owner={owner}
        scope={scope}
        active={active}
        templates={templates.data ?? []}
        workspaceId={workspaceId}
        workspaces={workspaces}
        started={started}
        closeLaunch={closeLaunch}
        saved={saved}
        setLaunch={setLaunch}
        copy={copy}
        navigation={navigation}
      />
    ),
    [
      launch,
      selection,
      owner,
      scope,
      active,
      templates.data,
      workspaceId,
      workspaces,
      started,
      closeLaunch,
      saved,
      copy,
      navigation,
    ],
  );
  const list = useMemo(
    () => (
      <View style={styles.content}>
        {library.error ? <Alert variant="error" description={library.error.message} /> : null}
        {library.data?.diagnostics.map((message) => (
          <Alert key={message} variant="warning" description={message} />
        ))}
        {library.data?.items.length === 0 ? (
          <Text style={styles.muted}>No saved items in this scope.</Text>
        ) : null}
        {library.data?.items.map((item) => (
          <LibraryRow
            key={workflowRefKey(item.ref)}
            item={item}
            select={select}
            selected={
              selection?.kind === "entry" &&
              workflowRefKey(selection.ref) === workflowRefKey(item.ref)
            }
          />
        ))}
        <View style={styles.actions}>
          <Button variant="ghost" disabled={offset === 0} onPress={previous}>
            Previous results
          </Button>
          <Button variant="ghost" disabled={library.data?.nextOffset === null} onPress={next}>
            More results
          </Button>
        </View>
      </View>
    ),
    [library.error, library.data, select, selection, offset, previous, next],
  );
  return (
    <WorkflowDraftSurface.Provider value={surface}>
      <View style={styles.page}>
        <View style={styles.toolbar}>
          <View style={styles.actions}>
            <Button variant="outline" onPress={ai}>
              New AI Workflow
            </Button>
            <Button variant="outline" onPress={graph}>
              New Graph
            </Button>
            <Button variant="outline" onPress={template}>
              New template
            </Button>
            <Button variant="ghost" onPress={showGallery}>
              Starters
            </Button>
            <Button variant="ghost" onPress={showImport}>
              Import
            </Button>
            <Button variant="ghost" onPress={showStorage}>
              Storage
            </Button>
            <Button variant="ghost" onPress={showDrafts}>
              Drafts
            </Button>
            <Button variant="ghost" onPress={refresh}>
              Refresh
            </Button>
          </View>
          <SettingsSelect label="Library" value={kind} options={kinds} onValueChange={changeKind} />
        </View>
        {storage ? <WorkflowProjectStorage scope={scope} active={active} /> : null}
        {drafts ? (
          <WorkflowDraftList owner={owner} scope={scope} surface={surface} open={openDraft} />
        ) : null}
        <LibraryBody
          importing={importing}
          gallery={gallery}
          compact={compact}
          hasDetail={!!selection || !!launch}
          scope={scope}
          active={active}
          started={started}
          copy={copy}
          back={back}
          detail={detail}
          list={list}
        />
      </View>
    </WorkflowDraftSurface.Provider>
  );
}
function Directory(props: PluginScreenProps | PluginWorkspacePanelProps) {
  const paseo = usePaseo(),
    retained = useRetainedPanelActive(),
    visible = useAppVisible(),
    active = retained && visible && ("active" in props ? props.active === true : true);
  const params = "params" in props ? props.params : {},
    hint = params.projectHostId === props.host.id,
    [project, setProject] = useState(hint ? (params.projectId ?? "") : "");
  const projects = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflowProjects", props.host.id],
    enabled: active,
    retry: false,
    queryFn: () => paseo.projects.list(),
  });
  const workspaces = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 1000,
    queryKey: ["ottoWorkflowWorkspaces", props.host.id],
    enabled: active,
    retry: false,
    queryFn: async () => (await paseo.workspaces.list()).entries,
  });
  const workspaceId = "workspaceId" in props ? props.workspaceId : (params.workspaceId ?? ""),
    workspace = workspaces.data?.find((item) => item.id === workspaceId),
    projectId = workspace?.projectId ?? project;
  const options = useMemo(
    () => [
      { value: "", label: "Choose a project" },
      ...(projects.data?.projects ?? []).map((item) => ({
        value: item.projectId,
        label: item.projectDisplayName,
      })),
    ],
    [projects.data],
  );
  const targets = useMemo(
    () => [
      { value: "", label: "Choose an execution workspace" },
      ...(workspaces.data ?? [])
        .filter((item) => item.projectId === projectId)
        .map((item) => ({ value: item.id, label: item.name })),
    ],
    [workspaces.data, projectId],
  );
  const scope = useMemo<WorkflowScope>(
    () => ({ hostId: props.host.id, projectId }),
    [props.host.id, projectId],
  );
  const initial = WorkflowRef.safeParse({
    scope,
    id: params.runId,
    kind: "run",
    location: params.location,
    storeKey: params.storeKey,
  });
  return (
    <View testID="otto-workflows-page" style={styles.page}>
      {!("workspaceId" in props) ? (
        <View style={styles.toolbar}>
          <SettingsSelect
            label="Project"
            value={projectId}
            options={options}
            onValueChange={setProject}
          />
        </View>
      ) : null}
      {projects.error || workspaces.error ? (
        <Alert
          variant="error"
          description="Project/workspace identity could not be loaded from the selected host."
        />
      ) : null}
      {projectId ? (
        <WorkflowLibrary
          key={`${props.host.id}/${projectId}`}
          scope={scope}
          workspaceId={workspaceId}
          workspaces={targets}
          active={active}
          navigation={props.navigation}
          initial={initial.success ? initial.data : undefined}
        />
      ) : (
        <View style={styles.content}>
          <Text style={styles.muted}>Choose the owning project to browse Workflows.</Text>
        </View>
      )}
    </View>
  );
}
export function WorkflowsScreen(props: PluginScreenProps) {
  const identity = JSON.stringify([
    props.host.id,
    props.params.projectHostId,
    props.params.projectId,
    props.params.runId,
    props.params.location,
    props.params.storeKey,
  ]);
  return (
    <WorkflowApiProvider key={identity}>
      <Directory {...props} />
    </WorkflowApiProvider>
  );
}
export function WorkflowsWorkspace(props: PluginWorkspacePanelProps) {
  return (
    <WorkflowApiProvider key={`${props.host.id}/${props.workspaceId}`}>
      <Directory {...props} />
    </WorkflowApiProvider>
  );
}

function LibraryDetail({
  launch,
  selection,
  owner,
  scope,
  active,
  templates,
  workspaceId,
  workspaces,
  started,
  closeLaunch,
  saved,
  setLaunch,
  copy,
  navigation,
}: {
  launch: WorkflowEntry | null;
  selection: Selection;
  owner: object;
  scope: WorkflowScope;
  active: boolean;
  templates: PromptTemplate[];
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  started(entry: WorkflowEntry): void;
  closeLaunch(): void;
  saved(entry: WorkflowEntry): void;
  setLaunch(entry: WorkflowEntry): void;
  copy(document: WorkflowAuthoredDocument): void;
  navigation: Navigation;
}) {
  if (launch)
    return (
      <WorkflowLaunch
        key={launch.revision}
        entry={launch}
        workspaceId={workspaceId}
        workspaces={workspaces}
        active={active}
        started={started}
        close={closeLaunch}
      />
    );
  if (selection?.kind === "draft")
    return (
      <DocumentEditor
        key={selection.key}
        document={selection.document}
        origin={null}
        owner={owner}
        scope={scope}
        active={active}
        templates={templates}
        saved={saved}
        run={setLaunch}
        copy={copy}
      />
    );
  if (selection?.kind === "retained")
    return (
      <WorkflowEditor
        key={selection.model.localKey}
        model={selection.model}
        active={active}
        templates={templates}
        saved={saved}
        run={setLaunch}
        copy={copy}
      />
    );
  if (selection?.kind === "entry")
    return (
      <SavedDetail
        reference={selection.ref}
        owner={owner}
        active={active}
        templates={templates}
        saved={saved}
        run={setLaunch}
        copy={copy}
        navigation={navigation}
      />
    );
  return (
    <View style={styles.content}>
      <Text style={styles.muted}>
        Select a saved Workflow, or create an AI Workflow, Graph or prompt template.
      </Text>
    </View>
  );
}

function LibraryBody({
  importing,
  gallery,
  compact,
  hasDetail,
  scope,
  active,
  started,
  copy,
  back,
  detail,
  list,
}: {
  importing: boolean;
  gallery: boolean;
  compact: boolean;
  hasDetail: boolean;
  scope: WorkflowScope;
  active: boolean;
  started(entry: WorkflowEntry): void;
  copy(document: WorkflowAuthoredDocument): void;
  back(): void;
  detail: ReactNode;
  list: ReactNode;
}) {
  if (importing)
    return (
      <ScrollView>
        <WorkflowImport scope={scope} active={active} imported={started} />
      </ScrollView>
    );
  if (gallery)
    return (
      <ScrollView>
        <Gallery copy={copy} />
      </ScrollView>
    );
  if (compact)
    return (
      <ScrollView>
        {hasDetail ? (
          <View>
            <Button variant="ghost" onPress={back}>
              Workflows library
            </Button>
            {detail}
          </View>
        ) : (
          list
        )}
      </ScrollView>
    );
  return (
    <View style={styles.columns}>
      <ScrollView style={styles.list}>{list}</ScrollView>
      <ScrollView style={styles.column}>{detail}</ScrollView>
    </View>
  );
}
