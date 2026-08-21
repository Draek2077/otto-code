import fs from "node:fs";
import path from "node:path";

import { resolveBrainPaths } from "../config/paths.js";
import type { GpuInfo, Model, ModelFeatures } from "../types.js";
import type { Calibration, Profile } from "../config/schema.js";
import type { FitResult } from "../vram.js";

/**
 * Persistent benchmark history.
 *
 * One JSON file per run, so results accumulate across sessions and can be
 * compared and charted later. Runs record the configuration they were measured
 * under, because a score is meaningless without the quant, context size and
 * reasoning budget that produced it.
 *
 * **A run records every value it was measured with, not a summary of them.** A
 * bad score is far more often a bad setup than a bad model, and the difference
 * is only visible from the settings: a context the VRAM fit had to cut, a
 * reasoning budget the model spends entirely on thinking, a KV quant that
 * wrecked recall, weights that fell off the GPU because `gpuLayers` did not
 * cover them, a budget estimated from the formula rather than measured. None of
 * that is recoverable after the fact, so it is all written down at save time -
 * including the exact llama-server argv the run was served with, which is the
 * only true statement of what ran.
 */

/** Resolve the writable store for benchmark scores for a given host environment. */
function resolveResultsDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveBrainPaths(env).resultsDir;
}

// Benchmark history is host state, not package data. Keeping it beside the
// Brain config also makes the service work from packaged/Electron installs,
// where the package directory may be an archive or read-only.
const RESULTS_DIR = resolveResultsDir();

/** Aggregate of a numeric health series (nvidia-smi samples during a run). */
export interface AggStat {
  avg: number;
  min: number;
  max: number;
}

/** System health summary stored alongside a run's score. */
export interface SystemHealth {
  samples: number;
  gpuUtilPct: AggStat | null;
  tempC: AggStat | null;
  powerW: AggStat | null;
  clockMHz: AggStat | null;
  vramUsedMiB: AggStat | null;
  cpuPct: AggStat | null;
  ramUsedBytes: AggStat | null;
  thermalThrottle: boolean;
  powerThrottle: boolean;
}

/** One depth-scaling measurement point (from the context-depth task detail). */
export interface DepthPoint {
  promptTokens?: number;
  ttftSeconds?: number;
  generatePerSecond?: number;
}

/** One graded task inside a live benchmark report (input to `save`). */
export interface BenchTaskResult {
  id: string;
  category: string;
  weight: number;
  score: number;
  summary: string;
  seconds: number;
  detail?: unknown;
  error?: string | null;
}

/** A completed benchmark report, as produced by the bench suite. */
export interface BenchReport {
  overall: number;
  grade: string;
  seconds: number;
  executedCode: boolean;
  results: BenchTaskResult[];
  vramBytes?: number | null;
  loadSeconds?: number | null;
  archiveId?: string | null;
  system?: SystemHealth | null;
}

/**
 * The model identity persisted with a run.
 *
 * The geometry fields are here because a context size is only sensible against
 * them: 32k on a model whose GGUF header says 8k native is a setup error, not a
 * capability, and layer/KV-head counts are what make a KV cost per token
 * explicable rather than just large.
 */
export interface RecordModel {
  id: string | null;
  displayName: string;
  quant: string | null;
  arch: string | null;
  sizeBytes: number | null;
  publisher: string | null;
  features: ModelFeatures | null;
  /** Native context from the GGUF header - the ceiling `contextSize` sits under. */
  contextLength: number | null;
  blockCount: number | null;
  headCountKv: number | null;
}

/**
 * The profile persisted with a run: every field that reaches llama-server.
 *
 * Schema 1 kept six of these. The omitted ones are exactly the ones that explain
 * a bad score - `gpuLayers` short of the model's layer count silently runs part
 * of it on the CPU, `parallelSlots` splits the context between slots so the
 * effective window is a fraction of `contextSize`, and `extraArgs` can override
 * anything above. Schema 3 added the settings that landed after the setup-capture
 * change - `preserveReasoning`, `contextMultiplier`, `cachedChats`, the sampler
 * values, and the hosting-profile identity - so the record keeps tracking the
 * profile instead of silently stopping at the field set it was born with.
 */
