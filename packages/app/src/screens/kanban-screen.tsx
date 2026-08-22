import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { COMPACT_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { HostPicker, HostStatusDotSlot } from "@/components/hosts/host-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  ChevronDown,
  ExternalLink,
  ListChevronsUpDown,
  MoreVertical,
  Plus,
  RefreshCw,
  type IconComponent,
} from "@/components/icons/material-icons";
import { useKanbanBoard, useKanbanBoards } from "@/kanban/kanban-hooks";
import { KanbanRemediationBlock } from "@/screens/kanban-remediation-block";
import { useProjects } from "@/hooks/use-projects";
import { buildProjectSettingsRoute } from "@/utils/host-routes";
import { KANBAN_NOT_CONFIGURED } from "@otto-code/protocol/kanban";
import type { KanbanCard, KanbanColumn, KanbanRemediation } from "@otto-code/protocol/kanban";
import {
  resolveKanbanProjectSelection,
  resolveKanbanScreenBodyState,
  type KanbanScreenBodyState,
} from "./kanban-screen-state";

// ── Shared types ────────────────────────────────────────────────────────────

/**
 * Structural layout-event type (matches the context-menu / dropdown-menu
 * handlers): the runtime event carries `nativeEvent.layout`.
 */
interface LayoutEvent {
  nativeEvent: {
    layout: { x: number; y: number; width: number; height: number };
  };
}

interface KanbanSelection {
  serverId: string;
  projectId: string;
  projectKey: string | null;
  boardId: string | null;
}

interface KanbanHostProject {
  serverId: string;
  projectId: string;
  projectKey: string | null;
  projectName: string;
  /** The project's root directory on this host; the cwd a fix-it command runs in. */
  repoRoot: string;
  hasTarget: boolean;
}

/**
 * Owns host -> project -> board selection state and its auto-select effects,
 * isolated from KanbanScreen so the screen component itself stays under the
 * complexity budget. Mirrors the state machine documented in
 * kanban-screen-state.ts: host picker -> project picker -> board.
 */
