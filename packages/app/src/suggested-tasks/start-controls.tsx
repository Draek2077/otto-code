import { useCallback, type ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  CornerDownLeft,
  GitBranch,
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
} from "@/components/ui/dropdown-menu";
import {
  SplitButton,
  SplitButtonMenuTrigger,
  SplitButtonPrimary,
} from "@/components/ui/split-button";
import type { Theme } from "@/styles/theme";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";
import type { SuggestedTaskActions } from "./use-suggested-task-actions";

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
// mirror the daemon's four start modes - only `subagent` links to this chat.
interface ModeMeta {
  primaryLabel: string;
  menuLabel: string;
  description: string;
  leading: ReactElement;
}

export const MODE_META: Record<TasksSuggestedStartMode, ModeMeta> = {
  new_chat: {
    primaryLabel: "New chat",
    menuLabel: "New chat",
    description: "Separate chat in its own tab, no link",
    leading: <ThemedMessageSquarePlus size="sm" uniProps={foregroundMutedColorMapping} />,
  },
  subagent: {
    primaryLabel: "Sub-agent",
    menuLabel: "Sub-agent",
    description: "Linked child of this chat",
    leading: <ThemedSchema size="sm" uniProps={foregroundMutedColorMapping} />,
  },
  worktree: {
    primaryLabel: "Worktree",
    menuLabel: "New worktree",
    description: "Isolated worktree on a new branch",
    leading: <ThemedGitBranch size="sm" uniProps={foregroundMutedColorMapping} />,
  },
  in_session: {
    primaryLabel: "This session",
    menuLabel: "This session",
    description: "Send the task to this agent",
    leading: <ThemedCornerDownLeft size="sm" uniProps={foregroundMutedColorMapping} />,
  },
};

// Every mode is a valid per-task action; bulk "Start all" excludes in_session
// (steering N tasks into one chat can't give "one chat each").
export const ALL_MODES: readonly TasksSuggestedStartMode[] = [
  "new_chat",
  "subagent",
  "worktree",
  "in_session",
];
export const BULK_MODES: readonly TasksSuggestedStartMode[] = ["new_chat", "subagent", "worktree"];

export interface SplitStartButtonProps {
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

/**
 * A split button: the primary half runs the caller's default mode immediately;
 * the attached caret opens the remaining modes (and optionally Dismiss). Mirrors
 * git/actions-split-button.tsx so the two read the same. Shared by the roomy
 * overlay and the collapsed compact card so both offer exactly the same actions.
 */
export function SplitStartButton({
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
    <SplitButton filled style={styles.splitButton}>
      <SplitButtonPrimary
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
              size="xs"
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
      </SplitButtonPrimary>
      <DropdownMenu>
        <SplitButtonMenuTrigger
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
              size="sm"
              uniProps={
                hovered || pressed || open ? foregroundColorMapping : foregroundMutedColorMapping
              }
            />
          )}
        </SplitButtonMenuTrigger>
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
    </SplitButton>
  );
}

const DISMISS_LEADING = <ThemedTrash2 size="sm" uniProps={destructiveColorMapping} />;

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

export interface DismissButtonProps {
  taskIds: readonly string[];
  actions: SuggestedTaskActions;
  accessibilityLabel: string;
  tooltip: string;
  testID: string;
}

// The title-bar close: withdraws the whole visible queue (one task or all).
export function DismissButton({
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
              size="md"
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
  splitButton: {
    flexShrink: 0,
    // Opaque, deliberately un-tinted: the button has to separate from the
    // washed row behind it, and a wash on a wash would erase it. Its accent
    // chrome is what makes it read as the action inside a blue card. The
    // surface2 fill + radius come from <SplitButton filled> so the fill's
    // corners track the segments' border arc (see filledFrame there).
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
  },
  caretActive: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.surface3,
  },
  headerDismiss: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));
