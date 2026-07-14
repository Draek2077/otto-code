import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder, Forum, GitBranch, Lightbulb, Play, X } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import type { Theme } from "@/styles/theme";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import type { SuggestedTaskRow } from "./select";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

const ThemedLightbulb = withUnistyles(Lightbulb);
const ThemedPlay = withUnistyles(Play);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedFolder = withUnistyles(Folder);
const ThemedForum = withUnistyles(Forum);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Stable leading elements — react-perf forbids inline JSX as a prop value.
const WORKTREE_LEADING = <ThemedGitBranch size={14} uniProps={foregroundMutedColorMapping} />;
const LOCAL_LEADING = <ThemedFolder size={14} uniProps={foregroundMutedColorMapping} />;
const IN_SESSION_LEADING = <ThemedForum size={14} uniProps={foregroundMutedColorMapping} />;

export interface SuggestedTasksTrackProps {
  rows: SuggestedTaskRow[];
  actions: SuggestedTaskActions;
}

export function SuggestedTasksTrack({
  rows,
  actions,
}: SuggestedTasksTrackProps): ReactElement | null {
  const allTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  if (rows.length === 0) {
    return null;
  }
  // Collective controls only make sense with a queue of 2+.
  const showBulk = rows.length >= 2;

  return (
    <View style={styles.outer} testID="suggested-tasks-track">
      <ChatWidthBounds style={styles.track}>
        <View style={styles.surface}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <ThemedLightbulb size={12} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.headerLabel} numberOfLines={1}>
                {rows.length === 1 ? "Suggested task" : `Suggested tasks (${rows.length})`}
              </Text>
            </View>
            {showBulk ? <BulkActions allTaskIds={allTaskIds} actions={actions} /> : null}
          </View>
          {rows.map((row) => (
            <SuggestedTaskChip key={row.taskId} row={row} actions={actions} />
          ))}
        </View>
      </ChatWidthBounds>
    </View>
  );
}

interface BulkActionsProps {
  allTaskIds: string[];
  actions: SuggestedTaskActions;
}

// "Answer collectively": apply one mode to every queued task (one agent/chat
// each). "This session" is intentionally omitted here — steering N tasks into
// the current chat can't give the "1 chat each" result and would clobber turns.
function BulkActions({ allTaskIds, actions }: BulkActionsProps): ReactElement {
  const { startTasks, dismissTasks } = actions;
  const handleStartAll = useCallback(
    (mode: TasksSuggestedStartMode) => {
      void startTasks(allTaskIds, mode);
    },
    [startTasks, allTaskIds],
  );
  const handleDismissAll = useCallback(() => {
    dismissTasks(allTaskIds);
  }, [dismissTasks, allTaskIds]);

  return (
    <View style={styles.bulkCluster}>
      <StartModeMenu
        triggerLabel="Start all"
        accessibilityLabel="Start all suggested tasks"
        testIdBase="suggested-tasks-track-start-all"
        includeInSession={false}
        onSelectMode={handleStartAll}
      />
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss all suggested tasks"
            testID="suggested-tasks-track-dismiss-all"
            onPress={handleDismissAll}
            style={styles.dismissAllButton}
            hitSlop={8}
          >
            <Text style={styles.dismissAllText}>Dismiss all</Text>
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>Withdraw the whole queue</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

interface SuggestedTaskChipProps {
  row: SuggestedTaskRow;
  actions: SuggestedTaskActions;
}

function SuggestedTaskChip({ row, actions }: SuggestedTaskChipProps): ReactElement {
  const { startTasks, dismissTasks } = actions;
  const handleStart = useCallback(
    (mode: TasksSuggestedStartMode) => {
      void startTasks([row.taskId], mode);
    },
    [startTasks, row.taskId],
  );
  const handleDismiss = useCallback(() => {
    dismissTasks([row.taskId]);
  }, [dismissTasks, row.taskId]);

  return (
    <View style={styles.row} testID={`suggested-tasks-track-row-${row.taskId}`}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {row.title}
          </Text>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" offset={8}>
          <Text style={styles.tooltipText}>{row.tldr}</Text>
        </TooltipContent>
      </Tooltip>

      <StartModeMenu
        triggerLabel="Start"
        accessibilityLabel={`Start suggested task: ${row.title}`}
        testIdBase={`suggested-tasks-track-start-${row.taskId}`}
        includeInSession
        onSelectMode={handleStart}
      />

      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss suggested task: ${row.title}`}
            testID={`suggested-tasks-track-dismiss-${row.taskId}`}
            onPress={handleDismiss}
            style={styles.dismissButton}
            hitSlop={8}
          >
            {({ hovered, pressed }) => (
              <ThemedX
                size={14}
                uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>Dismiss</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

interface StartModeMenuProps {
  triggerLabel: string;
  accessibilityLabel: string;
  testIdBase: string;
  includeInSession: boolean;
  onSelectMode: (mode: TasksSuggestedStartMode) => void;
}

function StartModeMenu({
  triggerLabel,
  accessibilityLabel,
  testIdBase,
  includeInSession,
  onSelectMode,
}: StartModeMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel={accessibilityLabel}
        testID={`${testIdBase}-trigger`}
        style={startTriggerStyle}
        hitSlop={8}
      >
        {({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
          <>
            <ThemedPlay
              size={12}
              uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
            />
            <Text style={hovered || pressed ? styles.startTextActive : styles.startText}>
              {triggerLabel}
            </Text>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={240}>
        <StartMenuItem
          mode="worktree"
          label="New worktree"
          description="New workspace on a git worktree"
          leading={WORKTREE_LEADING}
          testID={`${testIdBase}-worktree`}
          onSelectMode={onSelectMode}
        />
        <StartMenuItem
          mode="local"
          label="Local"
          description="New chat in the same project, no worktree"
          leading={LOCAL_LEADING}
          testID={`${testIdBase}-local`}
          onSelectMode={onSelectMode}
        />
        {includeInSession ? (
          <StartMenuItem
            mode="in_session"
            label="This session"
            description="Send the task to this agent"
            leading={IN_SESSION_LEADING}
            testID={`${testIdBase}-in-session`}
            onSelectMode={onSelectMode}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface StartMenuItemProps {
  mode: TasksSuggestedStartMode;
  label: string;
  description: string;
  leading: ReactElement;
  testID: string;
  onSelectMode: (mode: TasksSuggestedStartMode) => void;
}

function StartMenuItem({
  mode,
  label,
  description,
  leading,
  testID,
  onSelectMode,
}: StartMenuItemProps): ReactElement {
  const handleSelect = useCallback(() => {
    onSelectMode(mode);
  }, [onSelectMode, mode]);
  return (
    <DropdownMenuItem
      leading={leading}
      description={description}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    marginBottom: -theme.spacing[4],
  },
  surface: {
    alignSelf: "stretch",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    paddingBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
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
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  bulkCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  dismissAllButton: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  dismissAllText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  startTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  startTriggerActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  startText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  startTextActive: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  dismissButton: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));

function startTriggerStyle({
  hovered,
  pressed,
}: {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
}) {
  return hovered || pressed ? styles.startTriggerActive : styles.startTrigger;
}
