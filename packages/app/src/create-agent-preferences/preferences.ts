import { z } from "zod";
import type { AgentProvider } from "@otto-code/protocol/agent-types";

const featureValuesSchema = z.record(z.string(), z.union([z.boolean(), z.string(), z.null()]));

export interface ProviderPreferences {
  model?: string;
  mode?: string;
  thinkingByModel?: Record<string, string>;
  featureValues?: Record<string, unknown>;
}

export type LaunchTarget = { kind: "chat" } | { kind: "terminal"; profileId: string };

export interface FormPreferences {
  provider?: string;
  providerPreferences?: Record<string, ProviderPreferences>;
  favoriteModels?: Array<{ provider: string; modelId: string }>;
  isolation?: "local" | "worktree";
  launchTarget?: LaunchTarget;
  lastPersonalityByRole?: Record<string, string>;
  suppressPersonalitySwitchWarning?: boolean;
}

export interface FavoriteModelPreference {
  provider: string;
  modelId: string;
}

export interface FavoriteModelRow {
  favoriteKey: string;
  provider: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  description?: string;
}

const providerPreferencesSchema: z.ZodType<ProviderPreferences> = z.strictObject({
  model: z.string().optional(),
  mode: z.string().optional(),
  thinkingByModel: z.record(z.string(), z.string()).optional(),
  featureValues: featureValuesSchema.optional(),
});

const launchTargetSchema: z.ZodType<LaunchTarget> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("chat") }),
  z.strictObject({ kind: z.literal("terminal"), profileId: z.string() }),
]);

export const FormPreferencesSchema = z.strictObject({
  provider: z.string().optional(),
  providerPreferences: z.record(z.string(), providerPreferencesSchema).optional(),
  favoriteModels: z
    .array(
      z.strictObject({
        provider: z.string(),
        modelId: z.string(),
      }),
    )
    .optional(),
  isolation: z.enum(["local", "worktree"]).optional(),
  lastPersonalityByRole: z.record(z.string(), z.string()).optional(),
  suppressPersonalitySwitchWarning: z.boolean().optional(),
  launchTarget: launchTargetSchema.optional(),
}) satisfies z.ZodType<FormPreferences>;

const LegacyProviderPreferencesSchema = z.strictObject({
  model: z.string().optional(),
  mode: z.string().optional(),
  thinkingOptionId: z.string().optional(),
});

const LegacyFormPreferencesSchema = z
  .strictObject({
    workingDir: z.string().optional(),
    provider: z.string().optional(),
    serverId: z.string().optional(),
    providerPreferences: z.record(z.string(), LegacyProviderPreferencesSchema).optional(),
  })
  .transform(({ provider, providerPreferences }): FormPreferences => {
    const migratedProviderPreferences: Record<string, ProviderPreferences> = {};
    for (const [providerId, legacy] of Object.entries(providerPreferences ?? {})) {
      const model = legacy.model;
      migratedProviderPreferences[providerId] = {
        ...(model !== undefined ? { model } : {}),
        ...(legacy.mode !== undefined ? { mode: legacy.mode } : {}),
        ...(model !== undefined && legacy.thinkingOptionId !== undefined
          ? { thinkingByModel: { [model]: legacy.thinkingOptionId } }
          : {}),
      };
    }
    return {
      ...(provider !== undefined ? { provider } : {}),
      ...(providerPreferences !== undefined
        ? { providerPreferences: migratedProviderPreferences }
        : {}),
    };
  });

export const StoredFormPreferencesSchema: z.ZodType<FormPreferences> = z.union([
  FormPreferencesSchema,
  LegacyFormPreferencesSchema,
]);

export const DEFAULT_FORM_PREFERENCES: FormPreferences = {};

export function parseFormPreferences(value: unknown): FormPreferences {
  const result = StoredFormPreferencesSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_FORM_PREFERENCES;
}

function mergeDefinedRecord<T>(
  existing: Record<string, T> | undefined,
  updates: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (updates === undefined) {
    return existing;
  }
  return {
    ...existing,
    ...updates,
  };
}

function applyProviderPreferenceUpdates(
  existing: ProviderPreferences,
  updates: Omit<Partial<ProviderPreferences>, "mode"> & { mode?: string | null },
): ProviderPreferences {
  const next: ProviderPreferences = { ...existing };
  const nextThinkingByModel = mergeDefinedRecord(existing.thinkingByModel, updates.thinkingByModel);
  const nextFeatureValues = mergeDefinedRecord(existing.featureValues, updates.featureValues);

  if (updates.model !== undefined) {
    next.model = updates.model;
  }
  if (updates.mode === null) {
    delete next.mode;
  } else if (updates.mode !== undefined) {
    next.mode = updates.mode;
  }
  if (nextThinkingByModel !== undefined) {
    next.thinkingByModel = nextThinkingByModel;
  }
  if (nextFeatureValues !== undefined) {
    next.featureValues = nextFeatureValues;
  }

  return next;
}

