import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentSessionConfig, ProviderSnapshotEntry } from "../agent/agent-sdk-types.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import {
  resolvePersonality,
  type ResolvedPersonalitySnapshot,
} from "../agent/agent-personalities.js";
import {
  composeTeamAndPersonalityPrompt,
  resolveTeamSchedulerSnapshot,
  resolveTeamSnapshotForPersonality,
  type ResolvedTeamSnapshot,
} from "../agent/agent-teams.js";
import {
  TEAM_SCHEDULER_PERSONALITY_SENTINEL,
  type AgentTeamsConfigView,
} from "@otto-code/protocol/agent-teams";
import { curateAgentActivity } from "../agent/activity-curator.js";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import { formatSystemNotificationPrompt } from "../agent/agent-prompt.js";
import { resolveCreateAgentTitles } from "../agent/create-agent-title.js";
import { type BoundCreateAgentCommand, formatProviderModel } from "../agent/create-agent/create.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type { CreateOttoWorktreeWorkflowResult } from "../worktree-session.js";
import { ScheduleStore } from "./store.js";
import { computeNextRunAt, validateScheduleCadence } from "./cron.js";
import type {
  CreateScheduleInput,
  ScheduleExecutionResult,
  ScheduleRun,
  ScheduleTarget,
  StoredSchedule,
  UpdateScheduleInput,
  UpdateScheduleNewAgentConfig,
} from "@otto-code/protocol/schedule/types";
import type { AgentPersonality, FirstAgentContext } from "@otto-code/protocol/messages";

const SCHEDULE_TICK_INTERVAL_MS = 1000;

// A run failed because its target no longer exists: the agent was deleted or
// archived, or a new-agent cwd was removed. These are permanent, so the schedule
// is completed instead of retried until it burns down to its expiry.
export class ScheduleTargetGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleTargetGoneError";
  }
}

function trimOptionalName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildScheduleFireBody(schedule: StoredSchedule, runId: string): string {
  const heading = schedule.name
    ? `Schedule "${schedule.name}" fired (id=${schedule.id}, run=${runId}).`
    : `Schedule fired (id=${schedule.id}, run=${runId}).`;
  return `${heading}\n${schedule.prompt}`;
}

function normalizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Schedule prompt is required");
  }
  return trimmed;
}

function applyNewAgentConfig(
  target: Extract<ScheduleTarget, { type: "new-agent" }>,
  patch: UpdateScheduleNewAgentConfig,
): Extract<ScheduleTarget, { type: "new-agent" }> {
  const config = { ...target.config };
  if (patch.provider !== undefined) {
    const trimmed = patch.provider.trim();
    if (!trimmed) {
      throw new Error("provider cannot be empty");
    }
    config.provider = trimmed;
  }
  if (patch.cwd !== undefined) {
    const trimmed = patch.cwd.trim();
    if (!trimmed) {
      throw new Error("cwd cannot be empty");
    }
    config.cwd = trimmed;
  }
  if (patch.personality !== undefined) {
    const trimmed = patch.personality?.trim();
    if (trimmed) {
      config.personality = trimmed;
    } else {
      delete config.personality;
    }
  }
  if (patch.model !== undefined) {
    const trimmed = patch.model?.trim();
    if (trimmed) {
      config.model = trimmed;
    } else {
      delete config.model;
    }
  }
  if (patch.modeId !== undefined) {
    const trimmed = patch.modeId?.trim();
    if (trimmed) {
      config.modeId = trimmed;
    } else {
      delete config.modeId;
    }
  }
  if (patch.thinkingOptionId !== undefined) {
    const trimmed = patch.thinkingOptionId?.trim();
    if (trimmed) {
      config.thinkingOptionId = trimmed;
    } else {
      delete config.thinkingOptionId;
    }
  }
  if (patch.archiveOnFinish !== undefined) {
    config.archiveOnFinish = patch.archiveOnFinish;
  }
  if (patch.isolation !== undefined) {
    config.isolation = patch.isolation;
  }
  return { ...target, config };
}

function normalizeMaxRuns(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxRuns must be a positive integer");
  }
  return value;
}

function countCompletedRuns(schedule: StoredSchedule): number {
  return schedule.runs.filter((run) => run.status !== "running").length;
}

function shouldArchiveScheduleRunWorkspace(input: {
  agentId: string | null;
  archiveOnFinish?: boolean;
}): boolean {
  return input.agentId === null || (input.archiveOnFinish ?? true);
}

function shouldCompleteSchedule(schedule: StoredSchedule, now: Date): boolean {
  if (schedule.expiresAt && new Date(schedule.expiresAt).getTime() <= now.getTime()) {
    return true;
  }
  if (schedule.maxRuns == null) {
    return false;
  }
  return countCompletedRuns(schedule) >= schedule.maxRuns;
}

function requireSchedule(schedule: StoredSchedule | null, id: string): StoredSchedule {
  if (!schedule) {
    throw new Error(`Schedule not found: ${id}`);
  }
  return schedule;
}

function completeSchedule(schedule: StoredSchedule, now: Date): StoredSchedule {
  return {
    ...schedule,
    status: "completed",
    nextRunAt: null,
    pausedAt: null,
    updatedAt: now.toISOString(),
  };
}

