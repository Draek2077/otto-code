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
  "host-providers-tools-enable-otto-tools": "tools",
  "host-providers-tools-disabled-tools": "tools",
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
  ahrefs: "host-tools-connector-catalog-ahrefs",
  airtable: "host-tools-connector-catalog-airtable",
  asana: "host-tools-connector-catalog-asana",
  box: "host-tools-connector-catalog-box",
  canva: "host-tools-connector-catalog-canva",
  clickup: "host-tools-connector-catalog-clickup",
  cloudflare: "host-tools-connector-catalog-cloudflare",
  deepwiki: "host-tools-connector-catalog-deepwiki",
  dropbox: "host-tools-connector-catalog-dropbox",
  figma: "host-tools-connector-catalog-figma",
  github: "host-tools-connector-catalog-github",
  hubspot: "host-tools-connector-catalog-hubspot",
  intercom: "host-tools-connector-catalog-intercom",
  atlassian: "host-tools-connector-catalog-jira-confluence",
  linear: "host-tools-connector-catalog-linear",
  filesystem: "host-tools-connector-catalog-local-files",
  monday: "host-tools-connector-catalog-monday-com",
  netlify: "host-tools-connector-catalog-netlify",
  notion: "host-tools-connector-catalog-notion",
  memory: "host-tools-connector-catalog-persistent-memory",
  sentry: "host-tools-connector-catalog-sentry",
  slack: "host-tools-connector-catalog-slack",
  square: "host-tools-connector-catalog-square",
  stripe: "host-tools-connector-catalog-stripe",
  supabase: "host-tools-connector-catalog-supabase",
  trello: "host-tools-connector-catalog-trello",
  vercel: "host-tools-connector-catalog-vercel",
  webflow: "host-tools-connector-catalog-webflow",
};
export const CONNECTOR_PICKER_TARGETS = [
  ...Object.values(CONNECTOR_CATALOG_TARGETS),
  "host-tools-connectors-catalog-connector",
  "host-tools-connectors-custom-connector",
  ...["name", "transport", "command", "url", "token"].map(
    (field) => `host-tools-connector-editor-${field}`,
  ),
];