export function mergeProviderPreferences(args: {
  preferences: FormPreferences;
  provider: AgentProvider;
  updates: Omit<Partial<ProviderPreferences>, "mode"> & { mode?: string | null };
}): FormPreferences {
  const { preferences, provider, updates } = args;
  const existingProviderPreferences = preferences.providerPreferences ?? {};
  const existing = existingProviderPreferences[provider] ?? {};

  return {
    ...preferences,
    provider,
    providerPreferences: {
      ...existingProviderPreferences,
      [provider]: applyProviderPreferenceUpdates(existing, updates),
    },
  };
}

export function mergeCreateAgentSelectionPreferences(args: {
  preferences: FormPreferences;
  provider: AgentProvider | null;
  modelId?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown>;
}): FormPreferences {
  if (!args.provider) {
    return args.preferences;
  }

  const modelId = args.modelId?.trim() ?? "";
  const modeId = args.modeId?.trim() ?? "";
  const thinkingOptionId = args.thinkingOptionId?.trim() ?? "";
  const featureValues = featureValuesSchema.safeParse(args.featureValues);

  return mergeProviderPreferences({
    preferences: args.preferences,
    provider: args.provider,
    updates: {
      model: modelId || undefined,
      mode: args.modeId === undefined ? undefined : modeId || null,
      ...(modelId && thinkingOptionId ? { thinkingByModel: { [modelId]: thinkingOptionId } } : {}),
      ...(featureValues.success ? { featureValues: featureValues.data } : {}),
    },
  });
}

export function mergeLastPersonality(args: {
  preferences: FormPreferences;
  role: string;
  personalityId: string | null;
}): FormPreferences {
  const existing = args.preferences.lastPersonalityByRole ?? {};
  const next = { ...existing };
  if (args.personalityId) {
    next[args.role] = args.personalityId;
  } else {
    delete next[args.role];
  }
  return { ...args.preferences, lastPersonalityByRole: next };
}

export function mergeSuppressPersonalitySwitchWarning(args: {
  preferences: FormPreferences;
  suppressed: boolean;
}): FormPreferences {
  return { ...args.preferences, suppressPersonalitySwitchWarning: args.suppressed };
}

export function applyAgentProfilePreferences(args: {
  preferences: FormPreferences;
  previousProvider: AgentProvider | null;
  previousProviderModeIds: readonly string[];
  provider: AgentProvider;
  modelId: string;
  modeId: string;
  thinkingOptionId: string;
  featureValues: Record<string, unknown>;
}): FormPreferences {
  let next = args.preferences;
  if (args.previousProvider) {
    const previousMode = next.providerPreferences?.[args.previousProvider]?.mode;
    if (previousMode && !args.previousProviderModeIds.includes(previousMode)) {
      next = mergeProviderPreferences({
        preferences: next,
        provider: args.previousProvider,
        updates: { mode: null },
      });
    }
  }

  return mergeProviderPreferences({
    preferences: next,
    provider: args.provider,
    updates: {
      model: args.modelId || undefined,
      mode: args.modeId || null,
      ...(args.modelId && args.thinkingOptionId
        ? { thinkingByModel: { [args.modelId]: args.thinkingOptionId } }
        : {}),
      featureValues: args.featureValues,
    },
  });
}

export function buildFavoriteModelKey(input: FavoriteModelPreference): string {
  return `${input.provider}:${input.modelId}`;
}

export function isFavoriteModel(args: {
  preferences: FormPreferences;
  provider: string;
  modelId: string;
}): boolean {
  const favoriteKey = buildFavoriteModelKey({ provider: args.provider, modelId: args.modelId });
  return (args.preferences.favoriteModels ?? []).some(
    (favorite) => buildFavoriteModelKey(favorite) === favoriteKey,
  );
}

export function toggleFavoriteModel(args: {
  preferences: FormPreferences;
  provider: string;
  modelId: string;
}): FormPreferences {
  const favorite = { provider: args.provider, modelId: args.modelId };
  const favoriteKey = buildFavoriteModelKey(favorite);
  const existingFavorites = args.preferences.favoriteModels ?? [];
  const hasFavorite = existingFavorites.some(
    (entry) => buildFavoriteModelKey(entry) === favoriteKey,
  );

  return {
    ...args.preferences,
    favoriteModels: hasFavorite
      ? existingFavorites.filter((entry) => buildFavoriteModelKey(entry) !== favoriteKey)
      : [...existingFavorites, favorite],
  };
}