export interface RecordProfile {
  contextSize: number;
  cacheTypeK: string;
  cacheTypeV: string;
  reasoningBudget: number;
  reasoningBudgetMessage: string | null;
  vision: boolean;
  flashAttention: boolean;
  gpuLayers: number | null;
  parallelSlots: number | null;
  batchSize: number | null;
  ubatchSize: number | null;
  extraArgs: string[];
  /**
   * Schema 3+. Absent on schema 2 records, which predate the setting.
   * Tri-state: true/false as chosen, null for "the template's own default".
   */
  preserveReasoning: boolean | null;
  /** Schema 3+. RoPE extension factor; 1 is the GGUF-native window. */
  contextMultiplier: number;
  /** Schema 3+. Chats parked in system RAM; 0 leaves llama.cpp's default. */
  cachedChats: number;
  /** Schema 3+. The sampler the run was served with, server-level for every task. */
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  minP: number | null;
  presencePenalty: number | null;
  repeatPenalty: number | null;
  /**
   * Schema 3+. The Brain-owned hosting profile in effect (id, not text): its
   * chat template and system-prompt addendum change what the model is asked
   * to do, so a run under one profile is not comparable to one under another.
   */
  hostingProfileId: string | null;
}

/**
 * How the run was actually set up, as opposed to how it was configured.
 *
 * The gap between the two is where bad scores come from. `fitToBudget` will cut
 * a profile's context down to whatever fits the GPU and run anyway, which is the
 * right call at load time and a silent lie afterwards: the record would say the
 * model scored 41% at 128k context when it was really measured at 16k. Same for
 * the KV budget - a context chosen off the theoretical formula (which
 * overestimates by up to 4x) is a different measurement from one chosen off a
 * calibration, even when the numbers land in the same place.
 */
export interface RecordSetup {
  /**
   * The exact llama-server argv this run was served with. Every other field
   * here is a convenience; this one is the ground truth, and it is what makes a
   * run reproducible by hand.
   */
  args: string[] | null;
  /** True when the VRAM fit had to change the profile for the run to happen. */
  adjusted: boolean;
  /** The context the profile asked for, before any fit adjustment. */
  requestedContextSize: number | null;
  /** Why the fit changed the profile, in the fitter's own words. */
  adjustReason: string | null;
  /** Where the KV bytes/token came from. `theoretical` means nobody measured. */
  kvSource: "measured" | "theoretical" | "unknown" | null;
  /**
   * True when the calibration came from a relative with the same attention
   * geometry rather than from this file. Never present it as measured.
   */
  kvInherited: boolean;
  kvBytesPerToken: number | null;
  /** The formula's answer, kept beside the measured one to expose the gap. */
  theoreticalKvBytesPerToken: number | null;
  /** What the budget predicted the run would take, against `vramBytes` observed. */
  predictedVramBytes: number | null;
  reserveBytes: number | null;
  headroomBytes: number | null;
}

/**
 * Which suite graded the run.
 *
 * Two runs scored on different task sets are not comparable, and neither are a
 * run that was allowed to execute generated code and one that was only allowed
 * to syntax-check it. `configKey` deliberately does not include any of this (see
 * `configKey()` below), so it is recorded here instead of silently merging
 * unlike runs into one group.
 */
export interface RecordSuite {
  /** False when `--no-execute` limited grading to a syntax check. */
  execute: boolean | null;
  concurrency: number | null;
  /** Prompt depths for the depth-scaling task, when overridden. */
  depths: number[] | null;
  /** Task ids the run was restricted to (`--only`), when restricted. */
  only: string[] | null;
  /** True when the static suite was replaced by tasks mined from a repo. */
  mined: boolean;
}

/** The GPU identity persisted with a run. */
export interface RecordGpu {
  name: string;
  totalBytes: number;
  driver: string;
}

/** One task's score persisted with a run. */
export interface RecordTask {
  id: string;
  category: string;
  weight: number;
  score: number;
  summary: string;
  seconds: number;
  detail: unknown;
  error: string | null;
}