function useKanbanSelectionState(
  kanbanHosts: { serverId: string; label: string }[],
  projects: ReturnType<typeof useProjects>["projects"],
  preferredProject: { serverId: string; projectId: string } | null,
) {
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  // A persisted last-workspace preference can hydrate after this screen has
  // made an automatic fallback selection. Keep that fallback replaceable until
  // the reader deliberately picks a host, project, or board here.
  const hasExplicitKanbanSelection = useRef(false);
  // Last selection per host, kept in component state only (no persisted
  // setting in this phase). Switching hosts and back restores the choice.
  const [selections, setSelections] = useState<Record<string, KanbanSelection>>({});

  const selection = useMemo(
    () => (selectedHost ? (selections[selectedHost] ?? null) : null),
    [selectedHost, selections],
  );

  const updateSelection = useCallback((hostId: string, next: KanbanSelection | null) => {
    setSelections((prev) => {
      if (next === null) {
        const { [hostId]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [hostId]: next };
    });
  }, []);

  const selectHost = useCallback((hostId: string) => {
    hasExplicitKanbanSelection.current = true;
    setSelectedHost(hostId);
  }, []);

  const hostProjects = useMemo(() => {
    if (!selectedHost) return [];
    const entries: KanbanHostProject[] = [];
    for (const project of projects) {
      for (const hostEntry of project.hosts) {
        if (hostEntry.serverId === selectedHost) {
          entries.push({
            serverId: hostEntry.serverId,
            projectId: hostEntry.projectId,
            projectKey: project.projectKey,
            projectName:
              hostEntry.projectCustomName ?? project.projectCustomName ?? project.projectName,
            repoRoot: hostEntry.repoRoot,
            hasTarget: hostEntry.projectKanban !== null,
          });
        }
      }
    }
    return entries;
  }, [projects, selectedHost]);

  const hostProjectMap = useMemo(
    () => new Map(hostProjects.map((p) => [p.projectId, p])),
    [hostProjects],
  );

  const selectProject = useCallback(
    (projectId: string) => {
      hasExplicitKanbanSelection.current = true;
      setSelections((prev) => {
        const entry = hostProjects.find((project) => project.projectId === projectId);
        if (!entry) return prev;
        return {
          ...prev,
          [entry.serverId]: {
            serverId: entry.serverId,
            projectId: entry.projectId,
            projectKey: entry.projectKey,
            boardId: null,
          },
        };
      });
    },
    [hostProjects],
  );

  const selectBoard = useCallback(
    (boardId: string) => {
      if (!selectedHost) return;
      hasExplicitKanbanSelection.current = true;
      setSelections((prev) => {
        const current = prev[selectedHost];
        if (!current) return prev;
        return { ...prev, [selectedHost]: { ...current, boardId } };
      });
    },
    [selectedHost],
  );

  // Prefer the host behind the workspace the reader just left. This is an
  // initial context default only: once a valid Kanban selection exists, it is
  // never replaced by a later workspace observation.
  useEffect(() => {
    if (selectedHost && kanbanHosts.some((host) => host.serverId === selectedHost)) {
      return;
    }
    if (
      preferredProject &&
      kanbanHosts.some((host) => host.serverId === preferredProject.serverId)
    ) {
      setSelectedHost(preferredProject.serverId);
      return;
    }
    if (kanbanHosts.length === 1) {
      setSelectedHost(kanbanHosts[0].serverId);
    }
  }, [kanbanHosts, preferredProject, selectedHost]);

  // Auto-select project when the host changes: restores the host's last
  // selection if it still exists, otherwise uses the project from the last
  // workspace before falling back to the first project.
  useEffect(() => {
    if (!selectedHost) return;
    const existing = selections[selectedHost];
    const projectId = resolveKanbanProjectSelection({
      selectedProjectId: hasExplicitKanbanSelection.current ? (existing?.projectId ?? null) : null,
      preferredProjectId:
        preferredProject?.serverId === selectedHost ? preferredProject.projectId : null,
      availableProjectIds: hostProjects.map((project) => project.projectId),
    });
    if (projectId === null) {
      updateSelection(selectedHost, null);
      return;
    }
    if (existing?.projectId === projectId) {
      return;
    }
    const project = hostProjectMap.get(projectId);
    if (!project) return;
    updateSelection(selectedHost, {
      serverId: selectedHost,
      projectId: project.projectId,
      projectKey: project.projectKey,
      boardId: null,
    });
  }, [selectedHost, hostProjects, hostProjectMap, preferredProject, selections, updateSelection]);

  return {
    selectedHost,
    selection,
    hostProjects,
    hostProjectMap,
    selectHost,
    selectProject,
    selectBoard,
    updateSelection,
  };
}

/**
 * Fetches boards for the selected project, keeps the sticky board selection in
 * sync with the fetched list, and resolves the screen's body state. Isolated
 * from KanbanScreen for the same reason as useKanbanSelectionState.
 */
function useKanbanBoardResolution(input: {
  kanbanHosts: { serverId: string; label: string }[];
  selectedHost: string | null;
  selection: KanbanSelection | null;
  hostProjects: KanbanHostProject[];
  hostProjectMap: Map<string, KanbanHostProject>;
  updateSelection: (hostId: string, next: KanbanSelection | null) => void;
  refreshKey: number;
}) {
  const {
    kanbanHosts,
    selectedHost,
    selection,
    hostProjects,
    hostProjectMap,
    updateSelection,
    refreshKey,
  } = input;
  const {
    boards,
    isLoading: boardsLoading,
    error: boardsError,
    remediation: boardsRemediation,
  } = useKanbanBoards(
    selection?.serverId ?? null,
    selection?.projectId ?? null,
    selection?.projectKey ?? null,
    refreshKey,
  );

  // Default to the first board; keep a manual choice sticky while it is still
  // in the list.
  useEffect(() => {
    if (!selection || !selectedHost) return;
    const stillInList =
      selection.boardId !== null && boards.some((b) => b.boardId === selection.boardId);
    if (boards.length > 0 && !stillInList) {
      updateSelection(selectedHost, { ...selection, boardId: boards[0].boardId });
    }
    if (boards.length === 0 && selection.boardId !== null) {
      updateSelection(selectedHost, { ...selection, boardId: null });
    }
  }, [boards, selection, selectedHost, updateSelection]);

  const boardProviderId = useMemo(() => {
    if (!selection?.boardId) return null;
    return boards.find((b) => b.boardId === selection.boardId)?.providerId ?? null;
  }, [boards, selection]);

  // The daemon answers an unconfigured project with KANBAN_NOT_CONFIGURED.
  // Treat that as the unconfigured state, not a board error, so a stale
  // descriptor still lands on the watermark rather than a raw error message.
  const daemonNotConfigured = boardsError === KANBAN_NOT_CONFIGURED;
  const effectiveBoardError = daemonNotConfigured ? null : boardsError;

  const selectedProjectForState = useMemo(() => {
    if (!selection) return null;
    const entry = hostProjectMap.get(selection.projectId);
    return {
      serverId: selection.serverId,
      projectId: selection.projectId,
      hasTarget: (entry ? entry.hasTarget : false) && !daemonNotConfigured,
    };
  }, [selection, hostProjectMap, daemonNotConfigured]);

  const state = resolveKanbanScreenBodyState({
    isLoading: boardsLoading,
    hostCount: kanbanHosts.length,
    projectCount: hostProjects.length,
    selectedProject: selectedProjectForState,
    boardError: effectiveBoardError,
    boardCount: boards.length,
  });

  // Where a remediation command would run: the failing host, in the selected
  // project's root. Null while nothing is selected, which hides the run action
  // and leaves copy as the only route.
  const remediationTarget = useMemo(() => {
    if (!selection) return null;
    const entry = hostProjectMap.get(selection.projectId);
    return { serverId: selection.serverId, cwd: entry?.repoRoot ?? null };
  }, [selection, hostProjectMap]);

  return {
    boards,
    boardProviderId,
    state,
    remediation: daemonNotConfigured ? null : boardsRemediation,
    remediationTarget,
  };
}

/**
 * Material symbol icons are SVGs that paint with an explicit color. The color
 * comes from the resolved style token (a string, not a hook), so this stays a
 * plain component and never reaches for `useUnistyles`.
 */
function KanbanIcon({
  icon: Icon,
  size,
  color,
}: {
  icon: IconComponent;
  size: number;
  color: string;
}): ReactElement {
  return <Icon size={size} color={color} />;
}

// ── Host + project + board pickers ──────────────────────────────────────────
//
// The three pickers below all follow the same filter-chip pattern used by
// HostFilter/ProjectFilter (Sessions, Schedules, Artifacts): a compact
// Pressable trigger anchoring a Combobox-based popover. Unlike HostFilter,
// none of these carry an "all" option - the Kanban screen always resolves to
// exactly one host, project, and board.

interface FilterTriggerProps {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  isOpen: boolean;
  triggerRef: React.RefObject<View | null>;
  testID: string;
}

function FilterTrigger({
  label,
  accessibilityLabel,
  onPress,
  isOpen,
  triggerRef,
  testID,
}: FilterTriggerProps): ReactElement {
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      (Boolean(hovered) || pressed || isOpen) && styles.filterTriggerActive,
    ],
    [isOpen],
  );
  return (
    <View ref={triggerRef} collapsable={false}>
      <Pressable
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        <Text style={styles.filterTriggerText} numberOfLines={1}>
          {label}
        </Text>
        <ChevronDown size={14} color={styles.chevron.color} />
      </Pressable>
    </View>
  );
}

