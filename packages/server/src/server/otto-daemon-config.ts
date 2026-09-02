// Otto's daemon-config layer: the secret masking/redaction cluster, the
// per-feature persisted-section builders and readers, and the agent-array
// resolution helpers. Extracted from the Paseo daemon-config-store shell,
// which keeps the store class, the deep-merge plumbing, and the persisted
// merge composition that calls these builders.
import {
  AgentPersonalityConfigSchema,
  AgentTeamConfigSchema,
  type PersistedConfig,
  type PersistedAgentPersonality,
  type PersistedAgentTeam,
} from "./persisted-config.js";
import {
  OTTO_TOOL_GROUPS,
  STALL_GUARD_DEFAULT_THRESHOLD,
  type ConnectorConfig,
  type OttoToolGroup,
} from "@otto-code/protocol/provider-config";
import {
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  resolveLocalTtsSpeakerId,
} from "./speech/providers/local/models.js";

type MutableDaemonConfig = import("@otto-code/protocol/messages").MutableDaemonConfig;
type MutableDaemonConfigPatch = import("@otto-code/protocol/messages").MutableDaemonConfigPatch;
type ProviderOverride = import("./agent/provider-launch-config.js").ProviderOverride;

// Duplicated from daemon-config-store.ts (keep in sync): this module must not
// import the Paseo file, and these two golden helpers are 3 and 5 lines.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getValueAtPath(config: MutableDaemonConfig, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), config);
}

type MutableSpeechConfig = import("@otto-code/protocol/messages").MutableSpeechConfig;

type MutableGitHostingConfig = import("@otto-code/protocol/messages").MutableGitHostingConfig;

// A stand-in the daemon sends to clients in place of a stored host-provider
// secret, so the real value never rides the wire (the settings UI already hides
// it behind a secure field, but the plaintext was still echoed in the config
// payload). A client saving the config unchanged sends the sentinel straight
// back and patch() restores the stored value instead of overwriting it with the
// placeholder. The settings UI's change-detection usually means an untouched
// secret isn't re-sent at all, but a full-object patch would carry it - so the
// restore is handled defensively rather than relying on the client.
export const DAEMON_CONFIG_SECRET_SENTINEL = "__otto_secret_present__";

/**
 * The post-validation representation of a config write. `patch` contains only
 * values the caller actually supplied; `removedProviderIds` is deliberately
 * separate because deletion is an operation, not an absent provider value.
 *
 * This distinction is the persistence contract: an omitted field can mean an
 * older client did not load it (or a secret was masked), while an empty array,
 * null, or removeProviders entry is explicit user intent.
 */
export interface NormalizedDaemonConfigPatchIntent {
  patch: MutableDaemonConfigPatch;
  removedProviderIds: string[];
}

// Wire paths (within the mutable config) of the secrets masked on the way to
// clients. Deliberately narrow - only host-provider credentials.
const SECRET_WIRE_PATHS: readonly (readonly string[])[] = [
  ["speech", "openai", "apiKey"],
  ["gitHosting", "providers", "bitbucketCloud", "apiToken"],
  ["gitHosting", "providers", "atlassian", "apiToken"],
  ["brain", "authToken"],
  ["brain", "remote", "authToken"],
  // Retired credential slots. Kanban now reuses the host's gh CLI and Atlassian
  // credentials, but a config written before v0.8.11 may still hold these, and
  // an unmasked stale token is exactly as leakable as a live one.
  // COMPAT(kanbanProviderTokens): retired in v0.8.11, delete after 2027-02-28.
  ["kanban", "providers", "github", "token"],
  ["kanban", "providers", "jira", "token"],
];

// Connector secrets can't be expressed in SECRET_WIRE_PATHS: `connectors` is an
// array, and a dotted path has no way to say "every element". They were
// therefore never masked, so every token pasted into a connector was echoed back
// to every connected client in the config payload. These two helpers close that,
// and they have to exist before OAuth lands - a leaked refresh token is a
// standing grant, not a one-off.
//
// Two different mechanisms, deliberately:
//   - env / header values round-trip through the sentinel, because the user owns
//     them and may legitimately re-type one.
//   - `auth` is daemon-owned. The client never authors it (only the OAuth broker
//     does), so it is masked outbound and restored wholesale inbound rather than
//     trusted from the wire at all.
function maskRecordValues(
  values: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    masked[key] = value.length > 0 ? DAEMON_CONFIG_SECRET_SENTINEL : value;
  }
  return masked;
}

