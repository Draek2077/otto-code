import { useMemo, useState, useCallback } from "react";
import { View, Text } from "react-native";
import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import { useSchedules, type AggregatedSchedule } from "@/hooks/use-schedules";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { resolveSchedule } from "@/schedules/schedule-derivation";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
} from "@/schedules/schedule-project-targets";
import { SchedulesTable } from "@/components/schedules/schedules-table";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { styles } from "./styles";

/** Original native controls for old hosts. No extended target emulation. */
export function LegacyScheduleList({
  serverIds,
  selectedHost,
}: {
  serverIds: readonly string[];
  selectedHost: string | null;
}) {
  const input = useMemo(() => ({ serverIds }), [serverIds]);
  const query = useSchedules(input),
    { agents } = useAggregatedAgents({ includeArchived: true }),
    { projects } = useProjects();
  const [form, setForm] = useState<{ serverId: string; schedule?: ScheduleSummary } | null>(null);
  const create = useCallback(() => {
    if (selectedHost) setForm({ serverId: selectedHost });
  }, [selectedHost]);
  const edit = useCallback(
    (schedule: AggregatedSchedule) => setForm({ serverId: schedule.serverId, schedule }),
    [],
  );
  const close = useCallback(() => setForm(null), []);
  const rows = useMemo(() => {
    if (query.loadState.status !== "loaded") return [];
    const agentsByKey = new Map(
      agents.map((row) => [
        `${row.serverId}:${row.id}`,
        { title: row.title, provider: row.provider },
      ]),
    );
    const projectNameByCwd = buildProjectNameByCwd(buildScheduleProjectTargets(projects));
    return query.loadState.data.map((schedule) => {
      const resolved = resolveSchedule({
        schedule,
        serverId: schedule.serverId,
        now: Date.now(),
        agentsByKey,
        projectNameByCwd,
        agentDataLoaded:
          getHostRuntimeStore().getSnapshot(schedule.serverId)?.hasEverLoadedAgentDirectory ===
          true,
      });
      return {
        schedule,
        targetLabel: resolved.target.label,
        provider: resolved.target.provider,
        state: resolved.state,
        serverName: schedule.serverName,
        singleHost: serverIds.length === 1,
      };
    });
  }, [query.loadState, agents, projects, serverIds.length]);
  return (
    <View style={styles.contentGap}>
      {selectedHost ? (
        <>
          <Alert description="Update this host to schedule saved Workflows and Artifact updates. Existing agent scheduling remains available." />
          <Button onPress={create}>New agent schedule</Button>
        </>
      ) : null}
      {query.loadState.status !== "loaded" ? (
        <Text style={styles.muted}>Loading agent schedules...</Text>
      ) : (
        <SchedulesTable rows={rows} onEditSchedule={edit} />
      )}
      {query.hostErrors.map((error) => (
        <Alert
          key={error.serverId}
          variant="error"
          description={`Agent schedules are unavailable on ${error.serverName}. Reconnect and refresh.`}
        />
      ))}
      <ScheduleFormSheet
        key={form?.schedule?.id ?? "legacy-create"}
        serverId={form?.serverId}
        visible={!!form}
        onClose={close}
        mode={form?.schedule ? "edit" : "create"}
        schedule={form?.schedule}
      />
    </View>
  );
}
