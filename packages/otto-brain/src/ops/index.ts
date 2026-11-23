/** Explicit, host-owned operations. Importing these APIs never starts work. */
export * from "./calibrate.js";
export * from "./sweep.js";
export * from "./process.js";
export * as benchmarkResults from "./results.js";
export * as benchmarkReports from "./report.js";
export * as transcriptArchive from "./archive.js";
export * as benchmarkHealth from "../bench/health.js";
export {
  runSuite,
  formatReport,
  grade,
  type RunSuiteOptions,
  type SuiteReport,
  type ProgressEvent,
} from "../bench/index.js";
export {
  rescoreRun,
  rescoreAll,
  type RescoreOptions,
  type RescoreRunResult,
} from "../bench/rescore.js";
export {
  loadRepoTasks,
  type LoadRepoTasksOptions,
  type LoadedRepoTasks,
} from "../bench/repo-task.js";
export { createBrainRunLog, type BrainRunLog } from "../service/run-log.js";
export {
  SlotActivityTracker,
  createCpuSampler,
  slots as sampleSlots,
  sample as sampleSystem,
  type SlotInfo,
  type SystemSample,
} from "../sysmon.js";
