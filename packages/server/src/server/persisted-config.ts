import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  AgentProviderRuntimeSettingsMapSchema,
  migrateProviderSettings,
  ProviderOverridesSchema,
} from "./agent/provider-launch-config.js";
import type { AgentProviderRuntimeSettingsMap } from "./agent/provider-launch-config.js";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";
import { TerminalProfileSchema } from "@otto-code/protocol/messages";
import { OTTO_TOOL_GROUPS } from "@otto-code/protocol/provider-config";

export const LogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
export const LogFormatSchema = z.enum(["pretty", "json"]);

const LogConfigSchema = z
  .object({
    // Legacy global log settings (kept for backwards compatibility).
    level: LogLevelSchema.optional(),
    format: LogFormatSchema.optional(),

    console: z
      .object({
        level: LogLevelSchema.optional(),
        format: LogFormatSchema.optional(),
      })
      .strict()
      .optional(),

    file: z
      .object({
        level: LogLevelSchema.optional(),
        path: z.string().min(1).optional(),
        rotate: z
          .object({
            maxSize: z.string().min(1).optional(),
            maxFiles: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const OpenAiSpeechEndpointSchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    baseUrl: z.string().trim().min(1).optional(),
  })
  .strict();

const OpenAiProviderSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().trim().min(1).optional(),
    stt: OpenAiSpeechEndpointSchema.optional(),
    tts: OpenAiSpeechEndpointSchema.optional(),
  })
  .strict();

const LocalSpeechProviderSchema = z
  .object({
    modelsDir: z.string().min(1).optional(),
  })
  .strict();

const ProvidersSchema = z
  .object({
    openai: OpenAiProviderSchema.optional(),
    local: LocalSpeechProviderSchema.optional(),
  })
  .strict();

const WorktreesConfigSchema = z
  .object({
    root: z.string().min(1).optional(),
  })
  .strict();

const BcryptHashSchema = z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, {
  message: "Expected a bcrypt hash",
});

const DaemonAuthSchema = z
  .object({
    password: BcryptHashSchema.optional(),
  })
  .strict();

const SpeechProviderIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["openai", "local"]));

