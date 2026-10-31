// These entries are supplied by the host and remain external in author bundles.
export const PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS = [
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
  // OTTO(brain-ui): renderer injection, kept out of the general plugin graphics API.
  "@getpaseo/plugin/client/otto-brain",
  "@getpaseo/plugin/client/otto-knowledge", // OTTO(knowledge): app-owned Markdown/editor only.
  "@getpaseo/plugin/client/otto-preview", // OTTO(preview): trusted app-owned workspace controls.
  "@getpaseo/plugin/client/otto-artifacts", // OTTO(artifacts): app-owned isolated preview.
  "@getpaseo/plugin/client/otto-bitbucket", // OTTO(bitbucket): trusted built-in presentation and navigation.
  "@getpaseo/plugin/client/otto-connectors", // OTTO(connectors): app-owned Settings presentation.
  "@getpaseo/plugin/client/otto-speech", // OTTO(speech): trusted app-owned speech Settings presentation.
] as const;

const PLUGIN_SERVER_ONLY_SDK_SPECIFIERS = [
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
  // OTTO(provider-harness): full shared host-side agent/tool loop, never in client bundles.
  "@getpaseo/plugin/server/otto-openai",
  "@getpaseo/plugin/server/otto-brain",
  "@getpaseo/plugin/server/otto-kanban", // OTTO(kanban): injected host library, never client transport.
  "@getpaseo/plugin/server/otto-preview", // OTTO(preview): launch parser and provider approval stay Node-only.
  "@getpaseo/plugin/server/otto-browser", // OTTO(browser-host): shared snapshot/ref engine stays Node-only.
] as const;

export const PLUGIN_SDK_SPECIFIERS = [
  "@getpaseo/plugin",
  // OTTO(provider-harness): client-safe connection definitions, without Node imports.
  "@getpaseo/plugin/otto/openai-settings",
  "@getpaseo/plugin/otto/kanban", // OTTO(kanban): shared structural contracts only.
  "@getpaseo/plugin/otto/atlassian-settings", // OTTO(integration): account status/explicit write intents only.
  "@getpaseo/plugin/otto/bitbucket-connections", // OTTO(bitbucket): structural RPC contracts, no credentials returned.
  "@getpaseo/plugin/otto/project-knowledge", // OTTO(knowledge): client-safe scoped contracts.
  "@getpaseo/plugin/otto/preview", // OTTO(preview): structural requests and responses only.
  "@getpaseo/plugin/otto/artifacts", // OTTO(artifacts): structural library and mutation contracts.
  "@getpaseo/plugin/otto/connectors", // OTTO(connectors): catalog and sanitized RPC contracts only.
  "@getpaseo/plugin/otto/speech", // OTTO(speech): structural speech settings and bounded audio contracts.
  "@getpaseo/plugin/otto/host-browser", // OTTO(browser-host): scoped structural viewer contracts.
  ...PLUGIN_SERVER_ONLY_SDK_SPECIFIERS,
  ...PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS,
] as const;

export function isPluginClientOnlySdkSpecifier(name: string): boolean {
  return (PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS as readonly string[]).includes(name);
}

export function isPluginServerOnlySdkSpecifier(name: string): boolean {
  return (PLUGIN_SERVER_ONLY_SDK_SPECIFIERS as readonly string[]).includes(name);
}
