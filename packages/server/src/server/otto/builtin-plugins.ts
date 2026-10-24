// Otto-owned providers use Paseo's public plugin contract, not private agent adapters.
export const ottoBuiltinPlugins = [
  "otto-openai-compatible-provider",
  "otto-brain",
  "otto-kanban",
] as const;