function redactConnectorsForClient(connectors: ConnectorConfig[] | undefined): ConnectorConfig[] {
  const redacted: ConnectorConfig[] = [];
  for (const connector of connectors ?? []) {
    const server =
      connector.server.type === "stdio"
        ? { ...connector.server, ...maskedKey("env", maskRecordValues(connector.server.env)) }
        : {
            ...connector.server,
            ...maskedKey("headers", maskRecordValues(connector.server.headers)),
          };
    if (!connector.auth) {
      redacted.push({ ...connector, server });
      continue;
    }
    // Presence, never the value: the UI needs to know a connector is connected
    // and to whom, and nothing more.
    redacted.push({
      ...connector,
      server,
      auth: {
        kind: connector.auth.kind,
        ...(connector.auth.account ? { account: connector.auth.account } : {}),
        ...(connector.auth.authorizedAt ? { authorizedAt: connector.auth.authorizedAt } : {}),
        ...(connector.auth.tokens
          ? { tokens: { accessToken: DAEMON_CONFIG_SECRET_SENTINEL } }
          : {}),
      },
    });
  }
  return redacted;
}

// Omit the key entirely when the value is undefined, so a masked copy never
// introduces an explicit `env: undefined` where the original had no key at all.
function maskedKey<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function restoreRecordSecrets(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) {
    return undefined;
  }
  const restored: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === DAEMON_CONFIG_SECRET_SENTINEL) {
      const storedValue = stored?.[key];
      // No stored value to restore means the sentinel is meaningless - drop the
      // key rather than persisting the placeholder as if it were a credential.
      if (storedValue !== undefined) {
        restored[key] = storedValue;
      }
      continue;
    }
    restored[key] = value;
  }
  return restored;
}

export function restoreConnectorSecretsInPatch(
  patch: MutableDaemonConfigPatch,
  current: MutableDaemonConfig,
): void {
  if (!patch.connectors) {
    return;
  }
  const stored = new Map((current.connectors ?? []).map((entry) => [entry.id, entry]));
  const restoredConnectors: ConnectorConfig[] = [];
  for (const connector of patch.connectors) {
    const previous = stored.get(connector.id);
    const server =
      connector.server.type === "stdio"
        ? {
            ...connector.server,
            ...maskedKey(
              "env",
              restoreRecordSecrets(
                connector.server.env,
                previous?.server.type === "stdio" ? previous.server.env : undefined,
              ),
            ),
          }
        : {
            ...connector.server,
            ...maskedKey(
              "headers",
              restoreRecordSecrets(
                connector.server.headers,
                previous && previous.server.type !== "stdio" ? previous.server.headers : undefined,
              ),
            ),
          };
    // Auth is never taken from the wire. Whatever the daemon holds wins; a
    // client cannot mint, alter, or clear an authorization by saving settings.
    const { auth: _discarded, ...rest } = connector;
    restoredConnectors.push({
      ...rest,
      server,
      ...(previous?.auth ? { auth: previous.auth } : {}),
    });
  }
  patch.connectors = restoredConnectors;
}

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
  // Connectors live in an array, which SECRET_WIRE_PATHS cannot address.
  next = { ...next, connectors: redactConnectorsForClient(config.connectors) };
  return next as MutableDaemonConfig;
}

