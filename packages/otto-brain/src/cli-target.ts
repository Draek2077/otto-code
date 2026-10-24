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
export { withBrainSettingsTarget } from "./commands/settings-target.js";
export type {
  BrainSettingsCommandTarget,
  BrainConfigCommandResult,
} from "./commands/settings-target.js";
export {
  applyConfigKey,
  selectedConfigValue,
  parseConfigBoolean,
} from "./commands/config-values.js";
export { OwnerSettingsSaveSchema } from "./service/owner-settings-contract.js";
export { OwnerShareRequestSchema } from "./commands/share-contract.js";
export { sharingStatus, hasShareChange } from "./commands/share-policy.js";
