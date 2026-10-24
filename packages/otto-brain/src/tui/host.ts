import type { ProfileFieldDescriptor, ProfileWarning } from "../config/profile-edit.js";
import type { Profile } from "../config/schema.js";
import type { ModelSearchResult, RepoQuants } from "../models/hf.js";
import type { RankedModel, RunRecord, RecordTask, RecordModel } from "../ops/results.js";
import type { SweepResult } from "../ops/sweep.js";
import type { GpuInfo, Model, Runtime } from "../types.js";
import type { Budget } from "../vram.js";

/** Presentation data never asks a terminal client to infer owning-host paths. */
export type TuiModelInfo = Pick<
  Model,
  | "id"
  | "displayName"
  | "quant"
  | "sizeBytes"
  | "mmprojBytes"
  | "features"
  | "metadata"
  | "thinking"
> & { repo: string | null; hasProjector: boolean };
export type TuiProfile = Pick<
  Profile,
  | "contextSize"
  | "cacheTypeK"
  | "cacheTypeV"
  | "flashAttention"
  | "gpuLayers"
  | "vision"
  | "enabledComponents"
  | "reasoningBudget"
  | "reasoningBudgetMessage"
  | "preserveReasoning"
  | "temperature"
  | "topP"
  | "topK"
  | "minP"
  | "presencePenalty"
  | "repeatPenalty"
  | "parallelSlots"
  | "cachedChats"
  | "contextMultiplier"
  | "calibrationRequired"
  | "hostingProfileId"
  | "hostingProfileMode"
> &
  Record<string, unknown>;
export type TuiBenchmark = Pick<
  RunRecord,
  "ranAt" | "configKey" | "overall" | "grade" | "seconds"
> & {
  model: Pick<RecordModel, "displayName"> & { id?: string | null };
  tasks: Array<Pick<RecordTask, "id" | "category" | "score"> & { detail?: unknown }>;
};
export interface TuiModel {
  model: TuiModelInfo;
  revision: string;
  profile: TuiProfile;
  fields: ProfileFieldDescriptor[];
  warnings: ProfileWarning[];
  calibration: { kvBytesPerToken: number; inherited: boolean } | null;
  calibrationStale: boolean;
  budget: Budget | null;
  maxContext: number | null;
  sweep: {
    results: Pick<
      SweepResult,
      "budget" | "error" | "contentChars" | "filesDelivered" | "elapsedSeconds"
    >[];
    recommended: number | null;
  } | null;
  renamed: boolean;
  deleteBytes: number | null;
  deleteBlocked: string | null;
}

export interface TuiSlot {
  slot: number;
  phase: "idle" | "processing" | "thinking" | "generating";
}
export interface TuiResident {
  residentId: string;
  modelId: string;
  displayName: string;
  phase: "starting" | "ready" | "stopping" | "stopped" | "failed";
  pid: number | null;
  slots: TuiSlot[];
}
export interface TuiSystem {
  cpu: number | null;
  cpuCount: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  gpu: (GpuInfo & { utilization: number | null; temperature: number | null }) | null;
}
export interface TuiJob {
  id: string;
  operation: "calibrate" | "sweep" | "bench" | "pull" | "runtime";
  modelId: string | null;
  state: "queued" | "running" | "completed" | "failed" | "canceled";
  progress: string[];
  fraction: number | null;
  error: string | null;
  cancelable: boolean;
}
export interface TuiCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  installed: boolean;
}
export interface TuiRuntimeEntry {
  /** Opaque host-issued install candidate or installed-runtime identity, never a path. */
  id: string;
  label: string;
  version: string;
  installed: boolean;
  selected: boolean;
  unavailableReason: string | null;
}
export interface BrainTuiSnapshot {
  instanceId: string;
  libraryRevision: number;
  jobRevision: number;
  version: string;
  connection: "connected" | "connecting" | "disconnected";
  endpoint: string | null;
  state: TuiResident["phase"];
  message: string | null;
  runtime: Pick<Runtime, "label" | "version"> | null;
  gpu: GpuInfo | null;
  system: TuiSystem | null;
  models: TuiModel[];
  residents: TuiResident[];
  logs: string[];
  jobs: TuiJob[];
  catalog: TuiCatalogEntry[];
  runtimes: TuiRuntimeEntry[];
  storage: { modelBytes: number; freeBytes: number; totalBytes: number } | null;
  telemetry: {
    requests: number;
    ok: number;
    reasoningOnly: number;
    truncated: number;
    warning: string | null;
  };
  rankings: RankedModel[];
  benchmarks: TuiBenchmark[];
  availableActions: BrainTuiActionType[];
}

