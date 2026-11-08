import { useCallback, useMemo, useState, type ComponentType } from "react";
import { ScrollView, View, Text } from "react-native";
import { ScheduleSummarySchema } from "@getpaseo/protocol/schedule/types";
import type {
  ScheduleDocument,
  ScheduleListItem,
  ScheduleRef,
} from "@getpaseo/plugin/otto/schedules";
import { MenuHeader } from "@/components/headers/menu-header";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { SearchField } from "@/components/ui/search-field";
import { useProjects } from "@/hooks/use-projects";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHosts, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { ScheduleActivity } from "./activity";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatCadence } from "@/utils/schedule-format";
import { scheduleProjectChoices } from "./project-choices";
import type { ScheduleApi } from "./api";
import type { ScheduleSources } from "./sources";
import { bindScheduleHost } from "./host-api";
import { useScheduleAvailability } from "./availability";
import { ScheduleChoice } from "./fields";
import { ScheduleEditor } from "./editor";
import { ScheduleDetail } from "./detail";
import { ScheduleStorage } from "./storage";
import { ScheduleTransfer } from "./transfer";
import { LegacyScheduleList } from "./legacy-list";
import { useScheduleLibrary } from "./use-library";
import type { ScheduleProjectChoice } from "./native-fields";
import { styles } from "./styles";

interface Host {
  serverId: string;
  label: string;
}
interface Binding extends Host {
  api: ScheduleApi;
  sources: ScheduleSources;
}
type Selection =
  | { kind: "detail"; ref: ScheduleRef }
  | { kind: "edit"; project: ScheduleProjectChoice; document: ScheduleDocument | null; key: string }
  | { kind: "storage"; hostId: string; projectId: string | null }
  | { kind: "transfer"; document: ScheduleDocument; projectId: string }
  | null;
