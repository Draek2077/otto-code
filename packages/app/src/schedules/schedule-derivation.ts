import type { ScheduleSummary } from "@otto-code/protocol/schedule/types";
import { describeScheduleCwd } from "@/schedules/schedule-project-targets";

// "active"/"paused"/"failed" mirror stored schedule state; the rest are
// computed truths the daemon does not spell out in a single field.
export type ScheduleDerivedState =
  | "active"
  | "paused"
  | "failed"
  | "expired"
  | "finished"
  | "targetGone";

export type ScheduleBucket = "runnable" | "failed" | "ended";

export interface ScheduleTargetAgent {
  title: string | null;
  provider: string | null;
  cwd: string | null;
}

export interface ScheduleTargetResolution {
  /** The target line: agent title, project name, or the shortened cwd. */
  label: string;
  /** Provider glyph for the row, when known. */
  provider: string | null;
}

export interface ResolvedSchedule {
  state: ScheduleDerivedState;
  bucket: ScheduleBucket;
  target: ScheduleTargetResolution;
  /** The schedule's effective project root, when known — used for project filtering. */
  cwd: string | null;
}

export interface ResolveScheduleInput {
  schedule: ScheduleSummary;
  serverId: string;
  now: number;
  /** Client agent directory keyed by `${serverId}:${agentId}`. */
  agentsByKey: ReadonlyMap<string, ScheduleTargetAgent>;
  /** Known project roots keyed by `${serverId}:${cwd}`. */
  projectNameByCwd: ReadonlyMap<string, string>;
  /**
   * Whether the agent directory has finished its first load. While false we do
   * not claim an agent target is gone — absence would just be a cold cache.
   */
  agentDataLoaded: boolean;
}

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

function isExpired(schedule: ScheduleSummary, now: number): boolean {
  if (!schedule.expiresAt) {
    return false;
  }
  const expiresAt = Date.parse(schedule.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function isAgentTargetGone(input: ResolveScheduleInput): boolean {
  const { schedule, serverId, agentsByKey, agentDataLoaded } = input;
  if (schedule.target.type !== "agent" || !agentDataLoaded) {
    return false;
  }
  return !agentsByKey.has(agentKey(serverId, schedule.target.agentId));
}

function resolveTarget(input: ResolveScheduleInput): ScheduleTargetResolution {
  const { schedule, serverId, agentsByKey, projectNameByCwd } = input;
  if (schedule.target.type === "agent") {
    const agent = agentsByKey.get(agentKey(serverId, schedule.target.agentId));
    if (agent) {
      return { label: agent.title?.trim() || "Untitled agent", provider: agent.provider };
    }
    return { label: "Agent unavailable", provider: null };
  }
  return {
    label: describeScheduleCwd({ serverId, cwd: schedule.target.config.cwd, projectNameByCwd }),
    provider: schedule.target.config.provider,
  };
}

/** The schedule's effective project root: the target agent's cwd for
 * agent-targeted schedules, or the stored cwd for new-agent schedules. */
function resolveCwd(input: ResolveScheduleInput): string | null {
  const { schedule, serverId, agentsByKey } = input;
  if (schedule.target.type === "agent") {
    return agentsByKey.get(agentKey(serverId, schedule.target.agentId))?.cwd ?? null;
  }
  return schedule.target.config.cwd;
}

// One badge, one truth. Order matters: expiry and a missing target are more
// informative than the raw "completed"/"paused" status, so they win. A failed
// last run outranks "paused"/"active" too — it's actionable regardless of
// whether the schedule is currently running or paused.
function deriveState(input: ResolveScheduleInput): ScheduleDerivedState {
  const { schedule, now } = input;
  if (isExpired(schedule, now)) {
    return "expired";
  }
  if (isAgentTargetGone(input)) {
    return "targetGone";
  }
  if (schedule.status === "completed") {
    return "finished";
  }
  if (schedule.lastRunStatus === "failed") {
    return "failed";
  }
  if (schedule.status === "paused") {
    return "paused";
  }
  return "active";
}

export function scheduleBucket(state: ScheduleDerivedState): ScheduleBucket {
  if (state === "failed") {
    return "failed";
  }
  return state === "active" || state === "paused" ? "runnable" : "ended";
}

export function resolveSchedule(input: ResolveScheduleInput): ResolvedSchedule {
  const state = deriveState(input);
  return {
    state,
    bucket: scheduleBucket(state),
    target: resolveTarget(input),
    cwd: resolveCwd(input),
  };
}
