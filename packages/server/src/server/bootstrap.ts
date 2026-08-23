import express from "express";
import { CommunicationsService } from "./communications/communications-service.js";
import {
  getZoomTeamChatAuthorizationMethods,
  ZoomTeamChatProvider,
} from "./communications/zoom-team-chat-provider.js";
import { ZoomTeamChatManagedAuthorizationBroker } from "./communications/zoom-team-chat-managed-authorization.js";
import { createDaemonCredentialVault } from "./integration-authorization/credential-vault.js";
import { IntegrationAuthorizationCatalog } from "./integration-authorization/integration-authorization-catalog.js";
import { IntegrationBrowserAuthorizationService } from "./integration-authorization/browser-authorization-service.js";
import { FileBackedIntegrationAuthorizationRegistry } from "./integration-authorization/integration-authorization-registry.js";
import { IntegrationAuthorizationService } from "./integration-authorization/integration-authorization-service.js";
import { createServer as createHTTPServer, type IncomingMessage, type ServerResponse } from "http";
import { constants, existsSync, unlinkSync } from "fs";
import { open } from "fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, hostname as getHostname } from "node:os";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "pino";
import { z } from "zod";
import { createBranchChangeRouteHandler } from "./script-route-branch-handler.js";

export type ListenTarget =
  | { type: "tcp"; host: string; port: number }
  | { type: "socket"; path: string }
  | { type: "pipe"; path: string };

function resolveBoundListenTarget(
  listenTarget: ListenTarget,
  httpServer: ReturnType<typeof createHTTPServer>,
): ListenTarget {
  if (listenTarget.type !== "tcp") {
    return listenTarget;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address after listening");
  }

  return {
    type: "tcp",
    host: listenTarget.host,
    port: address.port,
  };
}

// Matches a Windows drive-letter path like C:\ or D:\
const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;

export function parseListenString(listen: string): ListenTarget {
  // 1. Windows named pipes: \\.\pipe\... or pipe://...
  if (listen.startsWith("\\\\.\\pipe\\") || listen.startsWith("pipe://")) {
    return {
      type: "pipe",
      path: listen.startsWith("pipe://") ? listen.slice("pipe://".length) : listen,
    };
  }
  // 2. Explicit unix:// prefix
  if (listen.startsWith("unix://")) {
    return { type: "socket", path: listen.slice(7) };
  }
  // 3. Reject Windows absolute drive paths - they are not Unix sockets
  if (WINDOWS_DRIVE_RE.test(listen)) {
    throw new Error(`Invalid listen string (Windows path is not a valid listen target): ${listen}`);
  }
  // 4. POSIX absolute path (/ or ~) - Unix socket
  if (listen.startsWith("/") || listen.startsWith("~")) {
    return { type: "socket", path: listen };
  }
  // 5. Pure numeric - TCP port on 127.0.0.1
  const trimmed = listen.trim();
  if (/^\d+$/.test(trimmed)) {
    const port = parseInt(trimmed, 10);
    return { type: "tcp", host: "127.0.0.1", port };
  }
  // 6. host:port - TCP
  if (listen.includes(":")) {
    const lastColonIdx = listen.lastIndexOf(":");
    const host = listen.slice(0, lastColonIdx);
    const portStr = listen.slice(lastColonIdx + 1);
    const parsedPort = parseInt(portStr, 10);
    if (!Number.isFinite(parsedPort)) {
      throw new Error(`Invalid port in listen string: ${listen}`);
    }
    const cleanHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    return { type: "tcp", host: cleanHost || "127.0.0.1", port: parsedPort };
  }
  throw new Error(`Invalid listen string: ${listen}`);
}

function formatListenTarget(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget) {
    return null;
  }
  if (listenTarget.type === "tcp") {
    return `${listenTarget.host}:${listenTarget.port}`;
  }
  return listenTarget.path;
}

export async function fanOutReconciledWorkspaceUpdates(input: {
  sessions: Iterable<{
    syncWorkspaceGitObserversForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
    emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
  }>;
  workspaceIds: readonly string[];
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  await Promise.all(
    Array.from(input.sessions, async (session) => {
      try {
        await session.syncWorkspaceGitObserversForExternalWorkspaceIds(input.workspaceIds);
      } catch (error) {
        input.logger.warn(
          { err: error },
          "Failed to sync workspace Git observers after reconciliation",
        );
      }
      try {
        await session.emitWorkspaceUpdatesForExternalWorkspaceIds(input.workspaceIds);
      } catch (error) {
        input.logger.warn({ err: error }, "Failed to emit workspace updates after reconciliation");
      }
    }),
  );
}

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import { createGitHubHostingService } from "../services/git-hosting/github-hosting-service.js";
import { createGitHostingResolver } from "../services/git-hosting/resolver.js";
import {
  createGitHostingProviderForgeAdapter,
  createGitHostingRouter,
} from "../services/git-hosting/router.js";
import { readOttoConfigJson } from "../utils/otto-config-file.js";
import {
  createOttoWorktree as createRegisteredOttoWorktree,
  createLocalCheckoutWorkspace,
  findOccupyingWorkspaceForCwd,
} from "./otto-worktree-service.js";
import { revealScheduleRunWorkspace } from "./schedule-workspace-reveal.js";
import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";
import { createOttoWorktreeWorkflow } from "./worktree-session.js";
import { createWorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { OpenAiSpeechProviderConfig } from "./speech/providers/openai/config.js";
import type { LocalSpeechProviderConfig } from "./speech/providers/local/config.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { createSpeechService } from "./speech/speech-runtime.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { RetainedTranscriptStore } from "./agent/retained-transcript-store.js";
import { PersonalityStatsStore } from "./agent/personality-stats-store.js";
import { PersonalityMemoryStore } from "./agent/personality-memory/personality-memory-store.js";
import { PersonalityMemoryService } from "./agent/personality-memory/personality-memory-service.js";
import { ProjectKnowledgeService } from "./agent/project-knowledge/project-knowledge-service.js";
import { loadInstructionFiles } from "./agent/context-management/instruction-files.js";
import { resolveProjectRootForCwd } from "./agent/context-management/context-management-service.js";
import {
  ActivityStatsStore,
  type ActivityIncrementFn,
} from "./activity-stats/activity-stats-store.js";
import { UsageLogStore } from "./activity-stats/usage-log-store.js";
import { attachAgentStoragePersistence } from "./persistence-hooks.js";
import { createAgentMcpServer } from "./agent/mcp-server.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "./agent/tools/otto-tools.js";
import { ArtifactService } from "./artifact/artifact-service.js";
import { DevServerManager } from "./preview/dev-server-manager.js";
import { BrainManager } from "./brain/brain-manager.js";
import { BrainOpsManager } from "./brain/brain-ops-manager.js";
import type { OttoToolRuntimeContext } from "./agent/tools/types.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { OTTO_BRAIN_PROVIDER_ID } from "./agent/provider-registry.js";
import { bootstrapWorkspaceRegistries } from "./workspace-registry-bootstrap.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import { FileBackedProjectLinkStore } from "./project-links.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  type WorkspaceArchiveContext,
} from "./workspace-registry.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { ScheduleService } from "./schedule/service.js";
import { RunService } from "./orchestration/run-service.js";
import { RunStore } from "./orchestration/run-store.js";
import { buildRunSummaryPrompt } from "./orchestration/run-engine.js";
import { GraphStore } from "./orchestration/graph-store.js";
import { seedStarterGraphs } from "./orchestration/starter-graphs.js";
import { NodeOutputStore } from "./orchestration/node-output.js";
import { PromptTemplateStore } from "./orchestration/prompt-template-store.js";
import { seedStarterPromptTemplates } from "./orchestration/starter-prompt-templates.js";
import { createAgentStructuredTextGeneration } from "./session/checkout/git-metadata-generator.js";
import { DaemonConfigStore, type MutableDaemonConfig } from "./daemon-config-store.js";
import { ConnectorOAuthBroker, type ConnectorAuthStore } from "./connectors/connector-oauth.js";
import { setConnectorAuthStore } from "./connectors/connector-auth-store.js";
import { BrowserToolsBroker } from "./browser-tools/broker.js";
import { DaemonConfigBrowserToolsPolicy } from "./browser-tools/policy.js";
import { DaemonConfigOttoToolGroupsPolicy } from "./agent/tools/tool-groups-policy.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import { resolveWorkspaceIdForPath } from "./resolve-workspace-id-for-path.js";
import {
  archiveByScope,
  archivePersistedWorkspaceRecord,
  killTerminalsForWorkspace,
  type ActiveWorkspaceRef,
} from "./workspace-archive-service.js";
import { setupAutoArchiveOnMerge } from "./auto-archive-on-merge/index.js";
import { wrapSessionMessage, type SessionOutboundMessage } from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { createConfiguredTerminalManager } from "../terminal/terminal-manager-factory.js";
import { applyTerminalAgentHookSetting } from "../terminal/agent-hooks/terminal-agent-hook-setting.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { createRelayRuntime, type RelayRuntime } from "./relay-runtime.js";
import type { PushNotificationSender } from "./push/index.js";
import { getOrCreateServerId } from "./server-id.js";
import { resolveDaemonVersion } from "./daemon-version.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";
import {
  DEFAULT_MUTABLE_BRAIN_CONFIG,
  MutableBrainConfigSchema,
} from "@otto-code/protocol/messages";
import type { OttoToolGroup } from "@otto-code/protocol/provider-config";
import { STALL_GUARD_DEFAULT_THRESHOLD } from "@otto-code/protocol/provider-config";
import {
  DEFAULT_AGENT_PROFILES,
  DEFAULT_AGENT_TEAMS,
} from "@otto-code/protocol/default-personalities";
import type {
  AgentProfile,
  FirstAgentContext,
  TerminalProfile,
} from "@otto-code/protocol/messages";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import {
  loadPersistedConfig,
  type PersistedConfig,
  type PersistedAgentPersonality,
  type PersistedAgentTeam,
  type PersistedModelTierOverride,
  type PersistedSavedProviderEndpoint,
} from "./persisted-config.js";
import { resolveSpeechConfig } from "./speech/speech-config-resolver.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  getLocalTtsDefaultSpeakerId,
  resolveLocalTtsVoiceName,
} from "./speech/providers/local/models.js";
import { createServiceProxySubsystem, type ServiceProxySubsystem } from "./service-proxy.js";
import {
  DEFAULT_ATTACHMENT_IMAGE_MAX_AGE_DAYS,
  DEFAULT_ATTACHMENT_IMAGE_MAX_TOTAL_MB,
} from "./agent/providers/provider-image-output.js";
import { startMaterializedImageHousekeeping } from "./materialized-image-housekeeping.js";
import { releaseWorkspaceServicePortPlan } from "./workspace-service-port-registry.js";
import { ScriptHealthMonitor } from "./script-health-monitor.js";
import { createScriptStatusEmitter } from "./script-status-projection.js";
import { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import {
  createManagedProcessRegistry,
  createSystemManagedProcessTable,
  type ManagedProcessRegistry,
} from "./managed-processes/managed-processes.js";
import { terminateWithTreeKill } from "../utils/tree-kill.js";
import { isHostnameAllowed, type HostnamesConfig } from "./hostnames.js";
import {
  createRequireBearerMiddleware,
  isAgentMcpRequestAuthorized,
  type DaemonAuthConfig,
} from "./auth.js";
import { createWebUiMiddleware } from "./web-ui.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { AgentAutoTitle } from "./agent/agent-auto-title.js";
import { createGitMutationService } from "./session/git-mutation/git-mutation-service.js";
import { workspaceIdsOnCheckout } from "./workspace-directory.js";
import { configureGitProcessPolicy } from "../utils/run-git-command.js";
import { resolveGitProcessPolicy } from "../utils/git-process-scheduler.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import {
  createAgentCommand,
  type CreateAgentCommandDependencies,
} from "./agent/create-agent/create.js";
import { archiveAgentCommand, cancelAgentRunCommand } from "./agent/lifecycle-command.js";
import { CreateAgentLifecycleDispatch } from "./agent/create-agent-lifecycle-dispatch.js";
// DISABLED(hub): these three specifiers used to read "./hub/...". They now
// resolve to inert stand-ins so `server/hub/**` never enters the module graph.
// The wiring below is left byte-identical to upstream on purpose, so their
// changes to it keep auto-merging. See hub-disabled.ts for the whole rationale.
import {
  HubRelationshipController,
  type HubRelationshipClock,
  type HubRelationshipRetryPolicy,
} from "./hub-disabled.js";
import { DirectHubRelationshipRemote, type HubRelationshipRemote } from "./hub-disabled.js";
import { DaemonExecutions } from "./hub-disabled.js";

