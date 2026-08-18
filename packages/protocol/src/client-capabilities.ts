export const CLIENT_CAPS = {
  // COMPAT(selectiveAgentTimeline): added in v0.1.106. Capable clients receive
  // agent streams only for their explicit viewed set. Remove after 2027-01-12
  // once the supported client floor is >= v0.1.106.
  selectiveAgentTimeline: "selective_agent_timeline",
  reasoningMergeEnum: "reasoning_merge_enum",
  // COMPAT(customModeIcons): added in v0.1.84. Old clients pin AgentModeIcon to
  // a closed enum and crash rendering unknown values; daemon downgrades icons
  // outside the legacy set to "ShieldCheck" when this cap is absent. Drop the
  // gate when floor >= v0.1.84.
  customModeIcons: "custom_mode_icons",
  // COMPAT(terminalReflowableSnapshot): added in v0.1.88. The daemon attaches
  // per-row soft-wrap flags (gridWrapped/scrollbackWrapped) to terminal snapshots
  // only when the client advertises this, so restored content can reflow on resize.
  // Old clients use a strict TerminalState schema and would reject the extra fields.
  // Drop the gate (always send the flags) when floor >= v0.1.88.
  terminalReflowableSnapshot: "terminal_reflowable_snapshot",
  // COMPAT(providerSubagents): added in v0.1.107. The daemon emits provider-owned
  // child descriptors and timelines only to clients that understand the new messages.
  providerSubagents: "provider_subagents",
  // COMPAT(projectUpdates): added in v0.1.109, remove gate after 2027-01-15.
  projectUpdates: "project_updates",
  // COMPAT(communicationsPresenceUpdates): added in v0.8.12, remove gate after
  // 2027-02-14. Older clients do not know the presence-change notification, so
  // the daemon sends it only after this capability is advertised.
  communicationsPresenceUpdates: "communications_presence_updates",
  // COMPAT(brainLogWatch): added in v0.8.13, remove gate after 2027-02-17.
  // Brain log lines are pushed only to sockets that asked for them. A client
  // advertising this defaults to NOT watching and turns the feed on when the
  // Logs tab opens; a client without it keeps the old unconditional feed,
  // because it has no way to ask and would otherwise lose live logs entirely.
  brainLogWatch: "brain_log_watch",
  browserHost: "browser_host",
} as const;

export type ClientCapability = (typeof CLIENT_CAPS)[keyof typeof CLIENT_CAPS];
