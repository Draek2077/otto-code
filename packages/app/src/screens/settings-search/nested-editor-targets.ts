/** Semantic destinations only: callers mount an editor after the user chooses its entity. */
export const PERSONALITY_SETTINGS_TABS = {
  "host-teams-identity-name": "identity",
  "host-teams-identity-roles": "identity",
  "host-teams-identity-appearance": "identity",
  "host-teams-identity-glow-a": "identity",
  "host-teams-identity-glow-b": "identity",
  "host-teams-personality-personality-prompt": "personality",
  "host-teams-personality-notes": "personality",
  "host-teams-personality-respect-global-append-prompt": "personality",
  "host-teams-personality-remember-lessons": "personality",
  "host-teams-personality-generate-with-ai": "personality",
  "host-teams-model-provider": "model",
  "host-teams-model-model": "model",
  "host-teams-model-mode": "model",
  "host-teams-model-effort": "model",
  "host-teams-model-provider-feature-override": "model",
  "host-teams-voice-voice": "voice",
  "host-teams-voice-starting-cue-lines": "voice",
  "host-teams-voice-thinking-cue-lines": "voice",
  "host-teams-voice-waiting-cue-lines": "voice",
  "host-teams-voice-completed-cue-lines": "voice",
  "host-teams-voice-generate-cues-with-ai": "voice",
} as const;
export const PERSONALITY_SETTINGS_TARGETS = Object.keys(PERSONALITY_SETTINGS_TABS);

export const TEAM_SETTINGS_TABS = {
  "host-teams-identity-name-2": "identity",
  "host-teams-identity-team-prompt": "identity",
  "host-teams-appearance-team-color": "appearance",
  "host-teams-members-team-member": "members",
} as const;
export const TEAM_SETTINGS_TARGETS = Object.keys(TEAM_SETTINGS_TABS);

export const PROVIDER_SETTINGS_TABS = {
  "host-providers-models-add-model": "models",
  "host-providers-models-diagnostics": "models",
  "host-providers-models-hide-all": "models",
  "host-providers-models-model-tier": "models",
  "host-providers-models-model-visibility": "models",
  "host-providers-models-refresh-models": "models",
  "host-providers-models-remove-model": "models",
  "host-providers-models-show-all": "models",
  "host-providers-connection-api-key": "connection",
  "host-providers-connection-forget-saved-endpoint": "connection",
  "host-providers-connection-server-url": "connection",
  "host-providers-agents-action-breaker-threshold": "agents",
  "host-providers-agents-action-breaker": "agents",
  "host-providers-agents-default-auto-compact": "agents",
  "host-providers-agents-max-tool-call-rounds-per-turn": "agents",
  "host-providers-agents-mid-session-context-updates": "agents",
  "host-providers-agents-show-selector": "agents",
  "host-providers-tools-agents": "tools",
  "host-providers-tools-artifacts": "tools",
  "host-providers-tools-browser": "tools",
  "host-providers-tools-memory": "tools",
  "host-providers-tools-orchestration": "tools",
  "host-providers-tools-permissions": "tools",
  "host-providers-tools-preview": "tools",
  "host-providers-tools-project-knowledge": "tools",
  "host-providers-tools-providers-and-models": "tools",
  "host-providers-tools-schedules": "tools",
  "host-providers-tools-suggested-tasks": "tools",
  "host-providers-tools-terminals": "tools",
  "host-providers-tools-voice": "tools",
  "host-providers-tools-web": "tools",
  "host-providers-tools-widgets": "tools",
  "host-providers-tools-workspace": "tools",
} as const;
export const PROVIDER_SETTINGS_TARGETS = Object.keys(PROVIDER_SETTINGS_TABS);

export function settingsEditorTab<T extends string>(
  mapping: Readonly<Record<string, T>>,
  settingId: string | null,
): T | null {
  return settingId !== null && Object.hasOwn(mapping, settingId)
    ? (mapping[settingId] ?? null)
    : null;
}

export const CONNECTOR_CATALOG_TARGETS: Readonly<Record<string, string>> = {
  ahrefs: "host-connectors-connector-catalog-ahrefs",
  airtable: "host-connectors-connector-catalog-airtable",
  asana: "host-connectors-connector-catalog-asana",
  box: "host-connectors-connector-catalog-box",
  canva: "host-connectors-connector-catalog-canva",
  clickup: "host-connectors-connector-catalog-clickup",
  cloudflare: "host-connectors-connector-catalog-cloudflare",
  deepwiki: "host-connectors-connector-catalog-deepwiki",
  dropbox: "host-connectors-connector-catalog-dropbox",
  figma: "host-connectors-connector-catalog-figma",
  github: "host-connectors-connector-catalog-github",
  hubspot: "host-connectors-connector-catalog-hubspot",
  intercom: "host-connectors-connector-catalog-intercom",
  atlassian: "host-connectors-connector-catalog-jira-confluence",
  linear: "host-connectors-connector-catalog-linear",
  filesystem: "host-connectors-connector-catalog-local-files",
  monday: "host-connectors-connector-catalog-monday-com",
  netlify: "host-connectors-connector-catalog-netlify",
  notion: "host-connectors-connector-catalog-notion",
  memory: "host-connectors-connector-catalog-persistent-memory",
  sentry: "host-connectors-connector-catalog-sentry",
  slack: "host-connectors-connector-catalog-slack",
  square: "host-connectors-connector-catalog-square",
  stripe: "host-connectors-connector-catalog-stripe",
  supabase: "host-connectors-connector-catalog-supabase",
  trello: "host-connectors-connector-catalog-trello",
  vercel: "host-connectors-connector-catalog-vercel",
  webflow: "host-connectors-connector-catalog-webflow",
};
export const CONNECTOR_PICKER_TARGETS = [
  ...Object.values(CONNECTOR_CATALOG_TARGETS),
  "host-connectors-connectors-catalog-connector",
  "host-connectors-connectors-custom-connector",
  ...["name", "transport", "command", "url", "token"].map(
    (field) => `host-connectors-connector-editor-${field}`,
  ),
];
