import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  CornerDownLeft,
  GitBranch,
  Lightbulb,
  MessageSquarePlus,
  Play,
  Schema,
  Trash2,
  X,
} from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import type { SuggestedTaskRow } from "./select";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

const ThemedLightbulb = withUnistyles(Lightbulb);
const ThemedPlay = withUnistyles(Play);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);
const ThemedSchema = withUnistyles(Schema);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedCornerDownLeft = withUnistyles(CornerDownLeft);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

// Per-mode display copy + a stable leading icon (react-perf forbids inline JSX
// as a prop, so each icon element is built once at module scope). Descriptions
// mirror the daemon's four start modes — only `subagent` links to this chat.
interface ModeMeta {
  primaryLabel: string;
  menuLabel: string;
  description: string;
  leading: ReactElement;
}

const MODE_META: Record<TasksSuggestedStartMode, ModeMeta> = {
  new_chat: {
    primaryLabel: "New chat",
    menuLabel: "New chat",
    description: "Separate chat in its own tab, no link",
    leading: <ThemedMessageSquarePlus size={14} uniProps={foregroundMutedColorMapping} />,
  },
  subagent: {
    primaryLabel: "Sub-agent",
    menuLabel: "Sub-agent",
    description: "Linked child of this chat",
    leading: <ThemedSchema size={14} uniProps={foregroundMutedColorMapping} />,
  },
  worktree: {
    primaryLabel: "Worktree",
    menuLabel: "New worktree",
    description: "Isolated worktree on a new branch",
    leading: <ThemedGitBranch size={14} uniProps={foregroundMutedColorMapping} />,
  },
  in_session: {
    primaryLabel: "This session",
    menuLabel: "This session",
    description: "Send the task to this agent",
    leading: <ThemedCornerDownLeft size={14} uniProps={foregroundMutedColorMapping} />,
  },
};

// Every mode is a valid per-task action; bulk "Start all" excludes in_session
// (steering N tasks into one chat can't give "one chat each").
const ALL_MODES: readonly TasksSuggestedStartMode[] = [
  "new_chat",
  "subagent",
  "worktree",
  "in_session",
];
const BULK_MODES: readonly TasksSuggestedStartMode[] = ["new_chat", "subagent", "worktree"];

const LIST_MAX_HEIGHT = 300;

export interface SuggestedTasksOverlayProps {
  rows: SuggestedTaskRow[];
  actions: SuggestedTaskActions;
}