function mergeScheduleCadenceTimezone(
  current: StoredSchedule["cadence"],
  next: StoredSchedule["cadence"],
): StoredSchedule["cadence"] {
  if (
    current.type === "cron" &&
    next.type === "cron" &&
    next.timezone === undefined &&
    current.timezone !== undefined
  ) {
    return {
      ...next,
      timezone: current.timezone,
    };
  }
  return next;
}

function buildRunOutput(params: {
  output: string | null;
  timelineText: string;
  finalText: string;
}): string | null {
  if (params.output && params.output.trim().length > 0) {
    return params.output;
  }
  if (params.finalText.trim().length > 0) {
    return params.finalText.trim();
  }
  if (params.timelineText.trim().length > 0) {
    return params.timelineText.trim();
  }
  return null;
}

type ScheduleAgentManager = Pick<
  AgentManager,
  | "closeAgent"
  | "createAgent"
  | "getAgent"
  | "getRegisteredProviderIds"
  | "hasInFlightRun"
  | "hydrateTimelineFromProvider"
  | "resumeAgentFromPersistence"
  | "runAgent"
  | "waitForAgentEvent"
>;

interface ScheduleWorkspaceCreateInput {
  cwd: string;
  firstAgentContext: FirstAgentContext;
  // Schedule runs always create their workspace hidden (withheld from clients).
  // The host honors this by persisting the workspace record with `hidden: true`;
  // the run reveals it later only on finish-and-keep or error.
  hidden: boolean;
}

/** Narrow provider-snapshot surface the run path needs for personality resolution. */
export interface ScheduleProviderLister {
  listProviders(input: {
    cwd?: string | null;
    wait?: boolean;
  }): Promise<readonly ProviderSnapshotEntry[]>;
}

export interface ScheduleServiceOptions {
  ottoHome: string;
  logger: Logger;
  agentManager: ScheduleAgentManager;
  agentStorage: AgentStorage;
  createAgent: BoundCreateAgentCommand;
  /** Optional — enables personality-bound schedules (run-time resolution). */
  providerSnapshotManager?: ScheduleProviderLister;
  /** Optional — reads the live personality roster for personality-bound schedules. */
  readAgentPersonalities?: () => AgentPersonality[];
  /**
   * Optional — reads the live Agent Teams section. A schedule resolves the
   * ACTIVE team at run time (the active team is "how this host operates right
   * now"): a run under Team B carries Team B's frame iff the bound personality
   * is a member; otherwise it runs teamless — never a hard-fail, unlike
   * personality unavailability, because teamlessness is a valid state.
   */
  readAgentTeams?: () => AgentTeamsConfigView | undefined;
  createLocalCheckoutWorkspace: (
    input: ScheduleWorkspaceCreateInput,
  ) => Promise<PersistedWorkspaceRecord>;
  createOttoWorktreeWorkspace: (
    input: ScheduleWorkspaceCreateInput,
  ) => Promise<CreateOttoWorktreeWorkflowResult>;
  archiveWorkspace: (workspaceId: string, repoRoot: string) => Promise<void>;
  // Flip a hidden schedule-run workspace to visible and emit a workspace_update
  // so it appears in every client's sidebar. Called on finish-and-keep and on
  // error (never on archive-on-finish success — that path stays invisible).
  revealWorkspace: (workspaceId: string) => Promise<void>;
  now?: () => Date;
  runner?: (schedule: StoredSchedule, runId: string) => Promise<ScheduleExecutionResult>;
}

