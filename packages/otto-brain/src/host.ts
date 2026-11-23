/** Inert public host/controller entry; only explicit calls resolve a home or launch work. */
export {
  BrainStartup,
  type BrainStartupPorts,
  type BrainStartupResult,
} from "./controller/startup.js";
export {
  BrainController,
  createBrainController,
  type BrainControllerPorts,
  type BrainControllerTransport,
} from "./controller/controller.js";
export {
  BrainConnectionStore,
  BrainConnectionError,
  type BrainConnectionSave,
  type BrainConnectionIntent,
} from "./controller/connection-store.js";
export * from "./service/serve.js";
export { HostEngine, createHostRuntime, type HostEnginePorts } from "./service/engine.js";
export { startLocalBrain, stopLocalBrain, type LocalBrainState } from "./service/lifecycle.js";
export { readPidFile, isProcessAlive } from "./service/pid-lock.js";
export {
  localBrainRequest,
  localBrainEvents,
  localBrainClient,
  type LocalBrainClientOptions,
} from "./service/local-client.js";
export { remoteBrainClient, type RemoteBrainClientOptions } from "./service/remote-client.js";
export { BrainHttpClient, BrainHttpResponseError } from "./service/host-http-client.js";
export type { BrainHostEvent } from "./service/event-decoder.js";
export {
  BrainStatusStore,
  type BrainStatusSource,
  type BrainStatusSnapshot,
  type BrainStatusLog,
} from "./client/status-store.js";
export {
  brainStatusSource,
  localBrainStatusSource,
  type BrainStatusTransport,
} from "./client/status-source.js";
export { BrainOwnerSettings, type BrainOwnerSettingsRead } from "./service/owner-settings.js";
export {
  OwnerSettingsSaveSchema,
  OwnerSettingsGenerateSchema,
  OwnerSettingsError,
  type OwnerSettingsSave,
  type OwnerCredentialIntent,
} from "./service/owner-settings-contract.js";
export {
  followBrainJob,
  localJobTransport,
  type BrainJobStatus,
  type BrainJobTransport,
} from "./service/job-client.js";
