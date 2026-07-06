import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentContextUsage,
  AgentFeature,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
  AgentUsage,
  FetchCatalogOptions,
  ProviderCatalog,
  ToolCallDetail,
} from "../agent-sdk-types.js";
import { z } from "zod";

import {
  buildCompatToolPreviewDetail,
  buildOpenAIToolsPayload,
  COMPAT_TOOL_SPECS,
  executeCompatTool,
  findCompatToolSpec,
  type CompatToolSpec,
} from "./openai-compat-tools.js";
import type { OttoToolCatalog, OttoToolDefinition, OttoToolResult } from "../tools/types.js";
import { ottoToolGroupForName, type OttoToolGroup } from "@otto-code/protocol/provider-config";
import {
  buildOpenAICompatFeatures,
  normalizeOpenAICompatReasoningEffort,
  type OpenAICompatReasoningEffort,
} from "./openai-compat-feature-definitions.js";
import { OpenAICompatMcpManager, type McpToolBinding } from "./openai-compat-mcp.js";
import { ottoToolPermissionKind } from "./openai-compat-otto-tool-permissions.js";
import type { McpServerConfig } from "../agent-sdk-types.js";
import type { ManagedProcessRegistry } from "../../managed-processes/managed-processes.js";
import { stripInternalOttoMcpServer } from "../runtime-mcp-config.js";
import type { McpToolPermissionMode } from "@otto-code/protocol/provider-config";

/**
 * Native provider for OpenAI-compatible HTTP endpoints (LM Studio, Ollama,
 * vLLM, llama.cpp server, gateways). The daemon talks to the endpoint
 * directly — model discovery via GET {base}/models, streaming chat via
 * POST {base}/chat/completions. No external agent binary is involved, so
 * availability means "the server is reachable", not "a CLI is installed".
 *
 * Tool support: the daemon is the tool runtime. Function-calling models get a
 * built-in coding toolset (read/list/grep/write/edit/shell) executed in the
 * agent's cwd, with permission gating per mode.
 */

export const OPENAI_COMPAT_EXTENDS = "openai-compatible";

const DEFAULT_CATALOG_TIMEOUT_MS = 10_000;
/** Cap persisted context so agent JSON files stay small. */
const MAX_PERSISTED_MESSAGES = 40;
/** Upper bound on model→tool→model rounds within a single turn. */
const MAX_TOOL_ROUNDS = 50;

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  // The daemon itself is the MCP client for this provider: configured servers
  // (provider config merged with per-agent config) are connected per session
  // and their tools exposed to the model. See OpenAICompatMcpManager.
  supportsMcpServers: true,
  // The daemon owns this provider's tool loop, so we inject Otto's tool catalog
  // (browser_*, preview_*, agent management, …) directly rather than via an MCP
  // client the local model's runtime doesn't have. See ottoTools handling below.
  supportsNativeOttoTools: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

export const OPENAI_COMPAT_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission before running commands or editing files",
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description: "Automatically approves file edits; still asks before running commands",
  },
  {
    id: "plan",
    label: "Read Only",
    description: "Only read tools are available — no edits or commands",
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
    isUnattended: true,
  },
];

const VALID_MODE_IDS = new Set(OPENAI_COMPAT_MODES.map((mode) => mode.id));

interface ToolCallPayload {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ChatMessage =
  /**
   * messageId is provider-internal bookkeeping for user messages: it ties the
   * persisted conversation to the durable timeline's user_message items so
   * revertConversation can find its truncation point. Stripped from the wire
   * payload before requests — strict servers reject unknown message fields.
   */
  | { role: "system" | "user"; content: string; messageId?: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallPayload[] }
  | { role: "tool"; content: string; tool_call_id: string };

/** Mirror of the opencode provider's parser: `/name rest` → command + args. */
function parseSlashCommandInput(text: string): { commandName: string; args: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.length <= 1) {
    return null;
  }
  const withoutPrefix = trimmed.slice(1);
  const firstWhitespaceIdx = withoutPrefix.search(/\s/u);
  const commandName =
    firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
  if (!commandName || commandName.includes("/")) {
    return null;
  }
  const rawArgs =
    firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
  return { commandName, args: rawArgs.length > 0 ? rawArgs : null };
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "system" || message.role === "user") {
    return { role: message.role, content: message.content };
  }
  return message;
}

export interface OpenAICompatAgentClientOptions {
  logger?: Logger;
  providerId: string;
  label: string;
  env?: Record<string, string>;
  /** Otto tool groups to inject; undefined = all groups, [] = none. */
  ottoToolGroups?: readonly OttoToolGroup[] | null;
  /** Provider-level MCP servers; merged with per-agent config (per-agent wins). */
  mcpServers?: Record<string, McpServerConfig> | null;
  /** MCP permission strictness in acceptEdits mode; defaults to "always-ask". */
  mcpToolPermissions?: McpToolPermissionMode | null;
  managedProcesses?: ManagedProcessRegistry | null;
}

interface ResolvedEndpoint {
  baseUrl: string;
  apiKey: string | null;
}

export function normalizeOpenAICompatBaseUrl(value: string): string {
  const withoutTrailingSlashes = value.trim().replace(/\/+$/u, "");
  if (withoutTrailingSlashes.endsWith("/v1")) {
    return withoutTrailingSlashes;
  }
  return `${withoutTrailingSlashes}/v1`;
}

function resolveEndpoint(env: Record<string, string> | undefined, label: string): ResolvedEndpoint {
  const rawBaseUrl = env?.["OPENAI_BASE_URL"]?.trim();
  if (!rawBaseUrl) {
    throw new Error(
      `${label} has no server URL configured. Set OPENAI_BASE_URL in the provider settings.`,
    );
  }
  const apiKey = env?.["OPENAI_API_KEY"]?.trim() || null;
  return { baseUrl: normalizeOpenAICompatBaseUrl(rawBaseUrl), apiKey };
}

function buildHeaders(endpoint: ResolvedEndpoint): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.apiKey) {
    headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
  }
  return headers;
}

