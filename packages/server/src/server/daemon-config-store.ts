import {
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "./persisted-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import {
  MutableDaemonConfigSchema,
  MutableDaemonConfigPatchSchema,
} from "@otto-code/protocol/messages";
import {
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  resolveLocalTtsSpeakerId,
} from "./speech/providers/local/models.js";

export type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";

type MutableDaemonConfig = import("@otto-code/protocol/messages").MutableDaemonConfig;
type MutableDaemonConfigPatch = import("@otto-code/protocol/messages").MutableDaemonConfigPatch;
type MutableSpeechConfig = import("@otto-code/protocol/messages").MutableSpeechConfig;
type MutableGitHostingConfig = import("@otto-code/protocol/messages").MutableGitHostingConfig;
type ProviderOverride = import("./agent/provider-launch-config.js").ProviderOverride;

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
}

export interface ConfigChangeDetails {
  /** Provider ids whose config entries were removed by this patch. */
  removedProviderIds: string[];
}

type ConfigListener = (config: MutableDaemonConfig, details: ConfigChangeDetails) => void;
type FieldChangeHandler = (value: unknown) => void;

function getLogger(logger: LoggerLike | undefined): LoggerLike | undefined {
  return logger?.child({ module: "daemon-config-store" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(
  current: T,
  patch: Record<string, unknown>,
): T {
  const next: Record<string, unknown> = { ...current };

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) {
      continue;
    }
    const currentValue = next[key];
    if (isRecord(currentValue) && isRecord(patchValue)) {
      next[key] = deepMerge(currentValue, patchValue);
      continue;
    }
    next[key] = patchValue;
  }

  return next as T;
}

function getValueAtPath(config: MutableDaemonConfig, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), config);
}

function isEqualValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function applyMutableProviderConfigToOverrides(
  baseOverrides: Record<string, ProviderOverride> | undefined,
  mutableProviders: MutableDaemonConfig["providers"] | undefined,
): Record<string, ProviderOverride> | undefined {
  if (!baseOverrides && (!mutableProviders || Object.keys(mutableProviders).length === 0)) {
    return undefined;
  }

  const nextOverrides: Record<string, ProviderOverride> = { ...baseOverrides };
  for (const [providerId, providerConfig] of Object.entries(mutableProviders ?? {})) {
    nextOverrides[providerId] = {
      ...nextOverrides[providerId],
      ...ProviderOverrideSchema.strip().parse(providerConfig),
    };
  }

  return nextOverrides;
}

export class DaemonConfigStore {
  private current: MutableDaemonConfig;
  private readonly ottoHome: string;
  private readonly logger: LoggerLike | undefined;
  private readonly changeListeners = new Set<ConfigListener>();
  private readonly fieldChangeHandlers = new Map<string, Set<FieldChangeHandler>>();

  constructor(ottoHome: string, initial: MutableDaemonConfig, logger?: LoggerLike) {
    this.ottoHome = ottoHome;
    this.logger = getLogger(logger);
    this.current = MutableDaemonConfigSchema.parse(initial);
  }

  public get(): MutableDaemonConfig {
    return this.current;
  }

  public patch(partial: MutableDaemonConfigPatch): MutableDaemonConfig {
    const parsedPatch = MutableDaemonConfigPatchSchema.parse(partial);
    const { patch: prunedPatch, removedProviderIds } = extractProviderRemovals(parsedPatch);
    const base = removedProviderIds.length
      ? removeProviders(this.current, removedProviderIds)
      : this.current;
    const next = MutableDaemonConfigSchema.parse(deepMerge(base, prunedPatch));

    const changedFieldPaths = Array.from(this.fieldChangeHandlers.keys()).filter((path) => {
      return !isEqualValue(getValueAtPath(this.current, path), getValueAtPath(next, path));
    });

    if (changedFieldPaths.length === 0 && isEqualValue(this.current, next)) {
      return this.current;
    }

    // Persist before updating in-memory state so that if persistence fails,
    // runtime and disk stay consistent.
    this.persistConfig(next, removedProviderIds);
    this.current = next;

    for (const path of changedFieldPaths) {
      const handlers = this.fieldChangeHandlers.get(path);
      if (!handlers) {
        continue;
      }
      const value = getValueAtPath(next, path);
      for (const handler of handlers) {
        handler(value);
      }
    }

    for (const listener of this.changeListeners) {
      listener(next, { removedProviderIds });
    }

    return next;
  }

