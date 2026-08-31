import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOttoNodeEnv } from "./otto-env.js";
import { z } from "zod";
import { expandTilde } from "../utils/path.js";

import type { OttoDaemonConfig } from "./bootstrap.js";
import {
  loadPersistedConfig,
  LogFormatSchema,
  LogLevelSchema,
  type PersistedConfig,
} from "./persisted-config.js";
import type { AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { AgentProviderSchema } from "@otto-code/protocol/provider-manifest";
import { hashDaemonPassword } from "./auth.js";
import { resolveSpeechConfig } from "./speech/speech-config-resolver.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { mergeHostnames, parseHostnamesEnv, type HostnamesConfig } from "./hostnames.js";
import { isRunningInWsl } from "./wsl-detect.js";
import { resolveGitProcessPolicy } from "../utils/git-process-scheduler.js";

const DEFAULT_PORT = 6868;
const DEFAULT_RELAY_ENDPOINT = "relay.otto-code.me:443";
export const DEFAULT_APP_BASE_URL = "https://app.otto-code.me";
const DEFAULT_TRUSTED_PROXIES = ["loopback"];

interface ResolveBundledWebUiDistDirInput {
  moduleUrl?: string | URL;
  resourcesPath?: string;
}

export function resolveBundledWebUiDistDir(input: ResolveBundledWebUiDistDirInput = {}): string {
  const moduleUrl = input.moduleUrl ?? import.meta.url;
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));

  if (path.basename(moduleDir) === "server" && path.basename(path.dirname(moduleDir)) === "src") {
    return path.resolve(moduleDir, "..", "..", "dist", "server", "web-ui");
  }

  if (
    path.basename(moduleDir) === "server" &&
    path.basename(path.dirname(moduleDir)) === "server" &&
    path.basename(path.dirname(path.dirname(moduleDir))) === "dist"
  ) {
    const appDistDir = input.resourcesPath ? path.join(input.resourcesPath, "app-dist") : null;

    if (appDistDir && existsSync(appDistDir)) {
      return appDistDir;
    }

    return path.resolve(moduleDir, "..", "web-ui");
  }

  return path.resolve(moduleDir, "web-ui");
}

const processResourcesPath = "resourcesPath" in process ? process.resourcesPath : undefined;
const BUNDLED_WEB_UI_DIST_DIR = resolveBundledWebUiDistDir({
  resourcesPath: typeof processResourcesPath === "string" ? processResourcesPath : undefined,
});

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeLogEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function resolveGitProcessConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): NonNullable<OttoDaemonConfig["git"]> {
  return resolveGitProcessPolicy({
    env,
    persisted: persisted.daemon?.git,
  });
}

export type CliConfigOverrides = Partial<{
  listen: string;
  relayEnabled: boolean;
  relayUseTls: boolean;
  mcpEnabled: boolean;
  mcpInjectIntoAgents: boolean;
  webUiEnabled: boolean;
  hostnames: HostnamesConfig;
}>;

type TrustedProxiesConfig = true | string[];

function resolveLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: PersistedConfig,
): PersistedConfig["log"] {
  const level = parseLogLevelEnv(env.OTTO_LOG_LEVEL ?? env.OTTO_LOG);
  const format = parseLogFormatEnv(env.OTTO_LOG_FORMAT);
  const console = resolveConsoleLogConfigFromEnv(env, persisted.log?.console);
  const file = resolveFileLogConfigFromEnv(env, persisted.log?.file);

  if (level === undefined && format === undefined && !console && !file) {
    return persisted.log;
  }

  return {
    ...persisted.log,
    ...(level !== undefined ? { level } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(console ? { console } : {}),
    ...(file ? { file } : {}),
  };
}

function resolveConsoleLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: NonNullable<PersistedConfig["log"]>["console"],
): NonNullable<PersistedConfig["log"]>["console"] {
  const level = parseLogLevelEnv(env.OTTO_LOG_CONSOLE_LEVEL);
  const format = parseLogFormatEnv(env.OTTO_LOG_CONSOLE_FORMAT);
  if (level === undefined && format === undefined) return undefined;
  return {
    ...persisted,
    ...(level !== undefined ? { level } : {}),
    ...(format !== undefined ? { format } : {}),
  };
}

function resolveFileLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: NonNullable<PersistedConfig["log"]>["file"],
): NonNullable<PersistedConfig["log"]>["file"] {
  const level = parseLogLevelEnv(env.OTTO_LOG_FILE_LEVEL);
  const filePath = nonEmptyEnv(env.OTTO_LOG_FILE_PATH);
  const maxSize = nonEmptyEnv(env.OTTO_LOG_FILE_ROTATE_SIZE);
  const maxFiles = parsePositiveIntegerEnv(env.OTTO_LOG_FILE_ROTATE_COUNT);
  const hasRotateOverride = maxSize !== undefined || maxFiles !== undefined;
  if (level === undefined && filePath === undefined && !hasRotateOverride) return undefined;
  return {
    ...persisted,
    ...(level !== undefined ? { level } : {}),
    ...(filePath !== undefined ? { path: filePath } : {}),
    ...(hasRotateOverride
      ? {
          rotate: {
            ...persisted?.rotate,
            ...(maxSize !== undefined ? { maxSize } : {}),
            ...(maxFiles !== undefined ? { maxFiles } : {}),
          },
        }
      : {}),
  };
}

function parseLogLevelEnv(value: string | undefined): z.infer<typeof LogLevelSchema> | undefined {
  const parsed = LogLevelSchema.safeParse(normalizeLogEnv(value));
  return parsed.success ? parsed.data : undefined;
}

function parseLogFormatEnv(value: string | undefined): z.infer<typeof LogFormatSchema> | undefined {
  const parsed = LogFormatSchema.safeParse(normalizeLogEnv(value));
  return parsed.success ? parsed.data : undefined;
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const OptionalVoiceLlmProviderSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | null =>
    typeof value === "string" ? value.trim().toLowerCase() : null,
  )
  .pipe(z.union([AgentProviderSchema, z.null()]));

