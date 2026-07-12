import {
  checkPersonalityAvailability,
  personalityHasRole,
} from "@otto-code/protocol/agent-personalities";
import type { AgentPersonality, PersonalityRole } from "@otto-code/protocol/messages";
import type {
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "./agent-sdk-types.js";
import type { StructuredGenerationProvider } from "./agent-response-loop.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import { resolveEffortOption } from "./effort-levels.js";

export interface StructuredGenerationDaemonConfig {
  metadataGeneration?: {
    providers?: Array<{
      provider: string;
      model?: string;
      thinkingOptionId?: string;
    }>;
  };
  // The host's Agent Personalities roster, so role-matched personalities can be
  // resolved as the primary worker for a mini-task before the legacy chain.
  agentPersonalities?: {
    personalities?: readonly AgentPersonality[];
  };
}

export interface StructuredGenerationProviderIdentifier {
  modelSubstring: string;
  thinkingOptionId?: string;
}

export const DEFAULT_STRUCTURED_GENERATION_PROVIDERS: readonly StructuredGenerationProviderIdentifier[] =
  [
    { modelSubstring: "haiku" },
    { modelSubstring: "gpt-5.4-mini", thinkingOptionId: "low" },
    { modelSubstring: "minimax-m2.5" },
    { modelSubstring: "nemotron-3-super" },
  ] as const;

export interface ResolveStructuredGenerationProvidersOptions {
  cwd: string;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  daemonConfig?: StructuredGenerationDaemonConfig | null;
  /**
   * When set, every available Agent Personality carrying this role is resolved
   * FIRST and prepended ahead of the legacy configured/substring/current chain.
   * This is how mini-task generation (commit messages, branch/workspace names)
   * prefers a user's role-matched personality — a Writer — before falling back
   * to the built-in preference list.
   */
  role?: PersonalityRole;
  currentSelection?: {
    provider?: AgentProvider | null;
    model?: string | null;
    thinkingOptionId?: string | null;
  };
}

export async function resolveStructuredGenerationProviders(
  options: ResolveStructuredGenerationProvidersOptions,
): Promise<StructuredGenerationProvider[]> {
  const configuredProviders = readConfiguredProviders(options.daemonConfig);
  const role = options.role;

  // Explicit-config fast path (no snapshot fetch). Skipped when a role is
  // requested: personality routing must consult the live snapshot to decide
  // availability and prepend ahead of the configured providers.
  if (!role && configuredProviders.length > 0) {
    const explicitProviders = resolveExplicitConfiguredProviders(configuredProviders);
    if (explicitProviders.length === configuredProviders.length) {
      return dedupeProviders(explicitProviders);
    }

    const providerEntries = await options.providerSnapshotManager.listProviders({
      cwd: options.cwd,
      wait: false,
    });
    const providers = resolveConfiguredProviders(configuredProviders, providerEntries);
    if (providers.length > 0) {
      return dedupeProviders(providers);
    }
  }

  const providerEntries = await options.providerSnapshotManager.listProviders({
    cwd: options.cwd,
    wait: true,
  });
  const enabledEntries = providerEntries.filter((entry) => entry.enabled);
  const modelEntries = enabledEntries.filter((entry) => (entry.models?.length ?? 0) > 0);
  const entriesByProvider = new Map(enabledEntries.map((entry) => [entry.provider, entry]));
  const providers: StructuredGenerationProvider[] = [];

  // Agent Personalities come first: a role-matched, available personality is the
  // primary worker for this task. Everything below — configured providers, the
  // built-in substring list, the current selection — is the legacy fallback that
  // only runs when no suitable personality exists (or all of them fail).
  if (role) {
    for (const resolved of resolvePersonalityProviders(
      role,
      readConfiguredPersonalities(options.daemonConfig),
      providerEntries,
    )) {
      providers.push(resolved);
    }
  }

  for (const configured of configuredProviders) {
    const resolvedConfigured = resolveConfiguredCandidate(
      configured,
      modelEntries,
      entriesByProvider,
    );
    if (!resolvedConfigured) {
      continue;
    }
    providers.push(resolvedConfigured);
  }

  for (const identifier of DEFAULT_STRUCTURED_GENERATION_PROVIDERS) {
    const resolved = resolveByModelSubstring(modelEntries, identifier);
    if (resolved) {
      providers.push(resolved);
    }
  }

  const currentSelection = resolveCurrentSelection(
    options.currentSelection,
    modelEntries,
    entriesByProvider,
  );
  if (currentSelection) {
    providers.push(currentSelection);
  }

  return dedupeProviders(providers);
}

/**
 * The primary agent identity the daemon would use for a role-scoped mini-task,
 * resolved for display before the task runs. Mirrors the head of the ordered
 * provider chain from resolveStructuredGenerationProviders: when an available
 * role-matched personality wins (personalities are prepended first), that
 * personality's name and bound provider/model; otherwise the bare provider/model.
 * null when nothing resolves — the caller decides how to refuse the task.
 */
export type ResolvedStructuredGenerationAgent =
  | {
      kind: "personality";
      personalityId: string;
      personalityName: string;
      provider: string;
      providerLabel: string;
      model: string | null;
      modelLabel: string | null;
    }
  | {
      kind: "provider";
      provider: string;
      providerLabel: string;
      model: string | null;
      modelLabel: string | null;
    };

/**
 * Resolve the first provider resolveStructuredGenerationProviders would use and
 * describe it for the user. Honest about the primary only: generation still
 * falls back through the rest of the chain on failure, but the confirmation
 * names who runs first. Returns null when the chain is empty (no agent set up).
 */
export async function resolveStructuredGenerationAgent(
  options: ResolveStructuredGenerationProvidersOptions,
): Promise<ResolvedStructuredGenerationAgent | null> {
  const providers = await resolveStructuredGenerationProviders(options);
  const primary = providers[0];
  if (!primary) {
    return null;
  }

  const providerEntries = await options.providerSnapshotManager.listProviders({
    cwd: options.cwd,
    wait: true,
  });
  const providerLabel = resolveProviderLabel(primary.provider, providerEntries);
  const model = primary.model ?? null;
  const modelLabel = resolveModelLabel(primary.provider, primary.model, providerEntries);

  if (options.role) {
    const personality = findPrimaryPersonalityMatch(
      options.role,
      readConfiguredPersonalities(options.daemonConfig),
      providerEntries,
      primary,
    );
    if (personality) {
      return {
        kind: "personality",
        personalityId: personality.id,
        personalityName: personality.name,
        provider: primary.provider,
        providerLabel,
        model,
        modelLabel,
      };
    }
  }

  return { kind: "provider", provider: primary.provider, providerLabel, model, modelLabel };
}

// The first available role-matched personality is the prepended head of the
// chain, so it is the primary when its bound provider/model equals `primary`.
function findPrimaryPersonalityMatch(
  role: PersonalityRole,
  personalities: readonly AgentPersonality[],
  entries: readonly ProviderSnapshotEntry[],
  primary: StructuredGenerationProvider,
): AgentPersonality | null {
  const entryByProvider = new Map<string, ProviderSnapshotEntry>(
    entries.map((entry) => [entry.provider, entry]),
  );
  for (const personality of personalities) {
    if (!personalityHasRole(personality, role)) {
      continue;
    }
    const entry = entryByProvider.get(personality.provider);
    const availability = checkPersonalityAvailability(personality, {
      providerStatus: entry?.status,
      providerEnabled: entry?.enabled,
      modelIds: entry?.models?.map((model) => model.id),
      modeIds: entry?.modes?.map((mode) => mode.id),
    });
    if (!availability.available) {
      continue;
    }
    return personality.provider === primary.provider && personality.model === primary.model
      ? personality
      : null;
  }
  return null;
}

function resolveProviderLabel(
  providerId: string,
  entries: readonly ProviderSnapshotEntry[],
): string {
  const entry = entries.find((candidate) => candidate.provider === providerId);
  return entry?.label?.trim() || providerId;
}

function resolveModelLabel(
  providerId: string,
  modelId: string | undefined,
  entries: readonly ProviderSnapshotEntry[],
): string | null {
  if (!modelId) {
    return null;
  }
  const entry = entries.find((candidate) => candidate.provider === providerId);
  const model = entry?.models?.find((candidate) => candidate.id === modelId);
  return model?.label?.trim() || modelId;
}

function resolveConfiguredProviders(
  configuredProviders: readonly { provider: string; model?: string; thinkingOptionId?: string }[],
  providerEntries: readonly ProviderSnapshotEntry[],
): StructuredGenerationProvider[] {
  const enabledEntries = providerEntries.filter((entry) => entry.enabled);
  const modelEntries = enabledEntries.filter((entry) => (entry.models?.length ?? 0) > 0);
  const entriesByProvider = new Map(enabledEntries.map((entry) => [entry.provider, entry]));
  const providers: StructuredGenerationProvider[] = [];
  for (const configured of configuredProviders) {
    const resolved = resolveConfiguredCandidate(configured, modelEntries, entriesByProvider);
    if (resolved) {
      providers.push(resolved);
    }
  }
  return providers;
}

function resolveExplicitConfiguredProviders(
  configuredProviders: readonly { provider: string; model?: string; thinkingOptionId?: string }[],
): StructuredGenerationProvider[] {
  const providers: StructuredGenerationProvider[] = [];
  for (const configured of configuredProviders) {
    const provider = configured.provider.trim();
    const model = configured.model?.trim();
    if (!provider || !model) {
      continue;
    }
    providers.push({
      provider,
      model,
      ...(configured.thinkingOptionId ? { thinkingOptionId: configured.thinkingOptionId } : {}),
    });
  }
  return providers;
}

function resolveCurrentSelection(
  selection: ResolveStructuredGenerationProvidersOptions["currentSelection"],
  readyEntries: readonly ProviderSnapshotEntry[],
  entriesByProvider: ReadonlyMap<AgentProvider, ProviderSnapshotEntry>,
): StructuredGenerationProvider | null {
  if (!selection) {
    return null;
  }

  const provider = selection.provider?.trim();
  if (!provider) {
    return null;
  }

  const normalized = resolveConfiguredCandidate(
    {
      provider,
      ...(selection.model ? { model: selection.model } : {}),
      ...(selection.thinkingOptionId ? { thinkingOptionId: selection.thinkingOptionId } : {}),
    },
    readyEntries,
    entriesByProvider,
  );
  if (normalized) {
    return normalized;
  }

  const explicitModel = selection.model?.trim();
  if (explicitModel) {
    return {
      provider,
      model: explicitModel,
      ...(selection.thinkingOptionId ? { thinkingOptionId: selection.thinkingOptionId } : {}),
    };
  }

  const model = selectDefaultModel(entriesByProvider.get(provider)?.models ?? []);
  if (!model) {
    return { provider };
  }

  const thinkingOptionId = resolveThinkingOptionId(model, selection.thinkingOptionId);
  return {
    provider,
    model: model.id,
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
  };
}

function resolveConfiguredCandidate(
  candidate: { provider: string; model?: string; thinkingOptionId?: string },
  readyEntries: readonly ProviderSnapshotEntry[],
  entriesByProvider: ReadonlyMap<AgentProvider, ProviderSnapshotEntry>,
): StructuredGenerationProvider | null {
  const provider = candidate.provider.trim();
  if (!provider) {
    return null;
  }

  const topLevelEntry = entriesByProvider.get(provider);
  const configuredModel = candidate.model?.trim();
  if (topLevelEntry) {
    if (configuredModel) {
      return {
        provider,
        model: configuredModel,
        ...(candidate.thinkingOptionId ? { thinkingOptionId: candidate.thinkingOptionId } : {}),
      };
    }

    const model = selectDefaultModel(topLevelEntry.models ?? []);
    const thinkingOptionId = resolveThinkingOptionId(model, candidate.thinkingOptionId);
    return {
      provider,
      ...(model ? { model: model.id } : {}),
      ...(thinkingOptionId ? { thinkingOptionId } : {}),
    };
  }

  if (!configuredModel) {
    return {
      provider,
      ...(candidate.thinkingOptionId ? { thinkingOptionId: candidate.thinkingOptionId } : {}),
    };
  }

  const nestedMatch = resolveNestedProviderModel(provider, configuredModel, readyEntries);
  if (!nestedMatch) {
    return {
      provider,
      model: configuredModel,
      ...(candidate.thinkingOptionId ? { thinkingOptionId: candidate.thinkingOptionId } : {}),
    };
  }

  const thinkingOptionId = resolveThinkingOptionId(nestedMatch.model, candidate.thinkingOptionId);
  return {
    provider: nestedMatch.provider,
    model: nestedMatch.model.id,
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
  };
}

function resolveNestedProviderModel(
  providerId: string,
  modelId: string,
  entries: readonly ProviderSnapshotEntry[],
): { provider: AgentProvider; model: AgentModelDefinition } | null {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModelId = modelId.trim().toLowerCase();

  for (const entry of entries) {
    for (const model of entry.models ?? []) {
      const modelProviderId = readModelMetadataString(model, "providerId")?.toLowerCase();
      const nestedModelId = readModelMetadataString(model, "modelId")?.toLowerCase();
      if (modelProviderId !== normalizedProviderId) {
        continue;
      }
      if (
        normalizedModelId === model.id.toLowerCase() ||
        normalizedModelId === nestedModelId ||
        model.id.toLowerCase() === `${normalizedProviderId}/${normalizedModelId}`
      ) {
        return { provider: entry.provider, model };
      }
    }
  }

  return null;
}

function resolveByModelSubstring(
  entries: readonly ProviderSnapshotEntry[],
  identifier: StructuredGenerationProviderIdentifier,
): StructuredGenerationProvider | null {
  const needle = identifier.modelSubstring.trim().toLowerCase();
  if (!needle) {
    return null;
  }

  for (const entry of entries) {
    for (const model of entry.models ?? []) {
      const haystacks = [model.id, model.label].map((value) => value.toLowerCase());
      if (!haystacks.some((value) => value.includes(needle))) {
        continue;
      }
      const thinkingOptionId = resolveThinkingOptionId(model, identifier.thinkingOptionId);
      return {
        provider: entry.provider,
        model: model.id,
        ...(thinkingOptionId ? { thinkingOptionId } : {}),
      };
    }
  }

  return null;
}

function readConfiguredProviders(
  daemonConfig: ResolveStructuredGenerationProvidersOptions["daemonConfig"],
): Array<{ provider: string; model?: string; thinkingOptionId?: string }> {
  const metadataGeneration = daemonConfig?.metadataGeneration;
  if (!metadataGeneration || typeof metadataGeneration !== "object") {
    return [];
  }
  const providers = "providers" in metadataGeneration ? metadataGeneration.providers : undefined;
  return Array.isArray(providers) ? providers : [];
}

function readConfiguredPersonalities(
  daemonConfig: ResolveStructuredGenerationProvidersOptions["daemonConfig"],
): readonly AgentPersonality[] {
  const personalities = daemonConfig?.agentPersonalities?.personalities;
  return Array.isArray(personalities) ? personalities : [];
}

/**
 * Resolve every personality carrying `role` and available against the live
 * snapshot into a structured-generation provider, in roster order. Availability
 * uses the same shared predicate the pickers and spawn path use, so a mini-task
 * never routes to a personality whose provider/model/mode can't resolve here.
 */
function resolvePersonalityProviders(
  role: PersonalityRole,
  personalities: readonly AgentPersonality[],
  entries: readonly ProviderSnapshotEntry[],
): StructuredGenerationProvider[] {
  const entryByProvider = new Map<string, ProviderSnapshotEntry>(
    entries.map((entry) => [entry.provider, entry]),
  );
  const resolved: StructuredGenerationProvider[] = [];
  for (const personality of personalities) {
    if (!personalityHasRole(personality, role)) {
      continue;
    }
    const entry = entryByProvider.get(personality.provider);
    const availability = checkPersonalityAvailability(personality, {
      providerStatus: entry?.status,
      providerEnabled: entry?.enabled,
      modelIds: entry?.models?.map((model) => model.id),
      modeIds: entry?.modes?.map((mode) => mode.id),
    });
    if (!availability.available) {
      continue;
    }
    const model = entry?.models?.find((candidate) => candidate.id === personality.model);
    const thinkingOptionId = resolvePersonalityThinkingOptionId(model, personality.effortLevel);
    resolved.push({
      provider: personality.provider,
      model: personality.model,
      ...(thinkingOptionId ? { thinkingOptionId } : {}),
    });
  }
  return resolved;
}

// Map the personality's canonical effort level onto the bound model's advertised
// thinking options — the same resolution the spawn path uses — falling back to
// the model default when the level can't be mapped (fully custom option ids).
function resolvePersonalityThinkingOptionId(
  model: AgentModelDefinition | undefined,
  effortLevel: string | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }
  const options = model.thinkingOptions ?? [];
  if (!effortLevel || options.length === 0) {
    return model.defaultThinkingOptionId;
  }
  try {
    return resolveEffortOption({ requested: effortLevel, thinkingOptions: options }).optionId;
  } catch {
    return model.defaultThinkingOptionId;
  }
}

function selectDefaultModel(models: readonly AgentModelDefinition[]): AgentModelDefinition | null {
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

function resolveThinkingOptionId(
  model: AgentModelDefinition | null | undefined,
  preferredThinkingOptionId: string | null | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }
  if (
    preferredThinkingOptionId &&
    model.thinkingOptions?.some((option) => option.id === preferredThinkingOptionId)
  ) {
    return preferredThinkingOptionId;
  }
  return model.defaultThinkingOptionId;
}

function dedupeProviders(
  providers: readonly StructuredGenerationProvider[],
): StructuredGenerationProvider[] {
  const seen = new Set<string>();
  const deduped: StructuredGenerationProvider[] = [];

  for (const provider of providers) {
    const key = [provider.provider, provider.model ?? "", provider.thinkingOptionId ?? ""].join(
      "\0",
    );
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(provider);
  }

  return deduped;
}

function readModelMetadataString(model: AgentModelDefinition, key: string): string | undefined {
  const value = model.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