  public onFieldChange(path: string, handler: FieldChangeHandler): () => void {
    const handlers = this.fieldChangeHandlers.get(path) ?? new Set<FieldChangeHandler>();
    handlers.add(handler);
    this.fieldChangeHandlers.set(path, handlers);

    return () => {
      const currentHandlers = this.fieldChangeHandlers.get(path);
      if (!currentHandlers) {
        return;
      }
      currentHandlers.delete(handler);
      if (currentHandlers.size === 0) {
        this.fieldChangeHandlers.delete(path);
      }
    };
  }

  public onChange(listener: ConfigListener): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private persistConfig(config: MutableDaemonConfig, removedProviderIds: string[]): void {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    const nextPersisted = mergeMutableConfigIntoPersistedConfig({
      persisted,
      mutable: config,
      removedProviderIds,
    });
    savePersistedConfig(this.ottoHome, nextPersisted, this.logger);
  }
}

function extractProviderRemovals(patch: MutableDaemonConfigPatch): {
  patch: MutableDaemonConfigPatch;
  removedProviderIds: string[];
} {
  const providers = patch.providers;
  if (!providers) {
    return { patch, removedProviderIds: [] };
  }

  const removedProviderIds = Object.entries(providers)
    .filter(([, value]) => value === null)
    .map(([providerId]) => providerId);
  if (removedProviderIds.length === 0) {
    return { patch, removedProviderIds };
  }

  const remainingProviders = Object.fromEntries(
    Object.entries(providers).filter(([, value]) => value !== null),
  );
  return {
    patch: { ...patch, providers: remainingProviders },
    removedProviderIds,
  };
}

function removeProviders(
  config: MutableDaemonConfig,
  removedProviderIds: string[],
): MutableDaemonConfig {
  const removed = new Set(removedProviderIds);
  return {
    ...config,
    providers: Object.fromEntries(
      Object.entries(config.providers).filter(([providerId]) => !removed.has(providerId)),
    ),
  };
}

function mergeMutableConfigIntoPersistedConfig(params: {
  persisted: PersistedConfig;
  mutable: MutableDaemonConfig;
  removedProviderIds: string[];
}): PersistedConfig {
  const { persisted, mutable, removedProviderIds } = params;
  const browserToolsEnabled = readBrowserToolsEnabled(mutable);
  const metadataGenerationProviders = readMetadataGenerationProviders(mutable);
  const removedProviders = new Set(removedProviderIds);
  const persistedOverrides = persisted.agents?.providers as
    | Record<string, ProviderOverride>
    | undefined;
  const retainedOverrides =
    persistedOverrides && removedProviders.size > 0
      ? Object.fromEntries(
          Object.entries(persistedOverrides).filter(
            ([providerId]) => !removedProviders.has(providerId),
          ),
        )
      : persistedOverrides;
  const providerOverrides = applyMutableProviderConfigToOverrides(
    retainedOverrides,
    mutable.providers,
  );
  const persistedAgents = persisted.agents as Record<string, unknown> | undefined;
  const persistedMetadataGeneration = {
    providers: metadataGenerationProviders,
  };
  const shouldPersistMetadataGeneration =
    metadataGenerationProviders.length > 0 || persisted.agents?.metadataGeneration !== undefined;

  let nextAgents = persisted.agents as PersistedConfig["agents"];
  if (providerOverrides && Object.keys(providerOverrides).length > 0) {
    nextAgents = {
      ...persistedAgents,
      providers: providerOverrides,
      ...(shouldPersistMetadataGeneration
        ? { metadataGeneration: persistedMetadataGeneration }
        : {}),
    } as PersistedConfig["agents"];
  } else if (removedProviders.size > 0 && persistedOverrides) {
    // The last provider override was removed — drop the providers key so the
    // removed entry does not survive in config.json.
    const { providers: _removed, ...agentsWithoutProviders } = persistedAgents ?? {};
    nextAgents = {
      ...agentsWithoutProviders,
      ...(shouldPersistMetadataGeneration
        ? { metadataGeneration: persistedMetadataGeneration }
        : {}),
    } as PersistedConfig["agents"];
  } else if (shouldPersistMetadataGeneration) {
    nextAgents = {
      ...persistedAgents,
      metadataGeneration: persistedMetadataGeneration,
    } as PersistedConfig["agents"];
  }

  return {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      mcp: {
        ...persisted.daemon?.mcp,
        injectIntoAgents: mutable.mcp.injectIntoAgents,
      },
      browserTools: {
        ...persisted.daemon?.browserTools,
        enabled: browserToolsEnabled,
      },
      autoArchiveAfterMerge: mutable.autoArchiveAfterMerge,
      enableTerminalAgentHooks: mutable.enableTerminalAgentHooks,
      appendSystemPrompt: mutable.appendSystemPrompt,
      ...(mutable.terminalProfiles !== undefined
        ? { terminalProfiles: mutable.terminalProfiles }
        : {}),
    },
    agents: nextAgents,
    features: mergeSpeechIntoPersistedFeatures(persisted, mutable.speech),
    providers: mergeSpeechOpenAiIntoPersistedProviders(persisted, mutable.speech),
    gitHosting: buildPersistedGitHosting(persisted, mutable.gitHosting),
  } as PersistedConfig;
}