const MAX_MCP_DEBUG_BATCH_ITEMS = 10;
const REDACTED_LOG_VALUE = "[redacted]";
const DOWNLOAD_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;

function formatHostForHttpUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveAgentMcpClientHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "::1";
  }
  return host;
}

function createAgentMcpBaseUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/mcp/agents",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

function createTerminalActivityUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/api/terminal-activity",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

const TerminalActivityReportSchema = z.object({
  terminalId: z.string().min(1),
  token: z.string().min(1),
  state: z.enum(["running", "idle", "needs-input"]),
});

const TERMINAL_ACTIVITY_STATE_MAP = {
  running: "working",
  idle: "idle",
  "needs-input": "attention",
} as const;

const LOOPBACK_REMOTE_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_REMOTE_ADDRESSES.has(remoteAddress);
}

export function createTerminalActivityRouteHandler(
  terminalManager: TerminalManager,
): express.RequestHandler {
  return async (req, res) => {
    if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const parsed = TerminalActivityReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid terminal activity report" });
      return;
    }

    const validation = terminalManager.validateTerminalActivityToken(
      parsed.data.terminalId,
      parsed.data.token,
    );
    if (validation !== "valid") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const updated = await terminalManager.setTerminalActivity(
        parsed.data.terminalId,
        TERMINAL_ACTIVITY_STATE_MAP[parsed.data.state],
      );
      if (!updated) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.status(204).end();
    } catch {
      res.status(500).json({ error: "Failed to update terminal activity" });
    }
  };
}

function summarizeAgentMcpDebugMessage(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      type: body === null ? "null" : typeof body,
    };
  }

  const record = body as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : undefined;
  return {
    type: "object",
    ...(typeof record.jsonrpc === "string" ? { jsonrpc: record.jsonrpc } : {}),
    ...(method ? { method } : {}),
    hasId: Object.prototype.hasOwnProperty.call(record, "id"),
    hasParams: Object.prototype.hasOwnProperty.call(record, "params"),
  };
}

function summarizeAgentMcpDebugBody(body: unknown): Record<string, unknown> {
  if (!Array.isArray(body)) {
    return summarizeAgentMcpDebugMessage(body);
  }

  const messages = body.slice(0, MAX_MCP_DEBUG_BATCH_ITEMS).map(summarizeAgentMcpDebugMessage);
  return {
    type: "batch",
    count: body.length,
    messages,
    ...(body.length > messages.length ? { omitted: body.length - messages.length } : {}),
  };
}

export type OttoOpenAIConfig = OpenAiSpeechProviderConfig;
export type OttoLocalSpeechConfig = LocalSpeechProviderConfig;

export interface OttoSpeechSttLanguages {
  dictation: string;
  voice: string;
}

export interface OttoSpeechConfig {
  providers: RequestedSpeechProviders;
  sttLanguages?: OttoSpeechSttLanguages;
  local?: OttoLocalSpeechConfig;
}

export type DaemonLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
      reason: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason: string;
    };

export interface OttoDaemonConfig {
  listen: string;
  /** True when `listen` was defaulted to 0.0.0.0 because the daemon detected it's running under WSL. */
  listenAutoWidenedForWsl?: boolean;
  daemonVersion?: string;
  /** True when the desktop app owns this daemon's lifecycle rather than the CLI. */
  desktopManaged?: boolean;
  ottoHome: string;
  worktreesRoot?: string;
  corsAllowedOrigins: string[];
  allowedHosts?: HostnamesConfig;
  hostnames?: HostnamesConfig;
  trustedProxies?: true | string[];
  mcpEnabled?: boolean;
  mcpInjectIntoAgents?: boolean;
  /** Otto tool-group allowlist for the MCP path. undefined = all groups enabled. */
  mcpToolGroups?: OttoToolGroup[];
  browserToolsEnabled?: boolean;
  /**
   * Daemon-wide agent behavior toggles, honoured by providers whose launch context supports
   * behavior injection. undefined fields = default (on).
   *
   * Deliberately not named after a provider. The agent-hook tests assert that this file mentions
   * no provider id at all, so that bootstrap stays generic and specifics live in the adapters -
   * which means even a comment naming one fails the build.
   */
  agentBehaviors?: {
    promptSuggestions?: boolean;
    agentProgressSummaries?: boolean;
    notifyOnFinishDefault?: boolean;
    todoNudge?: boolean;
    todoReconcileOnIdle?: boolean;
    stallGuardThreshold?: number;
  };
  git?: {
    maxProcessesPerSecond: number;
    maxProcessConcurrency: number;
  };
  autoArchiveAfterMerge?: boolean;
  enableTerminalAgentHooks?: boolean;
  appendSystemPrompt?: string;
  terminalProfiles?: TerminalProfile[];
  agentProfiles?: AgentProfile[];
  staticDir: string;
  mcpDebug: boolean;
  isDev?: boolean;
  agentClients: Partial<Record<AgentProvider, AgentClient>>;
  agentStoragePath: string;
  relayEnabled?: boolean;
  relayEnabledMutable?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  serviceProxy?: {
    publicBaseUrl: string | null;
    standaloneListen: string | null;
  };
  webUi?: {
    enabled: boolean;
    distDir: string | null;
  };
  appBaseUrl?: string;
  auth?: DaemonAuthConfig;
  openai?: OttoOpenAIConfig;
  speech?: OttoSpeechConfig;
  voiceLlmProvider?: AgentProvider | null;
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  downloadTokenTtlMs?: number;
  agentProviderSettings?: AgentProviderRuntimeSettingsMap;
  providerCatalogRefreshTimeoutMs?: number;
  metadataGeneration?: {
    providers?: Array<{
      provider: string;
      model?: string;
      thinkingOptionId?: string;
    }>;
    enabled?: boolean;
    preferWriterPersonalities?: boolean;
  };
  agentPersonalities?: {
    personalities?: PersistedAgentPersonality[];
  };
  agentTeams?: {
    teams?: PersistedAgentTeam[];
    activeTeamId?: string | null;
  };
  modelTierOverrides?: PersistedModelTierOverride[];
  savedProviderEndpoints?: PersistedSavedProviderEndpoint[];
  providerOverrides?: Record<string, ProviderOverride>;
  log?: PersistedConfig["log"];
  onLifecycleIntent?: (intent: DaemonLifecycleIntent) => void;
  pushNotificationSender?: PushNotificationSender;
  managedProcesses?: ManagedProcessRegistry;
}

export interface OttoDaemon {
  config: OttoDaemonConfig;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  serviceProxy: ServiceProxySubsystem;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore;
  browserToolsBroker: BrowserToolsBroker;
  start(): Promise<void>;
  stop(): Promise<void>;
  getListenTarget(): ListenTarget | null;
}

export interface OttoDaemonDependencies {
  hubRelationshipRemote?: HubRelationshipRemote;
  hubRelationshipClock?: HubRelationshipClock;
  hubRelationshipRetryPolicy?: HubRelationshipRetryPolicy;
  createHubDaemonId?: () => string;
  serverFeatureOverrides?: {
    daemonStatusRpc?: boolean;
    relayConfig?: boolean;
  };
}

function createBootstrapManagedProcessRegistry(
  config: Pick<OttoDaemonConfig, "ottoHome" | "managedProcesses">,
  logger: Logger,
): ManagedProcessRegistry {
  if (config.managedProcesses) {
    return config.managedProcesses;
  }

  return createManagedProcessRegistry({
    ottoHome: config.ottoHome,
    processTable: createSystemManagedProcessTable(),
    terminateProcess: terminateWithTreeKill,
    logger,
  });
}

async function reconcileManagedProcessLedger(
  managedProcesses: ManagedProcessRegistry,
  logger: Logger,
): Promise<void> {
  const reapResult = await managedProcesses.reapStale();
  if (reapResult.checked > 0 || reapResult.errors.length > 0) {
    logger.info(reapResult, "Managed helper process ledger reconciled");
  }
}

function mountWebUi(app: express.Application, config: OttoDaemonConfig, logger: Logger): void {
  app.use(
    createWebUiMiddleware({
      enabled: config.webUi?.enabled ?? false,
      distDir: config.webUi?.distDir ?? null,
      label: getHostname(),
      logger,
    }),
  );
}

function resolveExpressTrustProxySetting(config: OttoDaemonConfig): true | string[] {
  return config.trustedProxies ?? ["loopback"];
}

interface InitialMutableSttInput {
  provider: string;
  localModel: string | undefined;
  openaiModel: string | undefined;
  language: string | undefined;
}

function initialMutableSttConfig(input: InitialMutableSttInput): {
  provider: string;
  model?: string;
  language?: string;
} {
  const model = input.provider === "local" ? input.localModel : input.openaiModel;
  return {
    provider: input.provider,
    ...(model ? { model } : {}),
    ...(input.language ? { language: input.language } : {}),
  };
}

interface InitialMutableTtsInput {
  provider: string;
  local: { model: string; voice: string | undefined; speed: number | undefined };
  openai: { model: string | undefined; voice: string | undefined };
}

function initialMutableTtsConfig(input: InitialMutableTtsInput): {
  provider: string;
  model?: string;
  voice?: string;
  speed?: number;
} {
  if (input.provider !== "local") {
    return {
      provider: input.provider,
      ...(input.openai.model ? { model: input.openai.model } : {}),
      ...(input.openai.voice ? { voice: input.openai.voice } : {}),
    };
  }
  return {
    provider: input.provider,
    model: input.local.model,
    ...(input.local.voice ? { voice: input.local.voice } : {}),
    ...(input.local.speed !== undefined ? { speed: input.local.speed } : {}),
  };
}

interface InitialMutableSpeechInputs {
  requested: RequestedSpeechProviders | undefined;
  localModels: LocalSpeechProviderConfig["models"] | undefined;
  openai: OttoOpenAIConfig | undefined;
  languages: { dictation: string | undefined; voice: string | undefined };
}

function collectInitialMutableSpeechInputs(config: OttoDaemonConfig): InitialMutableSpeechInputs {
  return {
    requested: config.speech?.providers,
    localModels: config.speech?.local?.models,
    openai: config.openai,
    languages: {
      dictation: config.speech?.sttLanguages?.dictation,
      voice: config.speech?.sttLanguages?.voice,
    },
  };
}

function initialMutableDictationSection(inputs: InitialMutableSpeechInputs) {
  return {
    enabled: inputs.requested?.dictationStt.enabled !== false,
    stt: initialMutableSttConfig({
      provider: inputs.requested?.dictationStt.provider ?? "local",
      localModel: inputs.localModels?.dictationStt ?? DEFAULT_LOCAL_STT_MODEL,
      openaiModel: inputs.openai?.stt?.model,
      language: inputs.languages.dictation,
    }),
  };
}

function resolveInitialLocalTtsSelection(
  localModels: LocalSpeechProviderConfig["models"] | undefined,
): { model: string; voice: string | undefined; speed: number | undefined } {
  const model = localModels?.voiceTts ?? DEFAULT_LOCAL_TTS_MODEL;
  const voice = resolveLocalTtsVoiceName(
    model,
    localModels?.voiceTtsSpeakerId ?? getLocalTtsDefaultSpeakerId(model),
  );
  return { model, voice, speed: localModels?.voiceTtsSpeed };
}

