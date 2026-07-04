import type {
  AgentSnapshotPayload,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProjectPlacementPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
} from "@otto-code/protocol/messages";
import { DaemonClient } from "./daemon-client.js";
import type {
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
} from "./daemon-client.js";

export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  BrowserAutomationExecuteRequestMessage,
  BrowserAutomationExecuteResponseMessage,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface OttoLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface OttoClientConfig {
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: OttoLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type OttoWorkspace = WorkspaceDescriptorPayload;
export type OttoAgent = AgentSnapshotPayload;
export type OttoWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface OttoWorkspaceListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: OttoWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface OttoWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export interface OttoWorkspaceOpenResult {
  requestId: string;
  workspace: OttoWorkspaceHandle | null;
  error: string | null;
}

export interface OttoWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type OttoWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type OttoWorkspaceUpdateHandler = (update: OttoWorkspaceUpdate) => void;

/**
 * A handle is a stable typed reference to a daemon resource. Its identity is the
 * daemon id, and `latest()` only returns the most recent snapshot this handle has
 * seen through construction, `refetch()`, or this handle's local subscription.
 */
export interface OttoWorkspaceHandle {
  readonly id: string;
  latest(): OttoWorkspace | null;
  /**
   * Fetches a fresh workspace snapshot through the existing workspace list RPC,
   * exact-matches this handle id from the result, and updates `latest()`.
   */
  refetch(options?: { requestId?: string }): Promise<OttoWorkspace | null>;
  archive(requestId?: string): Promise<OttoWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: OttoWorkspaceUpdate) => void): () => void;
}

export interface OttoWorkspaceActions {
  list(options?: OttoWorkspaceListOptions): Promise<OttoWorkspaceListResult>;
  ref(workspace: string | OttoWorkspace): OttoWorkspaceHandle;
  open(
    input: string | OttoWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<OttoWorkspaceOpenResult>;
  create(
    input: string | OttoWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<OttoWorkspaceOpenResult>;
  archive(
    workspace: string | OttoWorkspaceHandle,
    requestId?: string,
  ): Promise<OttoWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: OttoWorkspaceUpdateHandler): () => void;
}

type OttoAgentSessionConfig = CreateAgentRequestMessage["config"];
type OttoAgentProvider = OttoAgentSessionConfig["provider"];
type OttoAgentConfigOverrides = Partial<Omit<OttoAgentSessionConfig, "provider" | "cwd">>;

export interface OttoAgentCreateOptions extends OttoAgentConfigOverrides {
  config?: OttoAgentSessionConfig;
  provider?: CreateAgentRequestMessage["config"]["provider"];
  cwd?: string;
  workspaceId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface OttoAgentRefetchResult {
  agent: OttoAgent;
  project: ProjectPlacementPayload | null;
}

export interface OttoAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface OttoAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export type OttoAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type OttoAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type OttoAgentUpdateHandler = (update: OttoAgentUpdate) => void;

export interface OttoAgentTimelineHandle {
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle's `latest()`
   * is updated to that snapshot.
   */
  refetch(options?: OttoAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: OttoAgentStream) => void): () => void;
}

/**
 * Agent handles follow the same identity/snapshot rule as workspace handles:
 * `id` is stable, while `latest()` is only the newest snapshot observed by this
 * handle through construction, `refetch()`, timeline refetch, archive, or local
 * agent_update subscription.
 */
export interface OttoAgentHandle {
  readonly id: string;
  readonly timeline: OttoAgentTimelineHandle;
  latest(): OttoAgent | null;
  refetch(requestId?: string): Promise<OttoAgentRefetchResult | null>;
  send(text: string, options?: OttoAgentSendOptions): Promise<void>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: OttoAgentUpdate) => void): () => void;
}

export interface OttoAgentActions {
  ref(agent: string | OttoAgent): OttoAgentHandle;
  create(options: OttoAgentCreateOptions): Promise<OttoAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: OttoAgentUpdateHandler): () => void;
}

export interface OttoProviderConfig extends OttoProviderConfigInput {
  provider: OttoAgentProvider;
}
export type OttoProviderFeatureValues = Record<string, unknown>;

export interface OttoProviderConfigInput {
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: OttoProviderFeatureValues;
}

export type OttoProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type OttoProviderModesResult = ListProviderModesResponseMessage["payload"];
export type OttoProviderFeaturesInput = ListProviderFeaturesRequestMessage["draftConfig"];
export type OttoProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type OttoProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type OttoProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type OttoProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type OttoProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type OttoProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];