// Host-level hosting credentials persist under gitHosting.providers in
// config.json — one set per provider. The mutable config is the post-merge
// source of truth; empty strings mean "remove" and a provider with no
// remaining credentials is dropped so stale tokens never linger on disk.
function buildPersistedGitHosting(
  persisted: PersistedConfig,
  gitHosting: MutableGitHostingConfig | undefined,
): PersistedConfig["gitHosting"] {
  if (!gitHosting) {
    return persisted.gitHosting;
  }
  const email = gitHosting.providers?.bitbucketCloud?.email?.trim();
  const apiToken = gitHosting.providers?.bitbucketCloud?.apiToken?.trim();
  const bitbucketCloud = {
    ...(email ? { email } : {}),
    ...(apiToken ? { apiToken } : {}),
  };
  if (Object.keys(bitbucketCloud).length === 0) {
    return undefined;
  }
  return { providers: { bitbucketCloud } };
}

// The speech OpenAI key lives at providers.openai.apiKey in config.json (the
// path the speech config resolver reads). An empty string in the patch removes
// the stored key; sibling fields (baseUrl, stt/tts endpoints) are preserved.
function mergeSpeechOpenAiIntoPersistedProviders(
  persisted: PersistedConfig,
  speech: MutableSpeechConfig | undefined,
): PersistedConfig["providers"] {
  const apiKey = speech?.openai?.apiKey;
  if (apiKey === undefined) {
    return persisted.providers;
  }
  const trimmed = apiKey.trim();
  const openai: Record<string, unknown> = { ...persisted.providers?.openai };
  if (trimmed.length === 0) {
    delete openai["apiKey"];
  } else {
    openai["apiKey"] = trimmed;
  }
  const next = { ...persisted.providers } as NonNullable<PersistedConfig["providers"]>;
  if (Object.keys(openai).length > 0) {
    next.openai = openai as NonNullable<PersistedConfig["providers"]>["openai"];
  } else {
    delete next.openai;
  }
  return next;
}

type PersistedFeatures = NonNullable<PersistedConfig["features"]>;

