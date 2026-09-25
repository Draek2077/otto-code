import type { AgentModelDefinition, AgentProvider } from "../agent-sdk-types.js";
import { resolveEffortOption } from "../effort-levels.js";
import { type ResolvedProfileSnapshot } from "../agent-profiles.js";
import { type ResolvedTeamSnapshot } from "../agent-teams.js";
import { expandUserPath, resolvePathFromBase } from "../../path-utils.js";

export function resolveScheduleProviderAndModel(params: {
  provider?: string;
  defaultProvider: AgentProvider;
}): { provider: AgentProvider; model?: string } {
  const providerInput = params.provider?.trim() || params.defaultProvider;
  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return { provider: providerInput };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const model = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !model) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }

  return {
    provider: provider,
    model,
  };
}

export function resolveChildAgentCwd(params: {
  parentCwd: string;
  requestedCwd?: string;
  lockedCwd?: string;
  allowCustomCwd: boolean;
}): string {
  const lockedCwd = params.lockedCwd?.trim();
  if (lockedCwd) {
    return expandUserPath(lockedCwd);
  }

  const requestedCwd = params.requestedCwd?.trim();
  if (!requestedCwd || !params.allowCustomCwd) {
    return params.parentCwd;
  }

  return resolvePathFromBase(params.parentCwd, requestedCwd);
}

export const EFFORT_INPUT_DESCRIPTION =
  "Effort level (off/minimal/low/medium/high/xhigh/max), clamped to the model's nearest option, or an exact thinkingOptions id from list_models.";

/**
 * Resolve a requested effort - canonical level or exact option id - against a
 * provider's advertised models. Levels clamp to the nearest supported option.
 * When the target model (or its thinkingOptions) isn't in the snapshot the
 * request passes through unchanged and the provider normalizes it like any
 * hand-typed id.
 */
export function resolveEffortAgainstModels(params: {
  requested: string;
  models: readonly AgentModelDefinition[];
  model: string | undefined;
}): string {
  const definition = params.model
    ? params.models.find((candidate) => candidate.id === params.model)
    : (params.models.find((candidate) => candidate.isDefault) ?? params.models[0]);
  const thinkingOptions = definition?.thinkingOptions;
  if (!thinkingOptions || thinkingOptions.length === 0) {
    return params.requested;
  }
  return resolveEffortOption({ requested: params.requested, thinkingOptions }).optionId;
}

/**
 * Fold a resolved personality's prompt + frozen snapshot into a partial agent
 * config, or undefined when there's nothing to carry. Kept top-level so the
 * create_chat handler stays under the complexity budget.
 */
export function buildPersonalityAgentConfig(brain: {
  systemPrompt?: string;
  profileSnapshot?: ResolvedProfileSnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
  featureValues?: Record<string, unknown>;
}):
  | {
      systemPrompt?: string;
      profileSnapshot?: ResolvedProfileSnapshot;
      teamSnapshot?: ResolvedTeamSnapshot;
      featureValues?: Record<string, unknown>;
    }
  | undefined {
  if (
    brain.systemPrompt === undefined &&
    brain.profileSnapshot === undefined &&
    brain.teamSnapshot === undefined &&
    brain.featureValues === undefined
  ) {
    return undefined;
  }
  const config: {
    systemPrompt?: string;
    profileSnapshot?: ResolvedProfileSnapshot;
    teamSnapshot?: ResolvedTeamSnapshot;
    featureValues?: Record<string, unknown>;
  } = {};
  if (brain.systemPrompt !== undefined) {
    config.systemPrompt = brain.systemPrompt;
  }
  if (brain.profileSnapshot !== undefined) {
    config.profileSnapshot = brain.profileSnapshot;
  }
  if (brain.teamSnapshot !== undefined) {
    config.teamSnapshot = brain.teamSnapshot;
  }
  if (brain.featureValues !== undefined) {
    config.featureValues = brain.featureValues;
  }
  return config;
}

/**
 * Effort resolution for values that may be inherited rather than asked for:
 * an explicit request resolves strictly (unknown values throw), while an
 * effort inherited from a caller on another provider gets clamped, or
 * dropped (undefined) when it can't be mapped.
 */
export function resolveEffortOrDropInherited(params: {
  requested: string | undefined;
  explicit: boolean;
  models: readonly AgentModelDefinition[] | undefined;
  model: string | undefined;
}): string | undefined {
  if (!params.requested) {
    return undefined;
  }
  try {
    return resolveEffortAgainstModels({
      requested: params.requested,
      models: params.models ?? [],
      model: params.model,
    });
  } catch (error) {
    if (params.explicit) {
      throw error;
    }
    return undefined;
  }
}
