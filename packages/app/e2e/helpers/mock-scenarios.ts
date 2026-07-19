import type { SeedDaemonClient } from "./seed-client";

/**
 * Prompt grammar for the mock provider's synthetic E2E scenarios. Keep these
 * builders in lockstep with the parsers in
 * packages/server/src/server/agent/providers/mock-load-test-agent.ts — the
 * prompts are the deterministic injection surface for stream events the mock
 * does not emit in its regular scripted cycle.
 */

/** Turn that emits a `prompt_suggestion` event (composer ghost text). */
export function buildPromptSuggestionScenarioPrompt(suggestion: string): string {
  return `emit a synthetic prompt suggestion "${suggestion}"`;
}

/** Turn that emits a `rate_limit_updated` event with a deterministic payload. */
export function buildRateLimitScenarioPrompt(status: "allowed" | "warning" | "rejected"): string {
  return `emit a synthetic rate limit ${status}`;
}

/** Turn whose assistant message is exactly the given markdown body. */
export function buildAssistantMarkdownScenarioPrompt(markdown: string): string {
  return `emit synthetic assistant markdown\n${markdown}`;
}

/** Turn that emits one completed tool call with the given raw tool name and an
 * `unknown` detail, so the UI's display-name humanizer renders the label. */
export function buildNamedToolCallScenarioPrompt(name: string): string {
  return `emit a synthetic tool call named "${name}"`;
}

/**
 * Mirror of the mock provider's deterministic AgentTitle derivation
 * (parseStructuredTitlePrompt): first three words of the chat's first prompt
 * line, quotes stripped, clamped to the 40-char schema ceiling.
 */
export function deriveMockAutoTitle(firstPromptLine: string): string {
  const title = firstPromptLine
    .replace(/["'`]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 40)
    .trim();
  return title || "Mock chat";
}

interface DaemonConfigCapableClient {
  patchDaemonConfig(config: {
    metadataGeneration?: {
      providers?: Array<{ provider: string; model?: string; thinkingOptionId?: string }>;
    };
  }): Promise<unknown>;
}

/**
 * Pin (or clear, with `[]`) the daemon's metadata-generation provider chain so
 * structured mini-tasks (chat titles, branch names) route to the mock provider
 * deterministically instead of whatever CLIs exist on the host machine. The
 * suite runs with workers: 1, so a test that pins this MUST restore it with
 * `[]` in a finally block before the next test starts.
 */
export async function patchMetadataGenerationProviders(
  client: SeedDaemonClient,
  providers: Array<{ provider: string; model?: string }>,
): Promise<void> {
  await (client as unknown as DaemonConfigCapableClient).patchDaemonConfig({
    metadataGeneration: { providers },
  });
}
