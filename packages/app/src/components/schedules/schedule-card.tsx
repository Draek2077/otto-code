import {
  CalendarClock,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  RotateCw,
  TriangleAlert,
  Trash2,
} from "@/components/icons/material-icons";
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExecutorRow, ProjectNameLine } from "@/components/project-row";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import type { ScheduleDerivedState } from "@/schedules/schedule-derivation";
import { formatCadence, formatNextRun, resolveScheduleTitle } from "@/utils/schedule-format";
import { formatTimeAgo } from "@/utils/time";
import type { ScheduleSummary } from "@otto-code/protocol/schedule/types";

// Themed lucide wrappers — module-scope so only the icon re-renders on theme
// change (never call useUnistyles in render). See docs/unistyles.md.
const ThemedPencil = withUnistyles(Pencil);
const ThemedPause = withUnistyles(Pause);
const ThemedPlay = withUnistyles(Play);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedKebab = withUnistyles(MoreVertical);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const MENU_ICON_SIZE = 14;
const HEADER_ICON_SIZE = 16;
// Matches ArtifactCard's star/kebab trigger size so the two grids' header
// rows align pixel-for-pixel.
const KEBAB_TRIGGER_ICON_SIZE = 18;

// Pending flags for each action so the parent grid can wire a mutation hook
// and the card reflects in-flight state without owning the mutation itself.
export interface ScheduleCardPending {
  pause?: boolean;
  resume?: boolean;
  runNow?: boolean;
  delete?: boolean;
}

export interface ScheduleCardActions {
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}

interface ScheduleCardProps extends ScheduleCardActions {
  schedule: ScheduleSummary;
  /** Host the schedule lives on — used to resolve the provider's display label. */
  serverId: string;
  /** Client-derived target line (agent title / project / shortened path). */
  targetLabel: string;
  /** Provider glyph, resolved from the schedule config or the target agent. */
  provider: string | null;
  /** Resolved project name for the schedule's target, when known. */
  projectName: string | null;
  /** Client-derived state — the single source for the badge and next-run copy. */
  state: ScheduleDerivedState;
  /** Host name, rendered when the list spans more than one host. */
  serverName?: string;
  /** True when only one host exists and the host name would be redundant. */
  singleHost?: boolean;
  pending?: ScheduleCardPending;
}

function stateBadge(state: ScheduleDerivedState): {
  label: string;
  variant: "success" | "warning" | "error";
} {
  switch (state) {
    case "active":
      return { label: "Active", variant: "success" };
    case "finished":
      return { label: "Finished", variant: "success" };
    case "paused":
      return { label: "Paused", variant: "warning" };
    case "expired":
      return { label: "Expired", variant: "warning" };
    case "failed":
      return { label: "Failed", variant: "error" };
    case "targetGone":
      return { label: "Target gone", variant: "error" };
  }
}

// Meta reads left-to-right as identity → history → future: how often, when it
// was created, when it last ran, and (only while it can still run) when it runs
// next. Status lives on the badge, never repeated here.
function buildMeta(
  schedule: ScheduleSummary,
  state: ScheduleDerivedState,
  serverName: string | undefined,
  singleHost: boolean,
): string {
  const parts = [
    formatCadence(schedule.cadence),
    `Created ${formatTimeAgo(new Date(schedule.createdAt))}`,
    schedule.lastRunAt ? `Last run ${formatTimeAgo(new Date(schedule.lastRunAt))}` : "Never run",
  ];
  if (state === "active" || state === "failed") {
    const next = formatNextRun(schedule.nextRunAt);
    if (next) {
      parts.push(`Next run ${next}`);
    }
  }
  if (serverName && !singleHost) {
    parts.unshift(serverName);
  }
  return parts.join(" · ");
}

/** Left slot of the footer row: always the state pill, so every card across
 * Artifacts/Schedules/Orchestrations reads the same way at a glance. */
function ScheduleStatusIndicator({ state }: { state: ScheduleDerivedState }): ReactElement {
  const badge = stateBadge(state);
  return <StatusBadge label={badge.label} variant={badge.variant} />;
}

/** Failure detail, shown above the footer instead of replacing the pill. */
function ScheduleFailureBanner({
  errorMessage,
}: {
  errorMessage: string | null | undefined;
}): ReactElement {
  return (
    <View style={styles.statusRow}>
      <TriangleAlert size={14} color={styles.errorText.color} />
      <Text style={styles.errorText} numberOfLines={2}>
        {errorMessage ?? "Last run failed"}
      </Text>
    </View>
  );
}

/**
 * One schedule, rendered as a card matching ArtifactCard's shape: provider
 * glyph + title + kebab in the header, the target line as the details row, a
 * spacer, and a footer of status indicator + meta text.
 *
 * Hover lives on the outer plain View (docs/hover.md): the inner Pressable owns
 * press, the nested kebab Pressable never fights it, and the card background
 * highlights without reflow.
 */