function initialMutableVoiceModeSection(inputs: InitialMutableSpeechInputs) {
  const voiceTtsEnabled = inputs.requested?.voiceTts.enabled !== false;
  const voiceSttEnabled = inputs.requested?.voiceStt.enabled !== false;
  return {
    enabled: voiceTtsEnabled || voiceSttEnabled,
    stt: initialMutableSttConfig({
      provider: inputs.requested?.voiceStt.provider ?? "local",
      localModel: inputs.localModels?.voiceStt ?? DEFAULT_LOCAL_STT_MODEL,
      openaiModel: inputs.openai?.stt?.model,
      language: inputs.languages.voice,
    }),
    tts: initialMutableTtsConfig({
      provider: inputs.requested?.voiceTts.provider ?? "local",
      local: resolveInitialLocalTtsSelection(inputs.localModels),
      openai: { model: inputs.openai?.tts?.model, voice: inputs.openai?.tts?.voice },
    }),
  };
}

// The mutable speech section mirrors the resolved speech config so clients see
// effective values (defaults included), not just what config.json happens to pin.
function createInitialMutableSpeechConfig(
  config: OttoDaemonConfig,
): NonNullable<MutableDaemonConfig["speech"]> {
  const inputs = collectInitialMutableSpeechInputs(config);
  // Only the key stored in config.json is echoed to clients - an env-only key
  // (OPENAI_API_KEY) stays out of the mutable config so unrelated speech
  // patches can never copy it onto disk.
  const persistedOpenAiApiKey = loadPersistedConfig(config.ottoHome).providers?.openai?.apiKey;
  return {
    dictation: initialMutableDictationSection(inputs),
    voiceMode: initialMutableVoiceModeSection(inputs),
    ...(persistedOpenAiApiKey ? { openai: { apiKey: persistedOpenAiApiKey } } : {}),
  };
}

// undefined mcpToolGroups = all groups enabled; only carry an explicit allowlist.
function buildInitialMcpSection(config: OttoDaemonConfig): MutableDaemonConfig["mcp"] {
  return {
    injectIntoAgents: config.mcpInjectIntoAgents ?? true,
    ...(config.mcpToolGroups !== undefined ? { toolGroups: config.mcpToolGroups } : {}),
  };
}

function buildInitialAgentBehaviors(
  config: OttoDaemonConfig,
): MutableDaemonConfig["agentBehaviors"] {
  return {
    promptSuggestions: config.agentBehaviors?.promptSuggestions ?? true,
    agentProgressSummaries: config.agentBehaviors?.agentProgressSummaries ?? true,
    notifyOnFinishDefault: config.agentBehaviors?.notifyOnFinishDefault ?? true,
    todoNudge: config.agentBehaviors?.todoNudge ?? true,
    todoReconcileOnIdle: config.agentBehaviors?.todoReconcileOnIdle ?? true,
    stallGuardThreshold:
      config.agentBehaviors?.stallGuardThreshold ?? STALL_GUARD_DEFAULT_THRESHOLD,
  };
}

/**
 * Retention for the images agents materialize (docs/attachment-lifecycle.md).
 * Host-level like the store it governs, and read fresh on every sweep, so an
 * edit takes effect on the next pass rather than at the next daemon restart.
 */
function buildInitialAttachmentImageRetention(persistedConfig: PersistedConfig): {
  attachmentImageMaxAgeDays: number;
  attachmentImageMaxTotalMb: number;
} {
  return {
    attachmentImageMaxAgeDays:
      persistedConfig.daemon?.attachmentImageMaxAgeDays ?? DEFAULT_ATTACHMENT_IMAGE_MAX_AGE_DAYS,
    attachmentImageMaxTotalMb:
      persistedConfig.daemon?.attachmentImageMaxTotalMb ?? DEFAULT_ATTACHMENT_IMAGE_MAX_TOTAL_MB,
  };
}

function buildInitialTerminalPreferences(
  persistedConfig: PersistedConfig,
): Pick<
  MutableDaemonConfig,
  "terminalTitleMode" | "terminalTitleIncludePaths" | "defaultTerminalShell"
> {
  const daemon = persistedConfig.daemon;
  return {
    ...(daemon?.terminalTitleMode !== undefined
      ? { terminalTitleMode: daemon.terminalTitleMode }
      : {}),
    ...(daemon?.terminalTitleIncludePaths !== undefined
      ? { terminalTitleIncludePaths: daemon.terminalTitleIncludePaths }
      : {}),
    ...(daemon?.defaultTerminalShell !== undefined
      ? { defaultTerminalShell: daemon.defaultTerminalShell }
      : {}),
  };
}

function buildInitialMetadataGeneration(
  config: OttoDaemonConfig,
): MutableDaemonConfig["metadataGeneration"] {
  return {
    providers: config.metadataGeneration?.providers ?? [],
    enabled: config.metadataGeneration?.enabled ?? true,
    preferWriterPersonalities: config.metadataGeneration?.preferWriterPersonalities ?? false,
  };
}

/**
 * "Microsoft .NET Solution Management" - off by default, and a **separate row** from `lsp` rather
 * than a member of it. The Solution view spawns a process and evaluates MSBuild, so it is opted
 * into; and turning C# code intelligence off does not turn this off, because the Language Server
 * Protocol has no project-structure request for it to have been built on.
 *
 * Only `enabled` round-trips through disk. The caps are daemon policy, not a user preference:
 * persisting them would freeze today's defaults into every existing install.
 */
function buildInitialDotnetSolutionManagement(
  persistedConfig: PersistedConfig,
): MutableDaemonConfig["dotnetSolutionManagement"] {
  return {
    enabled: persistedConfig.daemon?.dotnetSolutionManagement?.enabled ?? false,
    maxRunningProbes: 2,
    idleMinutes: 10,
  };
}

/**
 * The local AI host (otto-brain) projection round-trips config.json ⇄ mutable
 * config. Absent on disk reads as the schema default (OFF). The brain's own
 * config.json is the source of truth on disk; this is only the editable
 * projection the settings UI reads and the daemon writes through.
 */
function buildInitialBrainConfig(persistedConfig: PersistedConfig): MutableDaemonConfig["brain"] {
  const persistedBrain = persistedConfig.daemon?.brain;
  if (persistedBrain === undefined) {
    return DEFAULT_MUTABLE_BRAIN_CONFIG;
  }
  return MutableBrainConfigSchema.parse(persistedBrain);
}

function buildInitialGitFetchConfig(
  persistedConfig: PersistedConfig,
): NonNullable<MutableDaemonConfig["gitFetch"]> {
  return {
    enabled: persistedConfig.daemon?.gitFetch?.enabled ?? true,
    intervalSeconds: persistedConfig.daemon?.gitFetch?.intervalSeconds ?? 180,
  };
}

type MutableSavedProviderEndpoint = MutableDaemonConfig["savedProviderEndpoints"][number];

function withSavedEndpointApiKey(
  endpoint: PersistedSavedProviderEndpoint,
): MutableSavedProviderEndpoint {
  return { ...endpoint, apiKey: endpoint.apiKey ?? "" };
}

// The one stored roster, labelled "Personalities" in the UI. A host that has
// carried neither an agentProfiles section nor a legacy agentPersonalities one
// (undefined, not an empty roster the user cleared) is seeded with the shipped
// starter team. A pre-convergence host reads its legacy roster here so the
// in-memory config is correct on the very first tick; the durable copy is made
// by importLegacyPersonalitiesIfNeeded.
// COMPAT(agentPersonalities): added in v0.8.13, remove after 2027-02-22.
function buildInitialAgentProfiles(config: OttoDaemonConfig): AgentProfile[] {
  if (config.agentProfiles !== undefined) {
    return config.agentProfiles;
  }
  if (config.agentPersonalities !== undefined) {
    return config.agentPersonalities.personalities ?? [];
  }
  return [...DEFAULT_AGENT_PROFILES];
}

function buildInitialAgentTeams(config: OttoDaemonConfig): MutableDaemonConfig["agentTeams"] {
  return {
    // A missing section receives the inactive starter team. Persisting the seed
    // separately makes clearing the roster stick on subsequent starts.
    teams:
      config.agentTeams === undefined ? [...DEFAULT_AGENT_TEAMS] : (config.agentTeams.teams ?? []),
    ...(config.agentTeams?.activeTeamId !== undefined
      ? { activeTeamId: config.agentTeams.activeTeamId }
      : {}),
  };
}

function createInitialMutableDaemonConfig(config: OttoDaemonConfig): MutableDaemonConfig {
  const providers: MutableDaemonConfig["providers"] = Object.fromEntries(
    Object.entries(config.providerOverrides ?? {}).map(([providerId, override]) => {
      // Carry the full override so clients can inspect and edit custom
      // provider config (extends, env, models). The provider config schema is
      // passthrough, and persistence re-validates via ProviderOverrideSchema.
      const providerConfig: MutableDaemonConfig["providers"][string] = { ...override };
      return [providerId, providerConfig];
    }),
  );

  // Per-project git hosting credentials round-trip config.json ⇄ mutable
  // config the same way the speech OpenAI key does.
  const persistedConfig = loadPersistedConfig(config.ottoHome);
  const persistedGitHosting = persistedConfig.gitHosting;

  const initialConfig: MutableDaemonConfig = {
    relay: { enabled: config.relayEnabled ?? true },
    mcp: buildInitialMcpSection(config),
    browserTools: { enabled: config.browserToolsEnabled ?? false },
    // On by default and safe: nothing spawns until a code-intelligence action needs
    // a language in a workspace, so an unused language costs nothing.
    lsp: {
      enabled: true,
      languages: {},
      maxRunningServers: 6,
      idleMinutes: 10,
      backgroundIdleMinutes: 2,
    },
    dotnetSolutionManagement: buildInitialDotnetSolutionManagement(persistedConfig),
    // Local AI host (otto-brain) section. Round-trips from config.json; the
    // brain's own config.json is the source of truth and the daemon writes
    // changes through once brainControl is exercised (see MutableBrainConfigSchema).
    brain: buildInitialBrainConfig(persistedConfig),
    agentBehaviors: buildInitialAgentBehaviors(config),
    providers,
    metadataGeneration: buildInitialMetadataGeneration(config),
    autoArchiveAfterMerge: config.autoArchiveAfterMerge ?? false,
    gitFetch: buildInitialGitFetchConfig(persistedConfig),
    // Host-level client git-action policy; only the app consumes it, so it
    // rides the daemon config round-trip without a field on OttoDaemonConfig.
    hideMergeIntoBaseAction: persistedConfig.daemon?.hideMergeIntoBaseAction ?? false,
    ...buildInitialAttachmentImageRetention(persistedConfig),
    enableTerminalAgentHooks: config.enableTerminalAgentHooks ?? false,
    ...buildInitialTerminalPreferences(persistedConfig),
    appendSystemPrompt: config.appendSystemPrompt ?? "",
    speech: createInitialMutableSpeechConfig(config),
    ...(persistedGitHosting ? { gitHosting: persistedGitHosting } : {}),
    agentProfiles: buildInitialAgentProfiles(config),
    // COMPAT(agentPersonalities): added in v0.8.13, remove after 2027-02-22.
    // Retired section, kept on the wire so a pre-convergence client still
    // parses server_info. Nothing reads or writes it any more; the roster lives
    // in agentProfiles. An old client sees an empty roster rather than a stale
    // one, which is the feature contract's "upgrade the host" degradation.
    agentPersonalities: { personalities: [] },
    agentTeams: buildInitialAgentTeams(config),
    // User per-model tier tags round-trip config.json ⇄ mutable config; absent
    // on disk reads as an empty tag set (all tiers inferred at ingest).
    modelTierOverrides: config.modelTierOverrides ?? [],
    // Remembered provider endpoints round-trip config.json ⇄ mutable config;
    // absent on disk reads as "nothing remembered yet". A hand-edited entry may
    // omit apiKey (the wire shape requires the field), so it reads as "saved,
    // no credential" rather than dropping the endpoint.
    savedProviderEndpoints: (config.savedProviderEndpoints ?? []).map(withSavedEndpointApiKey),
    // Connector registry round-trips config.json ⇄ mutable config; absent on
    // disk reads as "no connectors configured yet".
    connectors: persistedConfig.daemon?.connectors ?? [],
  };

  if (config.terminalProfiles !== undefined) {
    initialConfig.terminalProfiles = config.terminalProfiles;
  }

  return initialConfig;
}