export class ScheduleService {
  private readonly store: ScheduleStore;
  private readonly logger: Logger;
  private readonly agentManager: ScheduleAgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly createAgent: BoundCreateAgentCommand;
  private readonly createLocalCheckoutWorkspace: (
    input: ScheduleWorkspaceCreateInput,
  ) => Promise<PersistedWorkspaceRecord>;
  private readonly createOttoWorktreeWorkspace: (
    input: ScheduleWorkspaceCreateInput,
  ) => Promise<CreateOttoWorktreeWorkflowResult>;
  private readonly archiveWorkspace: (workspaceId: string, repoRoot: string) => Promise<void>;
  private readonly revealWorkspace: (workspaceId: string) => Promise<void>;
  private readonly providerSnapshotManager: ScheduleProviderLister | null;
  private readonly readAgentPersonalities: (() => AgentPersonality[]) | null;
  private readonly readAgentTeams: (() => AgentTeamsConfigView | undefined) | null;
  private readonly now: () => Date;
  private readonly runner: (
    schedule: StoredSchedule,
    runId: string,
  ) => Promise<ScheduleExecutionResult>;
  private readonly runningScheduleIds = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ScheduleServiceOptions) {
    this.store = new ScheduleStore(join(options.ottoHome, "schedules"));
    this.logger = options.logger.child({ module: "schedule-service" });
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.createAgent = options.createAgent;
    this.createLocalCheckoutWorkspace = options.createLocalCheckoutWorkspace;
    this.createOttoWorktreeWorkspace = options.createOttoWorktreeWorkspace;
    this.archiveWorkspace = options.archiveWorkspace;
    this.revealWorkspace = options.revealWorkspace;
    this.providerSnapshotManager = options.providerSnapshotManager ?? null;
    this.readAgentPersonalities = options.readAgentPersonalities ?? null;
    this.readAgentTeams = options.readAgentTeams ?? null;
    this.now = options.now ?? (() => new Date());
    this.runner = options.runner ?? ((schedule, runId) => this.executeSchedule(schedule, runId));
  }

  async start(): Promise<void> {
    await this.recoverInterruptedRuns();
    await this.sweepOrphanedSchedules();
    if (this.tickTimer) {
      return;
    }
    const timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.error({ err: error }, "Failed to process schedule tick");
      });
    }, SCHEDULE_TICK_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.tickTimer = timer;
  }

  async stop(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async create(input: CreateScheduleInput): Promise<StoredSchedule> {
    const prompt = normalizePrompt(input.prompt);
    validateScheduleCadence(input.cadence);
    return this.createScheduleRecord(input, {
      name: trimOptionalName(input.name),
      prompt,
      target: input.target,
    });
  }

  private async createScheduleRecord(
    input: CreateScheduleInput,
    fields: { name: string | null; prompt: string; target: ScheduleTarget },
  ): Promise<StoredSchedule> {
    return this.store.create(this.buildScheduleRecord(input, fields));
  }

  private buildScheduleRecord(
    input: CreateScheduleInput,
    fields: { name: string | null; prompt: string; target: ScheduleTarget },
  ): Omit<StoredSchedule, "id"> {
    const now = this.now();
    const runOnCreate = input.runOnCreate ?? input.cadence.type === "every";
    const nextRunAt = runOnCreate ? now : computeNextRunAt(input.cadence, now);
    return {
      name: fields.name,
      prompt: fields.prompt,
      cadence: input.cadence,
      target: fields.target,
      status: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      pausedAt: null,
      expiresAt: input.expiresAt ?? null,
      maxRuns: normalizeMaxRuns(input.maxRuns),
      runs: [],
    };
  }

  // Idempotent create for the MCP write path: repeating a create with the same
  // name and target (e.g. babysit-pr re-registering its heartbeat) refreshes the
  // existing non-completed schedule in place instead of minting a duplicate.
  async createOrReplace(input: CreateScheduleInput): Promise<StoredSchedule> {
    const name = trimOptionalName(input.name);
    const prompt = normalizePrompt(input.prompt);
    validateScheduleCadence(input.cadence);
    if (name === null) {
      return this.createScheduleRecord(input, { name, prompt, target: input.target });
    }

    const inputTarget = input.target;
    return this.store.upsertByNameAndTarget(name, inputTarget, {
      create: async () => {
        return this.buildScheduleRecord(input, { name, prompt, target: inputTarget });
      },
      update: async (current) => {
        const now = this.now();
        const cadence = mergeScheduleCadenceTimezone(current.cadence, input.cadence);
        const runOnCreate = input.runOnCreate ?? cadence.type === "every";
        const nextRunAt = runOnCreate ? now : computeNextRunAt(cadence, now);
        return {
          ...current,
          name,
          prompt,
          cadence,
          target: inputTarget,
          status: "active",
          pausedAt: null,
          nextRunAt: nextRunAt.toISOString(),
          expiresAt: input.expiresAt ?? null,
          maxRuns: normalizeMaxRuns(input.maxRuns),
          updatedAt: now.toISOString(),
        };
      },
    });
  }

  async list(): Promise<StoredSchedule[]> {
    return this.store.list();
  }

  async inspect(id: string): Promise<StoredSchedule> {
    const schedule = await this.store.get(id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }
    return schedule;
  }

  async logs(id: string): Promise<ScheduleRun[]> {
    const schedule = await this.inspect(id);
    return [...schedule.runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async pause(id: string): Promise<StoredSchedule> {
    const paused = await this.store.update(id, (schedule) => {
      if (schedule.status === "completed") {
        throw new Error(`Schedule ${id} is already completed`);
      }
      if (schedule.status === "paused") {
        return schedule;
      }
      const now = this.now();
      return {
        ...schedule,
        status: "paused" as const,
        nextRunAt: null,
        pausedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    });
    return requireSchedule(paused, id);
  }

  async resume(id: string): Promise<StoredSchedule> {
    const resumed = await this.store.update(id, (schedule) => {
      if (schedule.status === "completed") {
        throw new Error(`Schedule ${id} is already completed`);
      }
      if (schedule.status === "active") {
        return schedule;
      }
      const now = this.now();
      return {
        ...schedule,
        status: "active" as const,
        pausedAt: null,
        nextRunAt: computeNextRunAt(schedule.cadence, now).toISOString(),
        updatedAt: now.toISOString(),
      };
    });
    return requireSchedule(resumed, id);
  }

  async update(input: UpdateScheduleInput): Promise<StoredSchedule> {
    const next = await this.store.update(input.id, async (schedule) => {
      const now = this.now();
      let updated: StoredSchedule = schedule;

      if (input.prompt !== undefined) {
        updated = { ...updated, prompt: normalizePrompt(input.prompt) };
      }

      if (input.name !== undefined) {
        updated = { ...updated, name: trimOptionalName(input.name) };
      }

      if (input.cadence !== undefined) {
        const cadence = mergeScheduleCadenceTimezone(updated.cadence, input.cadence);
        validateScheduleCadence(cadence);
        const nextRunAt =
          updated.status === "active" ? computeNextRunAt(cadence, now).toISOString() : null;
        updated = { ...updated, cadence, nextRunAt };
      }

      if (input.newAgentConfig !== undefined) {
        if (updated.target.type !== "new-agent") {
          throw new Error("new-agent config updates are only valid for new-agent target schedules");
        }
        const patchedTarget = applyNewAgentConfig(updated.target, input.newAgentConfig);
        updated = {
          ...updated,
          target: patchedTarget,
        };
      }

      if (input.maxRuns !== undefined) {
        updated = { ...updated, maxRuns: normalizeMaxRuns(input.maxRuns) };
      }

      if (input.expiresAt !== undefined) {
        updated = { ...updated, expiresAt: input.expiresAt };
      }

      return { ...updated, updatedAt: now.toISOString() };
    });
    return requireSchedule(next, input.id);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async completeForAgent(agentId: string): Promise<number> {
    const now = this.now();
    const schedules = await this.store.list();
    const matches = schedules.filter(
      (schedule) =>
        schedule.target.type === "agent" &&
        schedule.target.agentId === agentId &&
        schedule.status !== "completed",
    );
    const results = await Promise.allSettled(
      matches.map((schedule) => this.completeScheduleForAgent(schedule.id, agentId, now)),
    );
    let completed = 0;
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled" && result.value) {
        completed += 1;
      } else if (result.status === "rejected") {
        this.logger.warn(
          {
            err: result.reason,
            scheduleId: matches[index].id,
            agentId,
          },
          "Failed to complete schedule for archived agent; continuing",
        );
      }
    }
    return completed;
  }

  private async completeScheduleForAgent(
    scheduleId: string,
    agentId: string,
    now: Date,
  ): Promise<boolean> {
    let completed = false;
    const updated = await this.store.update(scheduleId, (schedule) => {
      if (
        schedule.target.type !== "agent" ||
        schedule.target.agentId !== agentId ||
        schedule.status === "completed"
      ) {
        return schedule;
      }
      completed = true;
      return completeSchedule(schedule, now);
    });
    requireSchedule(updated, scheduleId);
    return completed;
  }

  async runOnce(id: string): Promise<StoredSchedule> {
    const schedule = await this.inspect(id);
    if (schedule.status === "completed") {
      throw new Error(`Schedule ${id} is already completed`);
    }
    if (this.runningScheduleIds.has(id)) {
      throw new Error(`Schedule ${id} is already running`);
    }
    await this.runSchedule(schedule, this.now(), { manual: true });
    return this.inspect(id);
  }

  async tick(): Promise<void> {
    const now = this.now();
    const schedules = await this.store.list();
    for (const schedule of schedules) {
      if (schedule.status !== "active" || !schedule.nextRunAt) {
        continue;
      }
      if (this.runningScheduleIds.has(schedule.id)) {
        continue;
      }
      if (shouldCompleteSchedule(schedule, now)) {
        await this.completeScheduleIfDue(schedule.id, now);
        continue;
      }
      if (new Date(schedule.nextRunAt).getTime() > now.getTime()) {
        continue;
      }
      await this.runSchedule(schedule, now);
    }
  }

  private async completeScheduleIfDue(scheduleId: string, now: Date): Promise<void> {
    const updated = await this.store.update(scheduleId, (schedule) => {
      if (
        schedule.status !== "active" ||
        !schedule.nextRunAt ||
        !shouldCompleteSchedule(schedule, now)
      ) {
        return schedule;
      }
      return completeSchedule(schedule, now);
    });
    requireSchedule(updated, scheduleId);
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const schedules = await this.store.list();
    const now = this.now();
    await Promise.all(
      schedules.map((schedule) => this.recoverInterruptedSchedule(schedule.id, now)),
    );
  }

  private async recoverInterruptedSchedule(scheduleId: string, now: Date): Promise<void> {
    const interruptedWorkspaces: Array<{
      workspaceId: string;
      repoRoot: string;
      agentId: string | null;
      runId: string;
    }> = [];
    // Interrupted runs that we do NOT archive must be revealed: they were created
    // hidden, so without reveal a kept-run (archiveOnFinish=false) workspace would
    // be orphaned hidden forever. A daemon restart mid-run is a failure the user
    // should see.
    const revealWorkspaceIds: string[] = [];
    await this.store.update(scheduleId, (current) => {
      let updated = { ...current };
      let dirty = false;

      const runningIndex = updated.runs.findIndex((run) => run.status === "running");
      if (runningIndex !== -1) {
        const runs = [...updated.runs];
        const runningRun = runs[runningIndex];
        if (updated.target.type === "new-agent" && runningRun.workspaceId) {
          if (
            shouldArchiveScheduleRunWorkspace({
              agentId: runningRun.agentId,
              archiveOnFinish: updated.target.config.archiveOnFinish,
            })
          ) {
            interruptedWorkspaces.push({
              workspaceId: runningRun.workspaceId,
              repoRoot: updated.target.config.cwd,
              agentId: runningRun.agentId,
              runId: runningRun.id,
            });
          } else {
            revealWorkspaceIds.push(runningRun.workspaceId);
          }
        }
        runs[runningIndex] = {
          ...runningRun,
          status: "failed",
          endedAt: now.toISOString(),
          error: "Daemon restarted before the scheduled run completed",
        };
        updated = { ...updated, runs };
        dirty = true;
      }

      if (
        updated.status === "active" &&
        updated.nextRunAt &&
        new Date(updated.nextRunAt).getTime() <= now.getTime()
      ) {
        let nextRunAt = computeNextRunAt(updated.cadence, new Date(updated.nextRunAt));
        while (nextRunAt.getTime() <= now.getTime()) {
          nextRunAt = computeNextRunAt(updated.cadence, nextRunAt);
        }
        updated = { ...updated, nextRunAt: nextRunAt.toISOString() };
        dirty = true;
      }

      if (dirty) {
        return { ...updated, updatedAt: now.toISOString() };
      }
      return current;
    });
    for (const workspaceId of revealWorkspaceIds) {
      try {
        await this.revealWorkspace(workspaceId);
      } catch (error) {
        this.logger.warn(
          { err: error, workspaceId, scheduleId },
          "Failed to reveal interrupted scheduled workspace after daemon restart",
        );
      }
    }
    const interruptedWorkspace = interruptedWorkspaces[0];
    if (!interruptedWorkspace) {
      return;
    }
    try {
      await this.archiveWorkspace(interruptedWorkspace.workspaceId, interruptedWorkspace.repoRoot);
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          agentId: interruptedWorkspace.agentId,
          workspaceId: interruptedWorkspace.workspaceId,
          scheduleId,
          runId: interruptedWorkspace.runId,
        },
        "Failed to archive interrupted scheduled workspace after daemon restart",
      );
    }
  }

  // Orphaned agent-target schedules (agent deleted while the daemon was down, or
  // archived before completeForAgent existed) can never fire successfully. Complete
  // them on startup so they stop ticking and surface as ended in the UI.
  private async sweepOrphanedSchedules(): Promise<void> {
    const now = this.now();
    const schedules = await this.store.list();
    await Promise.all(schedules.map((schedule) => this.sweepOrphanedSchedule(schedule.id, now)));
  }

  private async sweepOrphanedSchedule(scheduleId: string, now: Date): Promise<void> {
    await this.store.update(scheduleId, async (schedule) => {
      if (schedule.target.type !== "agent" || schedule.status === "completed") {
        return schedule;
      }
      const record = await this.agentStorage.get(schedule.target.agentId);
      if (record && !record.archivedAt) {
        return schedule;
      }
      return completeSchedule(schedule, now);
    });
  }

  private async runSchedule(
    schedule: StoredSchedule,
    now: Date,
    options?: { manual?: boolean },
  ): Promise<void> {
    const manual = options?.manual === true;
    this.runningScheduleIds.add(schedule.id);
    const runId = randomUUID();
    const runningRun: ScheduleRun = {
      id: runId,
      scheduledFor: manual ? now.toISOString() : (schedule.nextRunAt ?? now.toISOString()),
      startedAt: now.toISOString(),
      endedAt: null,
      status: "running",
      agentId: null,
      output: null,
      error: null,
    };
    const scheduleWithRun = await this.appendRunningRun(schedule.id, runningRun);

    try {
      const result = await this.runner(scheduleWithRun, runId);
      await this.finishRun({
        scheduleId: schedule.id,
        runId,
        status: "succeeded",
        agentId: result.agentId,
        output: result.output,
        error: null,
        targetGone: false,
        manual,
      });
    } catch (error) {
      await this.finishRun({
        scheduleId: schedule.id,
        runId,
        status: "failed",
        agentId: null,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        targetGone: error instanceof ScheduleTargetGoneError,
        manual,
      });
    } finally {
      this.runningScheduleIds.delete(schedule.id);
    }
  }

  private async appendRunningRun(
    scheduleId: string,
    runningRun: ScheduleRun,
  ): Promise<StoredSchedule> {
    const updated = await this.store.update(scheduleId, (schedule) => ({
      ...schedule,
      updatedAt: runningRun.startedAt,
      runs: [...schedule.runs, runningRun],
    }));
    return requireSchedule(updated, scheduleId);
  }

  private async finishRun(params: {
    scheduleId: string;
    runId: string;
    status: "succeeded" | "failed";
    agentId: string | null;
    output: string | null;
    error: string | null;
    targetGone: boolean;
    manual: boolean;
  }): Promise<void> {
    const updatedSchedule = await this.store.update(params.scheduleId, (schedule) => {
      const now = this.now();
      const completedRuns = schedule.runs.map((run) =>
        run.id === params.runId
          ? {
              ...run,
              status: params.status,
              endedAt: now.toISOString(),
              agentId: params.agentId ?? run.agentId,
              output: params.output,
              error: params.error,
            }
          : run,
      );
      let updated: StoredSchedule = {
        ...schedule,
        runs: completedRuns,
        lastRunAt: now.toISOString(),
        lastRunStatus: params.status,
        lastRunError: params.error,
        updatedAt: now.toISOString(),
      };

      if (params.targetGone) {
        // The target is permanently gone; retrying only burns the schedule down to
        // its expiry, so complete it now regardless of manual/scheduled origin.
        updated = completeSchedule(updated, now);
      } else if (updated.status === "completed") {
        // Completed concurrently (e.g. the target agent was archived mid-run);
        // record the run outcome but leave the schedule terminal — don't advance.
      } else if (params.manual) {
        // Manual one-shot runs do not advance the cadence or recompute completion.
      } else if (shouldCompleteSchedule(updated, now)) {
        updated = completeSchedule(updated, now);
      } else if (updated.status === "paused") {
        updated = {
          ...updated,
          nextRunAt: null,
        };
      } else {
        const after = new Date(schedule.nextRunAt ?? now.toISOString());
        let nextRunAt = computeNextRunAt(updated.cadence, after);
        while (nextRunAt.getTime() <= now.getTime()) {
          nextRunAt = computeNextRunAt(updated.cadence, nextRunAt);
        }
        updated = {
          ...updated,
          nextRunAt: nextRunAt.toISOString(),
        };
      }

      return updated;
    });
    requireSchedule(updatedSchedule, params.scheduleId);
  }

  private async recordRunWorkspace(params: {
    scheduleId: string;
    runId: string;
    workspaceId: string;
    agentId: string | null;
  }): Promise<void> {
    const updatedSchedule = await this.store.update(params.scheduleId, (schedule) => ({
      ...schedule,
      updatedAt: this.now().toISOString(),
      runs: schedule.runs.map((run) =>
        run.id === params.runId && run.status === "running"
          ? {
              ...run,
              workspaceId: params.workspaceId,
              agentId: params.agentId,
            }
          : run,
      ),
    }));
    requireSchedule(updatedSchedule, params.scheduleId);
  }

  private async executeSchedule(
    schedule: StoredSchedule,
    runId: string,
  ): Promise<ScheduleExecutionResult> {
    if (schedule.target.type === "agent") {
      const wrappedPrompt = formatSystemNotificationPrompt(buildScheduleFireBody(schedule, runId));
      const record = await this.agentStorage.get(schedule.target.agentId);
      if (!record) {
        throw new ScheduleTargetGoneError(`Agent ${schedule.target.agentId} no longer exists`);
      }
      if (record.archivedAt) {
        throw new ScheduleTargetGoneError(`Agent ${schedule.target.agentId} is archived`);
      }

      const agent = await ensureAgentLoaded(schedule.target.agentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.logger,
      });
      if (this.agentManager.hasInFlightRun(agent.id)) {
        throw new Error(`Agent ${agent.id} already has an active run`);
      }
      const result = await this.agentManager.runAgent(agent.id, wrappedPrompt);
      const timelineText = curateAgentActivity(result.timeline);
      return {
        agentId: agent.id,
        output: buildRunOutput({
          output: null,
          timelineText,
          finalText: result.finalText,
        }),
      };
    }

    const config = schedule.target.type === "new-agent" ? schedule.target.config : null;
    if (!config) {
      throw new Error(`Schedule ${schedule.id} target changed during execution`);
    }
    await this.assertNewAgentCwdDirectory(config.cwd);
    let workspace: PersistedWorkspaceRecord | null = null;
    let agentId: string | null = null;
    let succeeded = false;
    try {
      workspace = await this.createScheduleRunWorkspace(config, schedule.prompt);
      await this.recordRunWorkspace({
        scheduleId: schedule.id,
        runId,
        workspaceId: workspace.workspaceId,
        agentId: null,
      });
      const runConfig = { ...config, cwd: workspace.cwd };
      // A personality-bound schedule re-resolves its personality against THIS
      // run's cwd and hard-fails the run if it's unavailable (surfaced via the
      // run's failure path) — no silent fallback.
      const brain = await this.resolveSchedulePersonalityBrain(runConfig);
      const spawn = applyScheduleBrain({
        brain,
        baseAgentConfig: buildScheduleAgentConfig(runConfig),
        fallbackProviderModel: formatScheduleProviderModel(runConfig),
        configModeId: config.modeId,
        configThinkingOptionId: config.thinkingOptionId,
      });
      const created = await this.createAgent({
        kind: "mcp",
        provider: spawn.provider,
        config: spawn.config,
        cwd: workspace.cwd,
        workspaceId: workspace.workspaceId,
        title: resolveScheduleAgentTitle(config, schedule.prompt),
        labels: {
          "otto.schedule-id": schedule.id,
          "otto.schedule-run": runId,
        },
        mode: spawn.mode,
        thinking: spawn.thinking,
        features: config.featureValues,
        unattended: true,
        // Schedule-run agents are internal like artifact-generator agents: this
        // suppresses agent-level attention broadcasts (agent-manager skips
        // internal agents), so a clean run is fully silent. Problems surface
        // through the schedule service's own error detection (waitResult.status
        // === "error"), which reveals the hidden workspace. Whether these agents
        // should instead stay listed/persisted is a deferred decision — see the
        // safe-unattended charter's Open questions.
        internal: true,
        promptFailure: "return-error",
        background: true,
        notifyOnFinish: false,
      });
      const agent = created.snapshot;
      agentId = agent.id;
      await this.recordRunWorkspace({
        scheduleId: schedule.id,
        runId,
        workspaceId: workspace.workspaceId,
        agentId,
      });
      if (created.initialPromptError) {
        throw created.initialPromptError;
      }
      const result = await this.agentManager.runAgent(agent.id, schedule.prompt);
      const waitResult = await this.agentManager.waitForAgentEvent(agent.id, {
        waitForActive: true,
      });
      if (result.canceled) {
        throw new Error(`Scheduled agent ${agent.id} was canceled`);
      }
      if (waitResult.permission) {
        throw new Error(`Scheduled agent ${agent.id} is waiting for permission`);
      }
      if (waitResult.status === "error") {
        throw new Error(waitResult.lastMessage ?? `Scheduled agent ${agent.id} failed`);
      }
      const timelineText = curateAgentActivity(result.timeline);
      succeeded = true;
      return {
        agentId: agent.id,
        output: buildRunOutput({
          output: waitResult.lastMessage ?? null,
          timelineText,
          finalText: result.finalText,
        }),
      };
    } finally {
      // Schedule-run agents are internal (ephemeral), so archive-by-workspace
      // can't see them — close the agent directly, mirroring how the artifact
      // generator tears down its internal agent. Without this the finished agent
      // would leak in-memory (internal agents are never persisted or listed).
      if (agentId) {
        try {
          await this.agentManager.closeAgent(agentId);
        } catch (error) {
          this.logger.warn(
            { err: error, agentId, scheduleId: schedule.id, runId },
            "Failed to close scheduled agent after run",
          );
        }
      }
      if (workspace) {
        await this.disposeScheduleRunWorkspace({
          workspace,
          agentId,
          succeeded,
          archiveOnFinish: config.archiveOnFinish,
          repoRoot: config.cwd,
          scheduleId: schedule.id,
          runId,
        });
      }
    }
  }

  // Disposition of a schedule-run workspace once the run settles. The workspace
  // was created hidden, so exactly one of three things happens:
  //   - error (run threw): REVEAL and never archive — the failure must surface,
  //     and archiving would hide the very problem the user needs to see, even
  //     when archiveOnFinish is set.
  //   - success + archiveOnFinish: archive as before — it was never revealed, so
  //     the user never sees the transient workspace.
  //   - success + keep (archiveOnFinish=false): REVEAL so the kept result shows.
  private async disposeScheduleRunWorkspace(params: {
    workspace: PersistedWorkspaceRecord;
    agentId: string | null;
    succeeded: boolean;
    archiveOnFinish?: boolean;
    repoRoot: string;
    scheduleId: string;
    runId: string;
  }): Promise<void> {
    const { workspace, agentId, succeeded, archiveOnFinish, repoRoot, scheduleId, runId } = params;
    if (succeeded && shouldArchiveScheduleRunWorkspace({ agentId, archiveOnFinish })) {
      try {
        await this.archiveWorkspace(workspace.workspaceId, repoRoot);
      } catch (error) {
        this.logger.warn(
          { err: error, agentId, workspaceId: workspace.workspaceId, scheduleId, runId },
          "Failed to archive scheduled workspace after run",
        );
      }
      return;
    }
    try {
      await this.revealWorkspace(workspace.workspaceId);
    } catch (error) {
      this.logger.warn(
        { err: error, agentId, workspaceId: workspace.workspaceId, scheduleId, runId, succeeded },
        "Failed to reveal scheduled workspace after run",
      );
    }
  }

  private async createScheduleRunWorkspace(
    config: Extract<ScheduleTarget, { type: "new-agent" }>["config"],
    prompt: string,
  ): Promise<PersistedWorkspaceRecord> {
    const firstAgentContext = { prompt };
    // Schedule runs are invisible until they finish-and-keep or error: create the
    // backing workspace hidden so it never flashes into any client's sidebar.
    switch (config.isolation ?? "local") {
      case "local":
        return this.createLocalCheckoutWorkspace({
          cwd: config.cwd,
          firstAgentContext,
          hidden: true,
        });
      case "worktree":
        return (
          await this.createOttoWorktreeWorkspace({
            cwd: config.cwd,
            firstAgentContext,
            hidden: true,
          })
        ).workspace;
    }
  }

  private async assertNewAgentCwdDirectory(cwd: string): Promise<void> {
    try {
      const stats = await stat(cwd);
      if (!stats.isDirectory()) {
        throw new ScheduleTargetGoneError(`Working directory ${cwd} is not a directory`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ScheduleTargetGoneError(`Working directory ${cwd} no longer exists`);
      }
      throw error;
    }
  }

  // Resolve a schedule's optional personality binding against the run cwd, or
  // undefined when unbound. Throws (failing the run) when the personality is
  // named but missing/unavailable, or when personality resolution isn't wired.
  private async resolveSchedulePersonalityBrain(config: {
    personality?: string;
    cwd: string;
  }): Promise<ScheduleBrain | undefined> {
    const name = config.personality?.trim();
    if (!name) {
      return undefined;
    }
    if (!this.providerSnapshotManager || !this.readAgentPersonalities) {
      throw new Error(
        `Schedule binds personality "${name}", but personality resolution is not configured on this host.`,
      );
    }
    const roster = this.readAgentPersonalities();
    const entries = await this.providerSnapshotManager.listProviders({
      cwd: config.cwd,
      wait: true,
    });

    // The dynamic "Team's Scheduler" binding resolves the active team's
    // Scheduler at RUN time — the schedule follows whoever holds the role in
    // the operating team when it fires.
    if (name === TEAM_SCHEDULER_PERSONALITY_SENTINEL) {
      return this.buildScheduleBrain(
        resolveTeamSchedulerSnapshot({
          agentTeams: this.readAgentTeams?.(),
          roster,
          entries,
        }),
      );
    }

    const personality =
      roster.find((entry) => entry.name === name) ??
      roster.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!personality) {
      throw new Error(`Personality "${name}" not found; the scheduled run cannot proceed.`);
    }
    const resolution = resolvePersonality(personality, entries);
    if (resolution.status === "unavailable") {
      throw new Error(`Personality "${personality.name}" is unavailable: ${resolution.reason}`);
    }
    return this.buildScheduleBrain(resolution.snapshot);
  }

  // Shared tail for both binding kinds: run-time team framing (iff the resolved
  // personality is a member of the team active NOW — teamless runs are valid,
  // never an error) plus the concrete brain fields.
  private buildScheduleBrain(snapshot: ResolvedPersonalitySnapshot): ScheduleBrain {
    const teamSnapshot = resolveTeamSnapshotForPersonality(
      this.readAgentTeams?.(),
      snapshot.personalityId,
    );
    const composedPrompt = composeTeamAndPersonalityPrompt(
      teamSnapshot,
      snapshot.systemPrompt,
      snapshot.roles,
    );
    return {
      providerModel: snapshot.model ? `${snapshot.provider}/${snapshot.model}` : snapshot.provider,
      ...(snapshot.modeId !== undefined ? { modeId: snapshot.modeId } : {}),
      ...(snapshot.thinkingOptionId !== undefined
        ? { thinkingOptionId: snapshot.thinkingOptionId }
        : {}),
      ...(composedPrompt !== undefined ? { systemPrompt: composedPrompt } : {}),
      snapshot,
      ...(teamSnapshot ? { teamSnapshot } : {}),
    };
  }
}