const FeatureDictationSchema = z
  .object({
    enabled: z.boolean().optional(),
    stt: z
      .object({
        provider: SpeechProviderIdSchema.optional(),
        model: z.string().min(1).optional(),
        language: z.string().trim().min(1).optional(),
        confidenceThreshold: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const FeatureVoiceModeSchema = z
  .object({
    enabled: z.boolean().optional(),
    llm: z
      .object({
        provider: z.string().optional(),
        model: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    stt: z
      .object({
        provider: SpeechProviderIdSchema.optional(),
        model: z.string().min(1).optional(),
        language: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    turnDetection: z
      .object({
        provider: SpeechProviderIdSchema.optional(),
      })
      .strict()
      .optional(),
    tts: z
      .object({
        provider: SpeechProviderIdSchema.optional(),
        model: z.string().min(1).optional(),
        voice: z
          .enum([
            "alloy",
            "ash",
            "ballad",
            "coral",
            "echo",
            "fable",
            "nova",
            "onyx",
            "sage",
            "shimmer",
            "verse",
          ])
          .optional(),
        speakerId: z.number().int().optional(),
        speed: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const FeatureWebUiSchema = z
  .object({
    enabled: z.boolean().optional(),
    distDir: z.string().min(1).optional(),
  })
  .strict();

const StructuredGenerationProviderConfigSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
  })
  .strict();

const AgentMetadataGenerationSchema = z
  .object({
    providers: z.array(StructuredGenerationProviderConfigSchema).optional(),
    // Master switch for daemon-side metadata generation. Absent = enabled
    // (today's implicit default). Read by the generation path (WP-B).
    enabled: z.boolean().optional(),
    // Prefer a role-matched Writer personality over the cheap default tier for
    // metadata generation. Absent = false (cheap-tier default). Read by WP-B.
    preferWriterPersonalities: z.boolean().optional(),
  })
  .strict();

// Persisted shape of an agent personality. Mirrors AgentPersonalitySchema on the
// wire; effort/roles stay plain strings (validated against the daemon catalog at
// use time). Passthrough so a config written by a newer daemon round-trips
// unknown fields instead of dropping them.
const AgentPersonalitySpinnerConfigSchema = z
  .object({
    glowA: z.string().min(1),
    glowB: z.string().min(1),
  })
  .passthrough();

const AgentPersonalityVoiceConfigSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    name: z.string().min(1),
  })
  .passthrough();

export const AgentPersonalityConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    effortLevel: z.string().min(1).optional(),
    modeId: z.string().min(1).optional(),
    personalityPrompt: z.string().optional(),
    respectGlobalAppendPrompt: z.boolean().optional(),
    roles: z.array(z.string().min(1)).optional(),
    spinner: AgentPersonalitySpinnerConfigSchema.optional(),
    voice: AgentPersonalityVoiceConfigSchema.optional(),
  })
  .passthrough();

export type PersistedAgentPersonality = z.infer<typeof AgentPersonalityConfigSchema>;

// Passthrough like every other persisted level: a sibling key written by a
// newer daemon must survive a rollback (strict would fail the whole config
// load and keep the daemon from booting).
const AgentPersonalitiesSchema = z
  .object({
    personalities: z.array(AgentPersonalityConfigSchema).optional(),
  })
  .passthrough();

// Persisted shape of an agent team. Mirrors AgentTeamSchema on the wire;
// member ids are validated against the roster at use time, not here, so a
// dangling id never blocks config load.
const AgentTeamAvatarConfigSchema = z
  .object({
    color: z.string().min(1).optional(),
    imageId: z.string().min(1).optional(),
  })
  .passthrough();

export const AgentTeamConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    avatar: AgentTeamAvatarConfigSchema.optional(),
    teamPrompt: z.string().optional(),
    memberIds: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export type PersistedAgentTeam = z.infer<typeof AgentTeamConfigSchema>;

const AgentTeamsSchema = z
  .object({
    teams: z.array(AgentTeamConfigSchema).optional(),
    activeTeamId: z.string().nullable().optional(),
  })
  .passthrough();

// Persisted user per-model tier tags. Mirrors ModelTierOverrideSchema on the
// wire; an entry for a model/provider that no longer exists is simply inert.
const ModelTierOverrideConfigSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    tier: z.enum(["deep", "standard", "fast"]),
  })
  .passthrough();

export type PersistedModelTierOverride = z.infer<typeof ModelTierOverrideConfigSchema>;

// Persisted remembered provider endpoints. Mirrors SavedProviderEndpointSchema
// on the wire. The credential is stored in the clear, exactly like the live
// `agents.providers.<id>.env.OPENAI_API_KEY` it was copied from — this is a
// convenience list over values config.json already holds, not a new secret
// store.
const SavedProviderEndpointConfigSchema = z
  .object({
    id: z.string().min(1),
    baseUrlKey: z.string().min(1),
    apiKeyKey: z.string().min(1),
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    label: z.string().optional(),
    savedAt: z.number().optional(),
  })
  .passthrough();

export type PersistedSavedProviderEndpoint = z.infer<typeof SavedProviderEndpointConfigSchema>;

const BUILTIN_PROVIDER_IDS = ["claude", "codex", "copilot", "opencode", "pi", "omp"] as const;

function isLegacyProviderEntry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const command = (value as Record<string, unknown>).command;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return false;
  }

  return typeof (command as Record<string, unknown>).mode === "string";
}

function normalizeAgentProviders(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const rawProviders = value as Record<string, unknown>;
  const hasLegacyEntries = Object.values(rawProviders).some((entry) =>
    isLegacyProviderEntry(entry),
  );
  if (!hasLegacyEntries) {
    return value;
  }

  const legacyEntries: Record<string, unknown> = {};
  const normalizedEntries: Record<string, unknown> = {};

  for (const [providerId, providerValue] of Object.entries(rawProviders)) {
    if (isLegacyProviderEntry(providerValue)) {
      legacyEntries[providerId] = providerValue;
      continue;
    }
    normalizedEntries[providerId] = providerValue;
  }

  const parsedLegacyEntries = AgentProviderRuntimeSettingsMapSchema.safeParse(legacyEntries);
  if (!parsedLegacyEntries.success) {
    return value;
  }

  return {
    ...normalizedEntries,
    ...migrateProviderSettings(parsedLegacyEntries.data, [...BUILTIN_PROVIDER_IDS]),
  };
}

export const PersistedConfigSchema = z
  .object({
    $schema: z.string().optional(),

    // v1 schema marker
    version: z.literal(1).optional(),

    // v1 config layout
    daemon: z
      .object({
        listen: z.string().optional(),
        hostnames: z.union([z.literal(true), z.array(z.string())]).optional(),
        allowedHosts: z.union([z.literal(true), z.array(z.string())]).optional(),
        trustedProxies: z.union([z.literal(true), z.array(z.string())]).optional(),
        mcp: z
          .object({
            enabled: z.boolean().optional(),
            injectIntoAgents: z.boolean().optional(),
            // Otto tool-group allowlist for the MCP (Claude) path. Absent = all
            // groups enabled (mirrors openai-compat's per-provider semantics).
            toolGroups: z.array(z.enum(OTTO_TOOL_GROUPS)).optional(),
          })
          .passthrough()
          .optional(),
        browserTools: z
          .object({
            enabled: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        // Daemon-wide agent behavior toggles (Claude-tier capabilities). Absent
        // fields read as their implicit default (all enabled).
        agentBehaviors: z
          .object({
            promptSuggestions: z.boolean().optional(),
            agentProgressSummaries: z.boolean().optional(),
            notifyOnFinishDefault: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        autoArchiveAfterMerge: z.boolean().optional(),
        hideMergeIntoBaseAction: z.boolean().optional(),
        enableTerminalAgentHooks: z.boolean().optional(),
        appendSystemPrompt: z.string().optional(),
        terminalProfiles: z.array(TerminalProfileSchema).optional(),
        cors: z
          .object({
            allowedOrigins: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        relay: z
          .object({
            enabled: z.boolean().optional(),
            endpoint: z.string().optional(),
            publicEndpoint: z.string().optional(),
            useTls: z.boolean().optional(),
            publicUseTls: z.boolean().optional(),
          })
          .strict()
          .optional(),
        serviceProxy: z
          .object({
            // COMPAT(serviceProxyEnabled): added 2026-06-02, remove after 2026-12-02.
            // Parsed only to suppress optional public/listen layers for old configs;
            // localhost service proxying remains always enabled.
            enabled: z.boolean().optional(),
            listen: z.string().optional(),
            publicBaseUrl: z.url().optional(),
          })
          .strict()
          .optional(),
        auth: DaemonAuthSchema.optional(),
      })
      .strict()
      .transform(({ allowedHosts, ...daemon }) => {
        const hostnames = daemon.hostnames ?? allowedHosts;
        return hostnames === undefined ? daemon : { ...daemon, hostnames };
      })
      .optional(),

    app: z
      .object({
        baseUrl: z.string().optional(),
      })
      .strict()
      .optional(),

    providers: ProvidersSchema.optional(),
    worktrees: WorktreesConfigSchema.optional(),
    agents: z
      .object({
        providers: z.preprocess(normalizeAgentProviders, ProviderOverridesSchema).optional(),
        metadataGeneration: AgentMetadataGenerationSchema.optional(),
        agentPersonalities: AgentPersonalitiesSchema.optional(),
        agentTeams: AgentTeamsSchema.optional(),
        modelTierOverrides: z.array(ModelTierOverrideConfigSchema).optional(),
        savedProviderEndpoints: z.array(SavedProviderEndpointConfigSchema).optional(),
      })
      .strict()
      .optional(),
    features: z
      .object({
        dictation: FeatureDictationSchema.optional(),
        voiceMode: FeatureVoiceModeSchema.optional(),
        webUi: FeatureWebUiSchema.optional(),
      })
      .strict()
      .optional(),

    // Host-level git hosting credentials, one set per provider. This is the
    // ONLY place hosting tokens persist — never in a repo's otto.json.
    gitHosting: z
      .object({
        providers: z
          .object({
            bitbucketCloud: z
              .object({
                email: z.string().optional(),
                apiToken: z.string().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),

    log: LogConfigSchema.optional(),
  })
  .strict();

type PersistedConfigSchemaOutput = z.infer<typeof PersistedConfigSchema>;

export type PersistedConfig = Omit<PersistedConfigSchemaOutput, "agents"> & {
  agents?: Omit<NonNullable<PersistedConfigSchemaOutput["agents"]>, "providers"> & {
    providers?: AgentProviderRuntimeSettingsMap;
  };
};

const CONFIG_FILENAME = "config.json";
// `daemon.listen` is deliberately left unset here so a fresh install's
// config.json doesn't freeze in a value — config.ts computes the effective
// default at runtime (127.0.0.1, or 0.0.0.0 when it detects WSL) every start.
const DEFAULT_PERSISTED_CONFIG = PersistedConfigSchema.parse({
  version: 1,
  daemon: {
    cors: {
      allowedOrigins: ["https://app.otto-code.me"],
    },
    relay: {
      enabled: true,
    },
  },
  app: {
    baseUrl: "https://app.otto-code.me",
  },
}) as PersistedConfig;

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
}

function getConfigPath(ottoHome: string): string {
  return path.join(ottoHome, CONFIG_FILENAME);
}

function getLogger(logger: LoggerLike | undefined): LoggerLike | undefined {
  return logger?.child({ module: "config" });
}

// Removed config fields are stripped before parsing so the strict schema does not
// reject a config written by an older release. The stripped values are discarded,
// not migrated — there is no back-compat for the removed `providers.openai.voice`
// block (use `providers.openai.stt` / `providers.openai.tts`).
function stripRemovedConfigFields(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const root = { ...(parsed as Record<string, unknown>) };
  const providers = root.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return root;
  }

  const providersRecord = { ...(providers as Record<string, unknown>) };

  const local = providersRecord.local;
  if (local && typeof local === "object" && !Array.isArray(local)) {
    const localRecord = { ...(local as Record<string, unknown>) };
    delete localRecord.autoDownload;
    providersRecord.local = localRecord;
  }

  const openai = providersRecord.openai;
  if (openai && typeof openai === "object" && !Array.isArray(openai)) {
    const openaiRecord = { ...(openai as Record<string, unknown>) };
    // COMPAT(openaiVoiceConfig): added 2026-06-30, remove after 2026-12-30.
    // Drop a `providers.openai.voice` block left by an older release so the strict
    // schema doesn't reject it. The value is discarded, not migrated — there is no
    // back-compat; configure `providers.openai.stt` / `providers.openai.tts` instead.
    delete openaiRecord.voice;
    providersRecord.openai = openaiRecord;
  }

  root.providers = providersRecord;
  return root;
}

export function loadPersistedConfig(ottoHome: string, logger?: LoggerLike): PersistedConfig {
  const log = getLogger(logger);
  const configPath = getConfigPath(ottoHome);

  if (!existsSync(configPath)) {
    try {
      writePrivateFileAtomicSync(
        configPath,
        JSON.stringify(DEFAULT_PERSISTED_CONFIG, null, 2) + "\n",
      );
      log?.info(`Initialized config file at ${configPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[Config] Failed to initialize ${configPath}: ${message}`, { cause: err });
    }
  }

  let raw: string;
  try {
    ensurePrivateFile(configPath);
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to read ${configPath}: ${message}`, {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Invalid JSON in ${configPath}: ${message}`, {
      cause: err,
    });
  }

  const migrated = stripRemovedConfigFields(parsed);
  const result = PersistedConfigSchema.safeParse(migrated);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[Config] Invalid config in ${configPath}:\n${issues}`);
  }

  log?.info(`Loaded from ${configPath}`);
  return result.data as PersistedConfig;
}

export function savePersistedConfig(
  ottoHome: string,
  config: PersistedConfig,
  logger?: LoggerLike,
): void {
  const log = getLogger(logger);
  const configPath = getConfigPath(ottoHome);

  const result = PersistedConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[Config] Invalid config to save:\n${issues}`);
  }

  try {
    writePrivateFileAtomicSync(configPath, JSON.stringify(result.data, null, 2) + "\n");
    log?.info(`Saved to ${configPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to write ${configPath}: ${message}`, {
      cause: err,
    });
  }
}
