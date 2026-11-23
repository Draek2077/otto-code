import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";

export function claudePromptSuggestionsEnabled(input: {
  configured: boolean | undefined;
  environment: string | undefined;
  ordinaryChat: boolean;
}): boolean {
  if (!input.ordinaryChat || input.environment?.trim().toLowerCase() === "false") return false;
  return input.configured ?? true;
}

export function toClaudePromptSuggestion(text: string): AgentStreamEvent | null {
  const suggestion = text.trim();
  if (!suggestion || suggestion.length > 4096) return null;
  return { type: "prompt_suggestion", provider: "claude", suggestion };
}
