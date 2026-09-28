import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useShallow } from "zustand/shallow";
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChevronsUpDown,
  MoreVertical,
  Plus,
  RefreshCw,
  type IconComponent,
} from "@/components/icons/material-icons";
import { useKanbanBoard, useKanbanBoards, useKanbanConnectionScope } from "@/kanban/kanban-hooks";
import { KanbanRemediationBlock } from "@/screens/kanban-remediation-block";
import { KanbanCardDetail } from "@/screens/kanban-card-detail";
import { KanbanCardActionSheet } from "@/screens/kanban-card-action-sheet";
import { useProjects } from "@/hooks/use-projects";
import { buildProjectSettingsRoute } from "@/utils/host-routes";
import { KANBAN_NOT_CONFIGURED } from "@otto-code/protocol/kanban";
import type {
  KanbanCard,
  KanbanColumn,
  KanbanFieldValueInput,
  KanbanRemediation,
} from "@otto-code/protocol/kanban";
import {
  resolveKanbanProjectSelection,
  resolveKanbanScreenBodyState,
  type KanbanScreenBodyState,
} from "./kanban-screen-state";
import type { IconSizeProp } from "@/components/icons/icon-size";

// ── Shared types ────────────────────────────────────────────────────────────

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
  size: IconSizeProp;
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
        <ChevronDown size="sm" color={styles.chevron.color} />
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
          <ChevronDown size="sm" color={styles.chevron.color} />
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

/**
 * The project of the active (or last) workspace. Selects the project id as a primitive so
 * unrelated session writes, such as agent streaming, do not re-render the board screen.
 */
function usePreferredKanbanProject(): { serverId: string; projectId: string } | null {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const workspaceSelection = activeWorkspaceSelection ?? lastWorkspaceSelection;
  const serverId = workspaceSelection?.serverId ?? null;
  const projectId = useSessionStore((state) => {
    if (!workspaceSelection) return null;
    return (
      state.sessions[workspaceSelection.serverId]?.workspaces.get(workspaceSelection.workspaceId)
        ?.projectId ?? null
    );
  });
  return useMemo(
    () => (serverId && projectId ? { serverId, projectId } : null),
    [serverId, projectId],
  );
}