interface KanbanHostFilterProps {
  hosts: { serverId: string; label: string }[];
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
}

/**
 * Same trigger chrome as FilterTrigger, plus the host status dot - kept as its
 * own Pressable (rather than a `leading` slot on FilterTrigger) so the trigger
 * never takes a JSX element as a prop.
 */
function KanbanHostFilter({
  hosts,
  selectedHost,
  onSelectHost,
}: KanbanHostFilterProps): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const handleOpen = useCallback(() => setOpen(true), []);
  const selectedLabel = hosts.find((host) => host.serverId === selectedHost)?.label ?? "";
  const hostOptionTestID = useCallback((serverId: string) => `kanban-host-${serverId}`, []);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      (Boolean(hovered) || pressed || open) && styles.filterTriggerActive,
    ],
    [open],
  );

  return (
    <HostPicker
      hosts={hosts}
      value={selectedHost}
      onSelect={onSelectHost}
      open={open}
      onOpenChange={setOpen}
      anchorRef={anchorRef}
      searchable={hosts.length > 6}
      title={t("kanban.host")}
      desktopPlacement="bottom-start"
      hostOptionTestID={hostOptionTestID}
    >
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handleOpen}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`${t("kanban.host")}: ${selectedLabel}`}
          testID="kanban-host-filter-trigger"
        >
          <HostStatusDotSlot serverId={selectedHost} />
          <Text style={styles.filterTriggerText} numberOfLines={1}>
            {selectedLabel}
          </Text>
          <ChevronDown size={14} color={styles.chevron.color} />
        </Pressable>
      </View>
    </HostPicker>
  );
}

interface KanbanProjectFilterProps {
  options: { id: string; label: string }[];
  value: string;
  onChange: (projectId: string) => void;
}

function KanbanProjectFilter({ options, value, onChange }: KanbanProjectFilterProps): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const handleOpen = useCallback(() => setOpen(true), []);
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((option) => ({ id: option.id, label: option.label })),
    [options],
  );
  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );
  const selectedLabel = options.find((option) => option.id === value)?.label ?? "";

  return (
    <>
      <FilterTrigger
        label={selectedLabel}
        accessibilityLabel={`${t("kanban.project")}: ${selectedLabel}`}
        onPress={handleOpen}
        isOpen={open}
        triggerRef={anchorRef}
        testID="kanban-project-filter-trigger"
      />
      <Combobox
        options={comboboxOptions}
        value={value}
        onSelect={handleSelect}
        searchable={comboboxOptions.length > 6}
        title={t("kanban.project")}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
      />
    </>
  );
}