function parseOptionalVoiceLlmProvider(value: unknown): AgentProvider | null {
  const parsed = OptionalVoiceLlmProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function extractProviderOverrides(
  providers: Record<string, unknown> | undefined,
): Record<string, ProviderOverride> | undefined {
  if (!providers) {
    return undefined;
  }

  const providerOverrides = Object.entries(providers).flatMap(([providerId, provider]) => {
    const parsed = ProviderOverrideSchema.safeParse(provider);
    return parsed.success ? [[providerId, parsed.data] as const] : [];
  });

  return providerOverrides.length > 0 ? Object.fromEntries(providerOverrides) : undefined;
}

function extractAgentProviderSettings(
  providerOverrides: Record<string, ProviderOverride> | undefined,
): AgentProviderRuntimeSettingsMap | undefined {
  if (!providerOverrides) {
    return undefined;
  }

  const runtimeSettings = Object.entries(providerOverrides).flatMap(([providerId, provider]) => {
    const parsedProviderId = AgentProviderSchema.safeParse(providerId);
    if (!parsedProviderId.success || (!provider.command && !provider.env)) {
      return [];
    }

    return [
      [
        parsedProviderId.data,
        {
          command: provider.command
            ? {
                mode: "replace" as const,
                argv: provider.command,
              }
            : undefined,
          env: provider.env,
        },
      ] as const,
    ];
  });

  return runtimeSettings.length > 0
    ? (Object.fromEntries(runtimeSettings) as AgentProviderRuntimeSettingsMap)
    : undefined;
}

interface ResolveRelayInput {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  cliRelayEnabled: boolean | undefined;
  cliRelayUseTls: boolean | undefined;
  enabledFallback: boolean;
}

interface ResolvedRelay {
  enabled: boolean;
  enabledMutable: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

interface ResolvedServiceProxy {
  publicBaseUrl: string | null;
  standaloneListen: string | null;
}

function resolveTlsFromEnv(
  envValue: string | undefined,
  persistedValue: boolean | undefined,
  fallback: boolean,
): boolean {
  if (envValue !== undefined) {
    return parseBooleanEnv(envValue) ?? false;
  }
  return persistedValue ?? fallback;
}

function resolveRelayConfig(input: ResolveRelayInput): ResolvedRelay {
  const environmentEnabled = parseBooleanEnv(input.env.OTTO_RELAY_ENABLED);
  // COMPAT(relayOptInDefault): daemons whose startup config omitted this field
  // retain relay-on removal semantics until 2027-01-31. Modern homes use false.
  const enabled =
    input.cliRelayEnabled ??
    environmentEnabled ??
    input.persisted.daemon?.relay?.enabled ??
    input.enabledFallback;
  const endpoint =
    input.env.OTTO_RELAY_ENDPOINT ??
    input.persisted.daemon?.relay?.endpoint ??
    DEFAULT_RELAY_ENDPOINT;
  const publicEndpoint =
    input.env.OTTO_RELAY_PUBLIC_ENDPOINT ??
    input.persisted.daemon?.relay?.publicEndpoint ??
    endpoint;
  const useTls =
    input.cliRelayUseTls ??
    resolveTlsFromEnv(
      input.env.OTTO_RELAY_USE_TLS,
      input.persisted.daemon?.relay?.useTls,
      endpoint === DEFAULT_RELAY_ENDPOINT,
    );
  const publicUseTls = resolveTlsFromEnv(
    input.env.OTTO_RELAY_PUBLIC_USE_TLS,
    input.persisted.daemon?.relay?.publicUseTls,
    useTls,
  );
  return {
    enabled,
    enabledMutable: input.cliRelayEnabled === undefined && environmentEnabled === undefined,
    endpoint,
    publicEndpoint,
    useTls,
    publicUseTls,
  };
}

interface ResolvedVoiceLlm {
  provider: AgentProvider | null;
  providerExplicit: boolean;
  model: string | null;
}

function resolveServiceProxyPublicBaseUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid OTTO_SERVICE_PROXY_PUBLIC_BASE_URL: ${value}`);
  }
}

function resolveServiceProxyConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedServiceProxy {
  const enabledShim =
    parseBooleanEnv(env.OTTO_SERVICE_PROXY_ENABLED) ?? persisted.daemon?.serviceProxy?.enabled;
  // COMPAT(serviceProxyEnabled): added 2026-06-02, remove after 2026-12-02.
  // `enabled=false` used to disable the separate service proxy listener. Localhost
  // service proxying is now always enabled; this only suppresses optional layers.
  const optionalLayersEnabled = enabledShim !== false;
  const publicBaseUrl = optionalLayersEnabled
    ? resolveServiceProxyPublicBaseUrl(
        env.OTTO_SERVICE_PROXY_PUBLIC_BASE_URL ??
          persisted.daemon?.serviceProxy?.publicBaseUrl ??
          null,
      )
    : null;
  const standaloneListen = optionalLayersEnabled
    ? (env.OTTO_SERVICE_PROXY_LISTEN ?? persisted.daemon?.serviceProxy?.listen ?? null)
    : null;

  return { publicBaseUrl, standaloneListen };
}

interface ResolvedWebUi {
  enabled: boolean;
  distDir: string | null;
}

function resolveWebUiConfig(
  ottoHome: string,
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedWebUi {
  const enabled =
    cli?.webUiEnabled ??
    parseBooleanEnv(env.OTTO_WEB_UI_ENABLED) ??
    persisted.features?.webUi?.enabled ??
    false;
  const rawDistDir = env.OTTO_WEB_UI_DIST_DIR ?? persisted.features?.webUi?.distDir;
  const trimmedDistDir = rawDistDir?.trim();
  const distDir = trimmedDistDir
    ? path.resolve(path.isAbsolute(trimmedDistDir) ? trimmedDistDir : ottoHome, trimmedDistDir)
    : BUNDLED_WEB_UI_DIST_DIR;
  return {
    enabled,
    distDir,
  };
}

function resolveVoiceLlmConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedVoiceLlm {
  const envVoiceLlmProvider = parseOptionalVoiceLlmProvider(env.OTTO_VOICE_LLM_PROVIDER);
  const persistedVoiceLlmProvider = parseOptionalVoiceLlmProvider(
    persisted.features?.voiceMode?.llm?.provider,
  );
  return {
    provider: envVoiceLlmProvider ?? persistedVoiceLlmProvider ?? null,
    providerExplicit: envVoiceLlmProvider !== null || persistedVoiceLlmProvider !== null,
    model: persisted.features?.voiceMode?.llm?.model ?? null,
  };
}

function resolveCorsAllowedOrigins(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string[] {
  const envCorsOrigins = env.OTTO_CORS_ORIGINS
    ? env.OTTO_CORS_ORIGINS.split(",").map((s) => s.trim())
    : [];
  const persistedCorsOrigins = persisted.daemon?.cors?.allowedOrigins ?? [];
  return Array.from(
    new Set([...persistedCorsOrigins, ...envCorsOrigins].filter((s) => s.length > 0)),
  );
}

function parseTrustedProxiesEnv(value: string | undefined): TrustedProxiesConfig | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return [];
  }

  return trimmed
    .split(",")
    .map((proxy) => proxy.trim())
    .filter((proxy) => proxy.length > 0);
}

function resolveTrustedProxiesConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): TrustedProxiesConfig {
  return (
    parseTrustedProxiesEnv(env.OTTO_TRUSTED_PROXIES) ??
    persisted.daemon?.trustedProxies ??
    DEFAULT_TRUSTED_PROXIES
  );
}

// OTTO_LISTEN can be:
// - host:port (TCP)
// - /path/to/socket (Unix socket)
// - unix:///path/to/socket (Unix socket)
// Default is TCP at 127.0.0.1:6868, except under WSL (see resolveListenAddress).
function resolveListenAddress(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): { listen: string; autoWidenedForWsl: boolean } {
  const explicit = cli?.listen ?? env.OTTO_LISTEN ?? persisted.daemon?.listen;
  if (explicit) {
    return { listen: explicit, autoWidenedForWsl: false };
  }

  const port = env.PORT ?? DEFAULT_PORT;
  // Windows' localhost forwarding into WSL2 only proxies to services bound
  // beyond the WSL VM's own loopback, so a daemon bound to 127.0.0.1 inside
  // WSL is unreachable from the Windows-side client without manual config.
  // Default to 0.0.0.0 in that case; WSL2's NAT still keeps this unreachable
  // from other machines on the LAN.
  if (isRunningInWsl(env)) {
    return { listen: `0.0.0.0:${port}`, autoWidenedForWsl: true };
  }

  return { listen: `127.0.0.1:${port}`, autoWidenedForWsl: false };
}

function resolveAuthConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): OttoDaemonConfig["auth"] {
  const envPassword = env.OTTO_PASSWORD?.trim();
  if (envPassword) {
    return { password: hashDaemonPassword(envPassword) };
  }
  return persisted.daemon?.auth?.password
    ? { password: persisted.daemon.auth.password }
    : undefined;
}

function resolveWorktreesRoot(
  ottoHome: string,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string | undefined {
  const configuredRoot = persisted.worktrees?.root?.trim();
  if (!configuredRoot) {
    return undefined;
  }

  const expandedRoot = expandTilde(configuredRoot);
  return path.isAbsolute(expandedRoot)
    ? path.resolve(expandedRoot)
    : path.resolve(ottoHome, expandedRoot);
}

function resolveAppendSystemPrompt(persisted: ReturnType<typeof loadPersistedConfig>): string {
  return persisted.daemon?.appendSystemPrompt ?? "";
}

// Deliberately OFF by default, unlike the Otto tools master next to it. Browser
// tools drive real Otto tabs carrying the user's logged-in sessions, so turning
// them on stays an explicit human act. Discoverability is handled in the UI
// instead: the Browser pane and preview surfaces point at this setting when it
// is off (see docs/preview.md).
function resolveBrowserToolsEnabled(persisted: ReturnType<typeof loadPersistedConfig>): boolean {
  return persisted.daemon?.browserTools?.enabled ?? false;
}

function resolveMcpToolGroups(persisted: ReturnType<typeof loadPersistedConfig>) {
  // undefined = all groups enabled (mirrors openai-compat per-provider semantics).
  return persisted.daemon?.mcp?.toolGroups;
}

function resolveAgentBehaviors(persisted: ReturnType<typeof loadPersistedConfig>) {
  return persisted.daemon?.agentBehaviors;
}

/**
 * Both profile lists stay `undefined` when absent rather than defaulting to an
 * empty array: for terminal profiles that is what selects the built-in
 * defaults, so an empty array has to keep meaning "the user removed them all".
 */
function resolveProfileLists(persisted: ReturnType<typeof loadPersistedConfig>) {
  return {
    terminalProfiles: persisted.daemon?.terminalProfiles,
    agentProfiles: persisted.daemon?.agentProfiles,
  };
}

function resolveStaticLoadConfigSettings(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
) {
  return {
    mcpEnabled: cli?.mcpEnabled ?? persisted.daemon?.mcp?.enabled ?? true,
    // On by default, same reasoning as browser tools: an agent that cannot
    // reach the Otto tools is a strictly weaker agent. `--no-mcp-inject` and an
    // explicit persisted `false` both still win.
    mcpInjectIntoAgents:
      cli?.mcpInjectIntoAgents ?? persisted.daemon?.mcp?.injectIntoAgents ?? true,
    browserToolsEnabled: resolveBrowserToolsEnabled(persisted),
    mcpToolGroups: resolveMcpToolGroups(persisted),
    agentBehaviors: resolveAgentBehaviors(persisted),
    autoArchiveAfterMerge: persisted.daemon?.autoArchiveAfterMerge ?? false,
    appendSystemPrompt: resolveAppendSystemPrompt(persisted),
    ...resolveProfileLists(persisted),
    hostnames: mergeHostnames([
      persisted.daemon?.hostnames,
      parseHostnamesEnv(env.OTTO_HOSTNAMES ?? env.OTTO_ALLOWED_HOSTS),
      cli?.hostnames,
    ]),
    trustedProxies: resolveTrustedProxiesConfig(env, persisted),
    appBaseUrl: env.OTTO_APP_BASE_URL ?? persisted.app?.baseUrl ?? DEFAULT_APP_BASE_URL,
  };
}

/**
 * The `agents` section of the persisted file, projected onto the daemon config.
 *
 * Every field here is a pass-through with an optional-chain guard, and gathering
 * them in one place keeps that guard count out of the assembly function.
 */
function resolveAgentSettingsFromPersisted(
  persisted: PersistedConfig,
  providerOverrides: ReturnType<typeof extractProviderOverrides>,
): Pick<
  OttoDaemonConfig,
  | "skillSelection"
  | "agentProviderSettings"
  | "providerCatalogRefreshTimeoutMs"
  | "metadataGeneration"
  | "agentPersonalities"
  | "agentTeams"
  | "modelTierOverrides"
  | "modelVisibilityOverrides"
  | "savedProviderEndpoints"
> {
  const agents = persisted.agents;
  return {
    skillSelection: agents?.skills?.selection,
    agentProviderSettings: extractAgentProviderSettings(providerOverrides),
    providerCatalogRefreshTimeoutMs: agents?.catalogRefreshTimeoutMs,
    metadataGeneration: agents?.metadataGeneration,
    agentPersonalities: agents?.agentPersonalities,
    agentTeams: agents?.agentTeams,
    modelTierOverrides: agents?.modelTierOverrides,
    modelVisibilityOverrides: agents?.modelVisibilityOverrides,
    savedProviderEndpoints: agents?.savedProviderEndpoints,
  };
}

interface ResolveConfigFromPersistedOptions {
  env?: NodeJS.ProcessEnv;
  cli?: CliConfigOverrides;
  relayEnabledFallback?: boolean;
}

export function resolveConfigFromPersisted(
  ottoHome: string,
  persisted: PersistedConfig,
  options?: ResolveConfigFromPersistedOptions,
): OttoDaemonConfig {
  const resolvedOptions = options ?? {};
  const env = resolvedOptions.env ?? process.env;
  const cli = resolvedOptions.cli;
  const relayEnabledFallback =
    resolvedOptions.relayEnabledFallback ?? persisted.daemon?.relay?.enabled === undefined;

  const { listen, autoWidenedForWsl: listenAutoWidenedForWsl } = resolveListenAddress(
    env,
    cli,
    persisted,
  );
  const {
    mcpEnabled,
    mcpInjectIntoAgents,
    browserToolsEnabled,
    mcpToolGroups,
    agentBehaviors,
    autoArchiveAfterMerge,
    appendSystemPrompt,
    terminalProfiles,
    agentProfiles,
    hostnames,
    trustedProxies,
    appBaseUrl,
  } = resolveStaticLoadConfigSettings(env, cli, persisted);

  const relay = resolveRelayConfig({
    env,
    persisted,
    cliRelayEnabled: cli?.relayEnabled,
    cliRelayUseTls: cli?.relayUseTls,
    enabledFallback: relayEnabledFallback,
  });
  const serviceProxy = resolveServiceProxyConfig(env, persisted);
  const webUi = resolveWebUiConfig(ottoHome, env, cli, persisted);

  const { openai, speech } = resolveSpeechConfig({
    ottoHome,
    env,
    persisted,
  });

  const voiceLlm = resolveVoiceLlmConfig(env, persisted);
  const providerOverrides = extractProviderOverrides(
    persisted.agents?.providers as Record<string, unknown> | undefined,
  );

  const overrideControlledPaths = resolveOverrideControlledPaths(env, cli, speech.providers);

  return {
    listen,
    listenAutoWidenedForWsl,
    ottoHome,
    desktopManaged: env.OTTO_DESKTOP_MANAGED === "1",
    worktreesRoot: resolveWorktreesRoot(ottoHome, persisted),
    corsAllowedOrigins: resolveCorsAllowedOrigins(env, persisted),
    hostnames,
    trustedProxies,
    mcpEnabled,
    mcpInjectIntoAgents,
    browserToolsEnabled,
    mcpToolGroups,
    agentBehaviors,
    git: resolveGitProcessConfig(env, persisted),
    autoArchiveAfterMerge,
    enableTerminalAgentHooks: persisted.daemon?.enableTerminalAgentHooks ?? false,
    appendSystemPrompt,
    terminalProfiles,
    agentProfiles,
    pluginsEnabled: persisted.pluginsEnabled ?? false,
    plugins: persisted.plugins,
    mcpDebug: env.MCP_DEBUG === "1",
    isDev: resolveOttoNodeEnv(env) === "development",
    agentStoragePath: path.join(ottoHome, "agents"),
    staticDir: "public",
    agentClients: {},
    relayEnabled: relay.enabled,
    relayEnabledMutable: relay.enabledMutable,
    relayEndpoint: relay.endpoint,
    relayPublicEndpoint: relay.publicEndpoint,
    relayUseTls: relay.useTls,
    relayPublicUseTls: relay.publicUseTls,
    serviceProxy,
    webUi,
    appBaseUrl,
    auth: resolveAuthConfig(env, persisted),
    openai,
    speech,
    voiceLlmProvider: voiceLlm.provider,
    voiceLlmProviderExplicit: voiceLlm.providerExplicit,
    voiceLlmModel: voiceLlm.model,
    ...resolveAgentSettingsFromPersisted(persisted, providerOverrides),
    providerOverrides,
    log: resolveLogConfigFromEnv(env, persisted),
    configReload: {
      env: { ...env },
      cli: cli ? { ...cli } : undefined,
      overrideControlledPaths,
      relayEnabledFallback,
      startupPersisted: persisted,
    },
  };
}

export function loadConfig(
  ottoHome: string,
  options?: Omit<ResolveConfigFromPersistedOptions, "relayEnabledFallback">,
): OttoDaemonConfig {
  const persisted = loadPersistedConfig(ottoHome);
  return resolveConfigFromPersisted(ottoHome, persisted, options);
}

function parsePositiveGitOverride(value: string | undefined): boolean {
  if (value === undefined) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function resolveOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  speechProviders: RequestedSpeechProviders,
): string[] {
  return Array.from(
    new Set([
      ...resolveDaemonOverrideControlledPaths(env, cli),
      ...resolveLogOverrideControlledPaths(env),
      ...resolveSpeechOverrideControlledPaths(env, speechProviders),
    ]),
  ).sort();
}

function resolveDaemonOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  return [
    ...resolveCoreDaemonOverridePaths(env, cli),
    ...resolveRelayOverridePaths(env, cli),
    ...resolveServiceAndWebUiOverridePaths(env, cli),
  ];
}

function resolveCoreDaemonOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  if (cli?.listen !== undefined || env.OTTO_LISTEN !== undefined) {
    paths.push("daemon.listen");
  }
  if (cli?.mcpEnabled !== undefined) paths.push("daemon.mcp.enabled");
  if (cli?.mcpInjectIntoAgents !== undefined) paths.push("daemon.mcp.injectIntoAgents");
  // Hostname sources append instead of replacing one another, so a launch value
  // does not prevent a persisted hostname edit from taking effect.
  if (parseTrustedProxiesEnv(env.OTTO_TRUSTED_PROXIES) !== undefined) {
    paths.push("daemon.trustedProxies");
  }
  if (parsePositiveGitOverride(env.OTTO_GIT_MAX_PROCESSES_PER_SECOND)) {
    paths.push("daemon.git.maxProcessesPerSecond");
  }
  if (parsePositiveGitOverride(env.OTTO_GIT_MAX_PROCESS_CONCURRENCY ?? env.OTTO_GIT_CONCURRENCY)) {
    paths.push("daemon.git.maxProcessConcurrency");
  }
  if (env.OTTO_APP_BASE_URL !== undefined) paths.push("app.baseUrl");
  if (env.OTTO_PASSWORD?.trim()) paths.push("daemon.auth.password");
  return paths;
}

function resolveRelayOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  if (cli?.relayEnabled !== undefined || parseBooleanEnv(env.OTTO_RELAY_ENABLED) !== undefined) {
    paths.push("daemon.relay.enabled");
  }
  if (env.OTTO_RELAY_ENDPOINT !== undefined) paths.push("daemon.relay.endpoint");
  if (env.OTTO_RELAY_PUBLIC_ENDPOINT !== undefined) {
    paths.push("daemon.relay.publicEndpoint");
  }
  if (cli?.relayUseTls !== undefined || env.OTTO_RELAY_USE_TLS !== undefined) {
    paths.push("daemon.relay.useTls");
  }
  if (env.OTTO_RELAY_PUBLIC_USE_TLS !== undefined) {
    paths.push("daemon.relay.publicUseTls");
  }
  return paths;
}

function resolveServiceAndWebUiOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  const serviceProxyEnabled = parseBooleanEnv(env.OTTO_SERVICE_PROXY_ENABLED);
  if (serviceProxyEnabled !== undefined) paths.push("daemon.serviceProxy.enabled");
  if (env.OTTO_SERVICE_PROXY_LISTEN !== undefined || serviceProxyEnabled === false) {
    paths.push("daemon.serviceProxy.listen");
  }
  if (env.OTTO_SERVICE_PROXY_PUBLIC_BASE_URL !== undefined || serviceProxyEnabled === false) {
    paths.push("daemon.serviceProxy.publicBaseUrl");
  }

  if (cli?.webUiEnabled !== undefined || parseBooleanEnv(env.OTTO_WEB_UI_ENABLED) !== undefined) {
    paths.push("features.webUi.enabled");
  }
  if (env.OTTO_WEB_UI_DIST_DIR !== undefined) paths.push("features.webUi.distDir");
  return paths;
}

function resolveLogOverrideControlledPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (parseLogLevelEnv(env.OTTO_LOG_LEVEL ?? env.OTTO_LOG) !== undefined) {
    paths.push("log.level");
  }
  if (parseLogFormatEnv(env.OTTO_LOG_FORMAT) !== undefined) paths.push("log.format");
  if (parseLogLevelEnv(env.OTTO_LOG_CONSOLE_LEVEL) !== undefined) {
    paths.push("log.console.level");
  }
  if (parseLogFormatEnv(env.OTTO_LOG_CONSOLE_FORMAT) !== undefined) {
    paths.push("log.console.format");
  }
  if (parseLogLevelEnv(env.OTTO_LOG_FILE_LEVEL) !== undefined) paths.push("log.file.level");
  if (nonEmptyEnv(env.OTTO_LOG_FILE_PATH) !== undefined) paths.push("log.file.path");
  if (nonEmptyEnv(env.OTTO_LOG_FILE_ROTATE_SIZE) !== undefined) {
    paths.push("log.file.rotate.maxSize");
  }
  if (parsePositiveIntegerEnv(env.OTTO_LOG_FILE_ROTATE_COUNT) !== undefined) {
    paths.push("log.file.rotate.maxFiles");
  }
  return paths;
}

function isEnabledSpeechProvider(
  provider: RequestedSpeechProviders[keyof RequestedSpeechProviders],
  expected: "local" | "openai",
): boolean {
  return provider.enabled !== false && provider.provider === expected;
}

function resolveSpeechOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  providers: RequestedSpeechProviders,
): string[] {
  const paths: string[] = [];
  const add = (envName: string, ...configPaths: string[]) => {
    if (env[envName] !== undefined) paths.push(...configPaths);
  };

  add("OTTO_DICTATION_ENABLED", "features.dictation.enabled");
  add("OTTO_DICTATION_STT_PROVIDER", "features.dictation.stt.provider");
  if (
    env.OTTO_DICTATION_LOCAL_STT_MODEL !== undefined &&
    isEnabledSpeechProvider(providers.dictationStt, "local")
  ) {
    paths.push("features.dictation.stt.model");
  }
  add("OTTO_DICTATION_LANGUAGE", "features.dictation.stt.language");
  add("OTTO_VOICE_MODE_ENABLED", "features.voiceMode.enabled");
  add("OTTO_VOICE_LLM_PROVIDER", "features.voiceMode.llm.provider");
  add("OTTO_VOICE_STT_PROVIDER", "features.voiceMode.stt.provider");
  if (
    env.OTTO_VOICE_LOCAL_STT_MODEL !== undefined &&
    isEnabledSpeechProvider(providers.voiceStt, "local")
  ) {
    paths.push("features.voiceMode.stt.model");
  }
  add("OTTO_VOICE_LANGUAGE", "features.voiceMode.stt.language");
  add("OTTO_VOICE_TURN_DETECTION_PROVIDER", "features.voiceMode.turnDetection.provider");
  add("OTTO_VOICE_TTS_PROVIDER", "features.voiceMode.tts.provider");
  if (
    env.OTTO_VOICE_LOCAL_TTS_MODEL !== undefined &&
    isEnabledSpeechProvider(providers.voiceTts, "local")
  ) {
    paths.push("features.voiceMode.tts.model");
  }
  add("OTTO_VOICE_LOCAL_TTS_SPEAKER_ID", "features.voiceMode.tts.speakerId");
  add("OTTO_VOICE_LOCAL_TTS_SPEED", "features.voiceMode.tts.speed");
  add("OTTO_LOCAL_MODELS_DIR", "providers.local.modelsDir");
  const openAiDictationStt = isEnabledSpeechProvider(providers.dictationStt, "openai");
  const openAiVoiceStt = isEnabledSpeechProvider(providers.voiceStt, "openai");
  if (env.STT_CONFIDENCE_THRESHOLD !== undefined && (openAiDictationStt || openAiVoiceStt)) {
    paths.push("features.dictation.stt.confidenceThreshold");
  }
  if (env.STT_MODEL !== undefined) {
    if (openAiDictationStt) paths.push("features.dictation.stt.model");
    if (openAiVoiceStt) paths.push("features.voiceMode.stt.model");
  }
  if (isEnabledSpeechProvider(providers.voiceTts, "openai")) {
    add("TTS_MODEL", "features.voiceMode.tts.model");
    add("TTS_VOICE", "features.voiceMode.tts.voice");
  }
  if (env.OTTO_DICTATION_LANGUAGE !== undefined && env.OTTO_VOICE_LANGUAGE === undefined) {
    paths.push("features.voiceMode.stt.language");
  }
  return paths;
}