export function KanbanScreen(): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const hosts = useHosts();
  const kanbanCapableServerIds = useSessionStore(
    useShallow((state) =>
      hosts
        .filter((host) => state.sessions[host.serverId]?.serverInfo?.features?.kanbanBoard === true)
        .map((host) => host.serverId),
    ),
  );
  const { projects, refetch: refetchProjects } = useProjects();

  const [refreshKey, setRefreshKey] = useState(0);

  // ── Derive the kanban-capable host list ──────────────────────────────────
  const kanbanHosts = useMemo(
    () =>
      hosts.filter((host) => {
        return (
          kanbanCapableServerIds.includes(host.serverId) &&
          getHostRuntimeStore().getClient(host.serverId) !== null
        );
      }),
    [hosts, kanbanCapableServerIds],
  );

  const preferredProject = usePreferredKanbanProject();

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
          projectId={selection.projectId}
          projectKey={selection.projectKey}
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
  projectId,
  projectKey,
  remediationCwd,
}: {
  serverId: string;
  providerId: string;
  boardId: string;
  projectId: string;
  projectKey: string | null;
  /** Project root for a fix-it command; null leaves copy as the only route. */
  remediationCwd: string | null;
}): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0);
  const connectionProjectId = useKanbanConnectionScope(serverId) ? projectId : undefined;
  const { board, fields, cardFields, canDeleteCards, isLoading, error, remediation } =
    useKanbanBoard(serverId, providerId, boardId, refreshKey, connectionProjectId ?? null);
  const client = getHostRuntimeStore().getClient(serverId);
  const canWatch = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.kanbanBoardWatch === true,
  );
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [cardAction, setCardAction] = useState<"create" | "link" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const openCreate = useCallback(() => setCardAction("create"), []);
  const openLink = useCallback(() => setCardAction("link"), []);
  const closeAction = useCallback(() => setCardAction(null), []);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!client || !canWatch) return;
    const unsubscribe = client.on("kanban.board.changed", (event) => {
      if (event.payload.providerId === providerId && event.payload.boardId === boardId) refresh();
    });
    void client
      .kanbanWatchBoard({
        providerId,
        boardId,
        ...(connectionProjectId ? { projectId: connectionProjectId } : {}),
        watch: true,
      })
      .catch(() => undefined);
    return () => {
      unsubscribe();
      void client
        .kanbanWatchBoard({
          providerId,
          boardId,
          ...(connectionProjectId ? { projectId: connectionProjectId } : {}),
          watch: false,
        })
        .catch(() => undefined);
    };
  }, [client, canWatch, providerId, boardId, connectionProjectId, refresh]);

  const updateCard = useCallback(
    async (cardId: string, fieldId: string, value: KanbanFieldValueInput) => {
      if (!client) throw new Error("Host disconnected");
      const payload = await client.kanbanUpdateCard({
        providerId,
        boardId,
        ...(connectionProjectId ? { projectId: connectionProjectId } : {}),
        cardId,
        fieldId,
        value,
      });
      if (payload.error) throw new Error(payload.error);
      refresh();
    },
    [client, providerId, boardId, connectionProjectId, refresh],
  );

  const deleteCard = useCallback(
    async (cardId: string) => {
      if (!client) throw new Error("Host disconnected");
      const payload = await client.kanbanDeleteCard({
        providerId,
        boardId,
        ...(connectionProjectId ? { projectId: connectionProjectId } : {}),
        cardId,
      });
      if (payload.error) throw new Error(payload.error);
      refresh();
    },
    [client, providerId, boardId, connectionProjectId, refresh],
  );

  const linkTask = useCallback(
    async (externalId: string, columnId?: string) => {
      if (!client) throw new Error("Host disconnected");
      const payload = await client.kanbanLinkTask({
        providerId,
        boardId,
        externalId,
        projectId,
        ...(projectKey ? { projectKey } : {}),
        ...(columnId ? { columnId } : {}),
      });
      if (payload.error) throw new Error(payload.error);
      refresh();
    },
    [client, providerId, boardId, projectId, projectKey, refresh],
  );

  const moveCard = useCallback(
    async (cardId: string, targetColumnId: string) => {
      if (!client) return;
      setActionError(null);
      try {
        const payload = await client.kanbanMoveCard({
          providerId,
          boardId,
          ...(connectionProjectId ? { projectId: connectionProjectId } : {}),
          cardId,
          targetColumnId,
        });
        if (payload.error) throw new Error(payload.error);
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        refresh();
      }
    },
    [client, providerId, boardId, connectionProjectId, refresh],
  );

  const createCard = useCallback(
    async (columnId: string, title: string, body?: string) => {
      if (!client) throw new Error("Host disconnected");
      setActionError(null);
      try {
        const payload = await client.kanbanCreateCard({
          providerId,
          boardId,
          ...(connectionProjectId ? { projectId: connectionProjectId } : {}),
          columnId,
          title,
          ...(body ? { body } : {}),
        });
        if (payload.error) throw new Error(payload.error);
        refresh();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [client, providerId, boardId, connectionProjectId, refresh],
  );

  const selectedCard = board?.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === selectedCardId);
  const closeDetail = useCallback(() => setSelectedCardId(null), []);
  const updateSelectedCard = useCallback(
    (fieldId: string, value: KanbanFieldValueInput) => {
      if (!selectedCardId) throw new Error("No card selected");
      return updateCard(selectedCardId, fieldId, value);
    },
    [selectedCardId, updateCard],
  );
  const deleteSelectedCard = useCallback(() => {
    if (!selectedCardId) throw new Error("No card selected");
    return deleteCard(selectedCardId);
  }, [selectedCardId, deleteCard]);

  if (isLoading && !board) {
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

  return (
    <>
      <View style={styles.boardToolbar}>
        <Button variant="secondary" size="sm" onPress={openLink} testID="kanban-link-task">
          Link existing
        </Button>
        <Button size="sm" leftIcon={Plus} onPress={openCreate} testID="kanban-add-card">
          New card
        </Button>
      </View>
      {actionError ? (
        <Text style={styles.messageSub} testID="kanban-action-error">
          {actionError}
        </Text>
      ) : null}
      <KanbanColumns board={board} onMoveCard={moveCard} onOpenCard={setSelectedCardId} />
      {cardAction ? (
        <KanbanCardActionSheet
          key={cardAction}
          action={cardAction}
          firstColumn={board.columns[0]}
          providerId={providerId}
          onClose={closeAction}
          onCreate={createCard}
          onLink={linkTask}
        />
      ) : null}
      {selectedCard ? (
        <KanbanCardDetail
          card={selectedCard}
          fields={fields}
          values={cardFields[selectedCard.id] ?? []}
          canDelete={canDeleteCards}
          onClose={closeDetail}
          onUpdate={updateSelectedCard}
          onDelete={deleteSelectedCard}
        />
      ) : null}
    </>
  );
}

// ── Columns + drag ──────────────────────────────────────────────────────────
//
// Gesture and drop coordinates are window-relative. Only the visual preview
// needs conversion to the board's local coordinates.

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  card: KanbanCard;
  sourceColumnId: string;
  boardOrigin: { x: number; y: number };
  pointer: { x: number; y: number };
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function KanbanColumns({
  board,
  onMoveCard,
  onOpenCard,
}: {
  board: { columns: KanbanColumn[] };
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [drag, setDrag] = useState<DragState | null>(null);
  const isDragging = drag !== null;
  const dragRef = useRef<DragState | null>(null);
  const [hoveredColumnId, setHoveredColumnId] = useState<string | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const boardRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const columnRefs = useRef<Map<string, View>>(new Map());
  const [selectedColumnId, setSelectedColumnId] = useState(board.columns[0]?.id ?? "");
  const [scrollX, setScrollX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    if (!board.columns.some((column) => column.id === selectedColumnId)) {
      setSelectedColumnId(board.columns[0]?.id ?? "");
    }
  }, [board.columns, selectedColumnId]);

  const setColumnRef = useCallback((columnId: string, view: View | null) => {
    if (view) columnRefs.current.set(columnId, view);
    else columnRefs.current.delete(columnId);
  }, []);

  const columnAtPoint = useCallback(
    (x: number, y: number) =>
      board.columns.find((column) => {
        const element = columnRefs.current.get(column.id) as unknown as HTMLElement | undefined;
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return containsPoint(rect, x, y);
      }),
    [board.columns],
  );

  const handleDragStart = useCallback(
    (card: KanbanCard, sourceColumnId: string, pointer: { x: number; y: number }) => {
      const boardElement = boardRef.current as unknown as HTMLElement | null;
      if (!boardElement) return;
      const boardRect = boardElement.getBoundingClientRect();
      const next = {
        card,
        sourceColumnId,
        boardOrigin: { x: boardRect.x, y: boardRect.y },
        pointer,
      };
      dragRef.current = next;
      setDrag(next);
      setDraggingCardId(card.id);
    },
    [],
  );

  const handleDragChange = useCallback(
    (pointer: { x: number; y: number }) => {
      const previous = dragRef.current;
      if (!previous) return;
      const target = columnAtPoint(pointer.x, pointer.y);
      setHoveredColumnId(target?.id === previous.sourceColumnId ? null : (target?.id ?? null));
      const next = { ...previous, pointer };
      dragRef.current = next;
      setDrag(next);
    },
    [columnAtPoint],
  );

  const handleDragEnd = useCallback(
    (event: { absoluteX: number; absoluteY: number }) => {
      const prev = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      setDraggingCardId(null);
      setHoveredColumnId(null);
      if (!prev) return;
      const target = columnAtPoint(event.absoluteX, event.absoluteY);
      if (target && target.id !== prev.sourceColumnId) {
        void onMoveCard(prev.card.id, target.id);
      }
    },
    [columnAtPoint, onMoveCard],
  );

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
    setDraggingCardId(null);
    setHoveredColumnId(null);
  }, []);

  useEffect(() => {
    if (!isDragging || !isWeb) return;
    const scrollElement = (
      boardRef.current as unknown as HTMLElement | null
    )?.querySelector<HTMLElement>('[data-testid="kanban-board-scroll"]');
    if (!scrollElement) return;
    const timer = window.setInterval(() => {
      const pointer = dragRef.current?.pointer;
      if (!pointer) return;
      const rect = scrollElement.getBoundingClientRect();
      if (pointer.y < rect.top || pointer.y > rect.bottom) return;
      let direction = 0;
      if (pointer.x < rect.left + 56) direction = -1;
      else if (pointer.x > rect.right - 56) direction = 1;
      if (!direction) return;
      scrollElement.scrollLeft += direction * 16;
      const target = columnAtPoint(pointer.x, pointer.y);
      setHoveredColumnId(
        target?.id === dragRef.current?.sourceColumnId ? null : (target?.id ?? null),
      );
    }, 16);
    return () => window.clearInterval(timer);
  }, [columnAtPoint, isDragging]);

  const maxScroll = Math.max(0, contentWidth - viewportWidth);
  const hasOverflow = maxScroll > 1;
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollX(event.nativeEvent.contentOffset.x);
  }, []);
  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);
  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);
  const scrollBy = useCallback(
    (direction: -1 | 1) => {
      scrollRef.current?.scrollTo({
        x: Math.max(0, Math.min(maxScroll, scrollX + direction * 320)),
        animated: true,
      });
    },
    [maxScroll, scrollX],
  );
  const scrollLeft = useCallback(() => scrollBy(-1), [scrollBy]);
  const scrollRight = useCallback(() => scrollBy(1), [scrollBy]);

  useEffect(() => {
    if (!isWeb || isCompact || !hasOverflow || isDragging) return;
    const boardElement = boardRef.current as unknown as HTMLElement | null;
    const scrollElement = boardElement?.querySelector<HTMLElement>(
      '[data-testid="kanban-board-scroll"]',
    );
    if (!boardElement || !scrollElement) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
        return;
      // A column keeps an ordinary wheel gesture while its card list can
      // consume it. Shift + wheel always navigates columns.
      let target = event.target as HTMLElement | null;
      while (!event.shiftKey && target && target !== scrollElement) {
        if (
          ["auto", "scroll"].includes(window.getComputedStyle(target).overflowY) &&
          target.scrollHeight > target.clientHeight + 1 &&
          ((event.deltaY > 0 && target.scrollTop < target.scrollHeight - target.clientHeight - 1) ||
            (event.deltaY < 0 && target.scrollTop > 1))
        )
          return;
        target = target.parentElement;
      }
      const next = Math.max(0, Math.min(maxScroll, scrollElement.scrollLeft + event.deltaY));
      if (next !== scrollElement.scrollLeft) {
        event.preventDefault();
        scrollElement.scrollLeft = next;
      }
    };
    boardElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => boardElement.removeEventListener("wheel", handleWheel);
  }, [hasOverflow, isCompact, isDragging, maxScroll]);

  const displayedColumns = isCompact
    ? board.columns.filter((column) => column.id === selectedColumnId)
    : board.columns;
  const thumbWidth =
    contentWidth > 0 ? Math.max(24, (trackWidth * viewportWidth) / contentWidth) : 0;
  const thumbLeft = maxScroll > 0 ? ((trackWidth - thumbWidth) * scrollX) / maxScroll : 0;

  const ghostStyle = useMemo(
    () =>
      drag
        ? [
            styles.dragGhost,
            inlineUnistylesStyle({
              left: drag.pointer.x - drag.boardOrigin.x + 12,
              top: drag.pointer.y - drag.boardOrigin.y + 12,
            }),
          ]
        : null,
    [drag],
  );

  return (
    <View ref={boardRef} style={styles.board} testID="kanban-board">
      {isCompact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.columnPicker}
          contentContainerStyle={styles.columnPickerContent}
          testID="kanban-column-picker"
        >
          {board.columns.map((column) => (
            <KanbanColumnPickerItem
              key={column.id}
              column={column}
              selected={column.id === selectedColumnId}
              onSelect={setSelectedColumnId}
            />
          ))}
        </ScrollView>
      ) : null}
      {isCompact ? (
        displayedColumns.map((column) => (
          <KanbanColumnView
            key={column.id}
            column={column}
            columns={board.columns}
            onColumnRef={setColumnRef}
            onDragStart={handleDragStart}
            onDragCancel={cancelDrag}
            isDropTarget={hoveredColumnId === column.id}
            draggingCardId={null}
            onCardDragChange={handleDragChange}
            onCardDragEnd={handleDragEnd}
            onMoveCard={onMoveCard}
            onOpenCard={onOpenCard}
            isCompact
          />
        ))
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator
            scrollEnabled={!drag}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={handleViewportLayout}
            onContentSizeChange={setContentWidth}
            contentContainerStyle={styles.boardContent}
            testID="kanban-board-scroll"
          >
            {displayedColumns.map((column) => (
              <KanbanColumnView
                key={column.id}
                column={column}
                columns={board.columns}
                onColumnRef={setColumnRef}
                onDragStart={handleDragStart}
                onDragCancel={cancelDrag}
                isDropTarget={hoveredColumnId === column.id}
                draggingCardId={draggingCardId}
                onCardDragChange={handleDragChange}
                onCardDragEnd={handleDragEnd}
                onMoveCard={onMoveCard}
                onOpenCard={onOpenCard}
                isCompact={false}
              />
            ))}
          </ScrollView>
          {drag && ghostStyle ? (
            <View pointerEvents="none" style={ghostStyle} testID="kanban-drag-preview">
              <Text style={styles.dragGhostText} numberOfLines={2}>
                {drag.card.title}
              </Text>
            </View>
          ) : null}
          {board.columns.length > 1 ? (
            <View style={styles.boardNavigation}>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={ChevronLeft}
                onPress={scrollLeft}
                disabled={!hasOverflow || scrollX <= 1}
                accessibilityLabel="Scroll board left"
                testID="kanban-scroll-left"
              />
              <View style={styles.scrollTrack} onLayout={handleTrackLayout}>
                {hasOverflow ? (
                  <View
                    style={[
                      styles.scrollThumb,
                      inlineUnistylesStyle({
                        width: thumbWidth,
                        transform: [{ translateX: thumbLeft }],
                      }),
                    ]}
                  />
                ) : null}
              </View>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={ChevronRight}
                onPress={scrollRight}
                disabled={!hasOverflow || scrollX >= maxScroll - 1}
                accessibilityLabel="Scroll board right"
                testID="kanban-scroll-right"
              />
              {hasOverflow ? (
                <Text style={styles.scrollHint}>Shift + wheel to scroll columns</Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function KanbanColumnPickerItem({
  column,
  selected,
  onSelect,
}: {
  column: KanbanColumn;
  selected: boolean;
  onSelect: (columnId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(column.id), [column.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      onPress={handlePress}
      style={[styles.columnPickerItem, selected ? styles.columnPickerItemSelected : null]}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      testID={`kanban-select-column-${column.id}`}
    >
      <Text style={styles.columnPickerLabel}>{column.name}</Text>
      <Text style={styles.columnCount}>{column.cards.length}</Text>
    </Pressable>
  );
}

function KanbanColumnView({
  column,
  columns,
  onColumnRef,
  onDragStart,
  onDragCancel,
  isDropTarget,
  draggingCardId,
  onCardDragChange,
  onCardDragEnd,
  onMoveCard,
  onOpenCard,
  isCompact,
}: {
  column: KanbanColumn;
  columns: KanbanColumn[];
  onColumnRef: (columnId: string, view: View | null) => void;
  onDragStart: (
    card: KanbanCard,
    sourceColumnId: string,
    pointer: { x: number; y: number },
  ) => void;
  onDragCancel: () => void;
  isDropTarget: boolean;
  draggingCardId: string | null;
  onCardDragChange: (pointer: { x: number; y: number }) => void;
  onCardDragEnd: (event: { absoluteX: number; absoluteY: number }) => void;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
  isCompact: boolean;
}): ReactElement {
  const setRef = useCallback(
    (view: View | null) => onColumnRef(column.id, view),
    [onColumnRef, column.id],
  );

  const handleCardDragStart = useCallback(
    (card: KanbanCard, pointer: { x: number; y: number }) => onDragStart(card, column.id, pointer),
    [onDragStart, column.id],
  );

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
      ref={setRef}
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
            isDragging={draggingCardId === card.id}
            onDragStart={handleCardDragStart}
            onDragCancel={onDragCancel}
            onDragChange={onCardDragChange}
            onDragEnd={onCardDragEnd}
            onMoveCard={onMoveCard}
            onOpenCard={onOpenCard}
            enableDrag={isWeb && !isCompact}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function KanbanCardView({
  card,
  sourceColumnId,
  columns,
  isDragging,
  onDragStart,
  onDragCancel,
  onDragChange,
  onDragEnd,
  onMoveCard,
  onOpenCard,
  enableDrag,
}: {
  card: KanbanCard;
  sourceColumnId: string;
  columns: KanbanColumn[];
  isDragging: boolean;
  onDragStart: (card: KanbanCard, pointer: { x: number; y: number }) => void;
  onDragCancel: () => void;
  onDragChange: (pointer: { x: number; y: number }) => void;
  onDragEnd: (event: { absoluteX: number; absoluteY: number }) => void;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
  enableDrag: boolean;
}): ReactElement {
  const cardRef = useRef<View>(null);
  useEffect(() => {
    if (!isWeb || !enableDrag) return;
    const element = cardRef.current as unknown as HTMLElement | null;
    if (!element) return;
    let start: { x: number; y: number; pointerId: number } | null = null;
    let dragging = false;
    let suppressClickUntil = 0;
    const stopTracking = () => {
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerCancel);
      start = null;
      dragging = false;
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || start) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-testid^="kanban-card-link-"], [data-testid^="kanban-card-menu-"]'))
        return;
      start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      document.addEventListener("pointermove", pointerMove);
      document.addEventListener("pointerup", pointerUp);
      document.addEventListener("pointercancel", pointerCancel);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) {
        dragging = true;
        onDragStart(card, { x: event.clientX, y: event.clientY });
      }
      if (dragging) {
        event.preventDefault();
        onDragChange({ x: event.clientX, y: event.clientY });
      }
    };
    const pointerUp = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      if (dragging) {
        suppressClickUntil = Date.now() + 500;
        onDragEnd({ absoluteX: event.clientX, absoluteY: event.clientY });
      }
      stopTracking();
    };
    const pointerCancel = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      onDragCancel();
      stopTracking();
    };
    const click = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
    };
    element.addEventListener("pointerdown", pointerDown, true);
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("pointerdown", pointerDown, true);
      if (dragging) onDragCancel();
      stopTracking();
      element.removeEventListener("click", click, true);
    };
  }, [card, enableDrag, onDragStart, onDragChange, onDragEnd, onDragCancel]);

  const cardStyle = useMemo(
    () => [styles.card, isDragging ? styles.cardDragging : null],
    [isDragging],
  );

  const openLink = useCallback(() => {
    if (card.url) {
      void Linking.openURL(card.url).catch(() => undefined);
    }
  }, [card.url]);
  const openDetail = useCallback(() => onOpenCard(card.id), [onOpenCard, card.id]);

  const cardContent = (
    <View ref={cardRef} style={cardStyle} accessibilityLabel={card.title}>
      <Pressable
        onPress={openDetail}
        accessibilityRole="button"
        testID={`kanban-card-detail-${card.id}`}
      >
        <Text style={styles.cardTitle} numberOfLines={3}>
          {card.title}
        </Text>
      </Pressable>
      {card.body ? (
        <Text style={styles.cardDescription} numberOfLines={1}>
          {card.body}
        </Text>
      ) : null}
      <View style={styles.cardFooter}>
        {enableDrag ? (
          <KanbanIcon icon={ListChevronsUpDown} size="sm" color={styles.cardAssignees.color} />
        ) : null}
        {card.assignees.length > 0 ? (
          <Text style={styles.cardAssignees} numberOfLines={1}>
            {card.assignees.join(", ")}
          </Text>
        ) : null}
        <View style={styles.cardFooterSpacer} />
        {card.url ? (
          <Pressable
            onPress={openLink}
            style={styles.cardLink}
            testID={`kanban-card-link-${card.id}`}
            accessibilityRole="link"
          >
            <KanbanIcon icon={ExternalLink} size="sm" color={styles.cardAssignees.color} />
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
  );
  return cardContent;
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
        <KanbanIcon icon={MoreVertical} size="md" color={styles.cardAssignees.color} />
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
  boardToolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
  },
  boardContent: {
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  boardNavigation: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingBottom: theme.spacing[3],
  },
  scrollTrack: {
    flex: 1,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  scrollThumb: {
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  scrollHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  columnPicker: { flexGrow: 0, flexShrink: 0 },
  columnPickerContent: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  columnPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  columnPickerItemSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  columnPickerLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
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
    width: "100%",
    maxWidth: "100%",
    flex: 1,
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
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
  },
  cardFooterSpacer: { flex: 1 },
  cardLink: {
    padding: 2,
  },
  cardMenuButton: {
    padding: 2,
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