interface ScheduleBrain {
  providerModel: string;
  modeId?: string;
  thinkingOptionId?: string;
  systemPrompt?: string;
  snapshot: ResolvedPersonalitySnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
}

// Fold a resolved personality brain (or its absence) into the createAgent
// provider/config/mode/thinking. Extracted so executeSchedule stays under the
// complexity budget.
function applyScheduleBrain(input: {
  brain: ScheduleBrain | undefined;
  baseAgentConfig: AgentSessionConfig;
  fallbackProviderModel: string;
  configModeId?: string;
  configThinkingOptionId?: string;
}): {
  provider: string;
  config: AgentSessionConfig;
  mode: string | undefined;
  thinking: string | undefined;
} {
  const { brain, baseAgentConfig, fallbackProviderModel, configModeId, configThinkingOptionId } =
    input;
  if (!brain) {
    return {
      provider: fallbackProviderModel,
      config: baseAgentConfig,
      mode: configModeId,
      thinking: configThinkingOptionId,
    };
  }
  const config: AgentSessionConfig = { ...baseAgentConfig, personalitySnapshot: brain.snapshot };
  if (brain.teamSnapshot !== undefined) {
    config.teamSnapshot = brain.teamSnapshot;
  }
  if (brain.systemPrompt !== undefined) {
    config.systemPrompt = brain.systemPrompt;
  }
  return {
    provider: brain.providerModel,
    config,
    mode: brain.modeId ?? configModeId,
    thinking: brain.thinkingOptionId ?? configThinkingOptionId,
  };
}

