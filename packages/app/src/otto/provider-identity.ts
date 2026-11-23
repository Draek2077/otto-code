export const OTTO_OPENAI_PROVIDER_LABEL = "OpenAI Compatible API";

export function ottoProviderLabel(provider: string, label: string): string {
  return provider === "openai-compatible" ? OTTO_OPENAI_PROVIDER_LABEL : label;
}
