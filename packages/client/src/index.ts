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
  WorkspaceCreateRequest,
} from "@otto-code/protocol/messages";
import { DaemonClient } from "./daemon-client.js";
import type {
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  WaitForFinishResult,
} from "./daemon-client.js";

export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  BrowserAutomationExecuteRequestMessage,
  BrowserAutomationExecuteResponseMessage,
  CodeRenameApplyOutcome,
  CodeRenameApplyQuery,
  CodeRenamePlan,
  CodeRenameUndoOutcome,
  HostingAuthStatusPayload,
  HostingListOwnersPayload,
  HostingListRepositoriesPayload,
  HostingSearchPayload,
  ProjectScaffoldPayload,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";
/**
 * Coding turns routinely run for minutes, so the handle waits far longer than
 * the transport's own conservative default.
 */
const DEFAULT_WAIT_FOR_FINISH_MS = 10 * 60_000;

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
export type OttoAgentListOptions = FetchAgentsOptions;

export interface OttoAgentListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: FetchAgentsEntry[];
  pageInfo: FetchAgentsPageInfo;
}
export type OttoWorkspaceListOptions = Omit<FetchWorkspacesRequestMessage, "type" | "requestId"> & {
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

export type OttoWorkspaceCreateOptions = Omit<WorkspaceCreateRequest, "type" | "requestId"> & {
  requestId?: string;
};

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

export interface OttoWorkspaceHandle {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly name: string | null;
  readonly status: OttoWorkspace["status"] | null;
  readonly agents: {
    create(options: OttoWorkspaceAgentCreateOptions): Promise<OttoAgentHandle>;
  };
  current(): OttoWorkspace | null;
  refresh(options?: { requestId?: string }): Promise<OttoWorkspace | null>;
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
  open(input: string | OttoWorkspaceOpenOptions, requestId?: string): Promise<OttoWorkspaceHandle>;
  create(options: OttoWorkspaceCreateOptions): Promise<OttoWorkspaceHandle>;
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
export type OttoAgentProvider = OttoAgentSessionConfig["provider"];

export type OttoProviderFeatureValues = Record<string, unknown>;

export interface OttoAgentConfig {
  /** Provider and model in `provider/model` format. */
  provider: string;
  modeId?: OttoAgentSessionConfig["modeId"];
  thinkingOptionId?: OttoAgentSessionConfig["thinkingOptionId"];
  featureValues?: OttoProviderFeatureValues;
  /** JSON-safe provider-native settings, validated by the selected provider. */
  options?: OttoAgentSessionConfig["providerOptions"];
  systemPrompt?: OttoAgentSessionConfig["systemPrompt"];
  toolPolicy?: OttoAgentSessionConfig["toolPolicy"];
  mcpServers?: OttoAgentSessionConfig["mcpServers"];
}

export interface OttoAgentCreateOptions {
  config: OttoAgentConfig;
  cwd: string;
  parent?: string | OttoAgentHandle;
  title?: OttoAgentSessionConfig["title"];
  env?: CreateAgentRequestMessage["env"];
  prompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  requestId?: string;
  labels?: Record<string, string>;
}

export type OttoWorkspaceAgentCreateOptions = Omit<OttoAgentCreateOptions, "cwd">;

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

export interface OttoAgentRunOptions extends OttoAgentSendOptions {
  timeoutMs?: number;
}

export type OttoAgentRunResult = WaitForFinishResult;

export type OttoAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type OttoAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type OttoAgentUpdateHandler = (update: OttoAgentUpdate) => void;

export interface OttoAgentTimelineHandle {
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle is updated to
   * that value.
   */
  refetch(options?: OttoAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: OttoAgentStream) => void): () => void;
}

export interface OttoAgentHandle {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  readonly status: OttoAgent["status"] | null;
  readonly timeline: OttoAgentTimelineHandle;
  current(): OttoAgent | null;
  refresh(requestId?: string): Promise<OttoAgentRefetchResult | null>;
  send(text: string, options?: OttoAgentSendOptions): Promise<void>;
  /** Sends a prompt and resolves when that turn finishes or needs attention. */
  run(text: string, options?: OttoAgentRunOptions): Promise<OttoAgentRunResult>;
  /** Waits for the current turn, including one started with `prompt`. */
  waitForFinish(timeoutMs?: number): Promise<OttoAgentRunResult>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: OttoAgentUpdate) => void): () => void;
}