export interface OttoProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface OttoProviderRefreshOptions {
  cwd?: string;
  providers?: OttoAgentProvider[];
  requestId?: string;
}

export interface OttoProviderActions {
  codex(input?: OttoProviderConfigInput): OttoProviderConfig;
  claude(input?: OttoProviderConfigInput): OttoProviderConfig;
  opencode(input?: OttoProviderConfigInput): OttoProviderConfig;
  copilot(input?: OttoProviderConfigInput): OttoProviderConfig;
  config(provider: OttoAgentProvider, input?: OttoProviderConfigInput): OttoProviderConfig;
  listModels(
    provider: OttoAgentProvider,
    options?: OttoProviderListOptions,
  ): Promise<OttoProviderModelsResult>;
  listModes(
    provider: OttoAgentProvider,
    options?: OttoProviderListOptions,
  ): Promise<OttoProviderModesResult>;
  listFeatures(
    draftConfig: OttoProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<OttoProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<OttoProviderAvailabilityResult>;
  snapshot(options?: OttoProviderListOptions): Promise<OttoProviderSnapshotResult>;
  refresh(options?: OttoProviderRefreshOptions): Promise<OttoProviderRefreshResult>;
  diagnostic(
    provider: OttoAgentProvider,
    options?: { requestId?: string },
  ): Promise<OttoProviderDiagnosticResult>;
  subscribe(handler: (update: OttoProviderSnapshotUpdate) => void): () => void;
}

export interface OttoConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface OttoClient {
  readonly workspaces: OttoWorkspaceActions;
  readonly agents: OttoAgentActions;
  readonly providers: OttoProviderActions;
  readonly config: OttoConfigActions;
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createOttoClient(config: OttoClientConfig): OttoClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient);
  const createAgentHandle = createAgentHandleFactory(daemonClient);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      ref: (agent) => createAgentHandle(agent),
      create: async (options) => {
        const agent = await daemonClient.createAgent(options);
        return createAgentHandle(agent);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      codex: (input) => providerConfig("codex", input),
      claude: (input) => providerConfig("claude", input),
      opencode: (input) => providerConfig("opencode", input),
      copilot: (input) => providerConfig("copilot", input),
      config: (provider, input) => providerConfig(provider, input),
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: (draftConfig, options) =>
        daemonClient.listProviderFeatures(draftConfig, options),
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      subscribe: (handler) =>
        daemonClient.on("providers_snapshot_update", (message) => {
          handler(message.payload);
        }),
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

type WorkspaceHandleFactory = (workspace: string | OttoWorkspace) => OttoWorkspaceHandle;
type AgentHandleFactory = (agent: string | OttoAgent) => OttoAgentHandle;

function createWorkspaceHandleFactory(daemonClient: DaemonClient): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let latest = typeof workspace === "string" ? null : workspace;

    return {
      id,
      latest: () => latest,
      refetch: async (options) => {
        // Best-effort: fetches one page and matches by id client-side, so a workspace beyond
        // the first page won't be found. TODO: add a "get workspace by id" lookup and resolve
        // by exact id instead of paging.
        const result = await daemonClient.fetchWorkspaces({
          requestId: options?.requestId,
          page: { limit: 25 },
        });
        latest = result.entries.find((entry) => entry.id === id) ?? null;
        return latest;
      },
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (latest) {
          latest = { ...latest, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            latest = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            latest = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let latest = typeof agent === "string" ? null : agent;

    const handle: OttoAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            latest = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          daemonClient.on("agent_stream", (message) => {
            if (message.payload.agentId === id) {
              handler(message.payload);
            }
          }),
      },
      latest: () => latest,
      refetch: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        latest = result?.agent ?? null;
        return result;
      },
      send: (text, options) => daemonClient.sendAgentMessage(id, text, options),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (latest) {
          latest = { ...latest, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.agent.id === id) {
            latest = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            latest = null;
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | OttoWorkspaceOpenOptions,
  requestId?: string,
): Promise<OttoWorkspaceOpenResult> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  return {
    ...result,
    workspace: result.workspace ? createWorkspaceHandle(result.workspace) : null,
  };
}

function resolveWorkspaceId(workspace: string | OttoWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function providerConfig(
  provider: OttoAgentProvider,
  input: OttoProviderConfigInput = {},
): OttoProviderConfig {
  return {
    provider,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modeId !== undefined ? { modeId: input.modeId } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues !== undefined ? { featureValues: input.featureValues } : {}),
  };
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `otto-sdk-${randomId}`;
}