const STATUSES = [
  { value: "", label: "All schedules" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];
function selectionHost(selection: Selection) {
  if (!selection) return undefined;
  switch (selection.kind) {
    case "detail":
      return selection.ref.scope.hostId;
    case "edit":
      return selection.project.target.serverId;
    case "storage":
      return selection.hostId;
    case "transfer":
      return selection.document.ref.scope.hostId;
  }
}

function Item({ item, open }: { item: ScheduleListItem; open(ref: ScheduleRef): void }) {
  const select = useCallback(() => open(item.ref), [open, item.ref]);
  return (
    <View style={styles.card} testID={`otto-schedule-${item.ref.id}`}>
      <View style={styles.actions}>
        <StatusBadge label={item.status} />
        <Text style={styles.title}>{item.name ?? item.ref.id}</Text>
      </View>
      <Text style={styles.text}>{`${item.target.type} · ${item.ref.location}`}</Text>
      <Text style={styles.muted}>{formatCadence(item.cadence)}</Text>
      <Text
        style={styles.muted}
      >{`Next ${item.nextRunAt ?? "not scheduled"} · ${item.runCount} retained runs`}</Text>
      {item.repairReason ? <Alert variant="error" description={item.repairReason} /> : null}
      {item.transfer?.phase === "pending" ? (
        <Alert description={`Transfer ${item.transfer.operationId} needs inspection.`} />
      ) : null}
      <Button variant="outline" size="sm" onPress={select}>
        Open Schedule
      </Button>
    </View>
  );
}
function HostList({
  binding,
  projectId,
  query,
  status,
  connected,
  open,
}: {
  binding: Binding;
  projectId: string | null;
  query: string;
  status: "active" | "paused" | "completed" | undefined;
  connected: boolean;
  open(ref: ScheduleRef): void;
}) {
  if (!connected)
    return (
      <Alert
        description={`Reconnect ${binding.label} to inspect its Schedules. No local copy is created.`}
      />
    );
  return (
    <ConnectedHostList
      binding={binding}
      projectId={projectId}
      query={query}
      status={status}
      open={open}
    />
  );
}
function ConnectedHostList({
  binding,
  projectId,
  query,
  status,
  open,
}: Omit<Parameters<typeof HostList>[0], "connected">) {
  const [cursor, setCursor] = useState({ query, status, offset: 0 }),
    [diagnosticOffset, setDiagnosticOffset] = useState(0);
  const offset = cursor.query === query && cursor.status === status ? cursor.offset : 0;
  const scope = useMemo(
    () => ({ hostId: binding.serverId, projectId }),
    [binding.serverId, projectId],
  );
  const input = useMemo(
    () => ({ query, status, offset, diagnosticOffset }),
    [query, status, offset, diagnosticOffset],
  );
  const { page, watchError, refresh } = useScheduleLibrary(binding.api, scope, input);
  const previous = useCallback(
    () => setCursor({ query, status, offset: Math.max(0, offset - 50) }),
    [query, status, offset],
  );
  const next = useCallback(
    () => setCursor({ query, status, offset: offset + 50 }),
    [query, status, offset],
  );
  const problems = useCallback(() => setDiagnosticOffset((value) => value + 50), []);
  const firstProblems = useCallback(() => setDiagnosticOffset(0), []);
  return (
    <View style={styles.contentGap}>
      <Text style={styles.title}>{binding.label}</Text>
      <Button
        variant="ghost"
        size="sm"
        onPress={refresh}
        disabled={page.isFetching}
        loading={page.isFetching}
      >
        Refresh Schedules
      </Button>
      {page.error ? (
        <Alert
          variant="error"
          description="Schedules could not be read from this host. Reconnect and refresh; retained records remain at their origins."
        />
      ) : null}
      {!page.data && page.isPending ? <Text style={styles.muted}>Loading Schedules...</Text> : null}
      {page.data ? (
        <>
          <Text style={styles.muted}>{`${page.data.total} schedules`}</Text>
          {page.data.items.map((item) => (
            <Item key={JSON.stringify(item.ref)} item={item} open={open} />
          ))}
          {page.data.diagnostics.map((problem, i) => (
            <Alert
              key={`${diagnosticOffset + i}:${problem.code}`}
              variant="error"
              description={problem.message}
            />
          ))}
          <View style={styles.actions}>
            <Button
              variant="outline"
              size="sm"
              onPress={previous}
              disabled={offset === 0 || page.isFetching}
            >
              Previous schedules
            </Button>
            <Button
              variant="outline"
              size="sm"
              onPress={next}
              disabled={offset + 50 >= page.data.total || page.isFetching}
            >
              More schedules
            </Button>
            {diagnosticOffset > 0 ? (
              <Button variant="ghost" size="sm" onPress={firstProblems}>
                First diagnostics
              </Button>
            ) : null}
            {diagnosticOffset + 50 < page.data.diagnosticTotal ? (
              <Button variant="ghost" size="sm" onPress={problems}>
                More diagnostics
              </Button>
            ) : null}
          </View>
        </>
      ) : null}
      {watchError ? <Alert variant="error" description={watchError} /> : null}
    </View>
  );
}
export function OttoSchedulesEntry({ Legacy }: { Legacy: ComponentType }) {
  const visible = useAppVisible(),
    retained = useRetainedPanelActive();
  const hosts = useHosts();
  const ids = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const availability = useScheduleAvailability(ids);
  const enabled = useMemo(
    () => hosts.filter((host) => availability.get(host.serverId) === true),
    [hosts, availability],
  );
  if (!enabled.length && hosts.some((host) => availability.get(host.serverId) === null))
    return (
      <View style={styles.page}>
        <MenuHeader title="Schedules" />
        <View style={styles.content}>
          <Text style={styles.muted}>Connecting to Schedules hosts...</Text>
        </View>
      </View>
    );
  if (!enabled.length) return <Legacy />;
  return (
    <ScheduleActivity.Provider value={visible && retained}>
      <OwnedSchedules hosts={hosts} capable={enabled} />
    </ScheduleActivity.Provider>
  );
}
function OwnedSchedules({ hosts, capable }: { hosts: Host[]; capable: Host[] }) {
  const compact = useIsCompactFormFactor(),
    { projects } = useProjects(),
    { agents } = useAggregatedAgents({ includeArchived: true });
  const ids = useMemo(() => hosts.map((row) => row.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(ids),
    multiplicity = useHostFeatureMap(ids, "workspaceMultiplicity");
  const bindings = useMemo<Binding[]>(
    () => capable.map((host) => ({ ...host, ...bindScheduleHost(host.serverId) })),
    [capable],
  );
  const choices = useMemo(
    () =>
      scheduleProjectChoices(
        projects,
        bindings.map((row) => row.serverId),
        multiplicity,
      ),
    [projects, bindings, multiplicity],
  );
  return (
    <ScheduleDirectory
      hosts={hosts}
      bindings={bindings}
      choices={choices}
      statuses={statuses}
      agents={agents}
      compact={compact}
    />
  );
}
function ScheduleDirectory({
  hosts,
  bindings,
  choices,
  statuses,
  agents,
  compact,
}: {
  hosts: Host[];
  bindings: Binding[];
  choices: ScheduleProjectChoice[];
  statuses: ReturnType<typeof useHostRuntimeConnectionStatuses>;
  agents: ReturnType<typeof useAggregatedAgents>["agents"];
  compact: boolean;
}) {
  const [host, setHost] = useState(ALL_HOSTS_OPTION_ID),
    [project, setProject] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState<"active" | "paused" | "completed" | undefined>();
  const [selection, setSelection] = useState<Selection>(null),
    [error, setError] = useState("");
  const [legacyEdit, setLegacyEdit] = useState<{
    serverId: string;
    document: ScheduleDocument;
  } | null>(null);
  const projectChoice = choices.find((row) => row.target.optionId === project);
  const filtered = bindings.filter(
    (row) =>
      (host === ALL_HOSTS_OPTION_ID || row.serverId === host) &&
      (!projectChoice || row.serverId === projectChoice.target.serverId),
  );
  const oldHosts = useMemo(
    () =>
      hosts
        .filter(
          (row) =>
            !bindings.some((binding) => binding.serverId === row.serverId) &&
            (host === ALL_HOSTS_OPTION_ID || host === row.serverId),
        )
        .map((row) => row.serverId),
    [hosts, bindings, host],
  );
  const projectOptions = useMemo(
    () => [
      { value: "", label: "All projects" },
      ...choices
        .filter((row) => host === ALL_HOSTS_OPTION_ID || row.target.serverId === host)
        .map((row) => ({
          value: row.target.optionId,
          label: `${row.label} · ${row.target.serverName}`,
        })),
    ],
    [choices, host],
  );
  const guard = useCallback(
    async () =>
      selection?.kind !== "edit" ||
      (await confirmDialog({
        title: "Leave Schedule draft?",
        message:
          "Discard this local draft? Saved records and any accepted work stay on the owning host.",
        confirmLabel: "Discard draft",
      })),
    [selection?.kind],
  );
  const chooseHost = useCallback(
    async (value: string) => {
      if (await guard()) {
        setHost(value);
        setProject("");
        setSelection(null);
        setError("");
      }
    },
    [guard],
  );
  const chooseProject = useCallback(
    async (value: string) => {
      if (await guard()) {
        setProject(value);
        setSelection(null);
        setError("");
      }
    },
    [guard],
  );
  const chooseStatus = useCallback((value: string) => {
    if (value === "active" || value === "paused" || value === "completed") setStatus(value);
    else setStatus(undefined);
  }, []);
  const open = useCallback(
    async (ref: ScheduleRef) => {
      if (await guard()) {
        setSelection({ kind: "detail", ref });
        setError("");
      }
    },
    [guard],
  );
  const create = useCallback(async () => {
    if (projectChoice && (await guard()))
      setSelection({
        kind: "edit",
        project: projectChoice,
        document: null,
        key: `new-${Date.now()}`,
      });
  }, [projectChoice, guard]);
  const close = useCallback(() => setSelection(null), []);
  const closeSelection = useCallback(async () => {
    if (await guard()) setSelection(null);
  }, [guard]);
  const saved = useCallback(
    (document: ScheduleDocument) => setSelection({ kind: "detail", ref: document.ref }),
    [],
  );
  const edit = useCallback(
    (document: ScheduleDocument) => {
      if (
        !document.ref.scope.projectId &&
        (document.schedule.target.type === "agent" || document.schedule.target.type === "new-agent")
      ) {
        setLegacyEdit({ serverId: document.ref.scope.hostId, document });
        return;
      }
      const current = choices.find(
        (row) =>
          row.target.serverId === document.ref.scope.hostId &&
          row.projectId === document.ref.scope.projectId,
      );
      if (!current) {
        setError(
          "Choose the canonical owning project before editing this Schedule. Unassigned legacy records can be copied or moved into an explicitly selected project.",
        );
        return;
      }
      setSelection({ kind: "edit", document, project: current, key: JSON.stringify(document.ref) });
    },
    [choices],
  );
  const transferred = useCallback(
    (document: ScheduleDocument) => {
      const projectId =
        document.ref.scope.projectId ??
        (projectChoice?.target.serverId === document.ref.scope.hostId
          ? projectChoice.projectId
          : null);
      if (!projectId) {
        setError(
          "Choose a project on this owning host before transferring an unassigned legacy Schedule.",
        );
        return;
      }
      setSelection({ kind: "transfer", document, projectId });
    },
    [projectChoice],
  );
  const storage = useCallback(async () => {
    const hostId =
      projectChoice?.target.serverId ??
      (host === ALL_HOSTS_OPTION_ID && bindings.length === 1 ? bindings[0].serverId : host);
    if (!bindings.some((row) => row.serverId === hostId)) {
      setError("Choose an upgraded host to configure Schedules storage.");
      return;
    }
    if (await guard())
      setSelection({ kind: "storage", hostId, projectId: projectChoice?.projectId ?? null });
  }, [projectChoice, host, bindings, guard]);
  const closeLegacy = useCallback(() => setLegacyEdit(null), []);
  const selectedHostId = selectionHost(selection);
  const selectedBinding = bindings.find((row) => row.serverId === selectedHostId);
  const selectedAgents = useMemo(
    () =>
      agents
        .filter((row) => row.serverId === selectedHostId && !row.archivedAt)
        .map((row) => ({ value: row.id, label: row.title ?? row.id })),
    [agents, selectedHostId],
  );
  return (
    <View style={styles.page} testID="otto-schedules-page">
      <MenuHeader title="Schedules" />
      <View style={styles.toolbar}>
        <View style={styles.actions}>
          {hosts.length > 1 ? (
            <HostFilter
              hosts={hosts}
              selectedHost={host}
              onSelectHost={chooseHost}
              triggerTestID="schedules-host-filter"
            />
          ) : null}
          <Button onPress={create} disabled={!projectChoice} testID="schedules-new-button">
            New schedule
          </Button>
          <Button variant="outline" onPress={storage}>
            Storage
          </Button>
          {selection ? (
            <Button variant="ghost" onPress={closeSelection}>
              Close selection
            </Button>
          ) : null}
        </View>
        <ScheduleChoice
          label="Project"
          value={project}
          options={projectOptions}
          change={chooseProject}
          testID="schedule-scope-project"
        />
        <ScheduleChoice
          label="Status"
          value={status ?? ""}
          options={STATUSES}
          change={chooseStatus}
        />
        <SearchField
          value={query}
          onChangeText={setQuery}
          clearAccessibilityLabel="Clear schedule search"
          accessibilityLabel="Search schedules"
          placeholder="Search schedules"
        />
        {!projectChoice ? (
          <Text style={styles.muted}>
            Choose a project to create a Schedule. Existing records remain discoverable at their
            original locations.
          </Text>
        ) : null}
        {error ? <Alert variant="error" description={error} /> : null}
      </View>
      <View style={styles.columns}>
        {!compact || !selection ? (
          <ScrollView
            style={compact ? styles.pane : styles.list}
            contentContainerStyle={styles.content}
          >
            {filtered.map((binding) => (
              <HostList
                key={JSON.stringify([binding.serverId, projectChoice?.projectId])}
                binding={binding}
                projectId={projectChoice?.projectId ?? null}
                query={query}
                status={status}
                connected={statuses.get(binding.serverId) === "online"}
                open={open}
              />
            ))}
            {oldHosts.length ? (
              <LegacyScheduleList
                serverIds={oldHosts}
                selectedHost={host === ALL_HOSTS_OPTION_ID ? null : host}
              />
            ) : null}
          </ScrollView>
        ) : null}
        {selection && selectedBinding ? (
          <SelectedContent
            key={JSON.stringify(selection)}
            selection={selection}
            binding={selectedBinding}
            agents={selectedAgents}
            edit={edit}
            transferred={transferred}
            saved={saved}
            close={close}
          />
        ) : null}
        {!selection && !compact ? (
          <View style={styles.pane}>
            <Text style={styles.muted}>
              Choose a Schedule to inspect its target, history and owning store.
            </Text>
          </View>
        ) : null}
      </View>
      {legacyEdit ? (
        <ScheduleFormSheet
          serverId={legacyEdit.serverId}
          visible
          onClose={closeLegacy}
          mode="edit"
          schedule={ScheduleSummarySchema.parse(legacyEdit.document.schedule)}
        />
      ) : null}
    </View>
  );
}
function SelectedContent({
  selection,
  binding,
  agents,
  edit,
  transferred,
  saved,
  close,
}: {
  selection: NonNullable<Selection>;
  binding: Binding;
  agents: { value: string; label: string }[];
  edit(document: ScheduleDocument): void;
  transferred(document: ScheduleDocument): void;
  saved(document: ScheduleDocument): void;
  close(): void;
}) {
  switch (selection.kind) {
    case "detail":
      return (
        <ScheduleDetail
          api={binding.api}
          reference={selection.ref}
          edit={edit}
          transferred={transferred}
        />
      );
    case "edit":
      return (
        <ScheduleEditor
          api={binding.api}
          sources={binding.sources}
          project={selection.project}
          document={selection.document}
          agents={agents}
          saved={saved}
          close={close}
        />
      );
    case "transfer":
      return (
        <ScheduleTransfer
          api={binding.api}
          document={selection.document}
          projectId={selection.projectId}
        />
      );
    case "storage":
      return (
        <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
          <ScheduleStorage
            api={binding.api}
            hostId={selection.hostId}
            projectId={selection.projectId}
          />
        </ScrollView>
      );
  }
}