// Drop any secret leaf whose value is the sentinel from an incoming patch, so
// deepMerge preserves the stored secret (it skips undefined/absent keys) instead
// of persisting the placeholder. Mutates the already-parsed patch in place.
export function stripRedactedSecretsFromPatch(patch: MutableDaemonConfigPatch): void {
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

// The patch-persistence counterpart to stripRedactedSecretsFromPatch. A
// sentinel means "retain the value the daemon already holds", not "delete this
// field": absence is reserved for untouched or unavailable data. Replacing it
// before persistence lets a client round-trip a masked config even when the
// secret originated from a launch override and is not yet on disk.
export function restoreRedactedSecretsInPatch(
  patch: MutableDaemonConfigPatch,
  current: MutableDaemonConfig,
): void {
  for (const path of SECRET_WIRE_PATHS) {
    let container: unknown = patch;
    for (let i = 0; i < path.length - 1; i += 1) {
      container = isRecord(container) ? container[path[i]] : undefined;
    }
    const leafKey = path[path.length - 1];
    if (!isRecord(container) || container[leafKey] !== DAEMON_CONFIG_SECRET_SENTINEL) {
      continue;
    }
    const retained = getValueAtPath(current, path.join("."));
    if (retained === undefined) delete container[leafKey];
    else container[leafKey] = retained;
  }
}

// Post-validation normalization (wire schemas stay pure declarations): never
// let a dangling active team id survive a patch. Deleting the active team -
// or patching an id that matches no team - heals to "no team active" rather
// than erroring, because teamlessness is a valid state and an active id must
// always resolve.
export function healActiveAgentTeamId(config: MutableDaemonConfig): MutableDaemonConfig {
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

/**
 * A patch can ask for a provider's config to be deleted two ways, and both are
 * in the schema: Otto's `providers: { id: null }` sentinel, and upstream's
 * `removeProviders: [id]` list. The app sends the list
 * (`screens/settings/providers-section.tsx`), the snapshot manager already
 * reads it (`provider-snapshot-manager.ts:144`), and `removeProviders` is not a
 * config field, so it is pruned from the patch here rather than being merged
 * into the stored config.
 */
export function extractProviderRemovals(patch: MutableDaemonConfigPatch): {
  patch: MutableDaemonConfigPatch;
  removedProviderIds: string[];
} {
  const { removeProviders: removeProviderIds, ...patchWithoutRemovals } = patch;
  const providers = patchWithoutRemovals.providers;
  const removedProviderIds = Array.from(
    new Set([
      ...(removeProviderIds ?? []),
      ...Object.entries(providers ?? {})
        .filter(([, value]) => value === null)
        .map(([providerId]) => providerId),
    ]),
  );
  if (removedProviderIds.length === 0) {
    return { patch: patchWithoutRemovals, removedProviderIds };
  }

  if (!providers) {
    return { patch: patchWithoutRemovals, removedProviderIds };
  }

  const remainingProviders = Object.fromEntries(
    Object.entries(providers).filter(([, value]) => value !== null),
  );
  return {
    patch: { ...patchWithoutRemovals, providers: remainingProviders },
    removedProviderIds,
  };
}

/**
 * Normalize a validated config patch before it touches runtime state or disk.
 * Wire schemas intentionally stay structural, so secret restoration and the
 * two equivalent provider-removal spellings belong here instead.
 */
export function normalizeDaemonConfigPatchIntent(params: {
  patch: MutableDaemonConfigPatch;
  current: MutableDaemonConfig;
}): NormalizedDaemonConfigPatchIntent {
  const { patch, current } = params;
  restoreRedactedSecretsInPatch(patch, current);
  restoreConnectorSecretsInPatch(patch, current);
  return extractProviderRemovals(patch);
}

export function removeProviders(
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

/** The agents section after provider overrides and metadata-generation are
 *  folded in - extracted from the merge so the top-level merge stays under the
 *  cyclomatic-complexity limit. */
export function resolveNextAgents(params: {
  persistedAgents: Record<string, unknown> | undefined;
  providerOverrides: Record<string, ProviderOverride> | undefined;
  removedProviders: Set<string>;
  persistedOverrides: Record<string, ProviderOverride> | undefined;
  shouldPersistMetadataGeneration: boolean;
  persistedMetadataGeneration: {
    providers: ReturnType<typeof readMetadataGenerationProviders>;
    enabled: boolean;
    preferWriterPersonalities: boolean;
  };
  initial: PersistedConfig["agents"];
}): PersistedConfig["agents"] {
  const {
    persistedAgents,
    providerOverrides,
    removedProviders,
    persistedOverrides,
    shouldPersistMetadataGeneration,
    persistedMetadataGeneration,
    initial,
  } = params;
  const metadata = shouldPersistMetadataGeneration
    ? { metadataGeneration: persistedMetadataGeneration }
    : {};

  if (providerOverrides && Object.keys(providerOverrides).length > 0) {
    return {
      ...persistedAgents,
      providers: providerOverrides,
      ...metadata,
    } as PersistedConfig["agents"];
  }
  if (removedProviders.size > 0 && persistedOverrides) {
    // The last provider override was removed - drop the providers key so the
    // removed entry does not survive in config.json.
    const { providers: _removed, ...agentsWithoutProviders } = persistedAgents ?? {};
    return { ...agentsWithoutProviders, ...metadata } as PersistedConfig["agents"];
  }
  if (shouldPersistMetadataGeneration) {
    return {
      ...persistedAgents,
      metadataGeneration: persistedMetadataGeneration,
    } as PersistedConfig["agents"];
  }
  return initial;
}

/** The daemon section of a persisted config. Extracted to keep the top-level
 *  merge under the cyclomatic-complexity limit; behaviour is unchanged. */
export function buildPersistedDaemonSection(
  persisted: PersistedConfig,
  mutable: MutableDaemonConfig,
): PersistedConfig["daemon"] {
  return {
    ...persisted.daemon,
    mcp: buildPersistedMcpSection({
      persistedMcp: persisted.daemon?.mcp,
      injectIntoAgents: mutable.mcp.injectIntoAgents,
      toolGroups: readMcpToolGroups(mutable),
    }),
    browserTools: {
      ...persisted.daemon?.browserTools,
      enabled: readBrowserToolsEnabled(mutable),
    },
    agentBehaviors: {
      ...persisted.daemon?.agentBehaviors,
      ...readAgentBehaviors(mutable),
    },
    autoArchiveAfterMerge: mutable.autoArchiveAfterMerge,
    ...(mutable.gitFetch ? { gitFetch: mutable.gitFetch } : {}),
    hideMergeIntoBaseAction: mutable.hideMergeIntoBaseAction,
    attachmentImageMaxAgeDays: mutable.attachmentImageMaxAgeDays,
    attachmentImageMaxTotalMb: mutable.attachmentImageMaxTotalMb,
    // Only `enabled` persists. The caps are daemon policy, not a user preference, and writing
    // them to disk would freeze today's defaults into every existing install.
    dotnetSolutionManagement: {
      ...persisted.daemon?.dotnetSolutionManagement,
      enabled: mutable.dotnetSolutionManagement.enabled,
    },
    enableTerminalAgentHooks: mutable.enableTerminalAgentHooks,
    ...(mutable.terminalTitleMode !== undefined
      ? { terminalTitleMode: mutable.terminalTitleMode }
      : {}),
    ...(mutable.terminalTitleIncludePaths !== undefined
      ? { terminalTitleIncludePaths: mutable.terminalTitleIncludePaths }
      : {}),
    ...(mutable.defaultTerminalShell !== undefined
      ? { defaultTerminalShell: mutable.defaultTerminalShell }
      : {}),
    appendSystemPrompt: mutable.appendSystemPrompt,
    ...(mutable.terminalProfiles !== undefined
      ? { terminalProfiles: mutable.terminalProfiles }
      : {}),
    // The local AI host projection round-trips to disk. The brain's own
    // config.json remains the source of truth; BrainManager.applySettings
    // writes the mapped fields through to it on every change.
    brain: buildPersistedBrainSection(persisted, mutable),
    // Connector registry persists under daemon.connectors. Written only once
    // it has content or already existed on disk, so an empty registry never
    // adds noise to every existing install's config.json.
    ...(mutable.connectors.length > 0 || persisted.daemon?.connectors !== undefined
      ? { connectors: mutable.connectors }
      : {}),
    // Knowledge store default. Same restraint as connectors: written only once
    // it differs from the built-in default or already existed on disk, so an
    // install that never touches the setting keeps a clean config.json.
    ...(mutable.projectKnowledge &&
    (mutable.projectKnowledge.defaultStoreLocation !== "repository" ||
      persisted.daemon?.projectKnowledge !== undefined)
      ? { projectKnowledge: mutable.projectKnowledge }
      : {}),
    ...persistProjectArtifactsConfig(persisted, mutable),
  } as PersistedConfig["daemon"];
}

function persistProjectArtifactsConfig(
  persisted: PersistedConfig,
  mutable: MutableDaemonConfig,
): Pick<NonNullable<PersistedConfig["daemon"]>, "projectArtifacts"> | Record<never, never> {
  const artifacts = mutable.projectArtifacts;
  if (!artifacts) return {};
  if (
    artifacts.defaultStoreLocation === "repository" &&
    persisted.daemon?.projectArtifacts === undefined
  )
    return {};
  return { projectArtifacts: artifacts };
}

// The local AI host (otto-brain) editable projection, persisted under
// daemon.brain. The mutable block mirrors the persisted shape 1:1 and is
// passthrough, so spreading it carries every field (including any written by a
// newer daemon) through untouched. The existing section is spread first so a
// sibling key that the mutable somehow lacks still survives.
function buildPersistedBrainSection(
  persisted: PersistedConfig,
  mutable: MutableDaemonConfig,
): Record<string, unknown> {
  const existing = isRecord(persisted.daemon?.brain) ? persisted.daemon.brain : {};
  const brain = isRecord(mutable.brain) ? mutable.brain : {};
  return { ...existing, ...brain };
}

// Host-level hosting credentials persist under gitHosting.providers in
// config.json - one set per provider. The mutable config is the post-merge
// source of truth; empty strings mean "remove" and a provider with no
// remaining credentials is dropped so stale tokens never linger on disk.
export function buildPersistedGitHosting(
  persisted: PersistedConfig,
  patch: MutableGitHostingConfig,
  current: MutableGitHostingConfig | undefined,
): PersistedConfig["gitHosting"] {
  const providers = {
    ...(persisted.gitHosting?.providers as Record<string, Record<string, unknown>> | undefined),
  };
  // Values supplied through launch/config resolution have to survive the first
  // targeted edit, but never overwrite a newer value already on disk. The
  // explicit patch below wins over both.
  const currentProviders = current?.providers as
    | Record<string, Record<string, unknown>>
    | undefined;
  const currentBitbucketCloud = currentProviders?.["bitbucketCloud"];
  if (currentBitbucketCloud) {
    providers["bitbucketCloud"] = {
      ...currentBitbucketCloud,
      ...providers["bitbucketCloud"],
    };
  }
  const patchProviders = patch.providers as Record<string, Record<string, unknown>> | undefined;
  for (const [providerId, providerPatch] of Object.entries(patchProviders ?? {})) {
    if (providerId !== "bitbucketCloud") continue;
    const provider = { ...providers[providerId] };
    for (const [key, value] of Object.entries(providerPatch)) {
      // Empty credential inputs are an explicit clear. Other values, including
      // future passthrough fields, retain their precise patch intent.
      if (typeof value === "string" && value.trim().length === 0) {
        delete provider[key];
      } else {
        provider[key] = value;
      }
    }
    if (Object.keys(provider).length > 0) providers[providerId] = provider;
    else delete providers[providerId];
  }
  return Object.keys(providers).length > 0
    ? ({ providers } as PersistedConfig["gitHosting"])
    : undefined;
}

// The speech OpenAI key lives at providers.openai.apiKey in config.json (the
// path the speech config resolver reads). An empty string in the patch removes
// the stored key; sibling fields (baseUrl, stt/tts endpoints) are preserved.
export function mergeSpeechOpenAiIntoPersistedProviders(
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

export function mergeSpeechIntoPersistedFeatures(
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
export function withAgentPersonalities(params: {
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
// AND carries unknown fields through untouched - so a team field written by a
// newer daemon round-trips instead of being silently stripped on the next
// patch. Member-id validation happens at use time against the roster, not here.
export function readAgentTeamsSection(mutable: MutableDaemonConfig): AgentTeamsPersistSection {
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
// active id persists as an omitted key - the section's presence alone is what
// blocks re-seeding.
export function withAgentTeams(params: {
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
// model-tier tags, model visibility, and remembered provider endpoints. Each is written when
// there is anything to persist, or when a previously-written array must be
// cleared to empty - so removing the last tag, or forgetting the last endpoint,
// survives a restart instead of being re-read off stale disk state.
export function withAgentArraySections(params: {
  nextAgents: PersistedConfig["agents"];
  persistedAgents: Record<string, unknown> | undefined;
  persisted: PersistedConfig;
  mutable: MutableDaemonConfig;
}): PersistedConfig["agents"] {
  const { nextAgents, persistedAgents, persisted, mutable } = params;
  const sections = {
    modelTierOverrides: mutable.modelTierOverrides,
    modelVisibilityOverrides: mutable.modelVisibilityOverrides,
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
  todoNudge: boolean;
  todoReconcileOnIdle: boolean;
  stallGuardThreshold: number;
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
    todoNudge: behaviors["todoNudge"] !== false,
    todoReconcileOnIdle: behaviors["todoReconcileOnIdle"] !== false,
    // Numeric, so the boolean !== false idiom above does not apply: anything
    // that is not a number reads as the built-in default rather than 0 (off).
    stallGuardThreshold:
      typeof behaviors["stallGuardThreshold"] === "number"
        ? behaviors["stallGuardThreshold"]
        : STALL_GUARD_DEFAULT_THRESHOLD,
  };
}

interface MetadataGenerationFlags {
  enabled: boolean;
  preferWriterPersonalities: boolean;
}

// Persist the mcp section, carrying an explicit toolGroups allowlist only when
// defined (undefined = all groups enabled - never frozen onto disk).
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

export function computeShouldPersistMetadataGeneration(params: {
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

export function readMetadataGenerationFlags(mutable: MutableDaemonConfig): MetadataGenerationFlags {
  const metadataGeneration: Record<string, unknown> = isRecord(mutable.metadataGeneration)
    ? mutable.metadataGeneration
    : {};
  return {
    enabled: metadataGeneration["enabled"] !== false,
    preferWriterPersonalities: metadataGeneration["preferWriterPersonalities"] === true,
  };
}

export function readMetadataGenerationProviders(
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
// re-validates the known fields AND carries unknown fields through untouched -
// so a personality field written by a newer daemon round-trips instead of being
// silently stripped on the next patch. Effort/role validation happens at use
// time against the daemon's live catalog, not here.
export function readAgentPersonalities(mutable: MutableDaemonConfig): PersistedAgentPersonality[] {
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