export async function createOttoDaemon(
  config: OttoDaemonConfig,
  rootLogger: Logger,
  dependencies: OttoDaemonDependencies = {},
): Promise<OttoDaemon> {
  configureGitProcessPolicy(config.git ?? resolveGitProcessPolicy({ env: process.env }));
  const logger = rootLogger.child({ module: "bootstrap" });
  const bootstrapStart = performance.now();
  const elapsed = () => `${(performance.now() - bootstrapStart).toFixed(0)}ms`;
  const daemonVersion = config.daemonVersion ?? resolveDaemonVersion(import.meta.url);
  const daemonConfigStore = new DaemonConfigStore(
    config.ottoHome,
    createInitialMutableDaemonConfig(config),
    logger,
    { relayEnabledMutable: config.relayEnabledMutable ?? true },
  );
  // Record the first-run seed on disk so the shipped starter team survives a
  // restart AND a subsequent "delete every profile" stays deleted.
  daemonConfigStore.seedDefaultProfilesIfAbsent(DEFAULT_AGENT_PROFILES);
  // COMPAT(agentPersonalities): added in v0.8.13, remove after 2027-02-22.
  // Fold a pre-convergence host's roster into agentProfiles. Runs after the
  // seed so a fresh host is seeded rather than importing an empty legacy list.
  daemonConfigStore.importLegacyPersonalitiesIfNeeded();
  daemonConfigStore.seedDefaultTeamsIfAbsent(DEFAULT_AGENT_TEAMS);
  // Publish the connector credential store before anything can spawn an agent:
  // the openai-compat provider reads it when it builds MCP transports, and a
  // signed-in connector with no store attaches no token and 401s.
  const connectorAuthStore: ConnectorAuthStore = {
    read: (connectorId) =>
      (daemonConfigStore.get().connectors ?? []).find((entry) => entry.id === connectorId)?.auth,
    write: (connectorId, auth) => {
      daemonConfigStore.setConnectorAuth(connectorId, auth);
    },
  };
  setConnectorAuthStore(connectorAuthStore);
  const connectorOAuthBroker = new ConnectorOAuthBroker({ store: connectorAuthStore, logger });
  const browserToolsPolicy = new DaemonConfigBrowserToolsPolicy(daemonConfigStore);
  const ottoToolGroupsPolicy = new DaemonConfigOttoToolGroupsPolicy(daemonConfigStore);
  const browserToolsBroker = new BrowserToolsBroker({});
  const previewDevServers = new DevServerManager({ logger });

  const serverId = getOrCreateServerId(config.ottoHome, { logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(config.ottoHome, logger);
  const managedProcesses = createBootstrapManagedProcessRegistry(config, logger);
  // Daemon-managed local AI host (otto-brain). Constructed alongside the other
  // managed children; it spawns the brain's `serve` command as a foreground
  // child, holds the process so it dies with the daemon, and talks to it over
  // HTTP. Settings are applied by the websocket server at startup and on change.
  // Forward-declared so the brain can tell the snapshot manager to re-probe the
  // otto-brain provider; the snapshot manager is built further down (it needs
  // the workspace git service) but reads the brain endpoint the same way.
  let providerSnapshotManagerRef: ProviderSnapshotManager | null = null;
  const brainManager = new BrainManager({
    logger,
    managedProcesses,
    ottoHome: config.ottoHome,
    onReachabilityChanged: () => {
      void providerSnapshotManagerRef
        ?.refreshProviderEverywhere(OTTO_BRAIN_PROVIDER_ID)
        .catch((error: unknown) => {
          logger.warn({ err: error }, "Failed to refresh the Otto Brain provider snapshot");
        });
    },
  });
  // Model/runtime management + long jobs, driven by shelling out to the
  // otto-brain CLI. Separate from BrainManager (which owns the serve lifecycle).
  const brainOpsManager = new BrainOpsManager({
    logger,
    ottoHome: config.ottoHome,
    onRuntimeInstalled: ({ build, runtime }) => {
      // A latest install resolves at request time, so retain the automatic
      // policy. An explicitly named build is a deliberate pin.
      daemonConfigStore.patch({
        brain: {
          runtime:
            build && build !== "latest"
              ? { source: "managed", path: runtime.dir }
              : { source: "auto", path: null },
        },
      });
    },
    onPullCompleted: () => brainManager.rescanInventory(),
  });
  // Reconcile the helper-process ledger in the background so it never blocks the
  // daemon from coming up; terminating a live leftover can take a few seconds.
  // Best-effort, so a failure is logged here rather than crashing startup.
  void reconcileManagedProcessLedger(managedProcesses, logger).catch((error) => {
    logger.warn({ err: error }, "Failed to reconcile managed helper process ledger");
  });
  const stopMaterializedImageHousekeeping = startMaterializedImageHousekeeping({
    ottoHome: config.ottoHome,
    logger,
    getPolicy: () => {
      const current = daemonConfigStore.get();
      return {
        maxAgeDays: current.attachmentImageMaxAgeDays,
        maxTotalMb: current.attachmentImageMaxTotalMb,
      };
    },
  });
  let relayRuntime: RelayRuntime | null = null;

  const staticDir = config.staticDir;
  const downloadTokenTtlMs = config.downloadTokenTtlMs ?? 60000;

  const downloadTokenStore = new DownloadTokenStore({
    ttlMs: downloadTokenTtlMs,
  });

  // Capability token authenticating the daemon's own agents to the loopback
  // Agent MCP endpoint (/mcp/agents). Random per daemon run, injected only into
  // local agent configs and the daemon's own MCP client - never sent to remote
  // clients - so it cannot be replayed off-box. This lets the injected MCP
  // authenticate even when the daemon password is set via the app (hash only,
  // no plaintext available). Mirrors the /api/files/download capability-token
  // pattern.
  const agentMcpAuthToken = randomUUID();

  const listenTarget = parseListenString(config.listen);

  const app = express();
  app.set("trust proxy", resolveExpressTrustProxySetting(config));
  let boundListenTarget: ListenTarget | null = null;
  let workspaceRegistry: FileBackedWorkspaceRegistry | null = null;
  const terminalManager = createConfiguredTerminalManager({
    getTerminalActivityUrl: () => createTerminalActivityUrl(boundListenTarget),
  });
  applyTerminalAgentHookSetting({ store: daemonConfigStore, logger });

  const serviceProxyPublicBaseUrl = config.serviceProxy?.publicBaseUrl
    ? config.serviceProxy.publicBaseUrl
    : null;
  const serviceProxy = createServiceProxySubsystem({
    logger,
    publicBaseUrl: serviceProxyPublicBaseUrl,
  });
  const scriptRuntimeStore = new WorkspaceScriptRuntimeStore();
  const workspaceSetupRuntime = new WorkspaceSetupRuntime();
  const configuredHostnames = config.hostnames ?? config.allowedHosts;
  let wsServer: VoiceAssistantWebSocketServer | null = null;
  let serviceProxyListenTarget: ListenTarget | null = null;
  const scriptHealthMonitor = new ScriptHealthMonitor({
    serviceProxy,
    onChange: createScriptStatusEmitter({
      sessions: () =>
        wsServer?.listTrustedSessions().map((session) => ({
          emit: (message) => session.emitServerMessage(message),
        })) ?? [],
      serviceProxy,
      runtimeStore: scriptRuntimeStore,
      daemonPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
      resolveWorkspaceDirectory: async (workspaceId) =>
        (await workspaceRegistry?.get(workspaceId))?.cwd ?? null,
      logger,
      serviceProxyPublicBaseUrl,
    }),
  });
  const handleBranchChange = createBranchChangeRouteHandler({
    serviceProxy,
    onRoutesChanged: (workspaceId) => {
      scriptHealthMonitor.invalidateWorkspace(workspaceId);
    },
    logger,
  });

  // Service proxy classifies service hosts before daemon auth/route fallthrough.
  // Registered service hosts proxy directly; known service namespaces without a
  // route return 404 and never reach daemon APIs.
  app.use(serviceProxy.middleware());

  // Host allowlist / DNS rebinding protection (vite-like semantics).
  // For non-TCP (unix sockets), skip host validation.
  if (listenTarget.type === "tcp") {
    app.use((req, res, next) => {
      const hostHeader = typeof req.headers.host === "string" ? req.headers.host : undefined;
      if (!isHostnameAllowed(hostHeader, configuredHostnames)) {
        res.status(403).json({ error: "Invalid Host header" });
        return;
      }
      next();
    });
  }

  // CORS - allow same-origin + configured origins
  const allowedOrigins = new Set([
    ...config.corsAllowedOrigins,
    // Packaged desktop renderers use the custom otto:// protocol scheme.
    "otto://app",
    // For TCP, add localhost variants
    ...(listenTarget.type === "tcp"
      ? [
          `http://${listenTarget.host}:${listenTarget.port}`,
          `http://localhost:${listenTarget.port}`,
          `http://127.0.0.1:${listenTarget.port}`,
        ]
      : []),
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Local, harmless, and token-gated; deliberately skips daemon auth.
  app.post(
    "/api/terminal-activity",
    express.json(),
    createTerminalActivityRouteHandler(terminalManager),
  );

  // Serve the bundled browser web UI when enabled. Mounted after service-proxy
  // classification and host/CORS handling, but before daemon bearer auth, so
  // static app files load without the daemon password while API/WebSocket calls
  // remain protected.
  mountWebUi(app, config, logger);

  app.use(
    createRequireBearerMiddleware(config.auth, (context) => {
      logger.warn(context, "Rejected HTTP request with invalid daemon password");
    }),
  );

  app.use(express.json());

  // Serve static files from public directory
  app.use("/public", express.static(staticDir));

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "server_info",
      serverId,
      hostname: getHostname(),
      version: daemonVersion,
      listen: formatListenTarget(boundListenTarget ?? listenTarget),
    });
  });

  const handleFileDownload = async (req: express.Request, res: express.Response): Promise<void> => {
    const token =
      typeof req.query.token === "string" && req.query.token.trim().length > 0
        ? req.query.token.trim()
        : null;

    if (!token) {
      res.status(400).json({ error: "Missing download token" });
      return;
    }

    const entry = downloadTokenStore.consumeToken(token);
    if (!entry) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }

    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fileHandle = await open(entry.absolutePath, DOWNLOAD_OPEN_FLAGS);
      const fileStats = await fileHandle.stat();
      if (!fileStats.isFile()) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const safeFileName = entry.fileName.replace(/["\r\n]/g, "_");
      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
      res.setHeader("Content-Length", fileStats.size.toString());

      const stream = fileHandle.createReadStream();
      fileHandle = null;
      stream.on("error", (err) => {
        logger.error({ err }, "Failed to stream download");
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read file" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      logger.error({ err }, "Failed to download file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    } finally {
      await fileHandle?.close().catch(() => undefined);
    }
  };

  app.get("/api/files/download", (req, res) => {
    void handleFileDownload(req, res);
  });

  const httpServer = createHTTPServer(app);

  // Script proxy WebSocket upgrade handler - must be registered before the
  // VoiceAssistantWebSocketServer attaches its own "upgrade" listener so that
  // script-bound upgrades are forwarded first. The handler is a no-op for
  // requests that don't match a registered script route.
  httpServer.on("upgrade", serviceProxy.upgradeHandler({ passthroughUnknown: true }));

  if (config.serviceProxy?.standaloneListen) {
    serviceProxyListenTarget = parseListenString(config.serviceProxy.standaloneListen);
  }

  const agentStorage = new AgentStorage(config.agentStoragePath, logger);
  const personalityStatsStore = new PersonalityStatsStore(
    path.join(config.ottoHome, "stats", "personality-usage.json"),
    logger,
  );
  // The lessons personalities accrue. One file per personality, so the store is
  // handed a directory rather than a path.
  const personalityMemoryStore = new PersonalityMemoryStore(
    path.join(config.ottoHome, "personality-memory"),
    logger,
  );
  const activityStatsStore = new ActivityStatsStore(
    path.join(config.ottoHome, "activity-stats.json"),
    logger,
  );
  const recordActivity: ActivityIncrementFn = (field, by) => {
    void activityStatsStore.increment(field, by);
  };
  // Itemized usage ledger - the scrollable rows behind the aggregate tiles.
  // Fed from the same chokepoint that moves the counters (usage-ledger project).
  const usageLogStore = new UsageLogStore(path.join(config.ottoHome, "usage-log.json"), logger);
  const projectRegistry = new FileBackedProjectRegistry(
    path.join(config.ottoHome, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(config.ottoHome, "projects", "workspaces.json"),
    logger,
  );
  const projectLinkStore = new FileBackedProjectLinkStore(
    path.join(config.ottoHome, "projects", "project-links.json"),
    logger,
  );
  // All PR/issue functionality routes through the git hosting layer: GitHub
  // uses gh and Bitbucket Cloud uses its native REST adapter.
  const gitHostingResolver = createGitHostingResolver({
    github: createGitHubHostingService(),
    getDaemonConfig: () => daemonConfigStore.get(),
    readOttoConfigJson,
    ottoHome: config.ottoHome,
  });
  const github = createGitHostingRouter(gitHostingResolver);
  const bitbucketCloud = createGitHostingProviderForgeAdapter(
    gitHostingResolver,
    "bitbucket-cloud",
  );
  const unsubscribeGitHostingConfigChange = daemonConfigStore.onChange(() => {
    // Provider credentials may have changed; re-resolve on next use.
    gitHostingResolver.invalidateAll();
  });
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger,
    ottoHome: config.ottoHome,
    worktreesRoot: config.worktreesRoot,
    fetchPolicy: daemonConfigStore.get().gitFetch ?? { enabled: true, intervalSeconds: 180 },
    deps: {
      forgeOverrides: { github, "bitbucket-cloud": bitbucketCloud },
      resolveHostingForCwd: async (cwd) => {
        const resolved = await gitHostingResolver.resolveForCwd(cwd);
        return {
          providerId: resolved.providerId,
          capabilities: resolved.capabilities,
          credentialsMissing: resolved.credentialsMissing,
        };
      },
    },
  });
  daemonConfigStore.onFieldChange("gitFetch", (value) => {
    workspaceGitService.setFetchPolicy(
      value as { enabled: boolean; intervalSeconds: 60 | 180 | 300 | 600 | 900 | 1_800 | 3_600 },
    );
  });

  const workspaceProvisioning = createWorkspaceProvisioningService({
    serverId,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  // Personality memory. Constructed here because AgentManager needs it below to
  // inject each personality's accrued lessons at spawn, and it needs the git
  // service to scope project lessons to a repo root rather than a bare cwd
  // (a worktree and its main checkout are the same project's lessons).
  const personalityMemory = new PersonalityMemoryService({
    store: personalityMemoryStore,
    readAgentProfiles: () => daemonConfigStore.get().agentProfiles ?? [],
    resolveProjectRoot: (cwd) => workspaceGitService.resolveRepoRoot(cwd),
    logger,
  });
  const projectKnowledge = new ProjectKnowledgeService({
    resolveProjectRoot: (cwd) => workspaceGitService.resolveRepoRoot(cwd),
    logger,
  });

  const providerSnapshotLogger = logger.child({ module: "provider-snapshot-manager" });
  const providerSnapshotManager = new ProviderSnapshotManager({
    logger: providerSnapshotLogger,
    refreshTimeoutMs: config.providerCatalogRefreshTimeoutMs,
    runtimeSettings: config.agentProviderSettings,
    providerOverrides: config.providerOverrides,
    workspaceGitService,
    managedProcesses,
    isDev: config.isDev === true,
    extraClients: config.agentClients,
    modelTierOverrides: daemonConfigStore.get().modelTierOverrides,
    connectors: daemonConfigStore.get().connectors,
    brainEndpoint: () => brainManager.getProviderEndpoint(),
  });
  providerSnapshotManagerRef = providerSnapshotManager;
  const initialAgentManagerState = providerSnapshotManager.getAgentManagerProviderState();
  const retainedTranscriptStore = new RetainedTranscriptStore({
    ottoHome: config.ottoHome,
    logger,
  });
  const agentManager = new AgentManager({
    clients: initialAgentManagerState.clients,
    providerDefinitions: initialAgentManagerState.providerDefinitions,
    registry: agentStorage,
    retainedTranscripts: retainedTranscriptStore,
    appendSystemPrompt: config.appendSystemPrompt,
    agentBehaviors: config.agentBehaviors,
    onWorkspaceStateMayHaveChanged: ({ cwd }) => {
      workspaceGitService.onWorkspaceStateMayHaveChanged(cwd);
    },
    // Counted at the createAgent choke point so composer, MCP create_agent,
    // and schedule spawns all land in the per-personality usage stats.
    onPersonalitySpawn: (personalityId) => {
      void personalityStatsStore.increment(personalityId);
    },
    // Injected at the same choke point, so every spawn path - composer, MCP
    // create_agent, schedule runs, orchestration, resume - carries the
    // personality's accrued lessons without threading anything per-caller.
    resolvePersonalityMemoryBrief: (params) => personalityMemory.resolveBriefForSpawn(params),
    resolveProjectKnowledgeBrief: async ({ cwd }) => {
      if (!cwd) return null;
      const brief = await projectKnowledge.briefForCwd(cwd);
      return brief.text || null;
    },
    // The repo's own AGENTS.md, for the providers that have no CLI of their own
    // to read it. Same choke point as the two briefs above, so every spawn path
    // gets it; the manager applies the `ownsContextPayload` gate so the
    // CLI-backed providers are not sent their instructions a second time.
    resolveInstructionFiles: async ({ cwd }) => {
      if (!cwd) return null;
      const projectRoot = await resolveProjectRootForCwd(cwd, (dir) =>
        workspaceGitService.resolveRepoRoot(dir),
      );
      const loaded = await loadInstructionFiles({
        cwd,
        projectRoot,
        homeDir: homedir(),
        env: process.env,
        logger,
      });
      return loaded.text;
    },
    onActivity: recordActivity,
    onUsageEvent: (event) => usageLogStore.append(event),
    mcpAuthToken: agentMcpAuthToken,
    logger,
  });

  const detachAgentStoragePersistence = attachAgentStoragePersistence(
    logger,
    agentManager,
    agentStorage,
  );
  await agentStorage.initialize();
  logger.info({ elapsed: elapsed() }, "Agent storage initialized");
  await bootstrapWorkspaceRegistries({
    ottoHome: config.ottoHome,
    agentStorage,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  logger.info({ elapsed: elapsed() }, "Workspace registries bootstrapped");
  await projectLinkStore.initialize();
  const teardownArchivedWorkspaceRuntime = (workspaceId: string): void => {
    scriptRuntimeStore.removeForWorkspace(workspaceId);
    releaseWorkspaceServicePortPlan(workspaceId);
  };
  const workspaceReconciliation = new WorkspaceReconciliationService({
    serverId,
    projectRegistry,
    workspaceRegistry,
    logger,
    workspaceGitService,
    onProjectUpdate: (update) => wsServer?.publishProjectUpdate(update),
    onWorkspaceArchived: teardownArchivedWorkspaceRuntime,
    onWorkspacesChanged: async (workspaceIds) => {
      await fanOutReconciledWorkspaceUpdates({
        sessions: wsServer?.listTrustedSessions() ?? [],
        workspaceIds,
        logger,
      });
    },
  });
  await workspaceReconciliation.start();
  void workspaceReconciliation.reconcileNow().catch((error) => {
    logger.warn({ err: error }, "Initial workspace reconciliation failed");
  });
  const checkoutDiffManager = new CheckoutDiffManager({
    logger,
    ottoHome: config.ottoHome,
    workspaceGitService,
  });
  const archiveWorkspaceRecordExternal = async (
    workspaceId: string,
    context?: WorkspaceArchiveContext,
  ) => {
    const existingWorkspace = await archivePersistedWorkspaceRecord({
      workspaceId,
      workspaceRegistry,
      context,
    });
    if (!existingWorkspace || existingWorkspace.archivedAt) return;
    teardownArchivedWorkspaceRuntime(workspaceId);
  };
  // external path→workspace adapter, not ownership: archive-by-path requests that
  // arrive with a worktree path and no workspaceId (old clients / CLI).
  const findWorkspaceIdForCwdExternal = async (cwd: string): Promise<string | null> => {
    return resolveWorkspaceIdForPath(cwd, await workspaceRegistry.list());
  };
  const ensureWorkspaceForCreateExternal = async (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<string> => {
    // One directory = one live workspace: reuse the visible workspace already
    // backing the cwd (MCP create_agent, loops, and agent-spawned terminals
    // attach to it) instead of minting a duplicate - which
    // createLocalCheckoutWorkspace now rejects. Auto-naming only runs for a
    // freshly minted workspace; an existing one keeps its name.
    const existingWorkspace = findOccupyingWorkspaceForCwd(await workspaceRegistry.list(), cwd);
    if (existingWorkspace) {
      return existingWorkspace.workspaceId;
    }
    const workspace = await createLocalCheckoutWorkspace(
      { cwd, title: resolveFirstAgentPromptTitle(firstAgentContext) },
      { projectRegistry, workspaceRegistry, workspaceGitService },
    );
    if (firstAgentContext) {
      workspaceAutoName.scheduleForDirectory({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        firstAgentContext,
      });
    }
    return workspace.workspaceId;
  };
  const listActiveWorkspacesExternal = async (): Promise<ActiveWorkspaceRef[]> => {
    const workspaces = await workspaceRegistry.list();
    return workspaces
      .filter((workspace) => !workspace.archivedAt)
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        kind: workspace.kind,
        worktreeRoot: workspace.worktreeRoot,
        isOttoOwnedWorktree: workspace.isOttoOwnedWorktree,
        mainRepoRoot: workspace.mainRepoRoot,
      }));
  };
  const markWorkspaceArchivingExternal = (workspaceIds: Iterable<string>, archivingAt: string) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listTrustedSessions() ?? []) {
      session.markWorkspaceArchivingForExternalMutation(workspaceIdList, archivingAt);
    }
  };
  const clearWorkspaceArchivingExternal = (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listTrustedSessions() ?? []) {
      session.clearWorkspaceArchivingForExternalMutation(workspaceIdList);
    }
  };
  const emitWorkspaceUpdatesExternal = async (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    await Promise.all(
      (wsServer?.listTrustedSessions() ?? []).map((session) =>
        session.emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIdList),
      ),
    );
  };
  const ensureWorkspaceForCreateAndBroadcastExternal = async (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<string> => {
    const workspaceId = await ensureWorkspaceForCreateExternal(cwd, firstAgentContext);
    await emitWorkspaceUpdatesExternal([workspaceId]);
    return workspaceId;
  };
  const emitWorkspaceUpdateForCwdExternal = async (cwd: string) => {
    const workspaceIds = workspaceIdsOnCheckout(await workspaceRegistry.list(), cwd);
    await emitWorkspaceUpdatesExternal(workspaceIds);
  };
  const emitExternalSessionMessage = (message: SessionOutboundMessage) => {
    wsServer?.broadcast(wrapSessionMessage(message));
  };
  // Live-update the Metrics screen: whenever any activity counter moves, ping
  // every connected client so it re-fetches stats.activity.get. The store
  // coalesces increments (max one callback per couple of seconds), so this
  // stays a low-frequency, payload-free broadcast.
  activityStatsStore.onDidChange(() => {
    emitExternalSessionMessage({ type: "activity_stats_changed" });
  });
  // Daemon-global artifact service backing the create_artifact agent tool.
  // Client-initiated artifact RPCs go through each session's own service
  // instance; both share the same file-backed store under $OTTO_HOME. Status
  // notifications broadcast to every client so artifacts created by agents
  // show up live everywhere.
  const toolArtifactService = new ArtifactService({
    projectCwd: config.ottoHome,
    logger,
    agentManager,
    providerSnapshotManager,
    broadcastArtifactUpdate: (metadata) => {
      emitExternalSessionMessage({
        type: "artifact.updated.notification",
        payload: { artifact: metadata },
      });
    },
    onActivity: recordActivity,
  });
  const workspaceAutoName = new WorkspaceAutoName({
    agentManager,
    workspaceRegistry,
    workspaceGitService,
    providerSnapshotManager,
    readDaemonConfig: () => ({
      metadataGeneration: daemonConfigStore.get().metadataGeneration,
      agentProfiles: daemonConfigStore.get().agentProfiles,
      agentTeams: daemonConfigStore.get().agentTeams,
    }),
    gitMutation: createGitMutationService({
      workspaceGitService,
      logger,
    }),
    emitWorkspaceUpdateForCwd: emitWorkspaceUpdateForCwdExternal,
    emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => {
      await emitWorkspaceUpdatesExternal([workspaceId]);
    },
    logger,
  });
  const agentAutoTitle = new AgentAutoTitle({
    agentManager,
    agentStorage,
    providerSnapshotManager,
    readDaemonConfig: () => ({
      metadataGeneration: daemonConfigStore.get().metadataGeneration,
      agentProfiles: daemonConfigStore.get().agentProfiles,
      agentTeams: daemonConfigStore.get().agentTeams,
    }),
    workspaceGitService,
    logger,
  });

  setupAutoArchiveOnMerge({
    ottoHome: config.ottoHome,
    ottoWorktreesBaseRoot: config.worktreesRoot,
    daemonConfigStore,
    workspaceGitService,
    github,
    agentManager,
    agentStorage,
    terminalManager,
    logger,
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    getAutoArchivedChangeRequestUrl: async (workspaceId) =>
      (await workspaceRegistry.get(workspaceId))?.autoArchivedChangeRequestUrl ?? null,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
  });

  const createOttoWorktreeForTools = async (
    input: Parameters<typeof createOttoWorktreeWorkflow>[1],
    serviceOptions?: Parameters<typeof createOttoWorktreeWorkflow>[2],
  ) => {
    return createOttoWorktreeWorkflow(
      {
        ottoHome: config.ottoHome,
        worktreesRoot: config.worktreesRoot,
        createOttoWorktree: async (workflowInput, workflowOptions) => {
          return createRegisteredOttoWorktree(workflowInput, {
            github,
            ...(workflowOptions?.resolveDefaultBranch
              ? {
                  resolveDefaultBranch: workflowOptions.resolveDefaultBranch,
                }
              : {}),
            projectRegistry,
            workspaceRegistry,
            workspaceGitService,
            workspaceProvisioning,
          });
        },
        warmWorkspaceGitData: async (workspace) => {
          await Promise.all(
            wsServer
              ?.listTrustedSessions()
              .map((session) => session.warmWorkspaceGitDataForWorkspace(workspace)) ?? [],
          );
        },
        autoNameWorkspaceBranchForFirstAgent: (autoNameInput) =>
          workspaceAutoName.scheduleForWorktree(autoNameInput),
        emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => {
          await emitWorkspaceUpdatesExternal([workspaceId]);
        },
        cacheWorkspaceSetupSnapshot: () => {},
        startWorkspaceSetup: (workspaceId, operation) =>
          workspaceSetupRuntime.start(workspaceId, operation),
        emit: emitExternalSessionMessage,
        sessionLogger: logger,
        terminalManager,
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        serviceProxy,
        scriptRuntimeStore,
        getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
        getDaemonTcpHost: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
        serviceProxyPublicBaseUrl,
        onScriptsChanged: null,
      },
      input,
      serviceOptions,
    );
  };

  const createAgentCommandDependencies: CreateAgentCommandDependencies = {
    agentManager,
    agentStorage,
    logger,
    ottoHome: config.ottoHome,
    worktreesRoot: config.worktreesRoot,
    terminalManager,
    providerSnapshotManager,
    createOttoWorktree: createOttoWorktreeForTools,
    ensureWorkspaceForCreate: ensureWorkspaceForCreateAndBroadcastExternal,
    scheduleAutoTitle: (request) => agentAutoTitle.schedule(request),
  };
  const createAgent = (input: Parameters<typeof createAgentCommand>[1]) =>
    createAgentCommand(createAgentCommandDependencies, input);
  const archiveWorkspaceByIdExternal = (workspaceId: string, requestId: string) =>
    archiveByScope(
      {
        ottoHome: config.ottoHome,
        ottoWorktreesBaseRoot: config.worktreesRoot,
        github,
        workspaceGitService,
        agentManager,
        agentStorage,
        findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
        listActiveWorkspaces: listActiveWorkspacesExternal,
        getWorkspace: (workspaceIdToGet) => workspaceRegistry.get(workspaceIdToGet),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        killTerminalsForWorkspace: (workspaceIdToKill) =>
          killTerminalsForWorkspace({ terminalManager, sessionLogger: logger }, workspaceIdToKill),
        stopWorkspaceSetup: (workspaceIdToStop) => workspaceSetupRuntime.stop(workspaceIdToStop),
        sessionLogger: logger,
      },
      { scope: { kind: "workspace", workspaceId }, requestId },
    );
  const hubAgentLifecycle = new CreateAgentLifecycleDispatch({
    ottoHome: config.ottoHome,
    worktreesRoot: config.worktreesRoot,
    agentManager,
    agentStorage,
    github,
    workspaceGitService,
    createOttoWorktreeWorkflow: createOttoWorktreeForTools,
    archiveAgentForClose: (agentId) =>
      archiveAgentCommand({ agentManager, agentStorage, logger }, agentId),
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    emit: emitExternalSessionMessage,
    emitAgentRemove: async () => undefined,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    killTerminalsForWorkspace: (workspaceId) =>
      killTerminalsForWorkspace({ terminalManager, sessionLogger: logger }, workspaceId),
    logger,
  });
  const hubRelationships = new HubRelationshipController({
    ottoHome: config.ottoHome,
    hostname: getHostname(),
    serverId,
    daemonPublicKey: daemonKeyPair.publicKeyB64,
    logger,
    remote: dependencies.hubRelationshipRemote ?? new DirectHubRelationshipRemote(),
    clock: dependencies.hubRelationshipClock,
    retryPolicy: dependencies.hubRelationshipRetryPolicy,
    createDaemonId: dependencies.createHubDaemonId,
    attachSocket: async (socket, options) => {
      if (!wsServer) throw new Error("WebSocket server is not running");
      await wsServer.attachHubSocket(socket, options);
    },
    createExecutionAgents: (daemonId) =>
      new DaemonExecutions({
        daemonId,
        agentManager,
        agentStorage,
        createAgent,
        interruptAgent: (agentId) => cancelAgentRunCommand({ agentManager, logger }, agentId),
        archiveWorkspace: archiveWorkspaceByIdExternal,
        cleanupFailedCreate: (input) =>
          hubAgentLifecycle.cleanupCreatedWorktreeAfterFailedAgentCreate(input),
      }),
  });

  const createScheduleLocalWorkspaceExternal = async (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
    hidden: boolean;
  }) => {
    const workspace = await createLocalCheckoutWorkspace(
      {
        cwd: input.cwd,
        title: resolveFirstAgentPromptTitle(input.firstAgentContext),
        hidden: input.hidden,
      },
      { projectRegistry, workspaceRegistry, workspaceGitService },
    );
    workspaceAutoName.scheduleForDirectory({
      workspaceId: workspace.workspaceId,
      cwd: workspace.cwd,
      firstAgentContext: input.firstAgentContext,
    });
    // A hidden workspace resolves to no descriptor, so this emit is a no-op REMOVE
    // (the row was never shown); it stays out of the sidebar until revealed.
    await emitWorkspaceUpdatesExternal([workspace.workspaceId]);
    return workspace;
  };
  const createScheduleOttoWorktreeExternal = async (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
    hidden: boolean;
  }) => {
    const result = await createOttoWorktreeForTools({
      cwd: input.cwd,
      firstAgentContext: input.firstAgentContext,
      hidden: input.hidden,
    });
    await emitWorkspaceUpdatesExternal([result.workspace.workspaceId]);
    return result;
  };
  // Reveal a hidden schedule-run workspace: flip `hidden` to false in the shared
  // registry, then emit so every session upserts it into the sidebar (the
  // descriptor now resolves). No-op if the workspace is already visible or gone.
  // When the directory is already backed by a visible workspace, this reattaches
  // the finished run to that occupant instead of revealing a duplicate - see
  // revealScheduleRunWorkspace for why.
  const revealScheduleWorkspaceExternal = async (workspaceId: string) => {
    const outcome = await revealScheduleRunWorkspace(workspaceId, {
      workspaceRegistry,
      agentStorage,
      archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    });
    switch (outcome.kind) {
      case "noop":
        return;
      case "revealed":
        await emitWorkspaceUpdatesExternal([workspaceId]);
        return;
      case "reattached":
        logger.info(
          {
            workspaceId,
            occupantWorkspaceId: outcome.occupantWorkspaceId,
            movedAgents: outcome.movedAgentIds.length,
          },
          "Reattached scheduled run to the workspace already backing its directory",
        );
        await emitWorkspaceUpdatesExternal([workspaceId, outcome.occupantWorkspaceId]);
        return;
    }
  };
  const archiveScheduleWorkspaceExternal = async (workspaceId: string, repoRoot: string) => {
    await archiveByScope(
      {
        ottoHome: config.ottoHome,
        ottoWorktreesBaseRoot: config.worktreesRoot,
        github,
        workspaceGitService,
        agentManager,
        agentStorage,
        findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
        listActiveWorkspaces: listActiveWorkspacesExternal,
        getWorkspace: (workspaceIdToGet) => workspaceRegistry.get(workspaceIdToGet),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        killTerminalsForWorkspace: (workspaceIdToKill) =>
          killTerminalsForWorkspace(
            {
              terminalManager,
              sessionLogger: logger,
            },
            workspaceIdToKill,
          ),
        stopWorkspaceSetup: (workspaceIdToStop) => workspaceSetupRuntime.stop(workspaceIdToStop),
        sessionLogger: logger,
      },
      {
        scope: { kind: "workspace", workspaceId },
        repoRoot,
        ottoWorktreesBaseRoot: config.worktreesRoot,
        requestId: "schedule-run-finish",
      },
    );
  };
  const scheduleService = new ScheduleService({
    ottoHome: config.ottoHome,
    logger,
    agentManager,
    agentStorage,
    createAgent,
    createLocalCheckoutWorkspace: createScheduleLocalWorkspaceExternal,
    createOttoWorktreeWorkspace: createScheduleOttoWorktreeExternal,
    archiveWorkspace: archiveScheduleWorkspaceExternal,
    revealWorkspace: revealScheduleWorkspaceExternal,
    providerSnapshotManager,
    readAgentProfiles: () => daemonConfigStore.get().agentProfiles ?? [],
    readAgentTeams: () => daemonConfigStore.get().agentTeams,
    onActivity: recordActivity,
  });
  await scheduleService.start();
  agentManager.setAgentArchivedCallback(async (agentId) => {
    try {
      await scheduleService.completeForAgent(agentId);
    } catch (error) {
      logger.warn({ err: error, agentId }, "Failed to complete schedules for archived agent");
    }
  });
  logger.info({ elapsed: elapsed() }, "Schedule service initialized");

  // Orchestration runtime - owns multi-agent Runs and drives the engine. Run
  // updates broadcast to every connected client so the UI can watch live.
  // A terminal run is summarized by a Writer (same one-shot, internal-agent path
  // as commit messages) so the Runs display shows a plain-language recap.
  const runSummaryGeneration = createAgentStructuredTextGeneration({
    agentManager,
    providerSnapshotManager,
    readDaemonConfig: () => {
      const cfg = daemonConfigStore.get();
      return {
        metadataGeneration: cfg.metadataGeneration,
        agentProfiles: cfg.agentProfiles,
        agentTeams: cfg.agentTeams,
      };
    },
    getFocusedSelection: () => undefined,
  });
  const runSummarySchema = z.object({ summary: z.string().min(1) });
  const runService = new RunService({
    store: new RunStore(path.join(config.ottoHome, "runs")),
    logger,
    onActivity: recordActivity,
    summarize: async (run) => {
      const result = await runSummaryGeneration.generate({
        cwd: run.cwd ?? config.ottoHome,
        prompt: buildRunSummaryPrompt(run),
        schema: runSummarySchema,
        schemaName: "RunSummary",
        agentTitle: "Run summary",
      });
      return result.summary;
    },
  });
  await runService.init();
  runService.onChange((run) => {
    emitExternalSessionMessage({ type: "runs.updated.notification", payload: { run } });
  });
  runService.onRemove((runIds) => {
    emitExternalSessionMessage({ type: "runs.cleared.notification", payload: { runIds } });
  });
  logger.info({ elapsed: elapsed() }, "Run service initialized");
  // Orchestration graph templates (projects/orchestration-graphs) - host-level,
  // like personalities/teams. Starter graphs seed once; user edits win forever.
  const graphStore = new GraphStore(path.join(config.ottoHome, "orchestration-graphs"));
  // Where a graph node's submit_output call lands on its way to the engine.
  // One per daemon, shared by the tool catalog (writes) and the orchestration
  // spawn port (reads); see orchestration/node-output.ts.
  const nodeOutputStore = new NodeOutputStore();
  // Reusable prompts + snippets, stored like graphs and for the same reason.
  const promptTemplateStore = new PromptTemplateStore(
    path.join(config.ottoHome, "prompt-templates"),
  );
  await seedStarterGraphs(graphStore, logger);
  await seedStarterPromptTemplates(promptTemplateStore, logger);
  graphStore.onChange((graphs) => {
    emitExternalSessionMessage({ type: "runs.graphs.changed.notification", payload: { graphs } });
  });
  promptTemplateStore.onChange((templates) => {
    emitExternalSessionMessage({
      type: "runs.templates.changed.notification",
      payload: { templates },
    });
  });
  logger.info({ elapsed: elapsed() }, "Orchestration graph store initialized");
  logger.info({ elapsed: elapsed() }, "Loading persisted agent registry");
  const persistedRecords = await agentStorage.list();
  logger.info(
    { elapsed: elapsed() },
    `Agent registry loaded (${persistedRecords.length} record${persistedRecords.length === 1 ? "" : "s"}); agents will initialize on demand`,
  );
  logger.info(
    "Voice mode configured for agent-scoped resume flow (no dedicated voice assistant provider)",
  );
  logger.info({ elapsed: elapsed() }, "Preparing voice and MCP runtime");

  const createAgentToolHostDependencies = (
    runtime: OttoToolRuntimeContext,
  ): OttoToolHostDependencies => ({
    agentManager,
    agentStorage,
    terminalManager,
    getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
    scheduleService,
    runService,
    providerSnapshotManager,
    readAgentProfiles: () => daemonConfigStore.get().agentProfiles ?? [],
    readAgentTeams: () => daemonConfigStore.get().agentTeams,
    personalityMemory,
    projectKnowledge,
    github,
    workspaceGitService,
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
    workspaceRegistry,
    projectRegistry,
    // Backs create_workspace's "local" isolation. The worktree half rides on
    // createOttoWorktree below, so both isolations reach the same services the
    // New Workspace screen uses.
    createDirectoryWorkspace: (cwd, title, projectId) =>
      workspaceProvisioning.createWorkspaceForDirectory(cwd, title, projectId),
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    ensureWorkspaceForCreate: createAgentCommandDependencies.ensureWorkspaceForCreate,
    createOttoWorktree: createAgentCommandDependencies.createOttoWorktree,
    scheduleAutoTitle: createAgentCommandDependencies.scheduleAutoTitle,
    browserToolsEnabled: browserToolsPolicy.isEnabled(),
    // Live-read the group allowlist so category toggles take effect without a
    // restart - the deps are rebuilt per MCP request (stateless transport).
    enabledOttoToolGroups: ottoToolGroupsPolicy.getEnabledGroups(),
    browserToolsBroker,
    previewDevServers,
    artifactService: toolArtifactService,
    emitArtifactCreated: (artifact) => {
      emitExternalSessionMessage({
        type: "artifact.created.notification",
        payload: { artifact },
      });
    },
    emitArtifactUpdated: (artifact) => {
      emitExternalSessionMessage({
        type: "artifact.updated.notification",
        payload: { artifact },
      });
    },
    ottoHome: config.ottoHome,
    worktreesRoot: config.worktreesRoot,
    callerAgentId: runtime.callerAgentId,
    enableVoiceTools: runtime.enableVoiceTools,
    voiceOnly: runtime.voiceOnly,
    resolveSpeakHandler: (agentId) => wsServer?.resolveVoiceSpeakHandler(agentId) ?? null,
    resolveCallerContext: (agentId) => wsServer?.resolveVoiceCallerContext(agentId) ?? null,
    onActivity: recordActivity,
    nodeOutputStore,
    logger,
  });
  const createAgentToolCatalog = (runtime: OttoToolRuntimeContext) =>
    createOttoToolCatalog(createAgentToolHostDependencies(runtime));
  agentManager.setOttoToolCatalogFactory(createAgentToolCatalog);
  agentManager.setOttoToolsEnabled(config.mcpInjectIntoAgents !== false);

  const mcpEnabled = config.mcpEnabled ?? true;
  let agentMcpBaseUrl: string | null = null;
  if (mcpEnabled) {
    const agentMcpRoute = "/mcp/agents";

    const createAgentMcpSession = async (callerAgentId?: string) => {
      const agentMcpServer = await createAgentMcpServer(
        createAgentToolHostDependencies({ callerAgentId }),
      );

      // Stateless mode: each HTTP request builds a fresh server + transport that is
      // torn down when the response closes, so no per-session state is retained between
      // requests. The agent control plane only lists and calls tools, neither of which
      // needs cross-request state, so sessions would only pin memory for the life of the
      // daemon (agents that exit without a clean DELETE never get reaped).
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        // NOTE: We enforce a Vite-like host allowlist at the app/websocket layer.
        // StreamableHTTPServerTransport's built-in check requires exact Host header matches.
        enableDnsRebindingProtection: false,
      });
      Object.assign(transport, {
        onerror: (err: Error) => {
          logger.error({ err }, "Agent MCP transport error");
        },
      });

      await agentMcpServer.connect(transport);
      return { server: agentMcpServer, transport };
    };

    const runAgentMcpRequest = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      // This route is exempt from the global daemon-password middleware, so it
      // authenticates here using the injected capability token (or a valid
      // daemon password). Without this, a password-protected daemon would be
      // wide open on its agent control plane.
      if (
        !(await isAgentMcpRequestAuthorized({
          password: config.auth?.password,
          capabilityToken: agentMcpAuthToken,
          authorizationHeader: req.header("authorization"),
        }))
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (config.mcpDebug) {
        logger.debug(
          {
            method: req.method,
            url: req.originalUrl,
            sessionId: req.header("mcp-session-id"),
            authorization: req.header("authorization") ? REDACTED_LOG_VALUE : undefined,
            body: summarizeAgentMcpDebugBody(req.body),
          },
          "Agent MCP request",
        );
      }
      try {
        // Stateless: GET (standalone SSE) and DELETE (session termination) have no
        // meaning without sessions. The MCP client tolerates 405 on the GET stream
        // and never issues a DELETE because it is never handed a session id.
        if (req.method !== "POST") {
          res.status(405).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Method not allowed",
            },
            id: null,
          });
          return;
        }
        const callerAgentIdRaw = req.query.callerAgentId;
        let callerAgentId: string | undefined;
        if (typeof callerAgentIdRaw === "string") {
          callerAgentId = callerAgentIdRaw;
        } else if (Array.isArray(callerAgentIdRaw) && typeof callerAgentIdRaw[0] === "string") {
          callerAgentId = callerAgentIdRaw[0];
        }
        const { server, transport } = await createAgentMcpSession(callerAgentId);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });

        await transport.handleRequest(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
          req.body,
        );
      } catch (err) {
        logger.error({ err }, "Failed to handle Agent MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal MCP server error",
            },
            id: null,
          });
        }
      }
    };

    const handleAgentMcpRequest: express.RequestHandler = (req, res) => {
      void runAgentMcpRequest(req, res);
    };

    app.post(agentMcpRoute, handleAgentMcpRequest);
    app.get(agentMcpRoute, handleAgentMcpRequest);
    app.delete(agentMcpRoute, handleAgentMcpRequest);
    logger.info({ route: agentMcpRoute }, "Agent MCP server mounted on main app");
  } else {
    logger.info("Agent MCP HTTP endpoint disabled");
  }

  const speechService = createSpeechService({
    logger,
    openaiConfig: config.openai,
    speechConfig: config.speech,
  });
  logger.info({ elapsed: elapsed() }, "Speech service created");

  // Hot-reload speech providers when daemon config changes (settings UI writes
  // features.dictation/voiceMode via the daemon config store). reconfigure()
  // no-ops when the resolved speech config is unchanged, so unrelated config
  // patches never churn the speech worker.
  const unsubscribeSpeechConfigChange = daemonConfigStore.onChange(() => {
    try {
      const persisted = loadPersistedConfig(config.ottoHome, logger);
      const resolved = resolveSpeechConfig({
        ottoHome: config.ottoHome,
        env: process.env,
        persisted,
      });
      void speechService
        .reconfigure({ openaiConfig: resolved.openai, speechConfig: resolved.speech })
        .catch((error: unknown) => {
          logger.warn({ err: error }, "Speech reconfigure failed after config change");
        });
    } catch (error) {
      logger.warn({ err: error }, "Failed to re-resolve speech config after config change");
    }
  });

  logger.info({ elapsed: elapsed() }, "Bootstrap complete, ready to start listening");

  const start = async () => {
    let mainStarted = false;
    try {
      if (serviceProxyListenTarget) {
        const boundServiceProxyTarget = await serviceProxy.startStandalone({
          listenTarget: serviceProxyListenTarget,
        });
        serviceProxyListenTarget = boundServiceProxyTarget;
        logger.info(
          {
            listen: formatListenTarget(serviceProxyListenTarget),
            publicBaseUrl: serviceProxyPublicBaseUrl,
            elapsed: elapsed(),
          },
          "Service proxy listening",
        );
      }

      // Start main HTTP server
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          httpServer.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          mainStarted = true;
          const logAndResolve = async () => {
            boundListenTarget = resolveBoundListenTarget(listenTarget, httpServer);
            const mcpBaseUrl = mcpEnabled ? createAgentMcpBaseUrl(boundListenTarget) : null;
            agentMcpBaseUrl = config.mcpInjectIntoAgents === false ? null : mcpBaseUrl;
            agentManager.setMcpBaseUrl(agentMcpBaseUrl);
            agentManager.setOttoToolsEnabled(config.mcpInjectIntoAgents !== false);
            daemonConfigStore.onFieldChange("mcp.injectIntoAgents", (value) => {
              agentManager.setMcpBaseUrl(value ? mcpBaseUrl : null);
              agentManager.setOttoToolsEnabled(value !== false);
            });
            daemonConfigStore.onFieldChange("appendSystemPrompt", (value) => {
              agentManager.setAppendSystemPrompt(typeof value === "string" ? value : "");
            });
            // Daemon-wide agent behavior toggles (behavior-injecting providers + the Otto-tools
            // notify-on-finish default). New/resumed agents pick up promptSuggestions
            // and agentProgressSummaries on their next launch (injected via
            // buildLaunchContext); notifyOnFinishDefault is read live per tool call.
            // WP-A persists agentBehaviors.*; WP-E owns this live wiring. The
            // resolver treats any non-false field as on, so passing the raw
            // partial object through is safe.
            daemonConfigStore.onFieldChange("agentBehaviors", (value) => {
              const behaviors =
                typeof value === "object" && value !== null
                  ? (value as {
                      promptSuggestions?: boolean;
                      agentProgressSummaries?: boolean;
                      notifyOnFinishDefault?: boolean;
                      todoNudge?: boolean;
                      todoReconcileOnIdle?: boolean;
                    })
                  : undefined;
              agentManager.setAgentBehaviors(behaviors);
            });
            const relayEnabled = config.relayEnabled ?? true;
            const relayEndpoint = config.relayEndpoint ?? "relay.otto-code.me:443";
            const relayPublicEndpoint = config.relayPublicEndpoint ?? relayEndpoint;
            const relayUseTls = config.relayUseTls ?? relayEndpoint === "relay.otto-code.me:443";
            const relayPublicUseTls = config.relayPublicUseTls ?? relayUseTls;
            if (boundListenTarget.type === "tcp") {
              logger.info(
                {
                  host: boundListenTarget.host,
                  port: boundListenTarget.port,
                  authRequired: !!config.auth?.password,
                  elapsed: elapsed(),
                },
                `Server listening on http://${boundListenTarget.host}:${boundListenTarget.port}`,
              );
            } else {
              logger.info(
                {
                  path: boundListenTarget.path,
                  authRequired: !!config.auth?.password,
                  elapsed: elapsed(),
                },
                `Server listening on ${boundListenTarget.path}`,
              );
            }
            if (config.auth?.password) {
              logger.info("Daemon password authentication enabled");
            } else if (config.listenAutoWidenedForWsl) {
              logger.warn(
                "Detected WSL: binding to 0.0.0.0 so the Windows host can reach the daemon " +
                  "without manual config. No password is set, so anything that can reach this " +
                  "port controls the daemon. Consider setting OTTO_PASSWORD (or auth.password " +
                  "in config.json) to require authentication.",
              );
            }

            const integrationAuthorizationRegistry = new FileBackedIntegrationAuthorizationRegistry(
              path.join(config.ottoHome, "integration-authorizations.json"),
              logger,
            );
            const integrationAuthorization = new IntegrationAuthorizationService({
              hostId: serverId,
              registry: integrationAuthorizationRegistry,
              vault: await createDaemonCredentialVault(),
            });
            await integrationAuthorization.initialize();

            const integrationAuthorizationCatalog = new IntegrationAuthorizationCatalog();
            integrationAuthorizationCatalog.registerMethods(getZoomTeamChatAuthorizationMethods());
            const zoomTeamChatAuthorization = new ZoomTeamChatManagedAuthorizationBroker(
              integrationAuthorization,
            );
            const integrationBrowserAuthorization = new IntegrationBrowserAuthorizationService();
            integrationBrowserAuthorization.register(zoomTeamChatAuthorization);

            const communicationsService = new CommunicationsService();
            communicationsService.registerProvider(
              new ZoomTeamChatProvider(integrationAuthorization),
            );

            wsServer = new VoiceAssistantWebSocketServer(
              httpServer,
              logger,
              serverId,
              agentManager,
              agentStorage,
              downloadTokenStore,
              config.ottoHome,
              daemonConfigStore,
              mcpBaseUrl,
              {
                allowedOrigins,
                hostnames: configuredHostnames,
                daemonStatusRpc: dependencies.serverFeatureOverrides?.daemonStatusRpc,
                relayConfig: dependencies.serverFeatureOverrides?.relayConfig,
              },
              workspaceAutoName,
              config.auth,
              speechService,
              terminalManager,
              {
                finalTimeoutMs: config.dictationFinalTimeoutMs,
              },
              daemonVersion,
              (intent) => {
                try {
                  config.onLifecycleIntent?.(intent);
                } catch (error) {
                  logger.error({ err: error, intent }, "Failed to handle daemon lifecycle intent");
                }
              },
              projectRegistry,
              workspaceRegistry,
              scheduleService,
              checkoutDiffManager,
              serviceProxy,
              scriptRuntimeStore,
              handleBranchChange,
              () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
              () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
              (hostname) => scriptHealthMonitor.getHealthForHostname(hostname),
              workspaceGitService,
              github,
              config.pushNotificationSender,
              providerSnapshotManager,
              {
                listen: formatListenTarget(boundListenTarget ?? listenTarget),
                worktreesRoot: config.worktreesRoot,
                appBaseUrl: config.appBaseUrl,
                desktopManaged: config.desktopManaged === true,
                getRelayConfig: () =>
                  relayRuntime?.getConfig() ?? {
                    enabled: daemonConfigStore.get().relay?.enabled ?? relayEnabled,
                    endpoint: relayEndpoint,
                    publicEndpoint: relayPublicEndpoint,
                    useTls: relayUseTls,
                    publicUseTls: relayPublicUseTls,
                  },
              },
              serviceProxyPublicBaseUrl,
              browserToolsBroker,
              previewDevServers,
              gitHostingResolver,
              runService,
              recordActivity,
              () => activityStatsStore.getRollups(),
              projectLinkStore,
              agentAutoTitle,
              (query) => usageLogStore.getPage(query),
              // "Reset" on the Metrics screen: wipe both usage sinks together -
              // the day-bucketed counters behind the tiles and the itemized
              // ledger behind the Log tab - so the screen starts fresh. The
              // stats store fires its coalesced change ping on reset, so every
              // connected client re-fetches both.
              async () => {
                await Promise.all([activityStatsStore.reset(), usageLogStore.reset()]);
              },
              graphStore,
              // Trailing positional arguments, and the place the v0.2.5 merge
              // went wrong: two branches each appended a final parameter to this
              // constructor, and only graphStore made it to the call site. The
              // session then saw no relationship manager and answered every
              // `otto hub connect` with "Hub relationship management is
              // unavailable". Anything appended below must be added here too.
              hubRelationships,
              connectorOAuthBroker,
              communicationsService,
              integrationAuthorization,
              integrationAuthorizationCatalog,
              integrationBrowserAuthorization,
              zoomTeamChatAuthorization,
              workspaceSetupRuntime,
            );
            relayRuntime = createRelayRuntime({
              config: {
                enabled: relayEnabled,
                endpoint: relayEndpoint,
                publicEndpoint: relayPublicEndpoint,
                useTls: relayUseTls,
                publicUseTls: relayPublicUseTls,
              },
              logger,
              attachSocket: async (ws, metadata) => {
                if (!wsServer) throw new Error("WebSocket server is not ready");
                await wsServer.attachExternalSocket(ws, metadata);
              },
              serverId,
              daemonKeyPair: daemonKeyPair.keyPair,
            });
            daemonConfigStore.onFieldChange("relay.enabled", (value) => {
              relayRuntime?.setEnabled(value === true);
            });
            await hubRelationships.start();

            wsServer.setPersonalityStatsProvider(() => personalityStatsStore.get());
            wsServer.setPersonalityMemoryService(personalityMemory);
            wsServer.setProjectKnowledgeService(projectKnowledge);
            wsServer.setNodeOutputStore(nodeOutputStore);
            wsServer.setPromptTemplateStore(promptTemplateStore);
            // Late-wired like the stores above: hands the brain manager to the
            // websocket server, which applies the current `brain` config now and
            // re-applies it on every daemon-config change.
            wsServer.setBrainManager(brainManager);
            wsServer.setBrainOpsManager(brainOpsManager);

            // Sanity guard: never let preview "stop external server" tree-kill
            // Otto's own runtime - the daemon's listen port or a loopback dev
            // server hosting a connected client (e.g. Metro serving this app).
            const wsServerForProtectedPorts = wsServer;
            previewDevServers.setProtectedPortsProvider(() => {
              const ports = new Set<number>();
              const bound = boundListenTarget ?? listenTarget;
              if (bound.type === "tcp") {
                ports.add(bound.port);
              }
              for (const port of wsServerForProtectedPorts.getConnectedClientOriginPorts()) {
                ports.add(port);
              }
              return [...ports];
            });
          };

          logAndResolve().then(resolve, reject);
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);

        if (listenTarget.type === "tcp") {
          httpServer.listen(listenTarget.port, listenTarget.host);
        } else {
          if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
            unlinkSync(listenTarget.path);
          }
          httpServer.listen(listenTarget.path);
        }
      });

      // Start speech service after listening so synchronous Sherpa native
      // model loading doesn't block the server from accepting connections.
      speechService.start();
      scriptHealthMonitor.start();
    } catch (error) {
      await serviceProxy.stopStandalone().catch(() => undefined);
      if (mainStarted) {
        httpServer.closeAllConnections();
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
      throw error;
    }
  };

  const stop = async () => {
    await hubRelationships.stop();
    workspaceReconciliation.dispose();
    scriptHealthMonitor.stop();
    stopMaterializedImageHousekeeping();
    // Freeze both ingress and registration before taking the agent closure snapshot.
    wsServer?.prepareForShutdown();
    agentManager.prepareForShutdown();
    // Dev servers next: they are children of this daemon and hold ports the
    // next daemon instance may want.
    await previewDevServers.shutdown().catch(() => undefined);
    // The local AI host is a managed child too - kill it so it never outlives
    // the daemon that spawned it.
    await brainManager.shutdown().catch(() => undefined);
    await brainOpsManager.shutdown().catch(() => undefined);
    await closeAllAgents(logger, agentManager);
    await agentManager.flushForShutdown().catch(() => undefined);
    detachAgentStoragePersistence();
    await agentStorage.flush().catch(() => undefined);
    // The ledger's write timer is coalesced and unref()'d, so without this every
    // daemon exit dropped up to WRITE_COALESCE_MS of appended rows. `flush()` was
    // always documented as the graceful-shutdown hook; nothing called it.
    await usageLogStore.flush().catch(() => undefined);
    await providerSnapshotManager.shutdown();
    terminalManager.killAll();
    unsubscribeSpeechConfigChange();
    unsubscribeGitHostingConfigChange();
    github.dispose?.();
    speechService.stop();
    toolArtifactService.stop();
    await scheduleService.stop().catch(() => undefined);
    await relayRuntime?.stop().catch(() => undefined);
    if (wsServer) {
      await wsServer.close();
    }
    await serviceProxy.stopStandalone();
    // Force-drop remaining sockets so httpServer.close() resolves promptly.
    // We've already closed wsServer (which sent ws-layer close frames) and
    // stopped every other service, so anything still attached is a TCP
    // socket whose higher-level shutdown hasn't fully released it (e.g.
    // upgraded WS sockets in the closing handshake, or HTTP keep-alive
    // sockets in CLOSE_WAIT). closeIdleConnections() does not catch
    // upgraded sockets, so we use closeAllConnections() here.
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    // Clean up socket files
    if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
      unlinkSync(listenTarget.path);
    }
  };

  return {
    config,
    agentManager,
    agentStorage,
    terminalManager,
    serviceProxy,
    scriptRuntimeStore,
    browserToolsBroker,
    start,
    stop,
    getListenTarget: () => boundListenTarget,
  };
}

async function closeAllAgents(logger: Logger, agentManager: AgentManager): Promise<void> {
  const agents = agentManager.listAgents();
  await Promise.all(
    agents.map(async (agent) => {
      try {
        await agentManager.closeAgent(agent.id);
      } catch (err) {
        logger.error({ err, agentId: agent.id }, "Failed to close agent");
      }
    }),
  );
}