/**
 * One stored benchmark run - the shared shape used across results and report.
 *
 * `schema` is 3 as of the profile-completeness change: 3 carries every profile
 * field that reaches llama-server, including the sampler values and the hosting
 * profile; 2 carried the profile as of the setup-capture change plus `setup`
 * and `suite`; 1 carried six profile fields and neither. Readers must treat
 * everything added after a record's schema as absent rather than assuming it,
 * because those runs are still perfectly good scores - they just cannot say
 * what they were measured with.
 */
export interface RunRecord {
  schema: number;
  ranAt: string;
  model: RecordModel;
  profile: RecordProfile | null;
  /** Schema 2+. Absent on runs saved before setup capture. */
  setup: RecordSetup | null;
  /** Schema 2+. Absent on runs saved before setup capture. */
  suite: RecordSuite | null;
  configKey: string;
  archiveId: string | null;
  gpu: RecordGpu | null;
  system: SystemHealth | null;
  runtime: string | null;
  overall: number;
  grade: string;
  seconds: number;
  executedCode: boolean;
  vramBytes: number | null;
  loadSeconds: number | null;
  tasks: RecordTask[];
  // Added by loadAll (the on-disk filename) and grouped (run ordering).
  file?: string;
  runIndex?: number;
}

/**
 * Arguments to `save`.
 *
 * Everything past `report` is optional so a caller that cannot supply it still
 * writes a usable record - but every caller that CAN should, because a run saved
 * without its setup is a score nobody can explain later.
 */
export interface SaveOptions {
  model: Model | null;
  /** The profile the run was actually served with (post-fit, not as configured). */
  profile: Profile | null;
  report: BenchReport;
  gpu?: GpuInfo | null;
  runtime?: string | null;
  archiveId?: string | null;
  system?: SystemHealth | null;
  /** The argv the supervisor launched, straight from `Supervisor.args`. */
  args?: string[] | null;
  /** The VRAM fit that produced `profile`, including what it had to change. */
  fit?: FitResult | null;
  /** The calibration the fit was computed against, if there was one. */
  calibration?: Calibration | null;
  suite?: Partial<RecordSuite> | null;
  timestamp?: Date;
}

/** Result of `save`: the written file path plus the persisted record. */
export interface SaveResult {
  file: string;
  record: RunRecord;
}

/** count / mean / sample-std / min / max of a numeric series. */
export interface Stats {
  count: number;
  mean: number;
  std: number;
  min: number;
  max: number;
}

/** A model+config grouping of runs. */
export interface Group {
  key: string;
  model: RecordModel;
  configKey: string;
  runs: RunRecord[];
  count: number;
}

/** Per-task variance stats within a group (category plus optional stats). */
export interface VarianceTask {
  category: string;
  count?: number;
  mean?: number;
  std?: number;
  min?: number;
  max?: number;
}

/** Per-config spread of overall and per-task scores across repeated runs. */
export interface VarianceRow {
  key: string;
  model: RecordModel;
  configKey: string;
  count: number;
  overall: Stats | null;
  tasks: Record<string, VarianceTask>;
}

/** One ranked entry per model, scored by the mean of its runs. */
export interface RankedModel {
  id: string | null;
  displayName: string;
  overall: number;
  runs: number;
  std: number;
  grade: string;
  rank?: number;
}

/** A task column: an id paired with its display category. */
export interface TaskColumn {
  id: string;
  category: string;
}