function isSpeechEngineId(value: unknown): value is "local" | "openai" {
  return value === "local" || value === "openai";
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildPersistedSttFields(params: {
  stt: NonNullable<MutableSpeechConfig["dictation"]>["stt"];
  existing: { provider?: "local" | "openai"; model?: string; language?: string } | undefined;
}): Record<string, unknown> {
  const { stt, existing } = params;
  if (!stt) {
    return { ...existing };
  }
  const provider = isSpeechEngineId(stt.provider) ? stt.provider : existing?.provider;
  const model =
    provider === "local"
      ? LocalSttModelIdSchema.safeParse(stt.model ?? "").data
      : nonEmptyString(stt.model);
  const language = nonEmptyString(stt.language) ?? existing?.language;
  return {
    ...existing,
    ...(provider ? { provider } : {}),
    // An unknown model id for the selected engine is dropped rather than
    // persisted, so a bad patch can never wedge config.json.
    ...(model ? { model } : {}),
    ...(language ? { language } : {}),
  };
}

function buildPersistedTtsFields(params: {
  tts: NonNullable<MutableSpeechConfig["voiceMode"]>["tts"];
  existing: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const { tts, existing } = params;
  if (!tts) {
    return { ...existing };
  }
  const provider = isSpeechEngineId(tts.provider)
    ? tts.provider
    : (existing?.["provider"] as "local" | "openai" | undefined);
  const next: Record<string, unknown> = {
    ...existing,
    ...(provider ? { provider } : {}),
    ...(typeof tts.speed === "number" && Number.isFinite(tts.speed) ? { speed: tts.speed } : {}),
  };

  if (provider === "local") {
    const localModel = LocalTtsModelIdSchema.safeParse(tts.model ?? "").data;
    if (localModel) {
      next["model"] = localModel;
      const voiceName = nonEmptyString(tts.voice);
      const speakerId = voiceName ? resolveLocalTtsSpeakerId(localModel, voiceName) : undefined;
      if (speakerId !== undefined) {
        next["speakerId"] = speakerId;
      }
    }
    // The persisted `voice` field is OpenAI-only; local voices persist as speakerId.
    delete next["voice"];
    return next;
  }

  const model = nonEmptyString(tts.model);
  if (model) {
    next["model"] = model;
  }
  const voice = nonEmptyString(tts.voice);
  if (voice) {
    next["voice"] = voice;
  }
  delete next["speakerId"];
  return next;
}

function mergeSpeechIntoPersistedFeatures(
  persisted: PersistedConfig,
  speech: MutableSpeechConfig | undefined,
): PersistedConfig["features"] {
  if (!speech) {
    return persisted.features;
  }
  const existing: PersistedFeatures = persisted.features ?? {};

  const dictation = speech.dictation
    ? {
        ...existing.dictation,
        ...(speech.dictation.enabled !== undefined ? { enabled: speech.dictation.enabled } : {}),
        ...(speech.dictation.stt
          ? {
              stt: buildPersistedSttFields({
                stt: speech.dictation.stt,
                existing: existing.dictation?.stt,
              }),
            }
          : {}),
      }
    : existing.dictation;

  const voiceMode = speech.voiceMode
    ? {
        ...existing.voiceMode,
        ...(speech.voiceMode.enabled !== undefined ? { enabled: speech.voiceMode.enabled } : {}),
        ...(speech.voiceMode.stt
          ? {
              stt: buildPersistedSttFields({
                stt: speech.voiceMode.stt,
                existing: existing.voiceMode?.stt,
              }),
            }
          : {}),
        ...(speech.voiceMode.tts
          ? {
              tts: buildPersistedTtsFields({
                tts: speech.voiceMode.tts,
                existing: existing.voiceMode?.tts as Record<string, unknown> | undefined,
              }),
            }
          : {}),
      }
    : existing.voiceMode;

  return {
    ...existing,
    ...(dictation ? { dictation } : {}),
    ...(voiceMode ? { voiceMode } : {}),
  } as PersistedConfig["features"];
}

function readBrowserToolsEnabled(mutable: MutableDaemonConfig): boolean {
  const browserTools = mutable.browserTools;
  if (!isRecord(browserTools)) {
    return false;
  }
  return browserTools["enabled"] === true;
}

function readMetadataGenerationProviders(
  mutable: MutableDaemonConfig,
): Array<{ provider: string; model?: string; thinkingOptionId?: string }> {
  const metadataGeneration = mutable.metadataGeneration;
  if (!isRecord(metadataGeneration)) {
    return [];
  }
  const providers = metadataGeneration["providers"];
  if (!Array.isArray(providers)) {
    return [];
  }
  return providers.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry["provider"] !== "string") {
      return [];
    }
    return [
      {
        provider: entry["provider"],
        ...(typeof entry["model"] === "string" ? { model: entry["model"] } : {}),
        ...(typeof entry["thinkingOptionId"] === "string"
          ? { thinkingOptionId: entry["thinkingOptionId"] }
          : {}),
      },
    ];
  });
}
