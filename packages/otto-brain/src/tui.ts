/** Public terminal composition; importing it is passive and does not touch a TTY or home. */
export { BrainTuiClient, type BrainTuiClientPorts } from "./tui/client.js";
export {
  BrainTuiSnapshotSchema,
  BrainTuiJobsSchema,
  BrainTuiResourcesSchema,
} from "./tui/contracts.js";
export { BrainTuiLiveSchema, type BrainTuiLive } from "./tui/live.js";
export { performTuiAction, BrainTuiActionSchema, BrainTuiExecutionSchema } from "./tui/actions.js";
export { openBrainHttpTui, openLocalBrainTui } from "./client/tui-http.js";
export { runUiCommand, assertInteractiveTerminal } from "./commands/ui.js";
export type {
  BrainTuiHost,
  BrainTuiAction,
  BrainTuiSnapshot,
  BrainTuiResult,
  TuiProfile,
} from "./tui/host.js";
export { TuiActionError } from "./tui/host.js";