function slugify(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * llama.cpp's own sampler defaults, the values an untouched profile stores
 * verbatim (see `ProfileSchema`). A key token is only emitted when the profile
 * deviates from these, which is what makes an untouched profile keep its
 * historical key after the widening.
 */
const ENGINE_SAMPLER_DEFAULTS = {
  temperature: 0.8,
  topP: 0.95,
  topK: 40,
  minP: 0.05,
  presencePenalty: 0,
  repeatPenalty: 1,
} as const;

/**
 * Stable identity for "same model, same settings", so reruns can be grouped.
 *
 * The base four tokens predate the record and are never rewritten - a stored
 * run's key is its key, and re-deriving the same string for the same setup is
 * what lets old runs stay in their old groups. The tokens added in schema 3 are
 * appended ONLY when they deviate from the engine default, because that is what
 * the key means: the effective configuration, and a default is the historical
 * configuration. An untouched profile therefore keeps exactly the key it had
 * before the setting existed, so variance figures for unchanged setups survive
 * the widening; a run that differs only in, say, `contextMultiplier` gets a
 * new key instead of silently merging into its predecessor's group and
 * contaminating that group's consistency line.
 */
function configKey(profile: Profile | null): string {
  if (!profile) return "unknown";
  const parts = [
    `ctx${profile.contextSize}`,
    `kv${profile.cacheTypeK}-${profile.cacheTypeV}`,
    `rb${profile.reasoningBudget}`,
    profile.vision ? "vision" : "novision",
  ];
  if (profile.contextMultiplier !== undefined && profile.contextMultiplier > 1) {
    parts.push(`x${profile.contextMultiplier}`);
  }
  if (profile.cachedChats !== undefined && profile.cachedChats > 0) {
    parts.push(`cc${profile.cachedChats}`);
  }
  if (profile.preserveReasoning === true) parts.push("pr");
  else if (profile.preserveReasoning === false) parts.push("nopr");
  // The sampler deviates from the engine default only when the user set it -
  // an untouched profile stores llama.cpp's own defaults verbatim, and those
  // are the default, so they carry no token. Each entry pairs the short token
  // name with the `ENGINE_SAMPLER_DEFAULTS` key the default is looked up by -
  // the two deliberately differ, so conflating them would emit every sampler
  // value on every key.
  const sampler: Array<[string, number | undefined, keyof typeof ENGINE_SAMPLER_DEFAULTS]> = [
    ["temp", profile.temperature, "temperature"],
    ["p", profile.topP, "topP"],
    ["k", profile.topK, "topK"],
    ["minp", profile.minP, "minP"],
    ["pres", profile.presencePenalty, "presencePenalty"],
    ["rep", profile.repeatPenalty, "repeatPenalty"],
  ];
  for (const [name, value, defaultKey] of sampler) {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value !== ENGINE_SAMPLER_DEFAULTS[defaultKey]
    ) {
      parts.push(`${name}${value}`);
    }
  }
  if (profile.hostingProfileId) parts.push(`hp${profile.hostingProfileId}`);
  return parts.join("_");
}

