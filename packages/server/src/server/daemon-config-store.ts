import {
  loadPersistedConfig,
  savePersistedConfig,
  AgentPersonalityConfigSchema,
  AgentTeamConfigSchema,
  type PersistedConfig,
  type PersistedAgentPersonality,
  type PersistedAgentTeam,
} from "./persisted-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { OTTO_TOOL_GROUPS, type OttoToolGroup } from "@otto-code/protocol/provider-config";
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
type AgentPersonality = import("@otto-code/protocol/messages").AgentPersonality;
type AgentTeam = import("@otto-code/protocol/messages").AgentTeam;
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

// A stand-in the daemon sends to clients in place of a stored host-provider
// secret, so the real value never rides the wire (the settings UI already hides
// it behind a secure field, but the plaintext was still echoed in the config
// payload). A client saving the config unchanged sends the sentinel straight
// back and patch() restores the stored value instead of overwriting it with the
// placeholder. The settings UI's change-detection usually means an untouched
// secret isn't re-sent at all, but a full-object patch would carry it — so the
// restore is handled defensively rather than relying on the client.
export const DAEMON_CONFIG_SECRET_SENTINEL = "__otto_secret_present__";

// Wire paths (within the mutable config) of the secrets masked on the way to
// clients. Deliberately narrow — only host-provider credentials.
const SECRET_WIRE_PATHS: readonly (readonly string[])[] = [
  ["speech", "openai", "apiKey"],
  ["gitHosting", "providers", "bitbucketCloud", "apiToken"],
];

function setValueAtPath(
  config: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  const clone: Record<string, unknown> = { ...config };
  if (rest.length === 0) {
    clone[head] = value;
  } else if (isRecord(clone[head])) {
    clone[head] = setValueAtPath(clone[head] as Record<string, unknown>, rest, value);
  }
  return clone;
}

// Return a copy of the config with every stored secret replaced by the sentinel.
// Structurally shares everything off the secret paths; only clones the branches
// it rewrites, so this.current is never mutated. Empty/absent secrets are left
// untouched so "not configured" still reads as empty on the client.
export function redactDaemonConfigForClient(config: MutableDaemonConfig): MutableDaemonConfig {
  let next = config as Record<string, unknown>;
  for (const path of SECRET_WIRE_PATHS) {
    const value = getValueAtPath(next as MutableDaemonConfig, path.join("."));
    if (typeof value === "string" && value.length > 0) {
      next = setValueAtPath(next, path, DAEMON_CONFIG_SECRET_SENTINEL);
    }
  }
  return next as MutableDaemonConfig;
}