function unreachableError(label: string, endpoint: ResolvedEndpoint, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Cannot reach ${label} at ${endpoint.baseUrl} (${detail}). Make sure the server is running and the URL is correct.`,
  );
}

function promptToText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  return prompt
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

async function* readLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      yield buffer.slice(0, newlineIndex).replace(/\r$/u, "");
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest) {
    yield rest;
  }
}

interface StreamToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsChunk?: string;
}

interface StreamDelta {
  content: string | null;
  reasoning: string | null;
  toolCalls: StreamToolCallDelta[];
  finishReason: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
}

function parseToolCallDeltas(deltaRecord: Record<string, unknown>): StreamToolCallDelta[] {
  const raw = deltaRecord.tool_calls;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry, position) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const fn =
      record.function && typeof record.function === "object"
        ? (record.function as Record<string, unknown>)
        : {};
    return [
      {
        index: typeof record.index === "number" ? record.index : position,
        ...(typeof record.id === "string" && record.id ? { id: record.id } : {}),
        ...(typeof fn.name === "string" && fn.name ? { name: fn.name } : {}),
        ...(typeof fn.arguments === "string" ? { argumentsChunk: fn.arguments } : {}),
      },
    ];
  });
}

function parseStreamChunk(json: unknown): StreamDelta {
  const result: StreamDelta = {
    content: null,
    reasoning: null,
    toolCalls: [],
    finishReason: null,
    usage: null,
  };
  if (!json || typeof json !== "object") {
    return result;
  }
  const chunk = json as Record<string, unknown>;
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const firstChoice = choices[0];
  if (firstChoice && typeof firstChoice === "object") {
    const choiceRecord = firstChoice as Record<string, unknown>;
    if (typeof choiceRecord.finish_reason === "string") {
      result.finishReason = choiceRecord.finish_reason;
    }
    const delta = choiceRecord.delta;
    if (delta && typeof delta === "object") {
      const deltaRecord = delta as Record<string, unknown>;
      if (typeof deltaRecord.content === "string" && deltaRecord.content.length > 0) {
        result.content = deltaRecord.content;
      }
      const reasoning = deltaRecord.reasoning_content ?? deltaRecord.reasoning;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        result.reasoning = reasoning;
      }
      result.toolCalls = parseToolCallDeltas(deltaRecord);
    }
  }
  const usage = chunk.usage;
  if (usage && typeof usage === "object") {
    const usageRecord = usage as Record<string, unknown>;
    result.usage = {
      ...(typeof usageRecord.prompt_tokens === "number"
        ? { inputTokens: usageRecord.prompt_tokens }
        : {}),
      ...(typeof usageRecord.completion_tokens === "number"
        ? { outputTokens: usageRecord.completion_tokens }
        : {}),
    };
  }
  return result;
}

function parseModelList(json: unknown): string[] {
  if (!json || typeof json !== "object") {
    return [];
  }
  const data = (json as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((entry) => {
    if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      return [(entry as { id: string }).id];
    }
    return [];
  });
}

/**
 * Optional per-model context-length fields seen across OpenAI-compatible
 * servers. LM Studio's native listing reports `loaded_context_length` (the
 * window the loaded instance actually runs with) ahead of the model's
 * theoretical `max_context_length`; vLLM extends /v1/models with
 * `max_model_len`; other gateways use `context_length`/`context_window`.
 */
const MODEL_CONTEXT_LENGTH_FIELDS = [
  "loaded_context_length",
  "max_context_length",
  "max_model_len",
  "context_length",
  "context_window",
] as const;

function parseModelContextLength(entry: Record<string, unknown>): number | null {
  for (const field of MODEL_CONTEXT_LENGTH_FIELDS) {
    const value = entry[field];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function parseModelContextLengths(json: unknown): Map<string, number> {
  const lengths = new Map<string, number>();
  if (!json || typeof json !== "object") {
    return lengths;
  }
  const data = (json as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    return lengths;
  }
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    const contextLength = parseModelContextLength(record);
    if (contextLength !== null) {
      lengths.set(record.id, contextLength);
    }
  }
  return lengths;
}

/**
 * Rough token estimate for the breakdown split (~4 chars/token). The split is
 * proportional only; the total is corrected to the server-measured
 * prompt_tokens when one has been observed.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function parseToolCallPayloads(raw: unknown): ToolCallPayload[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const calls = raw.flatMap((entry): ToolCallPayload[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const fn =
      record.function && typeof record.function === "object"
        ? (record.function as Record<string, unknown>)
        : null;
    if (
      typeof record.id !== "string" ||
      !fn ||
      typeof fn.name !== "string" ||
      typeof fn.arguments !== "string"
    ) {
      return [];
    }
    return [
      { id: record.id, type: "function", function: { name: fn.name, arguments: fn.arguments } },
    ];
  });
  return calls.length > 0 ? calls : null;
}

function restoreMessages(metadata: Record<string, unknown> | undefined): ChatMessage[] {
  const raw = metadata?.["messages"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed = raw.flatMap((entry): ChatMessage[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const { role, content } = record;
    if (typeof content !== "string") {
      return [];
    }
    if (role === "system" || role === "user") {
      const messageId = typeof record.messageId === "string" ? record.messageId : undefined;
      return [{ role, content, ...(messageId ? { messageId } : {}) }];
    }
    if (role === "assistant") {
      const toolCalls = parseToolCallPayloads(record.tool_calls);
      return [{ role, content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }];
    }
    if (role === "tool" && typeof record.tool_call_id === "string") {
      return [{ role, content, tool_call_id: record.tool_call_id }];
    }
    return [];
  });
  return sanitizeRestoredMessages(parsed);
}

/**
 * Persistence trims to the last N messages, which can orphan tool messages
 * from their assistant tool_calls (or vice versa). OpenAI-compatible servers
 * reject such conversations, so repair the boundary: drop orphan tool
 * results and strip tool_calls that have no results following them.
 */
function sanitizeRestoredMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "tool") {
      continue; // reached only when not consumed by an assistant tool_calls below
    }
    if (message.role !== "assistant" || !message.tool_calls) {
      result.push(message);
      continue;
    }
    const callIds = new Set(message.tool_calls.map((call) => call.id));
    const results: ChatMessage[] = [];
    let cursor = index + 1;
    while (cursor < messages.length) {
      const candidate = messages[cursor]!;
      if (candidate.role !== "tool" || !callIds.has(candidate.tool_call_id)) {
        break;
      }
      results.push(candidate);
      cursor += 1;
    }
    if (results.length === message.tool_calls.length) {
      result.push(message, ...results);
      index = cursor - 1;
    } else if (message.content) {
      result.push({ role: "assistant", content: message.content });
    }
  }
  return result;
}

export class OpenAICompatAgentClient implements AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities = CAPABILITIES;
  private readonly logger?: Logger;
  private readonly label: string;
  private readonly env?: Record<string, string>;
  private readonly ottoToolGroups?: readonly OttoToolGroup[] | null;
  private readonly mcpServers: Record<string, McpServerConfig> | null;
  private readonly mcpToolPermissions: McpToolPermissionMode;
  private readonly managedProcesses: ManagedProcessRegistry | null;

  constructor(options: OpenAICompatAgentClientOptions) {
    this.provider = options.providerId;
    this.logger = options.logger;
    this.label = options.label;
    this.env = options.env;
    this.ottoToolGroups = options.ottoToolGroups ?? null;
    this.mcpServers = options.mcpServers ?? null;
    this.mcpToolPermissions = options.mcpToolPermissions ?? "always-ask";
    this.managedProcesses = options.managedProcesses ?? null;
  }

  async isAvailable(): Promise<boolean> {
    // Nothing to install — availability is endpoint reachability, surfaced
    // through fetchCatalog so the UI shows a configuration error, not
    // "not installed".
    return true;
  }

  async fetchCatalog(options: FetchCatalogOptions): Promise<ProviderCatalog> {
    const endpoint = resolveEndpoint(this.env, this.label);
    const timeoutMs = options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetch(`${endpoint.baseUrl}/models`, {
        headers: buildHeaders(endpoint),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw unreachableError(this.label, endpoint, error);
    }
    if (!response.ok) {
      throw new Error(
        `${this.label} at ${endpoint.baseUrl} responded ${response.status} to /models. Check the URL and API key.`,
      );
    }
    const listing: unknown = await response.json();
    const modelIds = parseModelList(listing);
    const contextLengths = parseModelContextLengths(listing);
    const models: AgentModelDefinition[] = modelIds.map((id, index) => {
      const model: AgentModelDefinition = {
        provider: this.provider,
        id,
        label: id,
        isDefault: index === 0,
      };
      const contextWindowMaxTokens = contextLengths.get(id);
      if (typeof contextWindowMaxTokens === "number") {
        model.contextWindowMaxTokens = contextWindowMaxTokens;
      }
      return model;
    });
    return { models, modes: OPENAI_COMPAT_MODES };
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    let endpoint: ResolvedEndpoint;
    try {
      endpoint = resolveEndpoint(this.env, this.label);
    } catch (error) {
      return { diagnostic: error instanceof Error ? error.message : String(error) };
    }
    try {
      const catalog = await this.fetchCatalog({ scope: "global", force: true });
      return {
        diagnostic: [
          `${this.label} (OpenAI-compatible endpoint)`,
          `  URL: ${endpoint.baseUrl}`,
          `  Auth: ${endpoint.apiKey ? "API key configured" : "none"}`,
          `  Models: ${catalog.models.length}`,
          `  Status: reachable`,
        ].join("\n"),
      };
    } catch (error) {
      return {
        diagnostic: [
          `${this.label} (OpenAI-compatible endpoint)`,
          `  URL: ${endpoint.baseUrl}`,
          `  Auth: ${endpoint.apiKey ? "API key configured" : "none"}`,
          `  Status: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
      };
    }
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    return buildOpenAICompatFeatures({
      reasoningEffort: normalizeOpenAICompatReasoningEffort(
        config.featureValues?.["reasoning_effort"],
      ),
    });
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new OpenAICompatAgentSession({
      providerId: this.provider,
      label: this.label,
      env: this.env,
      config,
      sessionId: randomUUID(),
      messages: [],
      logger: this.logger,
      ottoTools: launchContext?.ottoTools ?? null,
      ottoToolGroups: this.ottoToolGroups,
      mcpServers: this.mcpServers,
      mcpToolPermissions: this.mcpToolPermissions,
      managedProcesses: this.managedProcesses,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadata = (handle.metadata ?? {}) as Record<string, unknown>;
    const model = typeof metadata.model === "string" ? metadata.model : undefined;
    const modeId = typeof metadata.modeId === "string" ? metadata.modeId : undefined;
    return new OpenAICompatAgentSession({
      providerId: this.provider,
      label: this.label,
      env: this.env,
      config: {
        provider: this.provider,
        cwd: overrides?.cwd ?? process.cwd(),
        ...(model ? { model } : {}),
        ...(modeId ? { modeId } : {}),
        ...overrides,
      },
      sessionId: handle.sessionId,
      messages: restoreMessages(metadata),
      logger: this.logger,
      ottoTools: launchContext?.ottoTools ?? null,
      ottoToolGroups: this.ottoToolGroups,
      mcpServers: this.mcpServers,
      mcpToolPermissions: this.mcpToolPermissions,
      managedProcesses: this.managedProcesses,
    });
  }
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

interface ActiveTurn {
  turnId: string;
  assistantMessageId: string;
  abort: AbortController;
  /** Assistant text streamed in the current model round. */
  roundText: string;
  /** Assistant text across all rounds of the turn. */
  finalTextParts: string[];
  pendingToolCalls: Map<number, AccumulatedToolCall>;
  finishReason: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  resolve: (result: AgentRunResult) => void;
  reject: (error: Error) => void;
  completed: Promise<AgentRunResult>;
}

interface PendingPermission {
  request: AgentPermissionRequest;
  resolve: (response: AgentPermissionResponse) => void;
}

function isZodType(schema: z.ZodRawShape | z.ZodType): schema is z.ZodType {
  return typeof (schema as { safeParseAsync?: unknown }).safeParseAsync === "function";
}

/** Convert an Otto tool's Zod input schema into the JSON Schema the OpenAI `tools` payload expects. */
function ottoToolParameters(tool: OttoToolDefinition): Record<string, unknown> {
  const schema = tool.inputSchema;
  if (!schema) {
    return { type: "object", properties: {} };
  }
  try {
    const zodSchema = isZodType(schema) ? schema : z.object(schema);
    const jsonSchema = z.toJSONSchema(zodSchema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    return jsonSchema;
  } catch {
    // A schema JSON Schema can't represent (e.g. transforms) still leaves the
    // tool callable; executeTool validates the args when it runs.
    return { type: "object", properties: {} };
  }
}

/** Flatten an Otto tool result into the text fed back to the model. */
function ottoResultToText(result: OttoToolResult): string {
  const texts = result.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);
  if (texts.length > 0) {
    return texts.join("\n");
  }
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent, null, 2);
    } catch {
      return String(result.structuredContent);
    }
  }
  return result.isError ? "Tool failed" : "Done.";
}

