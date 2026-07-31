/**
 * Library entry for @otto-code/brain. Exposes the command group (so the main
 * `otto` CLI can `program.addCommand(createBrainCommand())`), the service, runtime
 * resolution, model discovery, config, and shared types. The executable lives in
 * main.ts.
 */
export { createBrainCommand, registerBrainCommands } from "./cli.js";
export { startService, type ServiceHandle, type StartServiceOptions } from "./service/serve.js";
export {
  readRunningService,
  readPidFile,
  writePidFile,
  removePidFile,
  type PidRecord,
} from "./service/pid-lock.js";
export {
  resolveRuntime,
  ensureRuntime,
  listAllRuntimes,
  installManagedRuntime,
} from "./runtime/index.js";
export { scanModels, pickModel, pullModel } from "./models/index.js";
export * from "./config/index.js";
export type { Model, Runtime, GpuInfo, ModelMetadata, ModelFeatures } from "./types.js";
