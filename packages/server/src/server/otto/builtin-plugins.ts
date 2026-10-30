// Otto-owned providers use Paseo's public plugin contract, not private agent adapters.
export const ottoBuiltinPlugins = [
  "otto-openai-compatible-provider",
  "otto-brain",
  "otto-kanban",
  "otto-integrations",
  "otto-project-knowledge",
  "otto-browser",
  "otto-artifacts",
] as const;