export class OpenAICompatAgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly capabilities = CAPABILITIES;
  readonly id: string;

  private readonly label: string;
  private readonly env?: Record<string, string>;
  private readonly logger?: Logger;
  private readonly cwd: string;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private readonly eventHistory: AgentStreamEvent[] = [];
  private readonly messages: ChatMessage[];
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  /** Otto's tool catalog, injected natively since this provider can't host an MCP client. */
  private readonly ottoTools: OttoToolCatalog | null;
  /** Which Otto tool groups to expose; null/undefined = all groups. */
  private readonly ottoToolGroups?: readonly OttoToolGroup[] | null;
  /** Daemon-hosted MCP client for the configured servers; null when none are configured. */
  private readonly mcpManager: OpenAICompatMcpManager | null;
  private readonly mcpToolPermissions: McpToolPermissionMode;
  /** Connection failures already surfaced as timeline warnings. */
  private mcpFailuresAnnounced = false;
  private modelId: string | null;
  private modeId: string;
  private reasoningEffort: OpenAICompatReasoningEffort;
  private activeTurn: ActiveTurn | null = null;
  /** Resolved context window for the active model; null until (or unless) discovered. */
  private contextWindowMaxTokens: number | null = null;
  /** Model the cached context window was resolved for; re-probe after a model switch. */
  private contextWindowProbedModel: string | null = null;
  /** Exact context size (prompt + completion tokens) measured by the server on the last round. */
  private lastContextTokens: number | null = null;

  constructor(options: {
    providerId: string;
    label: string;
    env?: Record<string, string>;
    config: AgentSessionConfig;
    sessionId: string;
    messages: ChatMessage[];
    logger?: Logger;
    ottoTools?: OttoToolCatalog | null;
    ottoToolGroups?: readonly OttoToolGroup[] | null;
    mcpServers?: Record<string, McpServerConfig> | null;
    mcpToolPermissions?: McpToolPermissionMode;
    managedProcesses?: ManagedProcessRegistry | null;
  }) {
    this.provider = options.providerId;
    this.label = options.label;
    this.env = options.env;
    this.logger = options.logger;
    this.id = options.sessionId;
    this.cwd = options.config.cwd;
    this.ottoTools = options.ottoTools ?? null;
    this.ottoToolGroups = options.ottoToolGroups ?? null;
    this.mcpToolPermissions = options.mcpToolPermissions ?? "always-ask";

    // Provider-level servers merged with per-agent config; the per-agent entry
    // wins per server name. The daemon-injected internal "otto" MCP server is
    // stripped — this provider receives Otto tools natively, and connecting to
    // it over MCP as well would double them.
    const perAgentServers = stripInternalOttoMcpServer(options.config).mcpServers;
    const mergedServers: Record<string, McpServerConfig> = {
      ...options.mcpServers,
      ...perAgentServers,
    };
    this.mcpManager =
      Object.keys(mergedServers).length > 0
        ? new OpenAICompatMcpManager({
            servers: mergedServers,
            providerId: options.providerId,
            cwd: options.config.cwd,
            logger: options.logger,
            managedProcesses: options.managedProcesses ?? null,
          })
        : null;
    this.modelId = options.config.model ?? null;
    this.modeId =
      options.config.modeId && VALID_MODE_IDS.has(options.config.modeId)
        ? options.config.modeId
        : "default";
    this.reasoningEffort = normalizeOpenAICompatReasoningEffort(
      options.config.featureValues?.["reasoning_effort"],
    );

    // The system message is always rebuilt so cwd/mode/config changes take
    // effect on resume; restored copies of it are dropped first.
    this.messages = options.messages.filter((message) => message.role !== "system");
    this.messages.unshift({ role: "system", content: this.buildSystemPrompt(options.config) });

    this.rebuildEventHistory();
  }

  /**
   * Rebuild replayable history from the current conversation so a resumed or
   * rewound session still backfills its transcript. Tool traffic is skipped —
   * the durable timeline store owns the full historical record. User messages
   * keep their persisted messageId so the durable timeline and the provider
   * conversation agree on rewind targets.
   */
  private rebuildEventHistory(): void {
    this.eventHistory.length = 0;
    for (const message of this.messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      if (!message.content) continue;
      this.eventHistory.push({
        type: "timeline",
        provider: this.provider,
        item:
          message.role === "user"
            ? {
                type: "user_message",
                text: message.content,
                messageId: message.messageId ?? randomUUID(),
              }
            : { type: "assistant_message", text: message.content, messageId: randomUUID() },
      });
    }
  }

  get features(): AgentFeature[] {
    return buildOpenAICompatFeatures({ reasoningEffort: this.reasoningEffort });
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId !== "reasoning_effort") {
      throw new Error(`Unknown feature: ${featureId}`);
    }
    if (normalizeOpenAICompatReasoningEffort(value) !== value) {
      throw new Error(`Invalid reasoning effort value: ${String(value)}`);
    }
    this.reasoningEffort = value as OpenAICompatReasoningEffort;
  }

  private buildSystemPrompt(config: AgentSessionConfig): string {
    const parts = [
      [
        `You are a coding agent running inside Otto against ${this.label}.`,
        `Workspace directory: ${this.cwd}`,
        `Platform: ${process.platform}`,
        "Use the available tools to read, search, and modify files and to run shell commands.",
        "Prefer tools over guessing: inspect files before editing them and verify your changes.",
        "When the task is complete, reply with a concise summary of what you did.",
      ].join("\n"),
      this.buildPreviewWorkflowPrompt(),
      config.systemPrompt?.trim(),
      config.daemonAppendSystemPrompt?.trim(),
    ];
    return parts.filter((part): part is string => Boolean(part)).join("\n\n");
  }

  /**
   * Workflow doctrine for the preview/browser tool families. Tool descriptions
   * alone don't reliably steer local models, so when both families are exposed
   * the system prompt spells out the split: preview_start owns dev servers and
   * their designated tab; browser_new_tab is for everything else.
   */
  private buildPreviewWorkflowPrompt(): string | null {
    const hasTool = (name: string): boolean =>
      Boolean(this.ottoTools?.getTool(name)) && this.isOttoToolGroupEnabled(name);
    const hasPreview = hasTool("preview_start");
    const hasBrowser = hasTool("browser_snapshot");
    if (!hasPreview && !hasBrowser) {
      return null;
    }

    const lines = ["## Verifying changes in the browser"];
    if (hasPreview) {
      lines.push(
        "- Start dev servers with preview_start — never with run_command or other shell commands. It manages the process, its logs (preview_logs), and its preview tab.",
      );
    }
    if (hasPreview && hasBrowser) {
      lines.push(
        "- preview_start returns browser.browserId: the server's designated preview tab, the same tab the user watches. Verify your changes against that browserId with browser_snapshot, browser_inspect, browser_logs, browser_click, and browser_screenshot.",
        "- Never open a dev server URL with browser_new_tab or in another tab — the daemon rejects it. browser_new_tab is only for external sites and general browsing.",
      );
    }
    if (hasBrowser) {
      lines.push(
        "- After changing code that a running dev server renders, verify it: reload or snapshot the page, check browser_logs for errors, then share proof (a snapshot or screenshot) instead of asking the user to check manually.",
      );
    }
    return lines.join("\n");
  }

  private availableToolSpecs(): CompatToolSpec[] {
    if (this.modeId === "plan") {
      return COMPAT_TOOL_SPECS.filter((spec) => spec.kind === "read");
    }
    return COMPAT_TOOL_SPECS;
  }

  private toolNeedsApproval(spec: CompatToolSpec): boolean {
    if (spec.kind === "read") return false;
    if (this.modeId === "bypassPermissions") return false;
    if (this.modeId === "acceptEdits") return spec.kind === "execute";
    return true;
  }

  /**
   * Otto's injected catalog (browser_*, preview_*, agent management, …) rendered
   * as OpenAI function specs so the local model can call them. Excluded in
   * read-only "plan" mode since they can take actions; builtin coding tools win
   * on name collisions. Empty when no catalog was injected (e.g. tools disabled).
   */
  /** Whether an Otto tool's group is enabled for this provider (null groups = all). */
  private isOttoToolGroupEnabled(name: string): boolean {
    const groups = this.ottoToolGroups;
    return !groups || groups.includes(ottoToolGroupForName(name));
  }

  /**
   * Connect the configured MCP servers before the first model round. A server
   * that fails to connect is skipped — surfaced once as a timeline warning,
   * never fatal to the session.
   */
  private async ensureMcpReady(turn: ActiveTurn): Promise<void> {
    if (!this.mcpManager) {
      return;
    }
    await this.mcpManager.ensureConnected();
    if (this.mcpFailuresAnnounced) {
      return;
    }
    this.mcpFailuresAnnounced = true;
    for (const failure of this.mcpManager.failures) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: {
          type: "error",
          message: `MCP server '${failure.name}' unavailable: ${failure.error}`,
        },
      });
    }
  }

  /** MCP prompts from connected servers surfaced as slash commands. */
  async listCommands(): Promise<AgentSlashCommand[]> {
    if (!this.mcpManager) {
      return [];
    }
    const prompts = await this.mcpManager.listPrompts();
    return prompts.map((prompt) => ({
      name: prompt.commandName,
      description: prompt.description ?? `MCP prompt from server '${prompt.serverName}'`,
      argumentHint: prompt.argumentNames.join(" "),
    }));
  }

  /**
   * When the typed prompt is `/mcp_{server}_{prompt} args`, resolve it via
   * prompts/get and feed the resolved text to the model. The remainder of the
   * line maps to the prompt's first declared argument (multi-argument prompts
   * receive only that one). Any resolution failure falls back to sending the
   * raw text as a plain prompt, matching the opencode provider.
   */
  private async resolveMcpPromptText(promptText: string): Promise<string> {
    const manager = this.mcpManager;
    if (!manager) {
      return promptText;
    }
    const parsed = parseSlashCommandInput(promptText);
    if (!parsed || !parsed.commandName.startsWith("mcp_")) {
      return promptText;
    }
    try {
      const prompts = await manager.listPrompts();
      const binding = prompts.find((prompt) => prompt.commandName === parsed.commandName);
      if (!binding) {
        return promptText;
      }
      return await manager.getPrompt(binding, parsed.args);
    } catch (error) {
      this.logger?.warn(
        { err: error, commandName: parsed.commandName },
        "Failed to resolve MCP prompt command; falling back to plain prompt input",
      );
      return promptText;
    }
  }

  /**
   * MCP tools rendered as OpenAI function specs under namespaced
   * mcp_{server}_{tool} names. Hard-excluded in read-only "plan" mode — MCP
   * tools are opaque and may take actions regardless of what they claim.
   */
  private buildMcpToolPayload(): unknown[] {
    if (!this.mcpManager || this.modeId === "plan") {
      return [];
    }
    return this.mcpManager.getToolBindings().map((binding) => ({
      type: "function",
      function: {
        name: binding.modelName,
        description: binding.description,
        parameters: binding.parameters,
      },
    }));
  }

  private buildOttoToolPayload(): unknown[] {
    if (!this.ottoTools || this.modeId === "plan") {
      return [];
    }
    const payload: unknown[] = [];
    for (const tool of this.ottoTools.tools.values()) {
      if (findCompatToolSpec(tool.name) || !this.isOttoToolGroupEnabled(tool.name)) {
        continue;
      }
      payload.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: ottoToolParameters(tool),
        },
      });
    }
    return payload;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const { turnId } = await this.startTurn(prompt, options);
    const turn = this.activeTurn;
    if (!turn || turn.turnId !== turnId) {
      throw new Error(`${this.label} turn did not start`);
    }
    return turn.completed;
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.activeTurn) {
      throw new Error(`${this.label} already has an active turn`);
    }

    const turnId = randomUUID();
    let resolve!: (result: AgentRunResult) => void;
    let reject!: (error: Error) => void;
    const completed = new Promise<AgentRunResult>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    // startTurn callers observe failure via turn_failed events, not this
    // promise — swallow to avoid unhandled rejections. run() awaits the same
    // promise and still sees the rejection.
    completed.catch(() => {});

    const turn: ActiveTurn = {
      turnId,
      assistantMessageId: randomUUID(),
      abort: new AbortController(),
      roundText: "",
      finalTextParts: [],
      pendingToolCalls: new Map(),
      finishReason: null,
      usage: null,
      resolve,
      reject,
      completed,
    };
    this.activeTurn = turn;

    const promptText = promptToText(prompt);
    // One id shared by the timeline item and the conversation entry so
    // revertConversation can map a timeline user_message back to its message.
    const userMessageId = options?.messageId ?? randomUUID();
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      item: {
        type: "user_message",
        text: promptText,
        messageId: userMessageId,
      },
    });

    void this.executeTurn(turn, promptText, userMessageId);
    return { turnId };
  }

  private async executeTurn(
    turn: ActiveTurn,
    promptText: string,
    userMessageId: string,
  ): Promise<void> {
    this.emit({ type: "turn_started", provider: this.provider, turnId: turn.turnId });

    try {
      await this.ensureMcpReady(turn);
      // The timeline keeps the typed `/command args` text; the model receives
      // the resolved MCP prompt (or the raw text when nothing matches).
      const modelText = await this.resolveMcpPromptText(promptText);
      this.messages.push({ role: "user", content: modelText, messageId: userMessageId });
      await this.runToolLoop(turn);
    } catch (error) {
      this.settleTurnFailure(turn, error);
      return;
    }

    if (this.activeTurn !== turn) {
      return;
    }
    this.activeTurn = null;
    const finalText = turn.finalTextParts.join("\n\n");
    const usage = await this.buildTurnUsage(turn);
    this.emit({
      type: "turn_completed",
      provider: this.provider,
      turnId: turn.turnId,
      ...(usage ? { usage } : {}),
    });
    turn.resolve({
      sessionId: this.id,
      finalText,
      ...(usage ? { usage } : {}),
      timeline: [],
      canceled: false,
    });
  }

  private async runToolLoop(turn: ActiveTurn): Promise<void> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      await this.streamCompletion(turn);

      const toolCalls = [...turn.pendingToolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
      if (turn.roundText || toolCalls.length > 0) {
        this.messages.push({
          role: "assistant",
          content: turn.roundText,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map(
                  (call): ToolCallPayload => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: call.argumentsJson },
                  }),
                ),
              }
            : {}),
        });
      }
      if (turn.roundText) {
        turn.finalTextParts.push(turn.roundText);
        // Consumed — settleTurnFailure must not re-append it if a later tool
        // round gets interrupted.
        turn.roundText = "";
      }

      if (toolCalls.length === 0) {
        return;
      }

      for (const call of toolCalls) {
        if (turn.abort.signal.aborted) {
          throw new Error("Interrupted");
        }
        const resultContent = await this.executeToolCall(turn, call);
        this.messages.push({ role: "tool", content: resultContent, tool_call_id: call.id });
      }
      if (turn.abort.signal.aborted) {
        throw new Error("Interrupted");
      }
    }
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId: turn.turnId,
      item: {
        type: "error",
        message: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`,
      },
    });
  }

  private parseToolCallArgs(
    turn: ActiveTurn,
    call: AccumulatedToolCall,
  ): { args: Record<string, unknown> } | { error: string } {
    try {
      const parsed: unknown = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
      return {
        args: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
      };
    } catch {
      this.emitToolItem(
        turn,
        call,
        "failed",
        buildCompatToolPreviewDetail(call.name, {}, this.cwd),
        "Invalid tool arguments (malformed JSON)",
      );
      return { error: `Error: arguments for ${call.name} were not valid JSON` };
    }
  }

  private async executeToolCall(turn: ActiveTurn, call: AccumulatedToolCall): Promise<string> {
    const spec = findCompatToolSpec(call.name);
    const parsed = this.parseToolCallArgs(turn, call);
    if ("error" in parsed) {
      return parsed.error;
    }
    const args = parsed.args;

    // Otto catalog tools are dispatched to the catalog, not the builtin coding
    // tools. Builtins take precedence on name; plan mode offers neither actions
    // nor Otto tools, so a plan-mode call for one falls through to "not available".
    if (!spec && this.modeId !== "plan") {
      const ottoTool = this.isOttoToolGroupEnabled(call.name)
        ? this.ottoTools?.getTool(call.name)
        : undefined;
      if (ottoTool) {
        return this.executeOttoToolCall(turn, call, args, ottoTool);
      }
      // MCP tools live under namespaced mcp_{server}_{tool} names, so they can
      // never collide with (or shadow) builtins or Otto tools.
      const mcpBinding = this.mcpManager?.resolveTool(call.name);
      if (mcpBinding) {
        return this.executeMcpToolCall(turn, call, args, mcpBinding);
      }
    }

    const previewDetail = buildCompatToolPreviewDetail(call.name, args, this.cwd);
    if (!spec || !this.availableToolSpecs().some((candidate) => candidate.name === spec.name)) {
      this.emitToolItem(turn, call, "failed", previewDetail, `Tool ${call.name} is not available`);
      return `Error: tool ${call.name} is not available in the current mode`;
    }

    if (this.toolNeedsApproval(spec)) {
      const response = await this.requestPermission(turn, {
        name: spec.name,
        title: spec.name,
        description:
          spec.kind === "execute" ? "Wants to run a shell command" : "Wants to modify a file",
        args,
        detail: previewDetail,
      });
      if (response.behavior === "deny") {
        this.emitToolItem(turn, call, "failed", previewDetail, "Denied by user");
        if (response.interrupt) {
          turn.abort.abort();
        }
        const message = response.message?.trim();
        return message
          ? `The user declined this tool call: ${message}`
          : "The user declined this tool call.";
      }
    }

    this.emitToolItem(turn, call, "running", previewDetail, null);
    const outcome = await executeCompatTool({
      name: call.name,
      arguments: args,
      cwd: this.cwd,
      signal: turn.abort.signal,
    });
    if (turn.abort.signal.aborted) {
      this.emitToolItem(turn, call, "canceled", outcome.detail, null);
      return outcome.output;
    }
    this.emitToolItem(
      turn,
      call,
      outcome.isError ? "failed" : "completed",
      outcome.detail,
      outcome.isError ? outcome.output : null,
    );
    return outcome.output;
  }

  /**
   * MCP tools are opaque — the daemon cannot know whether one is destructive.
   * default mode always asks; acceptEdits asks unless the provider opted into
   * "trust-read-only" AND the server self-declares readOnlyHint (that
   * annotation is untrusted, so it never skips prompts in default mode);
   * bypassPermissions auto-approves like everything else. Plan mode never
   * reaches here — MCP tools are excluded from the payload entirely.
   */
  private mcpToolNeedsApproval(binding: McpToolBinding): boolean {
    if (this.modeId === "bypassPermissions") return false;
    if (this.modeId === "acceptEdits") {
      return !(this.mcpToolPermissions === "trust-read-only" && binding.readOnlyHint);
    }
    return true;
  }

  private async executeMcpToolCall(
    turn: ActiveTurn,
    call: AccumulatedToolCall,
    args: Record<string, unknown>,
    binding: McpToolBinding,
  ): Promise<string> {
    const manager = this.mcpManager;
    if (!manager) {
      return `Error: tool ${call.name} is not available`;
    }
    const detail: ToolCallDetail = { type: "unknown", input: args, output: null };
    if (this.mcpToolNeedsApproval(binding)) {
      const response = await this.requestPermission(turn, {
        name: binding.modelName,
        title: `${binding.serverName}: ${binding.toolName}`,
        description: `Wants to run an MCP tool from server '${binding.serverName}'`,
        args,
        detail,
      });
      if (response.behavior === "deny") {
        this.emitToolItem(turn, call, "failed", detail, "Denied by user");
        if (response.interrupt) {
          turn.abort.abort();
        }
        const message = response.message?.trim();
        return message
          ? `The user declined this tool call: ${message}`
          : "The user declined this tool call.";
      }
    }

    this.emitToolItem(turn, call, "running", detail, null);
    const outcome = await manager.callTool(binding, args, { signal: turn.abort.signal });
    if (turn.abort.signal.aborted) {
      this.emitToolItem(turn, call, "canceled", { ...detail, output: outcome.output }, null);
      return outcome.output;
    }
    this.emitToolItem(
      turn,
      call,
      outcome.isError ? "failed" : "completed",
      { ...detail, output: outcome.output },
      outcome.isError ? outcome.output : null,
    );
    return outcome.output;
  }

  /**
   * Otto tools skip prompts only when classified read-only; "interact" tools
   * are auto-approved in acceptEdits like file edits, and "execute" tools
   * always prompt outside bypassPermissions. CLI providers get this gating
   * from their own permission system in front of the MCP client — here the
   * daemon is the runtime, so it prompts itself.
   * See openai-compat-otto-tool-permissions.ts.
   */
  private ottoToolNeedsApproval(name: string): boolean {
    const kind = ottoToolPermissionKind(name);
    if (kind === "read") return false;
    if (this.modeId === "bypassPermissions") return false;
    if (this.modeId === "acceptEdits") return kind === "execute";
    return true;
  }

  private async executeOttoToolCall(
    turn: ActiveTurn,
    call: AccumulatedToolCall,
    args: Record<string, unknown>,
    tool: OttoToolDefinition,
  ): Promise<string> {
    const catalog = this.ottoTools;
    if (!catalog) {
      return `Error: tool ${call.name} is not available`;
    }
    const detail: ToolCallDetail = { type: "unknown", input: args, output: null };
    if (this.ottoToolNeedsApproval(tool.name)) {
      const response = await this.requestPermission(turn, {
        name: tool.name,
        title: tool.name,
        description:
          ottoToolPermissionKind(tool.name) === "execute"
            ? "Wants to run an Otto tool that can execute code or manage agents"
            : "Wants to interact with the Otto browser or preview servers",
        args,
        detail,
      });
      if (response.behavior === "deny") {
        this.emitToolItem(turn, call, "failed", detail, "Denied by user");
        if (response.interrupt) {
          turn.abort.abort();
        }
        const message = response.message?.trim();
        return message
          ? `The user declined this tool call: ${message}`
          : "The user declined this tool call.";
      }
    }
    this.emitToolItem(turn, call, "running", { type: "unknown", input: args, output: null }, null);
    try {
      const result = await catalog.executeTool(tool.name, args, { signal: turn.abort.signal });
      const output = ottoResultToText(result);
      if (turn.abort.signal.aborted) {
        this.emitToolItem(turn, call, "canceled", { type: "unknown", input: args, output }, null);
        return output;
      }
      this.emitToolItem(
        turn,
        call,
        result.isError ? "failed" : "completed",
        { type: "unknown", input: args, output },
        result.isError ? output : null,
      );
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitToolItem(
        turn,
        call,
        "failed",
        { type: "unknown", input: args, output: null },
        message,
      );
      return `Error: ${message}`;
    }
  }

  private emitToolItem(
    turn: ActiveTurn,
    call: AccumulatedToolCall,
    status: "running" | "completed" | "failed" | "canceled",
    detail: ToolCallDetail,
    error: string | null,
  ): void {
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId: turn.turnId,
      item:
        status === "failed"
          ? {
              type: "tool_call",
              callId: call.id,
              name: call.name,
              detail,
              status,
              error: error ?? "Tool failed",
            }
          : { type: "tool_call", callId: call.id, name: call.name, detail, status, error: null },
    });
  }

  private async requestPermission(
    turn: ActiveTurn,
    input: {
      name: string;
      title: string;
      description: string;
      args: Record<string, unknown>;
      detail: ToolCallDetail;
    },
  ): Promise<AgentPermissionResponse> {
    const request: AgentPermissionRequest = {
      id: randomUUID(),
      provider: this.provider,
      name: input.name,
      kind: "tool",
      title: input.title,
      description: input.description,
      input: input.args,
      detail: input.detail,
    };
    const response = await new Promise<AgentPermissionResponse>((resolve) => {
      this.pendingPermissions.set(request.id, { request, resolve });
      this.emit({
        type: "permission_requested",
        provider: this.provider,
        request,
        turnId: turn.turnId,
      });
    });
    return response;
  }

  private async streamCompletion(turn: ActiveTurn): Promise<void> {
    const endpoint = resolveEndpoint(this.env, this.label);
    const model = await this.resolveModel(endpoint);
    turn.assistantMessageId = randomUUID();
    turn.roundText = "";
    turn.pendingToolCalls = new Map();
    turn.finishReason = null;

    const toolSpecs = this.availableToolSpecs();
    const toolsPayload = [
      ...buildOpenAIToolsPayload(toolSpecs),
      ...this.buildOttoToolPayload(),
      ...this.buildMcpToolPayload(),
    ];
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(endpoint),
      signal: turn.abort.signal,
      body: JSON.stringify({
        model,
        messages: this.messages.map(toWireMessage),
        stream: true,
        stream_options: { include_usage: true },
        ...(this.reasoningEffort !== "off" ? { reasoning_effort: this.reasoningEffort } : {}),
        ...(toolsPayload.length > 0 ? { tools: toolsPayload, tool_choice: "auto" } : {}),
      }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `${this.label} responded ${response.status} to /chat/completions${
          bodyText ? `: ${bodyText.slice(0, 400)}` : ""
        }`,
      );
    }
    if (!response.body) {
      throw new Error(`${this.label} returned an empty response body`);
    }

    for await (const line of readLines(response.body as unknown as AsyncIterable<Uint8Array>)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      this.applyStreamPayload(turn, payload);
    }
  }

  private applyStreamPayload(turn: ActiveTurn, payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = parseStreamChunk(parsed);
    if (delta.reasoning) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: { type: "reasoning", text: delta.reasoning },
      });
    }
    if (delta.content) {
      turn.roundText += delta.content;
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: {
          type: "assistant_message",
          text: delta.content,
          messageId: turn.assistantMessageId,
        },
      });
    }
    for (const toolCallDelta of delta.toolCalls) {
      const existing = turn.pendingToolCalls.get(toolCallDelta.index) ?? {
        id: "",
        name: "",
        argumentsJson: "",
      };
      turn.pendingToolCalls.set(toolCallDelta.index, {
        id: toolCallDelta.id ?? (existing.id || `call_${toolCallDelta.index}`),
        name: existing.name || (toolCallDelta.name ?? ""),
        argumentsJson: existing.argumentsJson + (toolCallDelta.argumentsChunk ?? ""),
      });
    }
    if (delta.finishReason) {
      turn.finishReason = delta.finishReason;
    }
    if (delta.usage) {
      turn.usage = delta.usage;
    }
  }

  private settleTurnFailure(turn: ActiveTurn, error: unknown): void {
    if (this.activeTurn !== turn) {
      return;
    }
    this.activeTurn = null;
    this.failPendingPermissions();
    if (turn.abort.signal.aborted) {
      this.emit({
        type: "turn_canceled",
        provider: this.provider,
        reason: "Interrupted",
        turnId: turn.turnId,
      });
      if (turn.roundText) {
        turn.finalTextParts.push(turn.roundText);
        this.messages.push({ role: "assistant", content: turn.roundText });
      }
      turn.resolve({
        sessionId: this.id,
        finalText: turn.finalTextParts.join("\n\n"),
        timeline: [],
        canceled: true,
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.logger?.warn({ err: error, provider: this.provider }, "OpenAI-compatible turn failed");
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId: turn.turnId,
      item: { type: "error", message },
    });
    this.emit({
      type: "turn_failed",
      provider: this.provider,
      error: message,
      turnId: turn.turnId,
    });
    turn.reject(error instanceof Error ? error : new Error(message));
  }

  private failPendingPermissions(): void {
    // Map iterators tolerate deleting the current entry mid-iteration.
    for (const [requestId, pending] of this.pendingPermissions) {
      this.pendingPermissions.delete(requestId);
      pending.resolve({ behavior: "deny", message: "Turn ended", interrupt: false });
    }
  }

  private async resolveModel(endpoint: ResolvedEndpoint): Promise<string> {
    if (this.modelId) {
      return this.modelId;
    }
    let response: Response;
    try {
      response = await fetch(`${endpoint.baseUrl}/models`, {
        headers: buildHeaders(endpoint),
        signal: AbortSignal.timeout(DEFAULT_CATALOG_TIMEOUT_MS),
      });
    } catch (error) {
      throw unreachableError(this.label, endpoint, error);
    }
    const modelIds = response.ok ? parseModelList(await response.json()) : [];
    const first = modelIds[0];
    if (!first) {
      throw new Error(
        `${this.label} has no models loaded. Load a model in the server, then try again.`,
      );
    }
    this.modelId = first;
    return first;
  }

  /**
   * Best-effort context window discovery, cached per model. Checks the
   * standard /v1/models listing for extended context-length fields first,
   * then LM Studio's native /api/v0/models listing (same host, /v1 stripped),
   * which reports the loaded instance's actual window. Servers that expose
   * neither leave the meter without a max — never an error.
   */
  private async resolveContextWindowMaxTokens(): Promise<number | null> {
    const model = this.modelId;
    if (!model) {
      return null;
    }
    if (this.contextWindowProbedModel === model) {
      return this.contextWindowMaxTokens;
    }
    let endpoint: ResolvedEndpoint;
    try {
      endpoint = resolveEndpoint(this.env, this.label);
    } catch {
      return null;
    }
    const candidateUrls = [
      `${endpoint.baseUrl}/models`,
      `${endpoint.baseUrl.replace(/\/v1$/u, "")}/api/v0/models`,
    ];
    let resolved: number | null = null;
    for (const url of candidateUrls) {
      try {
        const response = await fetch(url, {
          headers: buildHeaders(endpoint),
          signal: AbortSignal.timeout(DEFAULT_CATALOG_TIMEOUT_MS),
        });
        if (!response.ok) continue;
        const match = parseModelContextLengths(await response.json()).get(model);
        if (typeof match === "number") {
          resolved = match;
          break;
        }
      } catch {
        // Discovery is optional; unreachable probe endpoints are expected.
      }
    }
    this.contextWindowMaxTokens = resolved;
    this.contextWindowProbedModel = model;
    return resolved;
  }

  /**
   * Promote the raw per-request token counts into AgentUsage. The final
   * round's prompt already contains the full conversation, so prompt +
   * completion tokens is the context content size as the server measured it.
   */
  private async buildTurnUsage(turn: ActiveTurn): Promise<AgentUsage | undefined> {
    if (!turn.usage) {
      return undefined;
    }
    const usage: AgentUsage = { ...turn.usage };
    if (typeof turn.usage.inputTokens === "number") {
      const usedTokens = turn.usage.inputTokens + (turn.usage.outputTokens ?? 0);
      usage.contextWindowUsedTokens = usedTokens;
      this.lastContextTokens = usedTokens;
    }
    const maxTokens = await this.resolveContextWindowMaxTokens();
    if (maxTokens !== null) {
      usage.contextWindowMaxTokens = maxTokens;
    }
    return usage;
  }

  /**
   * Context makeup for the client's popup. The daemon owns this provider's
   * entire prompt (system message, tool schemas, conversation), so the split
   * is computed locally: char-based estimates per category, scaled so the
   * counted total matches the server-measured context size when one exists.
   */
  async getContextUsage(): Promise<AgentContextUsage | null> {
    const maxTokens = await this.resolveContextWindowMaxTokens();
    if (maxTokens === null) {
      return null;
    }
    const systemMessage = this.messages.find((message) => message.role === "system");
    const conversation = this.messages.filter((message) => message.role !== "system");
    const toolsPayload = [
      ...buildOpenAIToolsPayload(this.availableToolSpecs()),
      ...this.buildOttoToolPayload(),
      ...this.buildMcpToolPayload(),
    ];
    let categories = [
      {
        name: "Messages",
        tokens: conversation.reduce(
          (sum, message) => sum + estimateTokens(JSON.stringify(message)),
          0,
        ),
      },
      { name: "Tools", tokens: estimateTokens(JSON.stringify(toolsPayload)) },
      { name: "System prompt", tokens: estimateTokens(systemMessage?.content ?? "") },
    ];
    let totalTokens = categories.reduce((sum, category) => sum + category.tokens, 0);
    if (this.lastContextTokens !== null && totalTokens > 0) {
      const scale = this.lastContextTokens / totalTokens;
      categories = categories.map((category) => ({
        ...category,
        tokens: Math.round(category.tokens * scale),
      }));
      totalTokens = this.lastContextTokens;
    }
    return {
      categories: categories.filter((category) => category.tokens > 0),
      totalTokens,
      maxTokens,
    };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.eventHistory) {
      yield event;
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.modelId,
      modeId: this.modeId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return OPENAI_COMPAT_MODES;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.modeId;
  }

  async setMode(modeId: string): Promise<void> {
    if (!VALID_MODE_IDS.has(modeId)) {
      throw new Error(`Unknown mode: ${modeId}`);
    }
    this.modeId = modeId;
    this.emit({
      type: "mode_changed",
      provider: this.provider,
      currentModeId: modeId,
      availableModes: OPENAI_COMPAT_MODES,
    });
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pendingPermissions.values()].map((pending) => pending.request);
  }

  async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      return undefined;
    }
    this.pendingPermissions.delete(requestId);
    this.emit({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
      ...(this.activeTurn ? { turnId: this.activeTurn.turnId } : {}),
    });
    pending.resolve(response);
    return undefined;
  }

  describePersistence(): AgentPersistenceHandle | null {
    return {
      provider: this.provider,
      sessionId: this.id,
      metadata: {
        model: this.modelId,
        modeId: this.modeId,
        messages: this.messages.slice(-MAX_PERSISTED_MESSAGES),
      },
    };
  }

  async setModel(modelId: string | null): Promise<void> {
    this.modelId = modelId;
  }

  /**
   * Rewind the daemon-owned conversation to just before the given user
   * message. Persistence trims to the last MAX_PERSISTED_MESSAGES messages,
   * so on a resumed session only that retained window is rewindable — older
   * targets fail with the not-found error below.
   */
  async revertConversation(input: { messageId: string }): Promise<void> {
    if (this.activeTurn) {
      throw new Error(`${this.label} cannot rewind while a turn is running`);
    }
    const index = this.messages.findIndex(
      (message) => message.role === "user" && message.messageId === input.messageId,
    );
    if (index === -1) {
      throw new Error(
        "Message not found in this session's conversation — it may predate rewind support or was trimmed from persisted history.",
      );
    }
    const retained = sanitizeRestoredMessages(this.messages.slice(0, index));
    this.messages.length = 0;
    this.messages.push(...retained);
    this.rebuildEventHistory();
    this.lastContextTokens = null;
  }

  async interrupt(): Promise<void> {
    const turn = this.activeTurn;
    if (!turn) {
      return;
    }
    turn.abort.abort();
    // A turn parked on a permission prompt has no in-flight fetch to abort —
    // deny the prompt so the loop unwinds and settles as canceled.
    this.failPendingPermissions();
  }

  async close(): Promise<void> {
    await this.interrupt();
    await this.mcpManager?.close();
    this.listeners.clear();
  }

  private emit(event: AgentStreamEvent): void {
    this.eventHistory.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger?.warn({ err: error }, "OpenAI-compatible listener failed");
      }
    }
  }
}
