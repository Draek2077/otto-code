/** Inert public host/controller entry; only explicit calls resolve a home or launch work. */
export * from "./service/serve.js";
export { HostEngine, createHostRuntime, type HostEnginePorts } from "./service/engine.js";
export { startLocalBrain, stopLocalBrain, type LocalBrainState } from "./service/lifecycle.js";
export {
  localBrainRequest,
  localBrainEvents,
  type LocalBrainClientOptions,
} from "./service/local-client.js";
export type { BrainHostEvent } from "./service/event-decoder.js";
export {
  followBrainJob,
  localJobTransport,
  type BrainJobStatus,
  type BrainJobTransport,
} from "./service/job-client.js";