/** Read a numeric GGUF metadata field, which is `null` when the header lacked it. */
function metadataNumber(model: Model | null, key: string): number | null {
  const value = model?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fold the fit and the calibration into the record's setup block.
 *
 * `fit.profile` is the profile that actually ran, so the requested context has
 * to be read from what the fit was HANDED, not from what it returned - by the
 * time `save` sees a profile, the adjustment has already been applied and is
 * invisible.
 */
function buildSetup({
  args,
  fit,
  calibration,
}: Pick<SaveOptions, "args" | "fit" | "calibration">): RecordSetup | null {
  if (!args && !fit && !calibration) {
    return null;
  }
  const budget = fit?.budget ?? null;
  return {
    args: args ?? null,
    adjusted: fit?.adjusted ?? false,
    requestedContextSize: fit?.requestedContextSize ?? null,
    adjustReason: fit?.reason ?? null,
    kvSource: budget?.source ?? null,
    kvInherited: calibration?.inherited === true,
    kvBytesPerToken: budget?.kvBytesPerToken ?? null,
    theoreticalKvBytesPerToken: budget?.theoreticalKvBytesPerToken ?? null,
    predictedVramBytes: budget?.totalBytes ?? null,
    reserveBytes: budget?.reserveBytes ?? null,
    headroomBytes: budget?.headroomBytes ?? null,
  };
}

function save({
  model,
  profile,
  report,
  gpu = null,
  runtime = null,
  archiveId = null,
  system = null,
  args = null,
  fit = null,
  calibration = null,
  suite = null,
  timestamp = new Date(),
}: SaveOptions): SaveResult {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const record: RunRecord = {
    schema: 3,
    ranAt: timestamp.toISOString(),
    model: {
      id: model?.id ?? null,
      displayName: model?.displayName ?? "unknown",
      quant: model?.quant ?? null,
      arch: model?.metadata?.arch ?? null,
      sizeBytes: model?.sizeBytes ?? null,
      publisher: model?.publisher ?? null,
      features: model?.features ?? null,
      contextLength: metadataNumber(model, "contextLength"),
      blockCount: metadataNumber(model, "blockCount"),
      headCountKv: metadataNumber(model, "headCountKv"),
    },
    // The whole profile, not a summary of it. `ProfileSchema` is `.passthrough()`
    // and its numeric fields carry defaults, so read them defensively: a profile
    // written by an older brain can be missing anything below `vision`, and a
    // schema-1-era profile can be missing the sampler values entirely (they
    // were implicit in llama.cpp then).
    profile: profile
      ? {
          contextSize: profile.contextSize,
          cacheTypeK: profile.cacheTypeK,
          cacheTypeV: profile.cacheTypeV,
          reasoningBudget: profile.reasoningBudget,
          reasoningBudgetMessage: profile.reasoningBudgetMessage ?? null,
          vision: profile.vision,
          flashAttention: profile.flashAttention,
          gpuLayers: profile.gpuLayers ?? null,
          parallelSlots: profile.parallelSlots ?? null,
          batchSize: profile.batchSize ?? null,
          ubatchSize: profile.ubatchSize ?? null,
          extraArgs: profile.extraArgs ?? [],
          preserveReasoning: profile.preserveReasoning ?? null,
          contextMultiplier: profile.contextMultiplier ?? 1,
          cachedChats: profile.cachedChats ?? 0,
          temperature: profile.temperature ?? null,
          topP: profile.topP ?? null,
          topK: profile.topK ?? null,
          minP: profile.minP ?? null,
          presencePenalty: profile.presencePenalty ?? null,
          repeatPenalty: profile.repeatPenalty ?? null,
          hostingProfileId: profile.hostingProfileId ?? null,
        }
      : null,
    setup: buildSetup({ args, fit, calibration }),
    suite: suite
      ? {
          execute: suite.execute ?? null,
          concurrency: suite.concurrency ?? null,
          depths: suite.depths ?? null,
          only: suite.only ?? null,
          mined: suite.mined ?? false,
        }
      : null,
    configKey: configKey(profile),
    // Links this result to its stored transcripts so `rescore` can re-grade it.
    archiveId: archiveId ?? report.archiveId ?? null,
    gpu: gpu ? { name: gpu.name, totalBytes: gpu.totalBytes, driver: gpu.driver } : null,
    // System health sampled during the run, so a score can be read against the
    // machine state that produced it (throttling, power cap, VRAM pressure).
    system: system ?? report.system ?? null,
    runtime,
    overall: report.overall,
    grade: report.grade,
    seconds: report.seconds,
    executedCode: report.executedCode,
    vramBytes: report.vramBytes ?? null,
    loadSeconds: report.loadSeconds ?? null,
    tasks: report.results.map((r) => ({
      id: r.id,
      category: r.category,
      weight: r.weight,
      score: r.score,
      summary: r.summary,
      seconds: r.seconds,
      detail: r.detail ?? null,
      error: r.error ?? null,
    })),
  };

  const stamp = record.ranAt.replace(/[:.]/g, "-");
  const file = path.join(RESULTS_DIR, `${stamp}_${slugify(record.model.displayName)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { file, record };
}

/** Every stored run, newest first. */
function loadAll(): RunRecord[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f): RunRecord | null => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8")) as RunRecord;
        return { ...record, file: f };
      } catch {
        return null;
      }
    })
    .filter((r): r is RunRecord => Boolean(r))
    .sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
}

/**
 * Collapse history to the most recent run per model+config, which is what you
 * want when comparing: earlier runs of the same setup are superseded.
 */
function latestPerConfig(records: RunRecord[] = loadAll()): RunRecord[] {
  const best = new Map<string, RunRecord>();
  for (const record of records) {
    const key = `${record.model.displayName}::${record.configKey}`;
    if (!best.has(key)) best.set(key, record);
  }
  return [...best.values()].sort((a, b) => b.overall - a.overall);
}

/**
 * Group every run by model+config (all runs kept, not just the latest), and
 * number them oldest→newest so a run can be plotted against run number. Wall
 * time is deliberately not the axis - only how many times we have measured it.
 */
function grouped(records: RunRecord[] = loadAll()): Group[] {
  const groups = new Map<string, Group>();
  for (const record of records) {
    const key = `${record.model.displayName}::${record.configKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, model: record.model, configKey: record.configKey, runs: [], count: 0 };
      groups.set(key, group);
    }
    group.runs.push(record);
  }
  for (const group of groups.values()) {
    // loadAll is newest-first; number oldest→newest for a left-to-right x-axis.
    [...group.runs].reverse().forEach((run, i) => {
      run.runIndex = i + 1;
    });
    group.count = group.runs.length;
  }
  return [...groups.values()];
}

