import type { AgentProviderNotice } from "./agent-sdk-types.js";

export const MODE_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Permission mode applies next turn",
};

export const THINKING_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Thinking level applies next turn",
};

// Otto's daemon-level system-prompt update lands on the next query rebuild.
// Distinct from the mode/thinking notices above: those name the setting the
// user just changed, this one covers a host-driven config change.
export const SETTING_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Setting applies next turn",
};
