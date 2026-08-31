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
import type { AgentProfile, AgentSkillSelection, AgentTeam } from "@otto-code/protocol/messages";

import {
  buildPersistedDaemonSection,
  buildPersistedGitHosting,
  computeShouldPersistMetadataGeneration,
  extractProviderRemovals,
  healActiveAgentTeamId,
  mergeSpeechIntoPersistedFeatures,
  mergeSpeechOpenAiIntoPersistedProviders,
  readAgentTeamsSection,
  readMetadataGenerationFlags,
  readMetadataGenerationProviders,
  resolveNextAgents,
  restoreConnectorSecretsInPatch,
  stripRedactedSecretsFromPatch,
  withAgentArraySections,
  withAgentTeams,
} from "./otto-daemon-config.js";

// Back-compat: the session, the websocket server, and the connector tests
// import these from this file.
export {
  DAEMON_CONFIG_SECRET_SENTINEL,
  redactDaemonConfigForClient,
} from "./otto-daemon-config.js";

export type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
// The re-export serves importers; this binds the names for use in this file.
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";

type ProviderOverride = import("./agent/provider-launch-config.js").ProviderOverride;

/**
 * OTTO: the sections Otto persists that upstream's daemon has no equivalent of.
 * They are copied through verbatim rather than narrowed field by field, because
 * each is read back off the resolved config when persisting.
 */
const OTTO_SUPPORTED_PATCH_KEYS = [
  "agentBehaviors",
  "gitFetch",
  "hideMergeIntoBaseAction",
  "attachmentImageMaxAgeDays",
  "attachmentImageMaxTotalMb",
  "terminalTitleMode",
  "terminalTitleIncludePaths",
  "defaultTerminalShell",
  "speech",
  "gitHosting",
  "projectKnowledge",
  "projectArtifacts",
  "projectWorkflows",
  "agentPersonalities",
  "agentTeams",
  "modelTierOverrides",
  "modelVisibilityOverrides",
  "savedProviderEndpoints",
  "lsp",
  "dotnetSolutionManagement",
  "brain",
  "connectors",
  "kanban",
] as const satisfies readonly (keyof MutableDaemonConfigPatch)[];

type OttoSupportedPatchKey = (typeof OTTO_SUPPORTED_PATCH_KEYS)[number];
type OttoSupportedPatch = Partial<Pick<MutableDaemonConfigPatch, OttoSupportedPatchKey>>;

interface SupportedMutableConfigPatch extends OttoSupportedPatch {
  relay?: { enabled?: boolean };
  mcp?: { injectIntoAgents?: boolean };
  browserTools?: { enabled?: boolean };
  providers?: MutableDaemonConfig["providers"];
  removeProviders?: string[];
  metadataGeneration?: MutableDaemonConfigPatch["metadataGeneration"];
  autoArchiveAfterMerge?: boolean;
  enableTerminalAgentHooks?: boolean;
  appendSystemPrompt?: string;
  terminalProfiles?: MutableDaemonConfig["terminalProfiles"];
  agentProfiles?: MutableDaemonConfig["agentProfiles"];
  skills?: MutableDaemonConfig["skills"];
  pluginsEnabled?: boolean;
  plugins?: MutableDaemonConfig["plugins"];
}

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
}

export interface DaemonConfigChangeDetails {
  /** Provider ids whose config entries were removed by this patch. */
  removedProviders: readonly string[];
}

export interface DaemonConfigReloadResult {
  appliedPaths: string[];
  restartRequiredPaths: string[];
  overrideControlledPaths: string[];
}

export interface DaemonConfigReloadSource {
  resolve(persisted: PersistedConfig): {
    mutable: MutableDaemonConfig;
    overrideControlledPaths: readonly string[];
  };
}

type ConfigListener = (config: MutableDaemonConfig, details: DaemonConfigChangeDetails) => void;
type ConfigApplyRollback = () => void;
type ConfigApplyListener = (
  config: MutableDaemonConfig,
  previous: MutableDaemonConfig,
  details: DaemonConfigChangeDetails,
) => ConfigApplyRollback;
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