// Drop any secret leaf whose value is the sentinel from an incoming patch, so
// deepMerge preserves the stored secret (it skips undefined/absent keys) instead
// of persisting the placeholder. Mutates the already-parsed patch in place.
function stripRedactedSecretsFromPatch(patch: MutableDaemonConfigPatch): void {
  for (const path of SECRET_WIRE_PATHS) {
    let container: unknown = patch;
    for (let i = 0; i < path.length - 1; i += 1) {
      container = isRecord(container) ? container[path[i]] : undefined;
    }
    const leafKey = path[path.length - 1];
    if (isRecord(container) && container[leafKey] === DAEMON_CONFIG_SECRET_SENTINEL) {
      delete container[leafKey];
    }
  }
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

  /**
   * Seed the shipped default Agent Personalities onto disk the first time this
   * host runs the feature — but ONLY when the persisted config has never carried
   * an agentPersonalities section. Once the section exists on disk (even as an
   * empty roster the user cleared), this is a no-op, so deleting the whole team
   * sticks across restarts instead of silently re-seeding. The in-memory config
   * is seeded separately at construction (see bootstrap); this only records the
   * one-time initialization on disk, writing just the personalities branch so
   * unrelated defaults (speech, etc.) are never frozen onto disk as a side
   * effect.
   */
  public seedDefaultPersonalitiesIfAbsent(defaults: readonly AgentPersonality[]): void {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    if (persisted.agents?.agentPersonalities !== undefined) {
      return;
    }
    savePersistedConfig(
      this.ottoHome,
      {
        ...persisted,
        agents: {
          ...persisted.agents,
          agentPersonalities: {
            personalities: [...defaults],
          },
        },
      },
      this.logger,
    );
    this.logger?.info(`Seeded ${defaults.length} default agent personalities`);
  }

  /**
   * Seed the shipped starter Agent Team onto disk the first time this host
   * runs the teams feature — ONLY when the persisted config has never carried
   * an agentTeams section (mirrors seedDefaultPersonalitiesIfAbsent: once the
   * section exists on disk, even emptied, this is a permanent no-op so
   * deleting the starter team sticks across restarts). Seeds teams only —
   * activeTeamId stays unset so a fresh host behaves exactly like today until
   * the user opts in via the switcher.
   */
  public seedDefaultTeamsIfAbsent(defaults: readonly AgentTeam[]): void {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    if (persisted.agents?.agentTeams !== undefined) {
      return;
    }
    savePersistedConfig(
      this.ottoHome,
      {
        ...persisted,
        agents: {
          ...persisted.agents,
          agentTeams: {
            teams: [...defaults],
          },
        },
      },
      this.logger,
    );
    this.logger?.info(`Seeded ${defaults.length} default agent teams`);
  }

  public patch(partial: MutableDaemonConfigPatch): MutableDaemonConfig {
    const parsedPatch = MutableDaemonConfigPatchSchema.parse(partial);
    // A masked secret that comes back unchanged must not overwrite the stored
    // value with the sentinel placeholder.
    stripRedactedSecretsFromPatch(parsedPatch);
    const { patch: prunedPatch, removedProviderIds } = extractProviderRemovals(parsedPatch);
    const base = removedProviderIds.length
      ? removeProviders(this.current, removedProviderIds)
      : this.current;
    const next = healActiveAgentTeamId(
      MutableDaemonConfigSchema.parse(deepMerge(base, prunedPatch)),
    );

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

// Post-validation normalization (wire schemas stay pure declarations): never
// let a dangling active team id survive a patch. Deleting the active team —
// or patching an id that matches no team — heals to "no team active" rather
// than erroring, because teamlessness is a valid state and an active id must
// always resolve.
function healActiveAgentTeamId(config: MutableDaemonConfig): MutableDaemonConfig {
  const section = config.agentTeams;
  const activeTeamId = section?.activeTeamId;
  if (typeof activeTeamId !== "string") {
    return config;
  }
  const teams = Array.isArray(section.teams) ? section.teams : [];
  if (teams.some((team) => team.id === activeTeamId)) {
    return config;
  }
  return { ...config, agentTeams: { ...section, activeTeamId: null } };
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
  const mcpToolGroups = readMcpToolGroups(mutable);
  const agentBehaviors = readAgentBehaviors(mutable);
  const metadataGenerationProviders = readMetadataGenerationProviders(mutable);
  const metadataGenerationFlags = readMetadataGenerationFlags(mutable);
  const agentPersonalities = readAgentPersonalities(mutable);
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
    enabled: metadataGenerationFlags.enabled,
    preferWriterPersonalities: metadataGenerationFlags.preferWriterPersonalities,
  };
  const shouldPersistMetadataGeneration = computeShouldPersistMetadataGeneration({
    providerCount: metadataGenerationProviders.length,
    hadSection: persisted.agents?.metadataGeneration !== undefined,
    flags: metadataGenerationFlags,
  });

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

  // Fold the personality roster into agents.agentPersonalities.
  nextAgents = withAgentPersonalities({
    nextAgents,
    persistedAgents,
    hadPersonalities: persisted.agents?.agentPersonalities !== undefined,
    personalities: agentPersonalities,
  });

  // Fold the teams + active team id into agents.agentTeams.
  nextAgents = withAgentTeams({
    nextAgents,
    persistedAgents,
    hadTeams: persisted.agents?.agentTeams !== undefined,
    section: readAgentTeamsSection(mutable),
  });

  // Fold the plain array sections (model-tier tags, remembered endpoints) in.
  nextAgents = withAgentArraySections({ nextAgents, persistedAgents, persisted, mutable });

  return {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      mcp: buildPersistedMcpSection({
        persistedMcp: persisted.daemon?.mcp,
        injectIntoAgents: mutable.mcp.injectIntoAgents,
        toolGroups: mcpToolGroups,
      }),
      browserTools: {
        ...persisted.daemon?.browserTools,
        enabled: browserToolsEnabled,
      },
      agentBehaviors: {
        ...persisted.daemon?.agentBehaviors,
        ...agentBehaviors,
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

// Attach the personality roster to the persisted agents section. Writes when
// there is a roster to persist, or when a previously-written roster must be
// cleared to empty (so deleting the last personality survives a restart).
function withAgentPersonalities(params: {
  nextAgents: PersistedConfig["agents"];
  persistedAgents: Record<string, unknown> | undefined;
  hadPersonalities: boolean;
  personalities: PersistedAgentPersonality[];
}): PersistedConfig["agents"] {
  const { nextAgents, persistedAgents, hadPersonalities, personalities } = params;
  if (personalities.length === 0 && !hadPersonalities) {
    return nextAgents;
  }
  // Spread the existing section so sibling keys written by a newer daemon
  // round-trip instead of being dropped on every config write.
  const baseAgents = nextAgents ?? persistedAgents;
  const existingSection = isRecord(baseAgents?.["agentPersonalities"])
    ? (baseAgents["agentPersonalities"] as Record<string, unknown>)
    : {};
  return {
    ...baseAgents,
    agentPersonalities: { ...existingSection, personalities },
  } as PersistedConfig["agents"];
}

interface AgentTeamsPersistSection {
  teams: PersistedAgentTeam[];
  activeTeamId: string | null;
}

// Read the teams section out of the mutable config, dropping entries that lack
// the required identity fields (id/name). Parsing each entry through the
// persisted schema (passthrough at every level) re-validates the known fields
// AND carries unknown fields through untouched — so a team field written by a
// newer daemon round-trips instead of being silently stripped on the next
// patch. Member-id validation happens at use time against the roster, not here.
function readAgentTeamsSection(mutable: MutableDaemonConfig): AgentTeamsPersistSection {
  const section = mutable.agentTeams;
  if (!isRecord(section)) {
    return { teams: [], activeTeamId: null };
  }
  const rawTeams = section["teams"];
  const teams = Array.isArray(rawTeams)
    ? rawTeams.flatMap((entry) => {
        const parsed = AgentTeamConfigSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const activeTeamId = section["activeTeamId"];
  return {
    teams,
    activeTeamId: typeof activeTeamId === "string" ? activeTeamId : null,
  };
}

// Attach the teams section to the persisted agents section. Writes when there
// is anything to persist, or when a previously-written section must be cleared
// to empty (so deleting the last team survives a restart). A null/absent
// active id persists as an omitted key — the section's presence alone is what
// blocks re-seeding.
function withAgentTeams(params: {
  nextAgents: PersistedConfig["agents"];
  persistedAgents: Record<string, unknown> | undefined;
  hadTeams: boolean;
  section: AgentTeamsPersistSection;
}): PersistedConfig["agents"] {
  const { nextAgents, persistedAgents, hadTeams, section } = params;
  if (section.teams.length === 0 && section.activeTeamId === null && !hadTeams) {
    return nextAgents;
  }
  // Spread the existing section so sibling keys written by a newer daemon
  // round-trip; teams and activeTeamId are then set explicitly (activeTeamId
  // deleted when inactive so a stale id can't resurrect from disk).
  const baseAgents = nextAgents ?? persistedAgents;
  const existingSection = isRecord(baseAgents?.["agentTeams"])
    ? (baseAgents["agentTeams"] as Record<string, unknown>)
    : {};
  const nextSection: Record<string, unknown> = { ...existingSection, teams: section.teams };
  if (section.activeTeamId !== null) {
    nextSection["activeTeamId"] = section.activeTeamId;
  } else {
    delete nextSection["activeTeamId"];
  }
  return {
    ...baseAgents,
    agentTeams: nextSection,
  } as PersistedConfig["agents"];
}

// The agents sections that are plain replace-the-whole-array lists: user
// model-tier tags and the remembered provider endpoints. Each is written when
// there is anything to persist, or when a previously-written array must be
// cleared to empty — so removing the last tag, or forgetting the last endpoint,
// survives a restart instead of being re-read off stale disk state.
function withAgentArraySections(params: {
  nextAgents: PersistedConfig["agents"];
  persistedAgents: Record<string, unknown> | undefined;
  persisted: PersistedConfig;
  mutable: MutableDaemonConfig;
}): PersistedConfig["agents"] {
  const { nextAgents, persistedAgents, persisted, mutable } = params;
  const sections = {
    modelTierOverrides: mutable.modelTierOverrides,
    savedProviderEndpoints: mutable.savedProviderEndpoints,
  };

  const writable = Object.entries(sections).filter(
    ([key, values]) =>
      values.length > 0 ||
      (persisted.agents as Record<string, unknown> | undefined)?.[key] !== undefined,
  );
  if (writable.length === 0) {
    return nextAgents;
  }

  return {
    ...(nextAgents ?? persistedAgents),
    ...Object.fromEntries(writable),
  } as PersistedConfig["agents"];
}

function readBrowserToolsEnabled(mutable: MutableDaemonConfig): boolean {
  const browserTools = mutable.browserTools;
  if (!isRecord(browserTools)) {
    return false;
  }
  return browserTools["enabled"] === true;
}

const OTTO_TOOL_GROUP_SET = new Set<string>(OTTO_TOOL_GROUPS);

// Read the Otto tool-group allowlist off the MCP section. undefined = all
// groups enabled (never written to disk); a defined array is validated against
// the known group set so a stray value can never wedge config.json.
function readMcpToolGroups(mutable: MutableDaemonConfig): OttoToolGroup[] | undefined {
  const mcp = mutable.mcp;
  if (!isRecord(mcp)) {
    return undefined;
  }
  const groups = mcp["toolGroups"];
  if (!Array.isArray(groups)) {
    return undefined;
  }
  return groups.filter(
    (g): g is OttoToolGroup => typeof g === "string" && OTTO_TOOL_GROUP_SET.has(g),
  );
}

interface AgentBehaviorsPersistShape {
  promptSuggestions: boolean;
  agentProgressSummaries: boolean;
  notifyOnFinishDefault: boolean;
}

// Read the agent-behavior toggles off the mutable config. The wire schema
// defaults every field, so the mutable always carries them; a rollback that
// dropped a field reads as its implicit default (on).
function readAgentBehaviors(mutable: MutableDaemonConfig): AgentBehaviorsPersistShape {
  const behaviors: Record<string, unknown> = isRecord(mutable.agentBehaviors)
    ? mutable.agentBehaviors
    : {};
  return {
    promptSuggestions: behaviors["promptSuggestions"] !== false,
    agentProgressSummaries: behaviors["agentProgressSummaries"] !== false,
    notifyOnFinishDefault: behaviors["notifyOnFinishDefault"] !== false,
  };
}

interface MetadataGenerationFlags {
  enabled: boolean;
  preferWriterPersonalities: boolean;
}

// Persist the mcp section, carrying an explicit toolGroups allowlist only when
// defined (undefined = all groups enabled — never frozen onto disk).
function buildPersistedMcpSection(params: {
  persistedMcp: NonNullable<PersistedConfig["daemon"]>["mcp"] | undefined;
  injectIntoAgents: boolean;
  toolGroups: OttoToolGroup[] | undefined;
}): Record<string, unknown> {
  const { persistedMcp, injectIntoAgents, toolGroups } = params;
  return {
    ...persistedMcp,
    injectIntoAgents,
    ...(toolGroups !== undefined ? { toolGroups } : {}),
  };
}

function computeShouldPersistMetadataGeneration(params: {
  providerCount: number;
  hadSection: boolean;
  flags: MetadataGenerationFlags;
}): boolean {
  const { providerCount, hadSection, flags } = params;
  return (
    providerCount > 0 ||
    hadSection ||
    flags.enabled === false ||
    flags.preferWriterPersonalities === true
  );
}

function readMetadataGenerationFlags(mutable: MutableDaemonConfig): MetadataGenerationFlags {
  const metadataGeneration: Record<string, unknown> = isRecord(mutable.metadataGeneration)
    ? mutable.metadataGeneration
    : {};
  return {
    enabled: metadataGeneration["enabled"] !== false,
    preferWriterPersonalities: metadataGeneration["preferWriterPersonalities"] === true,
  };
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

// Read the agent personality roster out of the mutable config, dropping entries
// that lack the required identity fields (id/name/provider/model). Parsing each
// entry through the persisted schema (which is .passthrough() at every level)
// re-validates the known fields AND carries unknown fields through untouched —
// so a personality field written by a newer daemon round-trips instead of being
// silently stripped on the next patch. Effort/role validation happens at use
// time against the daemon's live catalog, not here.
function readAgentPersonalities(mutable: MutableDaemonConfig): PersistedAgentPersonality[] {
  const section = mutable.agentPersonalities;
  if (!isRecord(section)) {
    return [];
  }
  const personalities = section["personalities"];
  if (!Array.isArray(personalities)) {
    return [];
  }
  return personalities.flatMap((entry) => {
    const parsed = AgentPersonalityConfigSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
