import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { GpuInfo, Model, ModelFeatures } from "../types.js";
import type { Profile } from "../config/schema.js";

/**
 * Persistent benchmark history.
 *
 * One JSON file per run, so results accumulate across sessions and can be
 * compared and charted later. Runs record the configuration they were measured
 * under, because a score is meaningless without the quant, context size and
 * reasoning budget that produced it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const RESULTS_DIR = path.join(ROOT, "results");

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

/** The model identity persisted with a run. */
export interface RecordModel {
  id: string | null;
  displayName: string;
  quant: string | null;
  arch: string | null;
  sizeBytes: number | null;
  publisher: string | null;
  features: ModelFeatures | null;
}

/** The subset of a profile persisted with a run. */
export interface RecordProfile {
  contextSize: number;
  cacheTypeK: string;
  cacheTypeV: string;
  reasoningBudget: number;
  vision: boolean;
  flashAttention: boolean;
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

/** One stored benchmark run — the shared shape used across results and report. */
export interface RunRecord {
  schema: number;
  ranAt: string;
  model: RecordModel;
  profile: RecordProfile | null;
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

/** Arguments to `save`. */
export interface SaveOptions {
  model: Model | null;
  profile: Profile | null;
  report: BenchReport;
  gpu?: GpuInfo | null;
  runtime?: string | null;
  archiveId?: string | null;
  system?: SystemHealth | null;
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

/** Stable identity for "same model, same settings", so reruns can be grouped. */
function configKey(profile: Profile | null): string {
  if (!profile) return "unknown";
  return [
    `ctx${profile.contextSize}`,
    `kv${profile.cacheTypeK}-${profile.cacheTypeV}`,
    `rb${profile.reasoningBudget}`,
    profile.vision ? "vision" : "novision",
  ].join("_");
}

function save({
  model,
  profile,
  report,
  gpu = null,
  runtime = null,
  archiveId = null,
  system = null,
  timestamp = new Date(),
}: SaveOptions): SaveResult {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const record: RunRecord = {
    schema: 1,
    ranAt: timestamp.toISOString(),
    model: {
      id: model?.id ?? null,
      displayName: model?.displayName ?? "unknown",
      quant: model?.quant ?? null,
      arch: model?.metadata?.arch ?? null,
      sizeBytes: model?.sizeBytes ?? null,
      publisher: model?.publisher ?? null,
      features: model?.features ?? null,
    },
    profile: profile
      ? {
          contextSize: profile.contextSize,
          cacheTypeK: profile.cacheTypeK,
          cacheTypeV: profile.cacheTypeV,
          reasoningBudget: profile.reasoningBudget,
          vision: profile.vision,
          flashAttention: profile.flashAttention,
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
 * time is deliberately not the axis — only how many times we have measured it.
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
 * Per-config spread of overall and per-task scores across repeated runs — the
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
};
