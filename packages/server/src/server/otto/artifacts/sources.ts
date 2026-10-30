import type { z } from "zod";
import type { ArtifactSource } from "@getpaseo/plugin/otto/artifacts";
import type { StoredSchedule } from "@getpaseo/protocol/schedule/types";
import { ScheduleNotFoundError } from "../../schedule/service.js";

export interface ArtifactCaller {
  workspaceId: string | null;
  agentId?: string;
  provider?: string;
  labels?: Readonly<Record<string, string>>;
}
export interface ArtifactSchedulePort {
  inspect(id: string): Promise<StoredSchedule>;
}
export async function readArtifactSchedule(schedules: ArtifactSchedulePort, id: string) {
  // Metadata and chat labels are editable. They may identify a Schedule, never a host path.
  if (!/^[a-zA-Z0-9_-]{1,512}$/.test(id)) return null;
  try {
    return await schedules.inspect(id);
  } catch (error) {
    if (error instanceof ScheduleNotFoundError) return null;
    throw error;
  }
}

/** Labels locate a candidate; only the scheduler's durable active run grants provenance.
 * Never retag a reused chat from old labels or reconstruct execution identity from a prompt.
 */
export async function artifactCallerSource(
  caller: ArtifactCaller,
  schedules?: ArtifactSchedulePort,
): Promise<z.infer<typeof ArtifactSource> | undefined> {
  if (!caller.agentId) return undefined;
  const chat = { kind: "chat" as const, agentId: caller.agentId };
  const scheduleId = caller.labels?.["paseo.schedule-id"];
  const runId = caller.labels?.["paseo.schedule-run"];
  if (!schedules || !scheduleId || !runId || !caller.workspaceId) return chat;
  const schedule = await readArtifactSchedule(schedules, scheduleId);
  if (!schedule) return chat;
  const run = schedule.runs.find((item) => item.id === runId);
  if (
    schedule.id !== scheduleId ||
    schedule.target.type !== "new-agent" ||
    run?.status !== "running" ||
    run.agentId !== caller.agentId ||
    run.workspaceId !== caller.workspaceId
  )
    return chat;
  return { kind: "schedule", scheduleId, runId };
}
