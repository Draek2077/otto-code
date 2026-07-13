/**
 * Model → tier classification, shared by the daemon (stamps `model.tier` at
 * ingest) and the app (reads `model.tier`). Pure and dependency-free — no zod,
 * no I/O.
 *
 * Deliberately NO name-pattern guessing: the official model ids are public
 * record, so we classify what we KNOW (the shipped catalog) and leave everything
 * else `undefined` = "Unknown". Size-in-the-name heuristics are unreliable
 * (a Qwen-32B coder ≠ a Qwen-32B instruct), so we don't pretend — the user tags
 * an Unknown model with an override and that's it.
 *
 * Resolution order for a single model:
 *   1. user override (a per-model tag persisted in host config),
 *   2. the shipped catalog of known models,
 * else undefined ("Unknown"). At generation the consumer's context-window
 * heuristic still fills a slot so a team can bind, but that's a last resort, not
 * a claim about the model's tier.
 */

import type { AgentModelDefinition, ModelTier } from "./agent-types.js";

// Shipped catalog of known, official model ids (public record). Matched
// case-insensitively against the exact model id; decorated ids that miss here
// fall through to patterns.
export const KNOWN_MODEL_TIERS: Readonly<Record<string, ModelTier>> = {
  // Anthropic (Claude)
  "claude-opus-4-8": "deep",
  "claude-opus-4-7": "deep",
  "claude-sonnet-5": "standard",
  "claude-haiku-4-5": "fast",
  "claude-haiku-4-5-20251001": "fast",
  // OpenAI (GPT / o-series)
  "gpt-5": "deep",
  "gpt-5-mini": "fast",
  "gpt-5-nano": "fast",
  o3: "deep",
  "o3-mini": "fast",
  "o4-mini": "fast",
  "gpt-4.1": "standard",
  "gpt-4.1-mini": "fast",
  "gpt-4o": "standard",
  "gpt-4o-mini": "fast",
  // Google (Gemini)
  "gemini-2.5-pro": "deep",
  "gemini-2.5-flash": "fast",
  "gemini-2.5-flash-lite": "fast",
  "gemini-2.0-flash": "fast",
  // DeepSeek
  "deepseek-r1": "deep",
  "deepseek-v3": "deep",
  "deepseek-chat": "standard",
  "deepseek-reasoner": "deep",
  // Alibaba (Qwen) hosted tiers
  "qwen-max": "deep",
  "qwen-plus": "standard",
  "qwen-turbo": "fast",
  // xAI (Grok)
  "grok-4": "deep",
  "grok-3": "deep",
  "grok-3-mini": "fast",
  // Mistral
  "mistral-large-latest": "deep",
  "mistral-large": "deep",
  "mistral-medium": "standard",
  "mistral-small": "fast",
};

export function catalogTier(modelId: string): ModelTier | undefined {
  return KNOWN_MODEL_TIERS[modelId.toLowerCase()];
}

/**
 * Infer a model's tier from the shipped catalog alone (no guessing). Undefined
 * for models we don't ship an id for — those read as "Unknown" until the user
 * tags one.
 */
export function inferModelTier(model: Pick<AgentModelDefinition, "id">): ModelTier | undefined {
  return catalogTier(model.id);
}

/**
 * The tier to stamp on a model at ingest: an explicit user override wins,
 * otherwise the catalog. Undefined ("Unknown") leaves the model tier-less until
 * the user tags it; the consumer's generation heuristic still binds a slot.
 */
export function resolveModelTier(
  model: Pick<AgentModelDefinition, "id">,
  override: ModelTier | undefined,
): ModelTier | undefined {
  return override ?? inferModelTier(model);
}