interface Action<Input, Result = void> {
  input: Input;
  result: Result;
}
export interface BrainTuiActions {
  refresh: Action<Record<never, never>>;
  "profile.save": Action<{
    modelId: string;
    patch: Record<string, unknown>;
    expectedRevision: string;
  }>;
  "profile.fit": Action<
    { modelId: string; expectedRevision: string; patch: Record<string, unknown> },
    { contextSize: number | null }
  >;
  "model.load": Action<{ modelId: string }>;
  "model.unload": Action<{ modelId: string }>;
  "model.rename": Action<{ modelId: string; displayName: string }>;
  "model.resetName": Action<{ modelId: string }>;
  "model.delete": Action<{ modelId: string }>;
  "hf.search": Action<{ query: string }, ModelSearchResult[]>;
  "hf.quants": Action<{ repo: string }, RepoQuants>;
  "hf.add": Action<{ repo: string; quant: string }, { jobId: string }>;
  "catalog.pull": Action<{ catalogId: string }, { jobId: string }>;
  "runtime.install": Action<{ runtimeId: string }, { jobId: string }>;
  "runtime.select": Action<{ runtimeId: string }>;
  "runtime.remove": Action<{ runtimeId: string }>;
  "job.start": Action<
    { operation: "calibrate" | "sweep" | "bench"; modelId: string },
    { jobId: string }
  >;
  "job.cancel": Action<{ jobId: string }>;
}
export type BrainTuiActionType = keyof BrainTuiActions;
type FullBrainTuiAction = {
  [T in BrainTuiActionType]: { type: T } & BrainTuiActions[T]["input"];
}[BrainTuiActionType];
export type BrainTuiAction<K extends BrainTuiActionType = BrainTuiActionType> = Extract<
  FullBrainTuiAction,
  { type: K }
>;

export type BrainTuiResult<T = void> =
  | { status: "success"; value: T }
  | { status: "unsupported" | "conflict" | "failed"; message: string };

/** Messages in failure results are safe display text, never raw errors, paths or
 * credentials. A rejected promise is a transport failure and gets generic copy. */
export class TuiActionError extends Error {
  constructor(
    readonly status: "unsupported" | "conflict" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "TuiActionError";
  }
}

export async function requestHost<K extends BrainTuiActionType>(
  host: BrainTuiHost,
  action: BrainTuiAction<K>,
  signal: AbortSignal,
): Promise<BrainTuiActions[K]["result"]> {
  let result: BrainTuiResult<BrainTuiActions[K]["result"]>;
  try {
    result = await host.execute(action, signal);
  } catch {
    throw new TuiActionError("failed", "The Brain host request could not complete.");
  }
  if (result.status !== "success") throw new TuiActionError(result.status, result.message);
  return result.value;
}

/** The owning host supplies complete snapshots, capability checks and all effects.
 * subscribe is passive; retainStatus owns demand on the shared transport feed.
 * execute resolves after an accepted write is visible in getSnapshot. Job starts
 * resolve on admission; progress/results arrive through snapshots. Aborting a
 * client request never implicitly cancels an admitted host job: use job.cancel.
 * Snapshots are immutable for their lifetime; arrays/logs are bounded by the
 * owning host. instanceId changes discard revision-bound drafts. Capabilities
 * describe currently supported operations, including write access.
 */
export interface BrainTuiHost {
  getSnapshot(): BrainTuiSnapshot;
  subscribe(listener: () => void): () => void;
  retainStatus(): () => void;
  execute<K extends BrainTuiActionType>(
    action: BrainTuiAction<K>,
    signal?: AbortSignal,
  ): Promise<BrainTuiResult<BrainTuiActions[K]["result"]>>;
}
