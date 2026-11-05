import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FlatList, Text, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder, RotateCw } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  listEditorSolutions,
  readEditorSolution,
  readEditorSolutionProject,
  refreshEditorSolution,
  type SolutionRef,
  type SolutionProjectContents,
} from "@getpaseo/plugin/otto/editor-solution";
import { useFetchQuery, useFetchQueries } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PaneContentToolbar, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Alert } from "@/components/ui/alert";
import { PressHighlight } from "@/components/ui/press-highlight";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  TreeChevron,
  treeRowPaddingLeft,
  workspaceTreeRowStyles,
} from "@/components/tree-primitives";
import type { Theme } from "@/styles/theme";
import { useEditorConnection, type EditorClient } from "../client";
import { buildSolutionRows, collapsedKey, type SolutionRow, type SolutionViewNode } from "./rows";

const FolderIcon = withUnistyles(Folder);
const RefreshIcon = withUnistyles(RotateCw);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
interface Selection {
  path: string;
  label: string;
}
interface Input {
  serverId: string;
  workspaceRoot: string;
  onOpenFile?: (path: string) => void;
}
function SolutionChoice({
  value,
  onSelect,
}: {
  value: SolutionRef;
  onSelect: (value: Selection | null) => void;
}) {
  const select = useCallback(
    () => onSelect({ path: value.path, label: value.name }),
    [onSelect, value],
  );
  return <DropdownMenuItem onSelect={select}>{value.name}</DropdownMenuItem>;
}
function Selector({
  values,
  selected,
  onSelect,
}: {
  values: SolutionRef[];
  selected: Selection | null;
  onSelect: (value: Selection | null) => void;
}) {
  const files = useCallback(() => onSelect(null), [onSelect]);
  return (
    <DropdownMenu>
      <ToolbarButton
        kind="menu"
        label="Files view"
        tooltip="Files or evaluated solution membership"
        testID="editor-solution-selector"
      >
        <Text style={styles.selector}>{selected?.label ?? "Files"}</Text>
      </ToolbarButton>
      <DropdownMenuContent side="bottom" align="start" sheetTitle="Files view">
        <DropdownMenuItem onSelect={files} selected={!selected}>
          Files
        </DropdownMenuItem>
        {values.map((value) => (
          <SolutionChoice key={value.path} value={value} onSelect={onSelect} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function Row({
  row,
  expanded,
  onPress,
}: {
  row: SolutionRow;
  expanded: boolean;
  onPress: (node: SolutionViewNode) => void;
}) {
  const press = useCallback(() => onPress(row.node), [onPress, row.node]);
  const padding = useMemo(
    () => [workspaceTreeRowStyles.row, styles.row, { paddingLeft: treeRowPaddingLeft(row.depth) }],
    [row.depth],
  );
  const node = row.node;
  return (
    <PressHighlight
      style={padding}
      highlightStyle={workspaceTreeRowStyles.active}
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={node.name}
      testID={`editor-solution-row-${node.id}`}
    >
      {node.kind === "file" ? (
        <MaterialFileIcon fileName={node.name} size={16} />
      ) : (
        <TreeChevron expanded={expanded} />
      )}
      {node.kind === "folder" || node.kind === "directory" ? (
        <FolderIcon size={16} uniProps={iconColor} />
      ) : null}
      <View style={styles.label}>
        <Text style={styles.name} numberOfLines={1}>
          {node.name}
        </Text>
        {node.kind === "solutionProject" && node.targetFrameworks.length > 0 && (
          <Text style={styles.detail} numberOfLines={1}>
            {node.targetFrameworks.join(", ")}
          </Text>
        )}
        {node.kind === "solutionProject" && node.error && (
          <Text style={styles.error}>{node.error}</Text>
        )}
      </View>
      {"outsideWorkspace" in node && node.outsideWorkspace && (
        <Text style={styles.detail}>External</Text>
      )}
      {node.kind === "file" && <Text style={styles.detail}>{node.itemType}</Text>}
    </PressHighlight>
  );
}
function rowKey(row: SolutionRow) {
  return `${row.ownerProjectPath ?? ""}:${row.node.id}`;
}
function SolutionTree({
  client,
  root,
  selected,
  selector,
  onOpenFile,
  active,
}: {
  client: EditorClient;
  root: string;
  selected: Selection;
  selector: ReactNode;
  onOpenFile?: (path: string) => void;
  active: boolean;
}) {
  const cache = useQueryClient();
  const [expanded, setExpanded] = useState<ReadonlySet<string> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const key = useMemo(() => ["otto-editor-solution", client.hostId, root], [client.hostId, root]);
  const tree = useFetchQuery({
    dataShape: "value",
    queryKey: [...key, "tree", selected.path],
    queryFn: () =>
      client.call(readEditorSolution, { hostId: client.hostId, root, solutionPath: selected.path }),
    enabled: active,
    staleTimeMs: 15000,
    retry: false,
  });
  const effective = useMemo(
    () => expanded ?? new Set(tree.data?.folders.map((folder) => folder.path) ?? []),
    [expanded, tree.data],
  );
  const openProjects = useMemo(
    () => tree.data?.projects.filter((project) => effective.has(project.path)) ?? [],
    [tree.data, effective],
  );
  const inputs = useMemo(
    () =>
      openProjects.map((project) => ({
        dataShape: "value" as const,
        queryKey: [...key, "project", selected.path, project.path],
        queryFn: () =>
          client.call(readEditorSolutionProject, {
            hostId: client.hostId,
            root,
            solutionPath: selected.path,
            projectPath: project.path,
          }),
        enabled: active,
        staleTimeMs: 15000,
        retry: false as const,
      })),
    [openProjects, client, root, selected.path, active, key],
  );
  const projects = useFetchQueries<SolutionProjectContents>(inputs);
  const rows = useMemo(
    () =>
      buildSolutionRows({
        tree: tree.data ?? null,
        expandedIds: effective,
        projects: new Map(
          projects.flatMap((query) => (query.data ? [[query.data.projectPath, query.data]] : [])),
        ),
      }),
    [tree.data, effective, projects],
  );
  const press = useCallback(
    (node: SolutionViewNode) => {
      if (node.kind === "file") {
        onOpenFile?.(node.path);
        return;
      }
      const id = node.kind === "directory" ? collapsedKey(node.id) : node.id;
      setExpanded((previous) => {
        const next = new Set(previous ?? effective);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [effective, onOpenFile],
  );
  const render = useCallback(
    ({ item }: ListRenderItemInfo<SolutionRow>) => (
      <Row
        row={item}
        expanded={
          item.node.kind === "directory"
            ? !effective.has(collapsedKey(item.node.id))
            : effective.has(item.node.id)
        }
        onPress={press}
      />
    ),
    [effective, press],
  );
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await client.call(refreshEditorSolution, { hostId: client.hostId, root });
      await cache.invalidateQueries({ queryKey: key });
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Solution refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [client, root, cache, key, refreshing]);
  const projectError = projects.find((query) => query.error)?.error;
  return (
    <View style={styles.container} testID="editor-solution-files">
      <PaneContentToolbar>
        {selector}
        <ToolbarButton
          label="Refresh solution"
          tooltip="Refresh solution and evaluated membership"
          onPress={refresh}
          disabled={refreshing}
        >
          <RefreshIcon size={16} uniProps={iconColor} />
        </ToolbarButton>
      </PaneContentToolbar>
      {tree.error && <Alert variant="error">{tree.error.message}</Alert>}
      {(refreshError || projectError) && (
        <Alert variant="error">{refreshError ?? projectError?.message}</Alert>
      )}
      {tree.isLoading && <Text style={styles.detail}>Loading solution...</Text>}
      <FlatList
        data={rows}
        renderItem={render}
        keyExtractor={rowKey}
        initialNumToRender={32}
        maxToRenderPerBatch={40}
        windowSize={8}
      />
    </View>
  );
}
/** A lens inside Files, sharing its open-file callback. No extra workspace tab,
 * no implicit solution selection, and no MSBuild work before a project expands. */
export function useOttoSolutionExplorer(input: Input) {
  const connection = useEditorConnection(input.serverId);
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const active = retained && visible;
  const source = `${input.serverId}\0${input.workspaceRoot}`;
  const [selection, setSelection] = useState<{ source: string; value: Selection | null }>(() => ({
    source,
    value: null,
  }));
  const selected = selection.source === source ? selection.value : null;
  const select = useCallback(
    (value: Selection | null) => setSelection({ source, value }),
    [source],
  );
  const client = connection.client;
  const list = useFetchQuery({
    dataShape: "value",
    queryKey: ["otto-editor-solution", input.serverId, input.workspaceRoot, "list"],
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected.");
      return client.call(listEditorSolutions, { hostId: client.hostId, root: input.workspaceRoot });
    },
    enabled: active && Boolean(client && input.workspaceRoot),
    staleTimeMs: 15000,
    retry: false,
  });
  const available = list.data?.enabled && list.data.solutions.length > 0;
  const selector = useMemo(
    () => <Selector values={list.data?.solutions ?? []} selected={selected} onSelect={select} />,
    [list.data, selected, select],
  );
  const control = available ? selector : null;
  const content =
    selected && client ? (
      <SolutionTree
        key={`${source}:${selected.path}`}
        client={client}
        root={input.workspaceRoot}
        selected={selected}
        selector={selector}
        onOpenFile={input.onOpenFile}
        active={active}
      />
    ) : null;
  return { control, content };
}
const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  row: { gap: 6 },
  label: { flex: 1, minWidth: 0 },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  selector: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  detail: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