export function ScheduleCard({
  schedule,
  serverId,
  targetLabel,
  provider,
  projectName,
  state,
  serverName,
  singleHost,
  pending,
  onEdit,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: ScheduleCardProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const title = resolveScheduleTitle(schedule);
  const meta = buildMeta(schedule, state, serverName, singleHost ?? false);
  const canRun = state === "active" || state === "paused" || state === "failed";
  const isErrorCard = state === "failed" || state === "targetGone";

  // The last-run executor. Prefer the recorded last run (who actually ran it);
  // before the first run, fall back to the configured provider/model so the
  // line isn't empty. Personality only shows once a run has recorded one.
  const executorProvider = schedule.lastRunProvider ?? provider;
  const executorModel =
    schedule.lastRunModel ??
    (schedule.target.type === "new-agent" ? (schedule.target.config.model ?? null) : null);
  const executorPersonality = schedule.lastRunPersonalityName ?? null;

  const cardStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.card,
      isErrorCard && styles.cardError,
      isHovered && !isCompact && styles.cardHovered,
      pressed && styles.cardPressed,
    ],
    [isErrorCard, isHovered, isCompact],
  );

  return (
    <View
      style={styles.container}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={cardStyle}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit schedule ${title}`}
        testID={`schedule-card-${schedule.id}`}
      >
        <View style={styles.headerRow}>
          <CalendarClock size={HEADER_ICON_SIZE} color={styles.icon.color} />
          <Text style={styles.name} numberOfLines={1}>
            {title}
          </Text>
          <ScheduleKebabMenu
            schedule={schedule}
            canRun={canRun}
            pending={pending}
            onEdit={onEdit}
            onPause={onPause}
            onResume={onResume}
            onRunNow={onRunNow}
            onDelete={onDelete}
          />
        </View>

        <ExecutorRow
          serverId={serverId}
          personalityName={executorPersonality}
          provider={executorProvider}
          model={executorModel}
        />
        <ProjectNameLine projectName={projectName} />

        {/* For "new agent" schedules the target line is just the project name
            again (see resolveTarget in schedule-derivation.ts) — skip it so it
            doesn't repeat the ProjectNameLine above. Agent-targeted schedules
            show the agent's title here, which is distinct info. */}
        {targetLabel !== projectName ? (
          <Text style={styles.target} numberOfLines={2}>
            {targetLabel}
          </Text>
        ) : null}

        {state === "failed" ? <ScheduleFailureBanner errorMessage={schedule.lastRunError} /> : null}

        {/* Spacer pins the footer to the bottom of the card regardless of how
            much detail sits above it, so cards in a row align. */}
        <View style={styles.spacer} />

        <View style={styles.footerRow}>
          <ScheduleStatusIndicator state={state} />
          <View style={styles.footerMeta}>
            <Text style={styles.metaText} numberOfLines={1}>
              {meta}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const editLeading = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const pauseLeading = <ThemedPause size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const resumeLeading = <ThemedPlay size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const runLeading = <ThemedRotateCw size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const deleteLeading = <ThemedTrash2 size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedKebab
      size={KEBAB_TRIGGER_ICON_SIZE}
      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
    />
  );
}

// Inner controls (kebab) sit inside the card's Pressable. Stopping the press-in
// here keeps a tap on them from also firing the card's edit action.
function stopPressInPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

function ScheduleKebabMenu({
  schedule,
  canRun,
  pending,
  onEdit,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: Pick<
  ScheduleCardProps,
  "schedule" | "pending" | "onEdit" | "onPause" | "onResume" | "onRunNow" | "onDelete"
> & {
  canRun: boolean;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        onPressIn={stopPressInPropagation}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel="Schedule actions"
        testID={`schedule-kebab-${schedule.id}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          leading={editLeading}
          onSelect={onEdit}
          testID={`schedule-menu-edit-${schedule.id}`}
        >
          Edit schedule
        </DropdownMenuItem>
        {schedule.status === "paused" ? (
          <DropdownMenuItem
            leading={resumeLeading}
            disabled={!canRun}
            status={pending?.resume ? "pending" : "idle"}
            pendingLabel="Resuming..."
            onSelect={onResume}
            testID={`schedule-menu-resume-${schedule.id}`}
          >
            Resume schedule
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            leading={pauseLeading}
            disabled={schedule.status === "completed" || !canRun}
            status={pending?.pause ? "pending" : "idle"}
            pendingLabel="Pausing..."
            onSelect={onPause}
            testID={`schedule-menu-pause-${schedule.id}`}
          >
            Pause schedule
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          leading={runLeading}
          disabled={!canRun}
          status={pending?.runNow ? "pending" : "idle"}
          pendingLabel="Starting..."
          onSelect={onRunNow}
          testID={`schedule-menu-run-${schedule.id}`}
        >
          Run now
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={deleteLeading}
          destructive
          status={pending?.delete ? "pending" : "idle"}
          pendingLabel="Deleting..."
          onSelect={onDelete}
          testID={`schedule-menu-delete-${schedule.id}`}
        >
          Delete schedule
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The hovered card is already surface2, so the kebab's own hover/press states
// step up to surface3/surface4 — anything lower is invisible against the card.
function kebabTriggerStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.kebabTrigger,
    hovered && styles.kebabTriggerHovered,
    pressed && styles.kebabTriggerPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  icon: {
    color: theme.colors.foregroundMuted,
  },
  container: {
    position: "relative",
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    minHeight: 132,
  },
  cardError: {
    borderColor: theme.colors.palette.red[500],
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  target: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  spacer: {
    flex: 1,
    minHeight: theme.spacing[2],
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  footerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  errorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  kebabTriggerPressed: {
    backgroundColor: theme.colors.surface4,
  },
}));