export interface OttoAgentActions {
  list(options?: OttoAgentListOptions): Promise<OttoAgentListResult>;
  ref(agent: string | OttoAgent): OttoAgentHandle;
  create(options: OttoAgentCreateOptions): Promise<OttoAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: OttoAgentUpdateHandler): () => void;
}

export type OttoProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type OttoProviderModesResult = ListProviderModesResponseMessage["payload"];
type OttoProviderFeaturesDraft = ListProviderFeaturesRequestMessage["draftConfig"];
export interface OttoProviderFeaturesInput extends Omit<
  OttoProviderFeaturesDraft,
  "provider" | "model"
> {
  /** Provider and model in `provider/model` format. */
  provider: string;
}
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

export interface OttoProviderWaitOptions extends OttoProviderListOptions {
  timeoutMs?: number;
}

export interface OttoProviderActions {
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
  /** Resolves after the daemon's lazy provider discovery has finished. */
  waitForReady(options?: OttoProviderWaitOptions): Promise<OttoProviderSnapshotResult>;
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
  const createAgentHandle = createAgentHandleFactory(daemonClient);
  const createAgent = async (
    options: OttoAgentCreateOptions,
    placement?: { workspaceId: string; cwd: string },
  ) => {
    const { config: agentConfig, cwd, parent, title, prompt, ...requestOptions } = options;
    const { provider: providerModel, options: providerOptions, ...runtimeConfig } = agentConfig;
    const { provider, model } = parseProviderModel(providerModel);
    const effectiveCwd = placement?.cwd ?? cwd;
    const agent = await daemonClient.createAgent({
      ...requestOptions,
      config: {
        ...runtimeConfig,
        provider,
        model,
        cwd: effectiveCwd,
        ...(title !== undefined ? { title } : {}),
        ...(providerOptions !== undefined ? { providerOptions } : {}),
      },
      ...(placement ? { workspaceId: placement.workspaceId } : {}),
      ...(parent ? { callerAgentId: resolveAgentId(parent) } : {}),
      ...(prompt !== undefined ? { initialPrompt: prompt } : {}),
    });
    return createAgentHandle(agent);
  };
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient, createAgent);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: async ({ requestId, ...options }) => {
        const result = await daemonClient.createWorkspace(options, requestId);
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The daemon did not create a workspace");
        }
        return createWorkspaceHandle(result.workspace);
      },
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), { requestId }),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      list: (options) => daemonClient.fetchAgents(options),
      ref: (agent) => createAgentHandle(agent),
      create: (options) => createAgent(options),
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: ({ provider: providerModel, ...draftConfig }, options) => {
        const { provider, model } = parseProviderModel(providerModel);
        return daemonClient.listProviderFeatures({ ...draftConfig, provider, model }, options);
      },
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      waitForReady: (options) => waitForProvidersReady(daemonClient, options),
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
type CreateAgent = (
  options: OttoAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
) => Promise<OttoAgentHandle>;