function omitProvidersFromConfig<T extends { providers?: Record<string, unknown> }>(
  config: T,
  providers: readonly string[],
): T {
  if (providers.length === 0 || !config.providers) {
    return config;
  }

  let changed = false;
  const nextProviders = { ...config.providers };
  for (const provider of providers) {
    if (provider in nextProviders) {
      delete nextProviders[provider];
      changed = true;
    }
  }

  return changed ? ({ ...config, providers: nextProviders } as T) : config;
}

function omitMetadataGenerationProvidersFromConfig<
  T extends { metadataGeneration?: { providers?: Array<{ provider?: unknown }> } },
>(config: T, providers: readonly string[]): T {
  if (providers.length === 0 || !config.metadataGeneration?.providers) {
    return config;
  }

  const removedProviderIds = new Set(providers);
  const nextProviders = config.metadataGeneration.providers.filter((entry) => {
    return typeof entry.provider !== "string" || !removedProviderIds.has(entry.provider);
  });
  if (nextProviders.length === config.metadataGeneration.providers.length) {
    return config;
  }

  return {
    ...config,
    metadataGeneration: {
      ...config.metadataGeneration,
      providers: nextProviders,
    },
  } as T;
}

function getValueAtPath(config: MutableDaemonConfig, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), config);
}

function isEqualValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const RELOADABLE_PATHS = [
  "daemon.relay.enabled",
  "daemon.mcp.enabled",
  "daemon.mcp.injectIntoAgents",
  "daemon.browserTools.enabled",
  "daemon.hostnames",
  "daemon.cors.allowedOrigins",
  "daemon.trustedProxies",
  "daemon.git.maxProcessesPerSecond",
  "daemon.git.maxProcessConcurrency",
  "daemon.autoArchiveAfterMerge",
  "daemon.enableTerminalAgentHooks",
  "daemon.appendSystemPrompt",
  "daemon.terminalProfiles",
  "daemon.agentProfiles",
  "app.baseUrl",
  "agents.providers",
  "agents.catalogRefreshTimeoutMs",
  "agents.metadataGeneration",
  "agents.skills.selection",
  "pluginsEnabled",
] as const;

const PERSISTED_TO_MUTABLE_PATH = new Map<string, string>([
  ["daemon.relay.enabled", "relay.enabled"],
  ["daemon.mcp.enabled", "mcp.enabled"],
  ["daemon.mcp.injectIntoAgents", "mcp.injectIntoAgents"],
  ["daemon.browserTools.enabled", "browserTools.enabled"],
  ["daemon.hostnames", "hostnames"],
  ["daemon.cors.allowedOrigins", "cors.allowedOrigins"],
  ["daemon.trustedProxies", "trustedProxies"],
  ["daemon.git.maxProcessesPerSecond", "git.maxProcessesPerSecond"],
  ["daemon.git.maxProcessConcurrency", "git.maxProcessConcurrency"],
  ["daemon.autoArchiveAfterMerge", "autoArchiveAfterMerge"],
  ["daemon.enableTerminalAgentHooks", "enableTerminalAgentHooks"],
  ["daemon.appendSystemPrompt", "appendSystemPrompt"],
  ["daemon.terminalProfiles", "terminalProfiles"],
  ["daemon.agentProfiles", "agentProfiles"],
  ["app.baseUrl", "app.baseUrl"],
  ["agents.providers", "providers"],
  ["agents.catalogRefreshTimeoutMs", "catalogRefreshTimeoutMs"],
  ["agents.metadataGeneration", "metadataGeneration"],
  ["agents.skills.selection", "skills.selection"],
  ["pluginsEnabled", "pluginsEnabled"],
]);

function pathBelongsTo(path: string, owner: string): boolean {
  return path === owner || path.startsWith(`${owner}.`);
}

function diffPaths(previous: unknown, next: unknown, prefix = ""): string[] {
  if (isEqualValue(previous, next)) return [];
  if (!isRecord(previous) || !isRecord(next)) {
    if (isRecord(previous)) return leafPaths(previous, prefix);
    if (isRecord(next)) return leafPaths(next, prefix);
    return prefix ? [prefix] : [];
  }

  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return Array.from(keys).flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return diffPaths(previous[key], next[key], path);
  });
}

function leafPaths(record: Record<string, unknown>, prefix: string): string[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isRecord(value) ? leafPaths(value, path) : [path];
  });
}

