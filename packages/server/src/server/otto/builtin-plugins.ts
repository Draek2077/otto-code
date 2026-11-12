// Otto-owned providers use Paseo's public plugin contract, not private agent adapters.
export const ottoBuiltinPlugins = [
  "otto-openai-compatible-provider",
  "otto-brain",
  "otto-kanban",
  "otto-integrations",
  "otto-project-knowledge",
  "otto-browser",
  "otto-artifacts",
  "otto-architectural-views",
  "otto-visualizer",
  "otto-speech",
  "otto-terminal",
  "otto-editor",
  "otto-workflows",
  "otto-schedules",
] as const;

/** Essential daemon routes are reserved identities, without a plugin module/worker to load. */
const ottoHostRpcIds = ["otto-workspace-git"] as const;
export function withOttoHostRpcIds(pluginIds: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...pluginIds, ...ottoHostRpcIds]);
}
