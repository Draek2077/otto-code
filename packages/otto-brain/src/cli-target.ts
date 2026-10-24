/** Node-only ports shared by the Otto CLI adapter and its owning daemon. Importing is inert. */
export { withBrainCommandHost } from "./commands/target.js";
export type { HostCommandPort } from "./commands/host-command.js";
export {
  BrainCommandRequestSchema,
  brainCommandHttpRequest,
  encodeBrainCommandRequest,
  type BrainCommandRequest,
} from "./commands/requests.js";
export type { BrainHostEvent } from "./service/event-decoder.js";