interface KanbanBoardFilterProps {
  options: { id: string; label: string }[];
  value: string;
  onChange: (boardId: string) => void;
}

function KanbanBoardFilter({ options, value, onChange }: KanbanBoardFilterProps): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const handleOpen = useCallback(() => setOpen(true), []);
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((option) => ({ id: option.id, label: option.label })),
    [options],
  );
  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );
  const selectedLabel = options.find((option) => option.id === value)?.label ?? "";

  return (
    <>
      <FilterTrigger
        label={selectedLabel}
        accessibilityLabel={`${t("kanban.board")}: ${selectedLabel}`}
        onPress={handleOpen}
        isOpen={open}
        triggerRef={anchorRef}
        testID="kanban-board-filter-trigger"
      />
      <Combobox
        options={comboboxOptions}
        value={value}
        onSelect={handleSelect}
        searchable={comboboxOptions.length > 6}
        title={t("kanban.board")}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
      />
    </>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function KanbanScreen(): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const hosts = useHosts();
  const sessions = useSessionStore((state) => state.sessions);
  const { projects, refetch: refetchProjects } = useProjects();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const lastWorkspaceSelection = useLastWorkspaceSelection();

  const [refreshKey, setRefreshKey] = useState(0);

  // ── Derive the kanban-capable host list ──────────────────────────────────
  const kanbanHosts = useMemo(
    () =>
      hosts.filter((host) => {
        const session = sessions[host.serverId];
        return (
          session?.serverInfo?.features?.kanbanBoard === true &&
          getHostRuntimeStore().getClient(host.serverId) !== null
        );
      }),
    [hosts, sessions],
  );

  const preferredProject = useMemo(() => {
    const workspaceSelection = activeWorkspaceSelection ?? lastWorkspaceSelection;
    if (!workspaceSelection) return null;
    const projectId = sessions[workspaceSelection.serverId]?.workspaces.get(
      workspaceSelection.workspaceId,
    )?.projectId;
    return projectId ? { serverId: workspaceSelection.serverId, projectId } : null;
  }, [activeWorkspaceSelection, lastWorkspaceSelection, sessions]);

  const {
    selectedHost,
    selection,
    hostProjects,
    hostProjectMap,
    selectHost,
    selectProject,
    selectBoard,
    updateSelection,
  } = useKanbanSelectionState(kanbanHosts, projects, preferredProject);

  const { boards, boardProviderId, state, remediation, remediationTarget } =
    useKanbanBoardResolution({
      kanbanHosts,
      selectedHost,
      selection,
      hostProjects,
      hostProjectMap,
      updateSelection,
      refreshKey,
    });

  // ── Refresh ───────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
    refetchProjects();
  }, [refetchProjects]);

  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RefreshCw}
        onPress={handleRefresh}
        testID="kanban-refresh"
        accessibilityLabel={t("kanban.refresh")}
      />
    ),
    [handleRefresh, t],
  );

  const showHostFilter = kanbanHosts.length > 1;
  const showProjectFilter = Boolean(selectedHost) && hostProjects.length > 1;
  const showBoardFilter = state.kind === "board" && boards.length > 1;
  const showFilterRow = showHostFilter || showProjectFilter || showBoardFilter;

  const projectFilterOptions = useMemo(
    () => hostProjects.map((project) => ({ id: project.projectId, label: project.projectName })),
    [hostProjects],
  );
  const boardFilterOptions = useMemo(
    () => boards.map((board) => ({ id: board.boardId, label: board.title })),
    [boards],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("kanban.title")} rightContent={refreshButton} />

      {showFilterRow ? (
        <View style={styles.controlsRow} testID="kanban-controls-row">
          {showHostFilter ? (
            <KanbanHostFilter
              hosts={kanbanHosts}
              selectedHost={selectedHost ?? ""}
              onSelectHost={selectHost}
            />
          ) : null}
          {showProjectFilter ? (
            <KanbanProjectFilter
              options={projectFilterOptions}
              value={selection?.projectId ?? ""}
              onChange={selectProject}
            />
          ) : null}
          {showBoardFilter ? (
            <KanbanBoardFilter
              options={boardFilterOptions}
              value={selection?.boardId ?? ""}
              onChange={selectBoard}
            />
          ) : null}
        </View>
      ) : null}

      {state.kind === "board" && selection?.boardId && boardProviderId ? (
        <KanbanBoardView
          key={`${selection.serverId}:${boardProviderId}:${selection.boardId}:${refreshKey}`}
          serverId={selection.serverId}
          providerId={boardProviderId}
          boardId={selection.boardId}
          remediationCwd={remediationTarget?.cwd ?? null}
        />
      ) : (
        renderKanbanScreenBody({
          state,
          remediation,
          remediationTarget,
          onOpenProjectSettings: (serverId: string, projectId: string) => {
            router.navigate(buildProjectSettingsRoute(serverId, projectId));
          },
          t,
        })
      )}
    </View>
  );
}

