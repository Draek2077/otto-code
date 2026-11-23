import type { z } from "zod";
import type { AgentRunOptions } from "../../agent/agent-sdk-types.js";
import type {
  CreateScheduleInput as PaseoCreateSchedule,
  UpdateScheduleInput as PaseoUpdateSchedule,
  ScheduleExecutionResult as PaseoExecutionResult,
} from "@getpaseo/protocol/schedule/types";
import type {
  OttoScheduleTarget,
  OttoStoredSchedule,
  OttoScheduleRun,
  ScheduleRef,
  ScheduleRunAudit,
} from "@getpaseo/plugin/otto/schedules";

export type ScheduleTarget = OttoScheduleTarget;
export type StoredSchedule = OttoStoredSchedule;
export type ScheduleRun = OttoScheduleRun;
/** Trusted in-process notification after durable claim, before target effects. Never a wire field. */
export type ScheduleAdmission = (schedule: StoredSchedule, runId: string) => void;
export type ScheduleTurnFactory = (agentId: string) => Promise<AgentRunOptions>;
export type ScheduleAudit = z.infer<typeof ScheduleRunAudit>;
export interface ScheduleVersionMutation {
  ref: ScheduleRef;
  expectedRevision: string;
  /** Trusted owner sets this only after explicit inspection acknowledgement and target validation. */
  repairReviewed?: boolean;
  /** Reject edits/resumption inside the same claim queue while a run is active. */
  requireIdle?: boolean;
}
export type ScheduleMutation = ScheduleVersionMutation | { legacyOnly: true };
export interface CreateScheduleInput extends Omit<PaseoCreateSchedule, "target"> {
  target: ScheduleTarget;
  otto?: StoredSchedule["otto"];
}
export interface UpdateScheduleInput extends PaseoUpdateSchedule {
  target?: ScheduleTarget;
  mutation?: ScheduleMutation;
}
export interface ScheduleExecutionResult extends PaseoExecutionResult {
  audit?: Partial<z.infer<typeof ScheduleRunAudit>>;
}
export type ScheduleUpdater = (
  schedule: StoredSchedule,
) => StoredSchedule | Promise<StoredSchedule>;
export interface ScheduleUpsert {
  create(): Omit<StoredSchedule, "id"> | Promise<Omit<StoredSchedule, "id">>;
  update: ScheduleUpdater;
}
export interface ScheduleStorePort {
  list(): Promise<StoredSchedule[]>;
  get(id: string): Promise<StoredSchedule | null>;
  create(schedule: Omit<StoredSchedule, "id">): Promise<StoredSchedule>;
  update(
    id: string,
    updater: ScheduleUpdater,
    mutation?: ScheduleMutation,
  ): Promise<StoredSchedule | null>;
  upsertByNameAndTarget(
    name: string,
    target: ScheduleTarget,
    options: ScheduleUpsert,
  ): Promise<StoredSchedule>;
  delete(id: string, mutation?: ScheduleMutation): Promise<void>;
}
export interface ScheduleSettlement {
  result?: ScheduleExecutionResult;
  error?: unknown;
}
/** Inject targets into Paseo's single claim/run/finish lifecycle, not a second timer. */
export interface ScheduleRuntimeHooks {
  requested(schedule: StoredSchedule): z.infer<typeof ScheduleRunAudit>;
  acquire(schedule: StoredSchedule): (() => void) | null;
  execute(input: {
    schedule: StoredSchedule;
    runId: string;
    legacy(turnOptions?: ScheduleTurnFactory): Promise<ScheduleExecutionResult>;
    stamp(audit: Partial<z.infer<typeof ScheduleRunAudit>>): Promise<void>;
  }): Promise<ScheduleExecutionResult>;
  settle(
    schedule: StoredSchedule,
    run: ScheduleRun,
    outcome: ScheduleSettlement,
  ): {
    run: ScheduleRun;
    pauseReason?: string;
  };
  recover(schedule: StoredSchedule, run: ScheduleRun): { run: ScheduleRun; pauseReason?: string };
  stop(): Promise<void>;
}