function buildScheduleAgentConfig(
  config: Extract<ScheduleTarget, { type: "new-agent" }>["config"],
): AgentSessionConfig {
  return {
    // Schedule agents are internal (see the createAgent call) but observable, like
    // the artifact generator: they stay out of listings/sidebar, yet their live
    // stream still forwards to a client that opens their timeline — so a revealed
    // (errored or kept) run can be watched. Without observable the daemon's global
    // subscription drops the stream events.
    observable: true,
    provider: config.provider,
    cwd: config.cwd,
    modeId: config.modeId,
    model: config.model,
    thinkingOptionId: config.thinkingOptionId,
    title: config.title,
    approvalPolicy: config.approvalPolicy,
    sandboxMode: config.sandboxMode,
    networkAccess: config.networkAccess,
    webSearch: config.webSearch,
    featureValues: config.featureValues,
    extra: config.extra,
    systemPrompt: config.systemPrompt,
    mcpServers: config.mcpServers as AgentSessionConfig["mcpServers"],
  };
}

function resolveScheduleAgentTitle(
  config: Extract<ScheduleTarget, { type: "new-agent" }>["config"],
  prompt: string,
): string {
  return (
    resolveCreateAgentTitles({
      configTitle: config.title,
      initialPrompt: prompt,
    }).provisionalTitle ?? ""
  );
}

function formatScheduleProviderModel(
  config: Extract<ScheduleTarget, { type: "new-agent" }>["config"],
): string {
  return formatProviderModel(config.provider, config.model);
}