// ── Body renderer ───────────────────────────────────────────────────────────

function renderKanbanScreenBody(input: {
  state: KanbanScreenBodyState;
  /**
   * The daemon's recovery route for a board error, when it named one. It rides
   * beside the state rather than inside it: the state machine decides which
   * body to show, and this decides what that body can offer.
   */
  remediation: KanbanRemediation | null;
  remediationTarget: { serverId: string; cwd: string | null } | null;
  onOpenProjectSettings: (serverId: string, projectId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement | null {
  if (input.state.kind === "loading") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" />
      </View>
    );
  }
  if (input.state.kind === "no-hosts") {
    return (
      <View style={styles.centered} testID="kanban-no-hosts">
        <Text style={styles.message}>{input.t("kanban.noHostsTitle")}</Text>
        <Text style={styles.messageSub}>{input.t("kanban.noHostsBody")}</Text>
      </View>
    );
  }
  if (input.state.kind === "no-projects") {
    return (
      <View style={styles.centered} testID="kanban-no-projects">
        <Text style={styles.message}>{input.t("kanban.noProjectsTitle")}</Text>
        <Text style={styles.messageSub}>{input.t("kanban.noProjectsBody")}</Text>
      </View>
    );
  }
  if (input.state.kind === "unconfigured") {
    return (
      <KanbanUnconfigured
        serverId={input.state.serverId}
        projectId={input.state.projectId}
        onOpenProjectSettings={input.onOpenProjectSettings}
        t={input.t}
      />
    );
  }
  if (input.state.kind === "error") {
    return (
      <View style={styles.centered} testID="kanban-board-error">
        <Text style={styles.message}>{input.t("kanban.boardError")}</Text>
        <Text style={styles.messageSub}>{input.state.message}</Text>
        {input.remediation && input.remediationTarget ? (
          <KanbanRemediationBlock
            serverId={input.remediationTarget.serverId}
            cwd={input.remediationTarget.cwd}
            remediation={input.remediation}
          />
        ) : null}
      </View>
    );
  }
  // kind === "board": the parent renders the board view (it needs the
  // resolved providerId), so the body has nothing to show here.
  return null;
}

/**
 * The "no board configured for this project" watermark. Its own component so
 * the settings button's press handler is a stable binding, not an inline
 * closure in the screen's JSX.
 */
function KanbanUnconfigured({
  serverId,
  projectId,
  onOpenProjectSettings,
  t,
}: {
  serverId: string;
  projectId: string;
  onOpenProjectSettings: (serverId: string, projectId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const handleOpenSettings = useCallback(
    () => onOpenProjectSettings(serverId, projectId),
    [onOpenProjectSettings, serverId, projectId],
  );
  return (
    <View style={styles.centered} testID="kanban-unconfigured">
      <Text style={styles.message}>{t("kanban.unconfiguredTitle")}</Text>
      <Text style={styles.messageSub}>{t("kanban.unconfiguredBody")}</Text>
      <Button
        variant="secondary"
        size="sm"
        onPress={handleOpenSettings}
        testID="kanban-open-project-settings"
      >
        {t("kanban.unconfiguredAction")}
      </Button>
    </View>
  );
}

// ── Board view ──────────────────────────────────────────────────────────────

function KanbanBoardView({
  serverId,
  providerId,
  boardId,
  remediationCwd,
}: {
  serverId: string;
  providerId: string;
  boardId: string;
  /** Project root for a fix-it command; null leaves copy as the only route. */
  remediationCwd: string | null;
}): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0);
  const { board, isLoading, error, remediation } = useKanbanBoard(
    serverId,
    providerId,
    boardId,
    refreshKey,
  );
  const client = getHostRuntimeStore().getClient(serverId);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const moveCard = useCallback(
    async (cardId: string, targetColumnId: string) => {
      if (!client) return;
      const payload = await client.kanbanMoveCard({
        providerId,
        boardId,
        cardId,
        targetColumnId,
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      refresh();
    },
    [client, providerId, boardId, refresh],
  );

  const createCard = useCallback(
    async (columnId: string, title: string) => {
      if (!client) return;
      const payload = await client.kanbanCreateCard({
        providerId,
        boardId,
        columnId,
        title,
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      refresh();
    },
    [client, providerId, boardId, refresh],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" />
      </View>
    );
  }
  if (error || !board) {
    return (
      <View style={styles.centered} testID="kanban-board-error">
        <Text style={styles.message}>{error ?? "Board unavailable"}</Text>
        {remediation ? (
          <KanbanRemediationBlock
            serverId={serverId}
            cwd={remediationCwd}
            remediation={remediation}
          />
        ) : null}
      </View>
    );
  }

  return <KanbanColumns board={board} onMoveCard={moveCard} onCreateCard={createCard} />;
}

// ── Columns + drag ──────────────────────────────────────────────────────────
//
// Drop targeting is content-relative, not window-relative: columns and cards
// record their layout rects (relative to the board content container / their
// column), and the gesture translation moves a content-space point. This works
// identically on web and native - `measureInWindow` is a native-only API.

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  card: KanbanCard;
  sourceColumnId: string;
  /** Card origin in board-content coordinates at drag start. */
  origin: Rect;
  /** Current finger offset from the drag origin, in board-content coordinates. */
  x: number;
  y: number;
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function KanbanColumns({
  board,
  onMoveCard,
  onCreateCard,
}: {
  board: { columns: KanbanColumn[] };
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onCreateCard: (columnId: string, title: string) => Promise<void>;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const columnRectsRef = useRef<Map<string, Rect>>(new Map());
  const cardRectsRef = useRef<Map<string, Rect>>(new Map());

  const recordColumnRect = useCallback((columnId: string, event: LayoutEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    columnRectsRef.current.set(columnId, { x, y, width, height });
  }, []);

  const recordCardRect = useCallback((cardId: string, event: LayoutEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    cardRectsRef.current.set(cardId, { x, y, width, height });
  }, []);

  const findColumnAt = useCallback(
    (x: number, y: number): KanbanColumn | null => {
      for (const column of board.columns) {
        const rect = columnRectsRef.current.get(column.id);
        if (rect && containsPoint(rect, x, y)) {
          return column;
        }
      }
      return null;
    },
    [board],
  );

  const handleDragStart = useCallback((card: KanbanCard, sourceColumnId: string) => {
    const columnRect = columnRectsRef.current.get(sourceColumnId);
    const cardRect = cardRectsRef.current.get(card.id);
    if (!columnRect || !cardRect) return;
    setDrag({
      card,
      sourceColumnId,
      origin: {
        x: columnRect.x + cardRect.x,
        y: columnRect.y + cardRect.y,
        width: cardRect.width,
        height: cardRect.height,
      },
      x: 0,
      y: 0,
    });
    setDraggingCardId(card.id);
  }, []);

  const handleDragChange = useCallback((event: { x: number; y: number }) => {
    setDrag((prev) => (prev ? { ...prev, x: event.x, y: event.y } : prev));
  }, []);

  const handleDragEnd = useCallback(
    (event: { x: number; y: number }) => {
      const prev = drag;
      setDrag(null);
      setDraggingCardId(null);
      if (!prev) return;
      const dropX = prev.origin.x + prev.origin.width / 2 + event.x;
      const dropY = prev.origin.y + prev.origin.height / 2 + event.y;
      const target = findColumnAt(dropX, dropY);
      if (target && target.id !== prev.sourceColumnId) {
        void onMoveCard(prev.card.id, target.id);
      }
    },
    [drag, findColumnAt, onMoveCard],
  );

  const ghostStyle = useMemo(
    () =>
      drag
        ? [
            styles.dragGhost,
            {
              left: drag.origin.x + drag.x,
              top: drag.origin.y + drag.y,
              width: drag.origin.width,
            },
          ]
        : null,
    [drag],
  );

  return (
    <View style={styles.board} testID="kanban-board">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.boardContent}
      >
        {board.columns.map((column) => (
          <KanbanColumnView
            key={column.id}
            column={column}
            columns={board.columns}
            onLayoutColumn={recordColumnRect}
            onLayoutCard={recordCardRect}
            onDragStart={handleDragStart}
            isDropTarget={
              draggingCardId !== null && drag !== null && column.id !== drag.sourceColumnId
            }
            draggingCardId={draggingCardId}
            onCardDragChange={handleDragChange}
            onCardDragEnd={handleDragEnd}
            onMoveCard={onMoveCard}
            onCreateCard={onCreateCard}
            isCompact={isCompact}
          />
        ))}
        {drag && ghostStyle ? (
          <View pointerEvents="none" style={ghostStyle}>
            <Text style={styles.dragGhostText} numberOfLines={2}>
              {drag.card.title}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function KanbanColumnView({
  column,
  columns,
  onLayoutColumn,
  onLayoutCard,
  onDragStart,
  isDropTarget,
  draggingCardId,
  onCardDragChange,
  onCardDragEnd,
  onMoveCard,
  onCreateCard,
  isCompact,
}: {
  column: KanbanColumn;
  columns: KanbanColumn[];
  onLayoutColumn: (columnId: string, event: LayoutEvent) => void;
  onLayoutCard: (cardId: string, event: LayoutEvent) => void;
  onDragStart: (card: KanbanCard, sourceColumnId: string) => void;
  isDropTarget: boolean;
  draggingCardId: string | null;
  onCardDragChange: (event: { x: number; y: number }) => void;
  onCardDragEnd: (event: { x: number; y: number }) => void;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onCreateCard: (columnId: string, title: string) => Promise<void>;
  isCompact: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleColumnLayout = useCallback(
    (event: LayoutEvent) => onLayoutColumn(column.id, event),
    [onLayoutColumn, column.id],
  );

  const handleCardDragStart = useCallback(
    (card: KanbanCard) => onDragStart(card, column.id),
    [onDragStart, column.id],
  );

  const submitNewCard = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    try {
      await onCreateCard(column.id, title);
      setNewTitle("");
      setCreating(false);
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, submitting, onCreateCard, column.id]);

  const cancelNewCard = useCallback(() => {
    setCreating(false);
    setNewTitle("");
  }, []);

  const startCreating = useCallback(() => setCreating(true), []);

  const submitOnBlur = useCallback(() => {
    void submitNewCard();
  }, [submitNewCard]);

  const columnStyle = useMemo(
    () => [
      styles.column,
      isCompact ? styles.columnCompact : null,
      isDropTarget ? styles.columnDropTarget : null,
    ],
    [isCompact, isDropTarget],
  );

  return (
    <View
      onLayout={handleColumnLayout}
      style={columnStyle}
      testID={`kanban-column-${column.id}`}
      accessibilityLabel={`${column.name}, ${column.cards.length} cards`}
    >
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle} numberOfLines={1}>
          {column.name}
        </Text>
        <Text style={styles.columnCount}>{column.cards.length}</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.columnScroll}
        contentContainerStyle={styles.columnScrollContent}
      >
        {column.cards.map((card) => (
          <KanbanCardView
            key={card.id}
            card={card}
            sourceColumnId={column.id}
            columns={columns}
            onLayout={onLayoutCard}
            isDragging={draggingCardId === card.id}
            onDragStart={handleCardDragStart}
            onDragChange={onCardDragChange}
            onDragEnd={onCardDragEnd}
            onMoveCard={onMoveCard}
          />
        ))}
        {creating ? (
          <View style={styles.createRow}>
            <TextInput
              style={styles.createInput}
              placeholder={t("kanban.cardTitlePlaceholder")}
              placeholderTextColor={styles.createInputPlaceholder.color}
              value={newTitle}
              onChangeText={setNewTitle}
              onEndEditing={submitOnBlur}
              testID="kanban-new-card-input"
              returnKeyType="done"
            />
            <Button
              size="xs"
              variant="ghost"
              leftIcon={Check}
              onPress={submitOnBlur}
              disabled={newTitle.trim().length === 0 || submitting}
              testID="kanban-new-card-confirm"
            />
            <Button
              size="xs"
              variant="ghost"
              onPress={cancelNewCard}
              testID="kanban-new-card-cancel"
            >
              <Text style={styles.cancelText}>{t("kanban.cancel")}</Text>
            </Button>
          </View>
        ) : (
          <Pressable
            onPress={startCreating}
            style={styles.addCardButton}
            testID={`kanban-add-card-${column.id}`}
            accessibilityRole="button"
          >
            <KanbanIcon icon={Plus} size={16} color={styles.addCardText.color} />
            <Text style={styles.addCardText}>{t("kanban.addCard")}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function KanbanCardView({
  card,
  sourceColumnId,
  columns,
  onLayout,
  isDragging,
  onDragStart,
  onDragChange,
  onDragEnd,
  onMoveCard,
}: {
  card: KanbanCard;
  sourceColumnId: string;
  columns: KanbanColumn[];
  onLayout: (cardId: string, event: LayoutEvent) => void;
  isDragging: boolean;
  onDragStart: (card: KanbanCard) => void;
  onDragChange: (event: { x: number; y: number }) => void;
  onDragEnd: (event: { x: number; y: number }) => void;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
}): ReactElement {
  const handleLayout = useCallback(
    (event: LayoutEvent) => onLayout(card.id, event),
    [onLayout, card.id],
  );

  const startDrag = useCallback(() => onDragStart(card), [onDragStart, card]);

  const handleGestureStart = useCallback(() => startDrag(), [startDrag]);
  const handleGestureUpdate = useCallback(
    (event: { translationX: number; translationY: number }) =>
      onDragChange({ x: event.translationX, y: event.translationY }),
    [onDragChange],
  );
  const handleGestureEnd = useCallback(
    (event: { translationX: number; translationY: number }) =>
      onDragEnd({ x: event.translationX, y: event.translationY }),
    [onDragEnd],
  );

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .onStart(handleGestureStart)
        .onUpdate(handleGestureUpdate)
        .onEnd(handleGestureEnd),
    [handleGestureStart, handleGestureUpdate, handleGestureEnd],
  );

  const cardStyle = useMemo(
    () => [styles.card, isDragging ? styles.cardDragging : null],
    [isDragging],
  );

  const openLink = useCallback(() => {
    if (card.url) {
      void Linking.openURL(card.url).catch(() => undefined);
    }
  }, [card.url]);

  return (
    <GestureDetector gesture={dragGesture}>
      <View onLayout={handleLayout} style={cardStyle} accessibilityLabel={card.title}>
        <Text style={styles.cardTitle} numberOfLines={3}>
          {card.title}
        </Text>
        {card.body ? (
          <Text style={styles.cardDescription} numberOfLines={2}>
            {card.body}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <KanbanIcon icon={ListChevronsUpDown} size={13} color={styles.cardAssignees.color} />
          {card.assignees.length > 0 ? (
            <Text style={styles.cardAssignees} numberOfLines={1}>
              {card.assignees.join(", ")}
            </Text>
          ) : null}
          {card.url ? (
            <Pressable
              onPress={openLink}
              style={styles.cardLink}
              testID={`kanban-card-link-${card.id}`}
              accessibilityRole="link"
            >
              <KanbanIcon icon={ExternalLink} size={14} color={styles.cardAssignees.color} />
            </Pressable>
          ) : null}
          <KanbanCardMoveMenu
            card={card}
            sourceColumnId={sourceColumnId}
            columns={columns}
            onMoveCard={onMoveCard}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

function KanbanCardMoveMenu({
  card,
  sourceColumnId,
  columns,
  onMoveCard,
}: {
  card: KanbanCard;
  sourceColumnId: string;
  columns: KanbanColumn[];
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
}): ReactElement | null {
  const { t } = useTranslation();
  const targets = useMemo(
    () => columns.filter((column) => column.id !== sourceColumnId),
    [columns, sourceColumnId],
  );
  if (targets.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.cardMenuButton}
        testID={`kanban-card-menu-${card.id}`}
        accessibilityLabel={`${t("kanban.moveTo", { column: card.title })}`}
      >
        <KanbanIcon icon={MoreVertical} size={16} color={styles.cardAssignees.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((column) => (
          <KanbanMoveMenuItem
            key={column.id}
            cardId={card.id}
            column={column}
            onMoveCard={onMoveCard}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KanbanMoveMenuItem({
  cardId,
  column,
  onMoveCard,
}: {
  cardId: string;
  column: KanbanColumn;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    void onMoveCard(cardId, column.id);
  }, [onMoveCard, cardId, column.id]);
  return (
    <DropdownMenuItem testID={`kanban-move-to-${column.id}`} onSelect={handleSelect}>
      {t("kanban.moveTo", { column: column.name })}
    </DropdownMenuItem>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    textAlign: "center",
  },
  messageSub: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 360,
  },
  // Host/project/board filters use the same top inset and unseparated canvas
  // as the other aggregate-page toolbars.
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  filterTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: COMPACT_CONTROL_HEIGHT,
    maxWidth: 240,
  },
  filterTriggerActive: {
    borderColor: theme.colors.borderAccent,
  },
  filterTriggerText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  chevron: {
    color: theme.colors.foregroundMuted,
  },
  board: {
    flex: 1,
    minHeight: 0,
  },
  boardContent: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  column: {
    width: 300,
    maxWidth: "80%",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 120,
  },
  columnCompact: {
    width: 260,
  },
  columnDropTarget: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  columnTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  columnCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  columnScroll: {
    flex: 1,
    minHeight: 0,
  },
  columnScrollContent: {
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  card: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  cardDragging: {
    opacity: 0.4,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  cardDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  cardAssignees: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flex: 1,
  },
  cardLink: {
    padding: 2,
  },
  cardMenuButton: {
    padding: 2,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  createInput: {
    flex: 1,
    minHeight: 32,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
  },
  createInputPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  cancelText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  addCardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  addCardText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  dragGhost: {
    position: "absolute",
    zIndex: 1000,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    padding: theme.spacing[2],
  },
  dragGhostText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