function createWorkspaceHandleFactory(
  daemonClient: DaemonClient,
  createAgent: CreateAgent,
): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let current = typeof workspace === "string" ? null : workspace;

    const refresh = async (options?: { requestId?: string }) => {
      let cursor: string | undefined;
      let requestId = options?.requestId;
      do {
        const result = await daemonClient.fetchWorkspaces({
          requestId,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const match = result.entries.find((entry) => entry.id === id);
        if (match) {
          current = match;
          return current;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        requestId = undefined;
      } while (cursor);
      current = null;
      return current;
    };

    return {
      id,
      get projectId() {
        return current?.projectId ?? null;
      },
      get directory() {
        return current?.workspaceDirectory ?? null;
      },
      get name() {
        return current?.name ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      agents: {
        create: async (options) => {
          const snapshot = current ?? (await refresh());
          if (!snapshot?.workspaceDirectory) {
            throw new Error(`Workspace ${id} has no available directory`);
          }
          return createAgent(
            { ...options, cwd: snapshot.workspaceDirectory },
            { workspaceId: id, cwd: snapshot.workspaceDirectory },
          );
        },
      },
      current: () => current,
      refresh,
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, { requestId });
        if (current) {
          current = { ...current, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            current = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            current = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let current = typeof agent === "string" ? null : agent;

    const handle: OttoAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            current = result.agent;
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
      get workspaceId() {
        return current?.workspaceId ?? null;
      },
      get cwd() {
        return current?.cwd ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      current: () => current,
      refresh: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        current = result?.agent ?? null;
        return result;
      },
      run: async (text, options) => {
        const { timeoutMs, ...sendOptions } = options ?? {};
        await daemonClient.sendAgentMessage(id, text, sendOptions);
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      waitForFinish: async (timeoutMs) => {
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (current) {
          current = { ...current, archivedAt: result.archivedAt };
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
            current = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            current = null;
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
): Promise<OttoWorkspaceHandle> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  if (result.error || !result.workspace) {
    throw new Error(result.error ?? `The daemon did not open a workspace for ${options.cwd}`);
  }
  return createWorkspaceHandle(result.workspace);
}

function resolveWorkspaceId(workspace: string | OttoWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function resolveAgentId(agent: string | OttoAgentHandle): string {
  return typeof agent === "string" ? agent : agent.id;
}

function parseProviderModel(selection: string): { provider: string; model: string } {
  const separator = selection.indexOf("/");
  if (separator <= 0 || separator === selection.length - 1) {
    throw new Error('Expected config.provider in "provider/model" format');
  }
  return {
    provider: selection.slice(0, separator),
    model: selection.slice(separator + 1),
  };
}

function waitForProvidersReady(
  daemonClient: DaemonClient,
  options: OttoProviderWaitOptions = {},
): Promise<OttoProviderSnapshotResult> {
  // COMPAT(providersSnapshotCwd): added in v0.3.2, remove gate after 2027-02-10.
  if (daemonClient.getLastServerInfoMessage()?.features?.providersSnapshotCwd !== true) {
    return Promise.reject(new Error("Update the host to wait for provider discovery."));
  }

  const { timeoutMs = 60_000, ...snapshotOptions } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let requestId: string | null = null;
    let snapshotCwd: string | undefined;
    const pendingUpdates = new Map<string | undefined, OttoProviderSnapshotUpdate>();
    let latestEntries: OttoProviderSnapshotResult["entries"] = [];

    const cleanup = () => {
      clearTimeout(timeout);
      unsubscribe();
    };
    const finish = (snapshot: OttoProviderSnapshotResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(snapshot);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const updateMatches = (update: OttoProviderSnapshotUpdate) => update.cwd === snapshotCwd;

    const unsubscribe = daemonClient.on("providers_snapshot_update", (message) => {
      const update = message.payload;
      if (!requestId) {
        pendingUpdates.set(update.cwd, update);
        return;
      }
      if (!updateMatches(update)) return;
      latestEntries = update.entries;
      if (update.entries.some((entry) => entry.status === "loading")) return;
      finish({ ...update, requestId });
    });

    const timeout = setTimeout(() => {
      const loading = latestEntries
        .filter((entry) => entry.status === "loading")
        .map((entry) => entry.provider)
        .join(", ");
      fail(
        new Error(
          loading
            ? `Timed out waiting for providers: ${loading}`
            : "Timed out waiting for provider discovery",
        ),
      );
    }, timeoutMs);

    void daemonClient
      .getProvidersSnapshot(snapshotOptions)
      .then((snapshot) => {
        requestId = snapshot.requestId;
        snapshotCwd = snapshot.cwd;
        latestEntries = snapshot.entries;
        if (!snapshot.entries.some((entry) => entry.status === "loading")) {
          finish(snapshot);
          return;
        }
        const pendingUpdate = pendingUpdates.get(snapshotCwd);
        if (pendingUpdate && !pendingUpdate.entries.some((entry) => entry.status === "loading")) {
          finish({ ...pendingUpdate, requestId });
        }
        return undefined;
      })
      .catch(fail);
  });
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `otto-sdk-${randomId}`;
}
