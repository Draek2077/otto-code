import { useCallback, useState, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScheduleCard, type ScheduleCardPending } from "@/components/schedules/schedule-card";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import type { AggregatedSchedule } from "@/hooks/use-schedules";
import type { ScheduleDerivedState } from "@/schedules/schedule-derivation";
import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveScheduleTitle } from "@/utils/schedule-format";

/** A schedule plus the client-derived fields the card renders. */
export interface ScheduleRowView {
  schedule: AggregatedSchedule;
  targetLabel: string;
  provider: string | null;
  projectName: string | null;
  state: ScheduleDerivedState;
  serverName: string;
  /** True when only one host exists, so the host name is redundant in cards. */
  singleHost: boolean;
}

interface ScheduleGridProps {
  rows: ScheduleRowView[];
  /**
   * The form sheet is owned by the screen (it serves both create and edit and
   * shares the screen's "New schedule" button), so the grid delegates edit
   * upward rather than mounting a second sheet here.
   */
  onEditSchedule: (schedule: AggregatedSchedule) => void;
}

/**
 * The schedules grid: cards across every connected host, wrapping 1-2 columns
 * wide (Schedules cards read wider/landscape vs. Artifacts' narrower cards —
 * see artifact-grid.tsx for the 2-3 column counterpart). Cards own their
 * host-scoped mutations (pause/resume/run/delete via the mutations hook + a
 * destructive confirm) and delegate editing upward.
 */
export function ScheduleGrid({ rows, onEditSchedule }: ScheduleGridProps): ReactElement {
  return (
    <View style={styles.grid} testID="schedules-grid">
      {rows.map((row) => (
        <View key={`${row.schedule.serverId}:${row.schedule.id}`} style={styles.cell}>
          <ScheduleGridCard row={row} onEditSchedule={onEditSchedule} />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-card wrapper owns local in-flight state and binds mutations to this
// schedule's host. Local state keeps pending precise to the acting card even
// when several cards are acted on at once (the mutations hook exposes only a
// single global pending flag per action).
// ---------------------------------------------------------------------------

const NO_PENDING: ScheduleCardPending = {};

function ScheduleGridCard({
  row,
  onEditSchedule,
}: {
  row: ScheduleRowView;
  onEditSchedule: (schedule: AggregatedSchedule) => void;
}): ReactElement {
  const { schedule } = row;
  const { id, serverId } = schedule;
  const mutations = useScheduleMutations({ serverId });
  const [pending, setPending] = useState<ScheduleCardPending>(NO_PENDING);

  const runAction = useCallback(
    async (key: keyof ScheduleCardPending, action: () => Promise<void>): Promise<void> => {
      setPending((current) => ({ ...current, [key]: true }));
      try {
        await action();
      } catch {
        // Mutations roll back their own optimistic cache writes on error and
        // re-fetch on settle; surfacing per-card toasts here is out of scope.
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [],
  );

  const handleEdit = useCallback(() => {
    onEditSchedule(schedule);
  }, [onEditSchedule, schedule]);

  const handlePause = useCallback(() => {
    void runAction("pause", () => mutations.pauseSchedule(id));
  }, [runAction, mutations, id]);

  const handleResume = useCallback(() => {
    void runAction("resume", () => mutations.resumeSchedule(id));
  }, [runAction, mutations, id]);

  const handleRunNow = useCallback(() => {
    void runAction("runNow", () => mutations.runScheduleNow(id));
  }, [runAction, mutations, id]);

  const handleDelete = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: "Delete schedule",
        message: `Delete "${resolveScheduleTitle(schedule)}"? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      await runAction("delete", () => mutations.deleteSchedule(id));
    })();
  }, [runAction, mutations, id, schedule]);

  return (
    <ScheduleCard
      schedule={schedule}
      serverId={serverId}
      targetLabel={row.targetLabel}
      provider={row.provider}
      projectName={row.projectName}
      state={row.state}
      serverName={row.serverName}
      singleHost={row.singleHost}
      pending={pending}
      onEdit={handleEdit}
      onPause={handlePause}
      onResume={handleResume}
      onRunNow={handleRunNow}
      onDelete={handleDelete}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  // 1 col until there's real room -> 2 cols (lg, 992px+). Pushed a tier higher
  // than the raw breakpoint name suggests, and stops at 2 columns since these
  // cards are wider/landscape versus Artifacts' narrower cards (artifact-grid.tsx).
  cell: {
    flexGrow: 1,
    flexBasis: { xs: "100%", lg: "48%" },
    maxWidth: { xs: "100%", lg: "50%" },
  },
}));