/** count / mean / sample-std / min / max of a numeric series. */
function stats(values: Array<number | undefined>): Stats | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const varc =
    nums.length > 1 ? nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1) : 0;
  return {
    count: nums.length,
    mean,
    std: Math.sqrt(varc),
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

/**
 * Per-config spread of overall and per-task scores across repeated runs - the
 * measure of whether the benchmark method is itself consistent.
 */
function variance(records: RunRecord[] = loadAll()): VarianceRow[] {
  return grouped(records)
    .map((group): VarianceRow => {
      const overall = stats(group.runs.map((r) => r.overall));
      const taskMeta = new Map<string, string>();
      for (const run of group.runs) {
        for (const task of run.tasks)
          if (!taskMeta.has(task.id)) taskMeta.set(task.id, task.category);
      }
      const tasks: Record<string, VarianceTask> = {};
      for (const [id, category] of taskMeta) {
        tasks[id] = {
          category,
          ...stats(group.runs.map((r) => r.tasks.find((t) => t.id === id)?.score)),
        };
      }
      return {
        key: group.key,
        model: group.model,
        configKey: group.configKey,
        count: group.count,
        overall,
        tasks,
      };
    })
    .sort((a, b) => (b.overall?.mean ?? 0) - (a.overall?.mean ?? 0));
}

function gradeFor(score: number): string {
  if (score >= 0.9) return "excellent";
  if (score >= 0.75) return "strong";
  if (score >= 0.55) return "usable";
  if (score >= 0.35) return "weak";
  return "unusable";
}

/**
 * One ranked entry per model, scored by the MEAN of all its runs (so a single
 * noisy or throttled run cannot set a model's rank), best first. `runs` and
 * `std` travel with it so the app can show how well-backed a ranking is.
 */
function rankModels(records: RunRecord[] = loadAll()): RankedModel[] {
  const byModel = new Map<string, { id: string | null; displayName: string; scores: number[] }>();
  for (const record of records) {
    const key = record.model.id || record.model.displayName;
    if (!byModel.has(key)) {
      byModel.set(key, {
        id: record.model.id ?? null,
        displayName: record.model.displayName,
        scores: [],
      });
    }
    byModel.get(key)?.scores.push(record.overall);
  }
  const ranked: RankedModel[] = [...byModel.values()]
    .map((m) => {
      const s = stats(m.scores) ?? { count: 0, mean: 0, std: 0, min: 0, max: 0 };
      return {
        id: m.id,
        displayName: m.displayName,
        overall: s.mean,
        runs: s.count,
        std: s.std,
        grade: gradeFor(s.mean),
      };
    })
    .sort((a, b) => b.overall - a.overall);
  ranked.forEach((m, i) => {
    m.rank = i + 1;
  });
  return ranked;
}

/** All task ids seen across a set of records, in a stable order. */
function taskColumns(records: RunRecord[]): TaskColumn[] {
  const seen = new Map<string, string>();
  for (const record of records) {
    for (const task of record.tasks) {
      if (!seen.has(task.id)) seen.set(task.id, task.category);
    }
  }
  return [...seen.entries()].map(([id, category]) => ({ id, category }));
}

export {
  RESULTS_DIR,
  resolveResultsDir,
  save,
  loadAll,
  latestPerConfig,
  grouped,
  variance,
  stats,
  rankModels,
  taskColumns,
  configKey,
  slugify,
  ENGINE_SAMPLER_DEFAULTS,
};
