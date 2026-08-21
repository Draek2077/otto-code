import {
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "./persisted-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { type ConnectorAuthState, type ConnectorConfig } from "@otto-code/protocol/provider-config";
import {
  MutableDaemonConfigSchema,
  MutableDaemonConfigPatchSchema,
} from "@otto-code/protocol/messages";
import {
  buildPersistedDaemonSection,
  buildPersistedGitHosting,
  computeShouldPersistMetadataGeneration,
  extractProviderRemovals,
  healActiveAgentTeamId,
  mergeSpeechIntoPersistedFeatures,
  mergeSpeechOpenAiIntoPersistedProviders,
  readAgentPersonalities,
  readAgentTeamsSection,
  readMetadataGenerationFlags,
  readMetadataGenerationProviders,
  removeProviders,
  resolveNextAgents,
  restoreConnectorSecretsInPatch,
  stripRedactedSecretsFromPatch,
  withAgentArraySections,
  withAgentPersonalities,
  withAgentTeams,
} from "./otto-daemon-config.js";

export type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";

// Back-compat: the session, the websocket server, and the connector tests
// import these from this file.
export {
  DAEMON_CONFIG_SECRET_SENTINEL,
  redactDaemonConfigForClient,
} from "./otto-daemon-config.js";

type MutableDaemonConfig = import("@otto-code/protocol/messages").MutableDaemonConfig;

type MutableDaemonConfigPatch = import("@otto-code/protocol/messages").MutableDaemonConfigPatch;

type AgentPersonality = import("@otto-code/protocol/messages").AgentPersonality;

type AgentTeam = import("@otto-code/protocol/messages").AgentTeam;

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

interface AppliedFieldChange {
  handler: FieldChangeHandler;
  previousValue: unknown;
}

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
  private readonly relayEnabledMutable: boolean;

  constructor(
    ottoHome: string,
    initial: MutableDaemonConfig,
    logger?: LoggerLike,
    options: { relayEnabledMutable?: boolean } = {},
  ) {
    this.ottoHome = ottoHome;
    this.logger = getLogger(logger);
    this.current = MutableDaemonConfigSchema.parse({
      ...initial,
      relay: initial.relay ?? { enabled: true },
    });
    this.relayEnabledMutable = options.relayEnabledMutable ?? true;
  }

  public get(): MutableDaemonConfig {
    return this.current;
  }

  /**
   * Seed the shipped default Agent Personalities onto disk the first time this
   * host runs the feature - but ONLY when the persisted config has never carried
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
   * runs the teams feature - ONLY when the persisted config has never carried
   * an agentTeams section (mirrors seedDefaultPersonalitiesIfAbsent: once the
   * section exists on disk, even emptied, this is a permanent no-op so
   * deleting the starter team sticks across restarts). Seeds teams only -
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
    if (parsedPatch.relay?.enabled !== undefined && !this.relayEnabledMutable) {
      throw new Error(
        "Relay is controlled by a daemon launch override. Remove OTTO_RELAY_ENABLED or the relay CLI flag before changing it here.",
      );
    }
    // A masked secret that comes back unchanged must not overwrite the stored
    // value with the sentinel placeholder.
    stripRedactedSecretsFromPatch(parsedPatch);
    restoreConnectorSecretsInPatch(parsedPatch, this.current);
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

    const persistedBeforePatch = this.persistConfig(next, removedProviderIds);
    const previous = this.current;
    const appliedFieldChanges: AppliedFieldChange[] = [];
    this.current = next;
    try {
      for (const path of changedFieldPaths) {
        const handlers = this.fieldChangeHandlers.get(path);
        if (!handlers) {
          continue;
        }
        const value = getValueAtPath(next, path);
        const previousValue = getValueAtPath(previous, path);
        for (const handler of handlers) {
          appliedFieldChanges.push({ handler, previousValue });
          handler(value);
        }
      }
    } catch (error) {
      this.current = previous;
      for (const change of appliedFieldChanges.toReversed()) {
        change.handler(change.previousValue);
      }
      savePersistedConfig(this.ottoHome, persistedBeforePatch, this.logger);
      throw error;
    }

    for (const listener of this.changeListeners) {
      listener(next, { removedProviderIds });
    }

    return next;
  }

  /**
   * Write a connector's OAuth state. The only door into `auth`: patch() discards
   * it on the way in so a client cannot mint or clear an authorization, which
   * means the broker needs its own entry point. Pass null to disconnect.
   *
   * A no-op when the connector id is unknown - an authorization that completes
   * after its connector was deleted must not resurrect the connector.
   */
  public setConnectorAuth(
    connectorId: string,
    auth: ConnectorAuthState | null,
  ): MutableDaemonConfig {
    const connectors = this.current.connectors ?? [];
    if (!connectors.some((entry) => entry.id === connectorId)) {
      return this.current;
    }
    const nextConnectors: ConnectorConfig[] = [];
    for (const entry of connectors) {
      if (entry.id !== connectorId) {
        nextConnectors.push(entry);
        continue;
      }
      const { auth: _previous, ...rest } = entry;
      nextConnectors.push(auth ? { ...rest, auth } : rest);
    }
    const next = MutableDaemonConfigSchema.parse({ ...this.current, connectors: nextConnectors });
    if (isEqualValue(this.current, next)) {
      return this.current;
    }
    this.persistConfig(next, []);
    this.current = next;
    for (const listener of this.changeListeners) {
      listener(next, { removedProviderIds: [] });
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

  private persistConfig(
    config: MutableDaemonConfig,
    removedProviderIds: readonly string[],
  ): PersistedConfig {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    const nextPersisted = mergeMutableConfigIntoPersistedConfig({
      persisted,
      mutable: config,
      removedProviderIds,
      persistRelayEnabled: this.relayEnabledMutable,
    });
    savePersistedConfig(this.ottoHome, nextPersisted, this.logger);
    return persisted;
  }
}

function mergeMutableConfigIntoPersistedConfig(params: {
  persisted: PersistedConfig;
  mutable: MutableDaemonConfig;
  removedProviderIds: readonly string[];
  persistRelayEnabled: boolean;
}): PersistedConfig {
  const { persisted, mutable, removedProviderIds, persistRelayEnabled } = params;
  if (!mutable.relay) {
    throw new Error("Mutable daemon config is missing relay state");
  }
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

  let nextAgents = resolveNextAgents({
    persistedAgents,
    providerOverrides,
    removedProviders,
    persistedOverrides,
    shouldPersistMetadataGeneration,
    persistedMetadataGeneration,
    initial: persisted.agents as PersistedConfig["agents"],
  });

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
      ...buildPersistedDaemonSection(persisted, mutable),
      ...(persistRelayEnabled
        ? {
            relay: {
              ...persisted.daemon?.relay,
              enabled: mutable.relay.enabled,
            },
          }
        : {}),
      ...(mutable.agentProfiles !== undefined ? { agentProfiles: mutable.agentProfiles } : {}),
    },
    agents: nextAgents,
    features: mergeSpeechIntoPersistedFeatures(persisted, mutable.speech),
    providers: mergeSpeechOpenAiIntoPersistedProviders(persisted, mutable.speech),
    gitHosting: buildPersistedGitHosting(persisted, mutable.gitHosting),
  } as PersistedConfig;
}