// A floating, non-blocking card that pops over the TOP of the chat when an agent
// suggests one or more tasks. The user answers each asynchronously via a split
// button (primary = their default mode, caret = the other modes + Dismiss), or
// closes the whole card with the title-bar X. It never steals composer focus and
// persists until the queue is empty. Mounted inside the chat content container
// (not a Portal) so it stays within bounds — Android hit-testing needs the card
// inside its parent (see docs/floating-panels.md).
export function SuggestedTasksOverlay({
  rows,
  actions,
}: SuggestedTasksOverlayProps): ReactElement | null {
  const enabled = useSettings((settings) => settings.suggestedTasksEnabled);
  const defaultMode = useSettings((settings) => settings.suggestedTasksDefaultMode);
  const allTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  // Secondary options for a per-row split button: every mode except the default.
  const rowSecondaryModes = useMemo(
    () => ALL_MODES.filter((mode) => mode !== defaultMode),
    [defaultMode],
  );
  // "Start all" can't do in_session, so its primary falls back to new_chat when
  // the user's default is in_session; its caret lists the rest.
  const bulkPrimaryMode: TasksSuggestedStartMode =
    defaultMode === "in_session" ? "new_chat" : defaultMode;
  const bulkSecondaryModes = useMemo(
    () => BULK_MODES.filter((mode) => mode !== bulkPrimaryMode),
    [bulkPrimaryMode],
  );

  // Suppressed on this device, or nothing pending → render nothing.
  if (!enabled || rows.length === 0) {
    return null;
  }
  const showBulk = rows.length >= 2;

  return (
    <View style={styles.overlayWrap} pointerEvents="box-none">
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={styles.card}
        testID="suggested-tasks-overlay"
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ThemedLightbulb size={14} uniProps={accentColorMapping} />
            <Text style={styles.headerLabel} numberOfLines={1}>
              {rows.length === 1 ? "Suggested task" : `Suggested tasks (${rows.length})`}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {showBulk ? (
              <SplitStartButton
                primaryMode={bulkPrimaryMode}
                secondaryModes={bulkSecondaryModes}
                primaryLabel="Start all"
                accessibilityLabel="Start all suggested tasks"
                testIdBase="suggested-tasks-overlay-start-all"
                taskIds={allTaskIds}
                actions={actions}
              />
            ) : null}
            <DismissButton
              taskIds={allTaskIds}
              actions={actions}
              accessibilityLabel={
                showBulk ? "Dismiss all suggested tasks" : "Dismiss suggested task"
              }
              tooltip={showBulk ? "Dismiss all" : "Dismiss"}
              testID="suggested-tasks-overlay-dismiss-all"
            />
          </View>
        </View>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {rows.map((row) => (
            <SuggestedTaskItem
              key={row.taskId}
              row={row}
              actions={actions}
              defaultMode={defaultMode}
              secondaryModes={rowSecondaryModes}
            />
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

interface SuggestedTaskItemProps {
  row: SuggestedTaskRow;
  actions: SuggestedTaskActions;
  defaultMode: TasksSuggestedStartMode;
  secondaryModes: readonly TasksSuggestedStartMode[];
}

function SuggestedTaskItem({
  row,
  actions,
  defaultMode,
  secondaryModes,
}: SuggestedTaskItemProps): ReactElement {
  const taskIds = useMemo(() => [row.taskId], [row.taskId]);
  return (
    <View style={styles.task} testID={`suggested-tasks-overlay-row-${row.taskId}`}>
      <View style={styles.taskText}>
        <Text style={styles.taskTitle} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.taskTldr} numberOfLines={2}>
          {row.tldr}
        </Text>
      </View>
      <SplitStartButton
        primaryMode={defaultMode}
        secondaryModes={secondaryModes}
        primaryLabel={MODE_META[defaultMode].primaryLabel}
        accessibilityLabel={`Start suggested task: ${row.title}`}
        testIdBase={`suggested-tasks-overlay-start-${row.taskId}`}
        taskIds={taskIds}
        actions={actions}
        showDismiss
      />
    </View>
  );
}

interface SplitStartButtonProps {
  primaryMode: TasksSuggestedStartMode;
  secondaryModes: readonly TasksSuggestedStartMode[];
  primaryLabel: string;
  accessibilityLabel: string;
  testIdBase: string;
  taskIds: readonly string[];
  actions: SuggestedTaskActions;
  // Adds a "Dismiss" row at the bottom of the caret menu (per-task control).
  showDismiss?: boolean;
}

// A split button: the primary half runs the caller's default mode immediately;
// the attached caret opens the remaining modes (and optionally Dismiss). Mirrors
// git/actions-split-button.tsx so the two read the same.
function SplitStartButton({
  primaryMode,
  secondaryModes,
  primaryLabel,
  accessibilityLabel,
  testIdBase,
  taskIds,
  actions,
  showDismiss,
}: SplitStartButtonProps): ReactElement {
  const { startTasks, dismissTasks } = actions;
  const handlePrimary = useCallback(() => {
    void startTasks(taskIds, primaryMode);
  }, [startTasks, taskIds, primaryMode]);
  const handleSelectMode = useCallback(
    (mode: TasksSuggestedStartMode) => {
      void startTasks(taskIds, mode);
    },
    [startTasks, taskIds],
  );
  const handleDismiss = useCallback(() => {
    dismissTasks(taskIds);
  }, [dismissTasks, taskIds]);

  return (
    <View style={styles.splitButton}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={`${testIdBase}-primary`}
        onPress={handlePrimary}
        style={primaryStyle}
        hitSlop={6}
      >
        {({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
          <>
            <ThemedPlay
              size={12}
              uniProps={hovered || pressed ? foregroundColorMapping : accentColorMapping}
            />
            <Text
              style={hovered || pressed ? styles.primaryTextActive : styles.primaryText}
              numberOfLines={1}
            >
              {primaryLabel}
            </Text>
          </>
        )}
      </Pressable>
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={`More start options: ${accessibilityLabel}`}
          testID={`${testIdBase}-caret`}
          style={caretStyle}
          hitSlop={6}
        >
          {({
            hovered,
            pressed,
            open,
          }: {
            hovered?: boolean;
            pressed?: boolean;
            open?: boolean;
          }) => (
            <ThemedChevronDown
              size={14}
              uniProps={
                hovered || pressed || open ? foregroundColorMapping : foregroundMutedColorMapping
              }
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={240} testID={`${testIdBase}-menu`}>
          {secondaryModes.map((mode) => (
            <StartMenuItem
              key={mode}
              mode={mode}
              testID={`${testIdBase}-${mode}`}
              onSelectMode={handleSelectMode}
            />
          ))}
          {showDismiss ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                leading={DISMISS_LEADING}
                destructive
                onSelect={handleDismiss}
                testID={`${testIdBase}-dismiss`}
              >
                Dismiss
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const DISMISS_LEADING = <ThemedTrash2 size={14} uniProps={destructiveColorMapping} />;

interface StartMenuItemProps {
  mode: TasksSuggestedStartMode;
  testID: string;
  onSelectMode: (mode: TasksSuggestedStartMode) => void;
}

function StartMenuItem({ mode, testID, onSelectMode }: StartMenuItemProps): ReactElement {
  const handleSelect = useCallback(() => {
    onSelectMode(mode);
  }, [onSelectMode, mode]);
  const meta = MODE_META[mode];
  return (
    <DropdownMenuItem
      leading={meta.leading}
      description={meta.description}
      onSelect={handleSelect}
      testID={testID}
    >
      {meta.menuLabel}
    </DropdownMenuItem>
  );
}

interface DismissButtonProps {
  taskIds: readonly string[];
  actions: SuggestedTaskActions;
  accessibilityLabel: string;
  tooltip: string;
  testID: string;
}

// The title-bar close: withdraws the whole visible queue (one task or all).
function DismissButton({
  taskIds,
  actions,
  accessibilityLabel,
  tooltip,
  testID,
}: DismissButtonProps): ReactElement {
  const { dismissTasks } = actions;
  const handleDismiss = useCallback(() => {
    dismissTasks(taskIds);
  }, [dismissTasks, taskIds]);
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          onPress={handleDismiss}
          style={styles.headerDismiss}
          hitSlop={8}
        >
          {({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
            <ThemedX
              size={16}
              uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function primaryStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return hovered || pressed ? styles.primaryActive : styles.primary;
}

function caretStyle({
  hovered,
  pressed,
  open,
}: {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
}) {
  return hovered || pressed || open ? styles.caretActive : styles.caret;
}

const styles = StyleSheet.create((theme) => ({
  overlayWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
  },
  card: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...theme.shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  headerLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  headerDismiss: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  listContent: {
    paddingVertical: theme.spacing[1],
  },
  task: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  taskText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  taskTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  taskTldr: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  splitButton: {
    flexDirection: "row",
    alignItems: "stretch",
    flexShrink: 0,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  primaryActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface3,
  },
  primaryText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  primaryTextActive: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  caret: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.borderAccent,
  },
  caretActive: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface3,
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));