function compactOwnedPaths(paths: readonly string[], owners: readonly string[]): string[] {
  const compacted = new Set<string>();
  for (const path of paths) {
    const owner = owners.find((candidate) => pathBelongsTo(path, candidate));
    compacted.add(owner ?? path);
  }
  return Array.from(compacted).sort();
}

/** OTTO: the sections listed in OTTO_SUPPORTED_PATCH_KEYS, copied through verbatim. */
function pickOttoPatchFields(patch: MutableDaemonConfigPatch): OttoSupportedPatch {
  const picked: Record<string, unknown> = {};
  for (const key of OTTO_SUPPORTED_PATCH_KEYS) {
    if (patch[key] !== undefined) picked[key] = patch[key];
  }
  return picked as OttoSupportedPatch;
}

function pickSupportedPatchFields(patch: MutableDaemonConfigPatch): SupportedMutableConfigPatch {
  return {
    ...pickOttoPatchFields(patch),
    ...(patch.relay?.enabled !== undefined ? { relay: { enabled: patch.relay.enabled } } : {}),
    ...(patch.mcp?.injectIntoAgents !== undefined
      ? { mcp: { injectIntoAgents: patch.mcp.injectIntoAgents } }
      : {}),
    ...(patch.browserTools?.enabled !== undefined
      ? { browserTools: { enabled: patch.browserTools.enabled } }
      : {}),
    // OTTO: a null entry is a provider uninstall, already lifted into
    // removeProviders by extractProviderRemovals. Drop any that remain so the
    // merged config never carries a null provider entry.
    ...(patch.providers !== undefined
      ? {
          providers: Object.fromEntries(
            Object.entries(patch.providers).filter(([, value]) => value !== null),
          ) as MutableDaemonConfig["providers"],
        }
      : {}),
    ...(patch.removeProviders !== undefined ? { removeProviders: patch.removeProviders } : {}),
    // OTTO: the whole section rides rather than only `providers` - Otto also
    // persists metadataGeneration.enabled and .preferWriterPersonalities.
    ...(patch.metadataGeneration !== undefined
      ? { metadataGeneration: patch.metadataGeneration }
      : {}),
    ...(patch.autoArchiveAfterMerge !== undefined
      ? { autoArchiveAfterMerge: patch.autoArchiveAfterMerge }
      : {}),
    ...(patch.enableTerminalAgentHooks !== undefined
      ? { enableTerminalAgentHooks: patch.enableTerminalAgentHooks }
      : {}),
    ...(patch.appendSystemPrompt !== undefined
      ? { appendSystemPrompt: patch.appendSystemPrompt }
      : {}),
    ...(patch.terminalProfiles !== undefined ? { terminalProfiles: patch.terminalProfiles } : {}),
    ...(patch.agentProfiles !== undefined ? { agentProfiles: patch.agentProfiles } : {}),
    ...(patch.pluginsEnabled !== undefined ? { pluginsEnabled: patch.pluginsEnabled } : {}),
    ...(patch.plugins !== undefined ? { plugins: patch.plugins } : {}),
  };
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
  private readonly applyListeners = new Set<ConfigApplyListener>();
  private readonly fieldChangeHandlers = new Map<string, Set<FieldChangeHandler>>();
  private readonly relayEnabledMutable: boolean;
  private readonly reloadSource: DaemonConfigReloadSource | undefined;
  private readonly startupPersisted: PersistedConfig;
  private lastKnownPersisted: PersistedConfig;

  constructor(
    ottoHome: string,
    initial: MutableDaemonConfig,
    logger?: LoggerLike,
    options: {
      relayEnabledMutable?: boolean;
      reloadSource?: DaemonConfigReloadSource;
      startupPersisted?: PersistedConfig;
    } = {},
  ) {
    this.ottoHome = ottoHome;
    this.logger = getLogger(logger);
    this.current = MutableDaemonConfigSchema.parse({
      ...initial,
      relay: initial.relay ?? { enabled: true },
    });
    this.relayEnabledMutable = options.relayEnabledMutable ?? true;
    this.reloadSource = options.reloadSource;
    this.startupPersisted = options.startupPersisted ?? loadPersistedConfig(ottoHome, this.logger);
    this.lastKnownPersisted = this.startupPersisted;
  }

  public get(): MutableDaemonConfig {
    return this.current;
  }

  /**
   * Seed the shipped starter roster into `daemon.agentProfiles` the first time
   * this host runs the feature - but ONLY when the persisted config carries
   * neither an agentProfiles section nor a legacy agentPersonalities one. Once
   * either exists on disk (even as an empty roster the user cleared), this is a
   * no-op, so deleting the whole team sticks across restarts instead of silently
   * re-seeding. The in-memory config is seeded separately at construction (see
   * bootstrap); this only records the one-time initialization on disk, writing
   * just the profiles branch so unrelated defaults (speech, etc.) are never
   * frozen onto disk as a side effect.
   */
  public seedDefaultProfilesIfAbsent(defaults: readonly AgentProfile[]): void {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    if (
      persisted.daemon?.agentProfiles !== undefined ||
      persisted.agents?.agentPersonalities !== undefined
    ) {
      return;
    }
    savePersistedConfig(
      this.ottoHome,
      {
        ...persisted,
        daemon: {
          ...persisted.daemon,
          agentProfiles: [...defaults],
        },
      },
      this.logger,
    );
    this.logger?.info(`Seeded ${defaults.length} default agent profiles`);
  }

  /**
   * COMPAT(agentPersonalities): added in v0.8.13, remove after 2027-02-22.
   *
   * Fold a pre-convergence host's `agents.agentPersonalities` roster into
   * `daemon.agentProfiles`, which is now the one stored template list.
   * `AgentProfile` is a strict superset of `AgentPersonality`, so this is a
   * copy rather than a translation - and ids are preserved verbatim, which is
   * what keeps personality memory (files named `<id>.json`), the usage stats
   * store, and `agentTeams.memberIds` resolving without a data migration.
   *
   * One-shot, guarded by its own marker rather than by the roster being empty:
   * a user who imports and then deletes every profile must not get the roster
   * back on the next start. Existing profiles win on an id collision, and the
   * legacy section is left on disk untouched as a rollback tombstone.
   */
  public importLegacyPersonalitiesIfNeeded(): void {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    if (persisted.daemon?.agentProfilesImportedPersonalities === true) {
      return;
    }
    const legacy = persisted.agents?.agentPersonalities?.personalities ?? [];
    const existing = persisted.daemon?.agentProfiles ?? [];
    const existingIds = new Set(existing.map((profile) => profile.id));
    const imported = legacy.filter((personality) => !existingIds.has(personality.id));
    savePersistedConfig(
      this.ottoHome,
      {
        ...persisted,
        daemon: {
          ...persisted.daemon,
          ...(imported.length > 0 ? { agentProfiles: [...existing, ...imported] } : {}),
          agentProfilesImportedPersonalities: true,
        },
      },
      this.logger,
    );
    if (imported.length > 0) {
      this.current = {
        ...this.current,
        agentProfiles: [...existing, ...imported],
      };
      this.logger?.info(`Imported ${imported.length} agent personalities into agent profiles`);
    }
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
    // OTTO: secrets are masked on the way out to a client, so a round-tripped
    // patch carries the sentinel rather than the stored value. Both of these
    // run on the raw client patch, before the supported-field pick narrows it.
    stripRedactedSecretsFromPatch(parsedPatch);
    restoreConnectorSecretsInPatch(parsedPatch, this.current);
    // OTTO: a `providers` entry set to null is a provider uninstall. Fold those
    // into removeProviders so upstream's removal path sees one representation.
    const { patch: prunedPatch, removedProviderIds } = extractProviderRemovals(parsedPatch);
    return this.applySupportedPatch({
      ...pickSupportedPatchFields(prunedPatch),
      ...(removedProviderIds.length > 0 ? { removeProviders: removedProviderIds } : {}),
    });
  }

  public setAgentSkillSelection(selection: AgentSkillSelection): MutableDaemonConfig {
    return this.applySupportedPatch({ skills: { selection } });
  }

  private applySupportedPatch(parsedPatch: SupportedMutableConfigPatch): MutableDaemonConfig {
    if (parsedPatch.relay?.enabled !== undefined && !this.relayEnabledMutable) {
      throw new Error(
        "Relay is controlled by a daemon launch override. Remove OTTO_RELAY_ENABLED or the relay CLI flag before changing it here.",
      );
    }
    const { removeProviders = [], ...configPatch } = parsedPatch;
    const removedProviders = Array.from(new Set(removeProviders));
    const merged = deepMerge(this.current, configPatch);
    if (parsedPatch.skills?.selection !== undefined) {
      merged.skills = { selection: parsedPatch.skills.selection };
    }
    if (parsedPatch.plugins !== undefined) merged.plugins = parsedPatch.plugins;
    // OTTO: healActiveAgentTeamId clears activeTeamId when the patch deleted the
    // team it pointed at, so a removed team cannot leave the host pinned to a
    // roster that no longer exists.
    const next = healActiveAgentTeamId(
      MutableDaemonConfigSchema.parse(
        omitMetadataGenerationProvidersFromConfig(
          omitProvidersFromConfig(merged, removedProviders),
          removedProviders,
        ),
      ),
    );

    const configChanged = !isEqualValue(this.current, next);

    // A patch that changes nothing still has to run when it removes a provider:
    // the removal is expressed outside the config value itself.
    if (!configChanged && removedProviders.length === 0) {
      return this.current;
    }

    const { previous: persistedBeforePatch, knownNext } = this.persistConfig(
      next,
      removedProviders,
    );
    if (!configChanged) {
      this.lastKnownPersisted = knownNext;
      return this.current;
    }

    try {
      this.applyReplacement(next, { removedProviders });
      this.lastKnownPersisted = knownNext;
    } catch (error) {
      savePersistedConfig(this.ottoHome, persistedBeforePatch, this.logger);
      throw error;
    }

    return this.current;
  }

  public reload(): DaemonConfigReloadResult {
    if (!this.reloadSource) {
      throw new Error("Daemon config reload is unavailable for this daemon instance");
    }

    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    const resolved = this.reloadSource.resolve(persisted);
    // Plugin source changes require the plugin lifecycle operation or a daemon
    // restart. The global switch is independently reloadable.
    const desired = MutableDaemonConfigSchema.parse({
      ...resolved.mutable,
      plugins: this.current.plugins,
    });
    const changedSinceLastApply = diffPaths(this.lastKnownPersisted, persisted);
    const overrideControlledPaths = compactOwnedPaths(
      changedSinceLastApply.filter((path) =>
        resolved.overrideControlledPaths.some((owner) => pathBelongsTo(path, owner)),
      ),
      resolved.overrideControlledPaths,
    );
    const appliedPaths = RELOADABLE_PATHS.filter((persistedPath) => {
      if (resolved.overrideControlledPaths.some((owner) => pathBelongsTo(persistedPath, owner))) {
        return false;
      }
      const mutablePath = PERSISTED_TO_MUTABLE_PATH.get(persistedPath);
      return (
        mutablePath !== undefined &&
        !isEqualValue(
          getValueAtPath(this.current, mutablePath),
          getValueAtPath(desired, mutablePath),
        )
      );
    });
    const restartRequiredPaths = compactOwnedPaths(
      diffPaths(this.startupPersisted, persisted).filter((path) => {
        if (path === "$schema" || path === "version") return false;
        if (RELOADABLE_PATHS.some((owner) => pathBelongsTo(path, owner))) return false;
        return !resolved.overrideControlledPaths.some((owner) => pathBelongsTo(path, owner));
      }),
      [],
    );

    const removedProviders = Object.keys(this.current.providers).filter(
      (provider) => !(provider in desired.providers),
    );
    this.applyReplacement(desired, { removedProviders });
    this.lastKnownPersisted = persisted;

    return {
      appliedPaths: [...appliedPaths].sort(),
      restartRequiredPaths,
      overrideControlledPaths,
    };
  }

  private applyReplacement(
    next: MutableDaemonConfig,
    changeDetails: DaemonConfigChangeDetails,
  ): void {
    const changedFieldPaths = Array.from(this.fieldChangeHandlers.keys()).filter((path) => {
      return !isEqualValue(getValueAtPath(this.current, path), getValueAtPath(next, path));
    });
    if (isEqualValue(this.current, next) && changeDetails.removedProviders.length === 0) return;

    const previous = this.current;
    const appliedFieldChanges: AppliedFieldChange[] = [];
    const applyRollbacks: ConfigApplyRollback[] = [];
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
      for (const listener of this.applyListeners) {
        applyRollbacks.push(listener(next, previous, changeDetails));
      }
    } catch (error) {
      this.current = previous;
      const rollbackErrors: unknown[] = [];
      for (const rollback of applyRollbacks.toReversed()) {
        try {
          rollback();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const change of appliedFieldChanges.toReversed()) {
        try {
          change.handler(change.previousValue);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        const rollbackFailure = new Error(
          "Daemon config apply failed and one or more live owners could not roll back",
          { cause: error },
        );
        Object.assign(rollbackFailure, { rollbackErrors });
        throw rollbackFailure;
      }
      throw error;
    }

    for (const listener of this.changeListeners) {
      try {
        listener(next, changeDetails);
      } catch (error) {
        this.logger?.info({ error }, "Daemon config change notification failed");
      }
    }
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
    this.applyReplacement(next, { removedProviders: [] });
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

  public onApply(listener: ConfigApplyListener): () => void {
    // A live owner must either throw before changing its state or return a
    // rollback that restores the previous config. Notifications belong in
    // onChange so they run only after every live owner commits.
    this.applyListeners.add(listener);
    return () => {
      this.applyListeners.delete(listener);
    };
  }

  /**
   * OTTO: upstream merges the *patch* into config.json; Otto merges the
   * resolved config. Otto persists roughly fifteen sections that upstream's
   * daemon has no equivalent of (speech, git hosting, teams, brain, connectors,
   * knowledge/artifact stores, ...), and every one of Otto's persist helpers is
   * written against the whole MutableDaemonConfig - they self-guard on "did this
   * section already exist on disk", so folding the resolved config in does not
   * freeze unrelated defaults the way a naive whole-config write would.
   *
   * Upstream's double-merge contract is preserved exactly: `previous` is the
   * rollback snapshot, `knownNext` is what reload() diffs against to tell an
   * external edit apart from one this store just made.
   */
  private persistConfig(
    config: MutableDaemonConfig,
    removeProviders: readonly string[],
  ): { previous: PersistedConfig; knownNext: PersistedConfig } {
    const persisted = loadPersistedConfig(this.ottoHome, this.logger);
    const merge = (source: PersistedConfig) =>
      mergeMutableConfigIntoPersistedConfig({
        persisted: source,
        mutable: config,
        removedProviderIds: removeProviders,
        persistRelayEnabled: this.relayEnabledMutable,
      });
    const nextPersisted = merge(persisted);
    const knownNext = merge(this.lastKnownPersisted);
    savePersistedConfig(this.ottoHome, nextPersisted, this.logger);
    return { previous: persisted, knownNext };
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

  // COMPAT(agentPersonalities): added in v0.8.13, remove after 2027-02-22.
  // The roster now lives in daemon.agentProfiles, so nothing writes
  // agents.agentPersonalities any more. It is deliberately NOT folded in here:
  // resolveNextAgents spreads the persisted agents section verbatim, so leaving
  // it alone preserves the pre-import roster on disk as a rollback tombstone.
  // Folding the (now unmaintained) mutable roster back in would overwrite it
  // with an empty array on the first unrelated config patch.

  // Fold the teams + active team id into agents.agentTeams.
  nextAgents = withAgentTeams({
    nextAgents,
    persistedAgents,
    hadTeams: persisted.agents?.agentTeams !== undefined,
    section: readAgentTeamsSection(mutable),
  });

  // Fold the plain array sections (model-tier tags, remembered endpoints) in.
  nextAgents = withAgentArraySections({ nextAgents, persistedAgents, persisted, mutable });

  // Upstream's agent skill selection persists alongside Otto's agent sections.
  if (mutable.skills?.selection !== undefined) {
    nextAgents = {
      ...nextAgents,
      skills: { selection: mutable.skills.selection },
    } as PersistedConfig["agents"];
  }

  return {
    ...persisted,
    ...(mutable.pluginsEnabled !== undefined ? { pluginsEnabled: mutable.pluginsEnabled } : {}),
    ...(mutable.plugins !== undefined ? { plugins: mutable.plugins } : {}),
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
