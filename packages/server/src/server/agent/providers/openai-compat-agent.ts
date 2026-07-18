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
  AgentPersonalityUpdate,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
  AgentTimelineItem,
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
  isPathInsideWorkspace,
  type CompatToolSpec,
} from "./openai-compat-tools.js";
import type { OttoToolCatalog, OttoToolDefinition, OttoToolResult } from "../tools/types.js";
import {
  ottoToolGroupForName,
  MAX_TOOL_ROUNDS_DEFAULT,
  MAX_TOOL_ROUNDS_MIN,
  MAX_TOOL_ROUNDS_MAX,
  type OttoToolGroup,
} from "@otto-code/protocol/provider-config";
import {
  buildOpenAICompatFeatures,
  normalizeOpenAICompatAutoCompact,
  normalizeOpenAICompatReasoningEffort,
  OPENAI_COMPAT_AUTO_COMPACT_FALLBACK,
  OPENAI_COMPAT_AUTO_COMPACT_VALUES,
  OPENAI_COMPAT_DEFAULT_THINKING_OPTION_ID,
  OPENAI_COMPAT_THINKING_OPTIONS,
  type OpenAICompatAutoCompact,
  type OpenAICompatReasoningEffort,
} from "./openai-compat-feature-definitions.js";
import { OpenAICompatMcpManager, type McpToolBinding } from "./openai-compat-mcp.js";
import { ottoToolPermissionKind } from "./openai-compat-otto-tool-permissions.js";
import type { McpServerConfig } from "../agent-sdk-types.js";
import type { ManagedProcessRegistry } from "../../managed-processes/managed-processes.js";
import { stripInternalOttoMcpServer } from "../runtime-mcp-config.js";
import type {
  McpToolPermissionMode,
  ProviderCompactionConfig,
} from "@otto-code/protocol/provider-config";

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

/**
 * Upper bound on model→tool→model rounds within a single turn. Defaults to
 * MAX_TOOL_ROUNDS_DEFAULT; the provider-level `maxToolRounds` override raises or
 * lowers it (clamped to the schema's [min, max] as a defense-in-depth guard so a
 * hand-edited config.json can't disable the safety valve). Out-of-range or
 * missing values fall back to the default rather than failing the session.
 */
function resolveMaxToolRounds(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_TOOL_ROUNDS_DEFAULT;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_TOOL_ROUNDS_MAX, Math.max(MAX_TOOL_ROUNDS_MIN, rounded));
}

/**
 * Per-tool-result budget for the compaction payload. Large results keep their
 * head and tail — truncating harder starves the summarizer of the material
 * (file contents, diffs, command output) the summary is supposed to preserve.
 */
const TOOL_RESULT_HEAD_CHARS = 3000;
const TOOL_RESULT_TAIL_CHARS = 1000;

/**
 * Compaction keeps the most recent slice of the conversation verbatim and only
 * summarizes the older history before it. Summarization is lossy, so we confine
 * it to the distant past where the loss is cheap; recent turns (the files just
 * read, the diff just applied, the error being debugged) stay intact.
 * Default only — tunable per provider via `compaction.keepRecentTokens`.
 */
const COMPACTION_KEEP_RECENT_TOKENS = 20_000;

/**
 * Resolve the provider-level auto-compact default that applies when an agent
 * has no explicit `auto_compact` feature value. `autoCompact: false` wins over
 * any configured threshold.
 */
function resolveAutoCompactDefault(
  compaction: ProviderCompactionConfig | null | undefined,
): OpenAICompatAutoCompact {
  if (compaction?.autoCompact === false) {
    return "off";
  }
  if (typeof compaction?.thresholdPercent === "number") {
    const candidate = String(compaction.thresholdPercent) as OpenAICompatAutoCompact;
    if (OPENAI_COMPAT_AUTO_COMPACT_VALUES.includes(candidate)) {
      return candidate;
    }
  }
  return OPENAI_COMPAT_AUTO_COMPACT_FALLBACK;
}

function resolveKeepRecentTokens(compaction: ProviderCompactionConfig | null | undefined): number {
  return typeof compaction?.keepRecentTokens === "number" && compaction.keepRecentTokens > 0
    ? compaction.keepRecentTokens
    : COMPACTION_KEEP_RECENT_TOKENS;
}

/**
 * Pre-summarization pruning (zero-LLM) reclaims context before we spend a model
 * call: uneventful tool results are elided and oversized older tool outputs are
 * truncated, while the newest tool outputs are protected so live work is never
 * trimmed out from under the model.
 */
const PRUNE_PROTECT_RECENT_TOOL_TOKENS = 12_000;
const PRUNE_TOOL_RESULT_MIN_CHARS = 2_000;
const PRUNE_TOOL_RESULT_HEAD_CHARS = 800;
const PRUNE_TOOL_RESULT_TAIL_CHARS = 400;
const UNEVENTFUL_RESULT_PLACEHOLDER = "[Uneventful result elided]";

/**
 * True when a tool result carries no signal worth keeping in context — empty
 * output, zero-match searches, or a bare timeout/no-op acknowledgement. These
 * are elided wholesale during pruning. Kept conservative on purpose: anything
 * ambiguous is left intact for the summarizer to judge.
 */
export function isUneventfulToolResult(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed === UNEVENTFUL_RESULT_PLACEHOLDER) {
    return false;
  }
  return [
    /^no matches found\.?$/iu,
    /^no results? found\.?$/iu,
    /^found 0 (?:matches|results|files)\b/iu,
    /^0 results?\b/iu,
    /^no files? found\.?$/iu,
    /^\(?no output\)?\.?$/iu,
    /^command (?:completed|finished|exited) with no output\.?$/iu,
    /^no changes\b/iu,
  ].some((pattern) => pattern.test(trimmed));
}

/** Built-in slash command available for every OpenAI-compatible session. */
const COMPACT_COMMAND: AgentSlashCommand = {
  name: "compact",
  description: "Compress the conversation history to free up context space",
  argumentHint: "[instruction]",
  kind: "command",
};

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

// Icons/colorTiers live here (not in AGENT_PROVIDER_DEFINITIONS) because
// openai-compatible providers are registered dynamically, so the registry's
// definition-based mode decoration has nothing to merge from.
export const OPENAI_COMPAT_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission before running commands or editing files",
    icon: "ShieldQuestionMark",
    colorTier: "neutral",
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description:
      "Automatically approves file edits inside the workspace; still asks before running commands",
    icon: "ShieldPerson",
    colorTier: "safe",
  },
  {
    id: "plan",
    label: "Read Only",
    description: "Only read tools are available — no edits or commands; web fetches still ask",
    icon: "ShieldToggle",
    colorTier: "planning",
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
    icon: "PrivacyTip",
    colorTier: "dangerous",
    isUnattended: true,
  },
];

const VALID_MODE_IDS = new Set(OPENAI_COMPAT_MODES.map((mode) => mode.id));

/** Permission-prompt description per builtin tool kind ("read" never prompts). */
const COMPAT_TOOL_PROMPT_DESCRIPTIONS: Record<CompatToolSpec["kind"], string> = {
  read: "Wants to read from the workspace",
  edit: "Wants to modify a file",
  execute: "Wants to run a shell command",
  network: "Wants to fetch content from the web",
};

interface ToolCallPayload {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * A base64-encoded image attached to a user message. Sent to the model as an
 * OpenAI-vision `image_url` content part (a `data:` URL), and persisted with
 * the conversation so the image stays in context across resume — vision APIs
 * keep the image in the running conversation, not just the turn it arrived on.
 */
interface PromptImage {
  data: string;
  mimeType: string;
}

type ChatMessage =
  /**
   * messageId is provider-internal bookkeeping for user messages: it ties the
   * persisted conversation to the durable timeline's user_message items so
   * revertConversation can find its truncation point. Stripped from the wire
   * payload before requests — strict servers reject unknown message fields.
   *
   * images carries attached pictures (user role only); when present, the wire
   * message uses OpenAI's content-array vision format instead of a bare string.
   */
  | {
      role: "system" | "user";
      content: string;
      messageId?: string;
      isCompactionSummary?: boolean;
      images?: PromptImage[];
    }
  // reasoning is the round's accumulated thinking text, kept only so a
  // resumed session can redisplay it — never sent back to the model (most
  // reasoning APIs don't want their own thinking echoed back as input, and
  // strict servers reject unknown message fields). Stripped in toWireMessage.
  | { role: "assistant"; content: string; tool_calls?: ToolCallPayload[]; reasoning?: string }
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
    if (message.role === "user" && message.images && message.images.length > 0) {
      // OpenAI vision format: content becomes an array of typed parts. The
      // text part is omitted when empty (image-only prompt) so we never send a
      // blank text block that some strict servers reject.
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) {
        parts.push({ type: "text", text: message.content });
      }
      for (const image of message.images) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        });
      }
      return { role: message.role, content: parts };
    }
    return { role: message.role, content: message.content };
  }
  if (message.role === "assistant") {
    return {
      role: message.role,
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    };
  }
  return message;
}

/**
 * Fold a reconstructed tool result's raw text into whichever field the
 * preview detail's type uses for it. Only the flat result text survives
 * persistence — structured metadata that a live run attaches (numMatches,
 * webResults, exitCode, ...) isn't recoverable from a bare
 * { name, arguments, result-text } tuple, so callers only get the text back.
 */
function attachReconstructedOutput(detail: ToolCallDetail, outputText: string): ToolCallDetail {
  switch (detail.type) {
    case "shell":
      return { ...detail, output: outputText };
    case "read":
      return { ...detail, content: outputText };
    case "search":
      return { ...detail, content: outputText };
    case "fetch":
      return { ...detail, result: outputText };
    case "plain_text":
      return { ...detail, text: outputText };
    case "unknown":
      return { ...detail, output: outputText };
    default:
      return detail;
  }
}

/**
 * Reconstruct a tool_call timeline item from a persisted assistant tool call
 * plus its matching "tool" result message. Used to replay history on resume,
 * where the only surviving record is the raw chat-format conversation.
 */
function buildReconstructedToolCallItem(
  call: ToolCallPayload,
  resultMessage: Extract<ChatMessage, { role: "tool" }> | undefined,
  cwd: string,
): AgentTimelineItem {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    if (parsed && typeof parsed === "object") {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed persisted arguments shouldn't block reload — fall back to {}.
  }
  const baseDetail = buildCompatToolPreviewDetail(call.function.name, args, cwd);
  return {
    type: "tool_call",
    callId: call.id,
    name: call.function.name,
    detail: resultMessage
      ? attachReconstructedOutput(baseDetail, resultMessage.content)
      : baseDetail,
    // No matching "tool" result means the turn was interrupted before the
    // result came back (e.g. the app closed mid-call).
    status: resultMessage ? "completed" : "canceled",
    error: null,
  };
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
  /** Provider-level compaction defaults; per-agent feature values win. */
  compaction?: ProviderCompactionConfig | null;
  /** Max tool rounds per turn; undefined/null = the built-in default. */
  maxToolRounds?: number | null;
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

/**
 * Pull image attachments out of a structured prompt so they can ride along as
 * OpenAI-vision `image_url` parts. Non-image mime types are dropped — a `data:`
 * URL with a non-image type wouldn't be interpreted as an image by the server.
 */
function promptToImages(prompt: AgentPromptInput): PromptImage[] {
  if (typeof prompt === "string") {
    return [];
  }
  return prompt.flatMap((block) =>
    block.type === "image" && block.mimeType.startsWith("image/")
      ? [{ data: block.data, mimeType: block.mimeType }]
      : [],
  );
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

/** Restore persisted image attachments, dropping any malformed entries. */
function parsePromptImages(raw: unknown): PromptImage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry): PromptImage[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.data === "string" && typeof record.mimeType === "string") {
      return [{ data: record.data, mimeType: record.mimeType }];
    }
    return [];
  });
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
      const isCompactionSummary = record.isCompactionSummary === true;
      const images = parsePromptImages(record.images);
      return [
        {
          role,
          content,
          ...(messageId ? { messageId } : {}),
          ...(isCompactionSummary ? { isCompactionSummary: true } : {}),
          ...(images.length > 0 ? { images } : {}),
        },
      ];
    }
    if (role === "assistant") {
      const toolCalls = parseToolCallPayloads(record.tool_calls);
      const reasoning = typeof record.reasoning === "string" ? record.reasoning : undefined;
      return [
        {
          role,
          content,
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
      ];
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
    } else if (message.content || message.reasoning) {
      result.push({
        role: "assistant",
        content: message.content,
        ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      });
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
  private readonly compaction: ProviderCompactionConfig | null;
  private readonly maxToolRounds: number | null;
  private readonly managedProcesses: ManagedProcessRegistry | null;

  constructor(options: OpenAICompatAgentClientOptions) {
    this.provider = options.providerId;
    this.logger = options.logger;
    this.label = options.label;
    this.env = options.env;
    this.ottoToolGroups = options.ottoToolGroups ?? null;
    this.mcpServers = options.mcpServers ?? null;
    this.mcpToolPermissions = options.mcpToolPermissions ?? "always-ask";
    this.compaction = options.compaction ?? null;
    this.maxToolRounds = options.maxToolRounds ?? null;
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
        // Whether a given endpoint model honors reasoning_effort isn't
        // discoverable from /models, so every model advertises the full set
        // with "off" as the safe default (off omits the parameter entirely).
        thinkingOptions: [...OPENAI_COMPAT_THINKING_OPTIONS],
        defaultThinkingOptionId: OPENAI_COMPAT_DEFAULT_THINKING_OPTION_ID,
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
    const autoCompactDefault = resolveAutoCompactDefault(this.compaction);
    const hideAutoCompact = this.compaction?.hideSelector === true;
    return buildOpenAICompatFeatures({
      autoCompact: hideAutoCompact
        ? autoCompactDefault
        : normalizeOpenAICompatAutoCompact(
            config.featureValues?.["auto_compact"],
            autoCompactDefault,
          ),
      autoCompactDefault,
      hideAutoCompact,
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
      compaction: this.compaction,
      maxToolRounds: this.maxToolRounds,
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
      compaction: this.compaction,
      maxToolRounds: this.maxToolRounds,
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
  /** Reasoning/thinking text streamed in the current model round. */
  roundReasoning: string;
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
  /** Provider-level default for the auto_compact feature select. */
  private autoCompactDefault: OpenAICompatAutoCompact;
  /**
   * Provider config hides the per-agent auto_compact select: the feature is
   * omitted from `features` and persisted per-agent values are ignored, so
   * the provider default always applies.
   */
  private autoCompactHidden: boolean;
  /** Effective auto-compact setting: "off" or the trigger percentage. */
  private autoCompact: OpenAICompatAutoCompact;
  /**
   * Loop protection: set when an auto-compaction failed or couldn't bring
   * usage back under the threshold, so the next round doesn't immediately
   * retry. Cleared once measured usage drops below the threshold again
   * (rewind, manual /compact, model switch to a larger window).
   */
  private autoCompactDisarmed = false;
  /** Recent-conversation budget kept verbatim through compaction. */
  private keepRecentTokens: number;
  /** Resolved max model→tool→model rounds per turn (default or provider override). */
  private maxToolRounds: number;
  private activeTurn: ActiveTurn | null = null;
  /** Resolved context window for the active model; null until (or unless) discovered. */
  private contextWindowMaxTokens: number | null = null;
  /** Model the cached context window was resolved for; re-probe after a model switch. */
  private contextWindowProbedModel: string | null = null;
  /** Exact context size (prompt + completion tokens) measured by the server on the last round. */
  private lastContextTokens: number | null = null;
  /** Session config stored so the system prompt can be rebuilt after compaction. */
  private readonly config: AgentSessionConfig;

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
    compaction?: ProviderCompactionConfig | null;
    maxToolRounds?: number | null;
    managedProcesses?: ManagedProcessRegistry | null;
  }) {
    this.provider = options.providerId;
    this.label = options.label;
    this.env = options.env;
    this.logger = options.logger;
    this.id = options.sessionId;
    this.cwd = options.config.cwd;
    this.config = options.config;
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
    // Effort comes from the model-level thinking option like every other
    // provider. COMPAT(openaiCompatReasoningFeature): added in v0.4.5 — agents
    // created before the unification persisted the value as the
    // featureValues.reasoning_effort select instead; drop the fallback when
    // floor >= v0.4.5 (target 2027-01).
    this.reasoningEffort = normalizeOpenAICompatReasoningEffort(
      options.config.thinkingOptionId || options.config.featureValues?.["reasoning_effort"],
    );
    this.autoCompactDefault = resolveAutoCompactDefault(options.compaction);
    this.autoCompactHidden = options.compaction?.hideSelector === true;
    this.autoCompact = this.autoCompactHidden
      ? this.autoCompactDefault
      : normalizeOpenAICompatAutoCompact(
          options.config.featureValues?.["auto_compact"],
          this.autoCompactDefault,
        );
    this.keepRecentTokens = resolveKeepRecentTokens(options.compaction);
    this.maxToolRounds = resolveMaxToolRounds(options.maxToolRounds);

    // The system message is always rebuilt so cwd/mode/config changes take
    // effect on resume; restored copies of it are dropped first.
    this.messages = options.messages.filter((message) => message.role !== "system");
    this.messages.unshift({ role: "system", content: this.buildSystemPrompt(options.config) });

    this.rebuildEventHistory();
  }

  /**
   * Rebuild replayable history from the current conversation so a resumed or
   * rewound session still backfills its transcript, tool calls included.
   * There is no separate durable store for tool traffic — `this.messages` is
   * the only record that survives a resume, so tool_call items are
   * reconstructed from each assistant message's `tool_calls` plus the
   * matching "tool" result message. User messages keep their persisted
   * messageId so the durable timeline and the provider conversation agree on
   * rewind targets.
   */
  private rebuildEventHistory(): void {
    this.eventHistory.length = 0;
    for (const [index, message] of this.messages.entries()) {
      if (message.role === "user") {
        if (!message.content) continue;
        this.eventHistory.push({
          type: "timeline",
          provider: this.provider,
          item: {
            type: "user_message",
            text: message.content,
            messageId: message.messageId ?? randomUUID(),
          },
        });
        continue;
      }
      if (message.role !== "assistant") continue;
      // Live order within a round is reasoning → assistant text → tool calls;
      // replay mirrors it.
      if (message.reasoning) {
        this.eventHistory.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "reasoning", text: message.reasoning },
        });
      }
      if (message.content) {
        this.eventHistory.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "assistant_message", text: message.content, messageId: randomUUID() },
        });
      }
      for (const call of message.tool_calls ?? []) {
        const resultMessage = this.messages
          .slice(index + 1)
          .find(
            (candidate): candidate is Extract<ChatMessage, { role: "tool" }> =>
              candidate.role === "tool" && candidate.tool_call_id === call.id,
          );
        this.eventHistory.push({
          type: "timeline",
          provider: this.provider,
          item: buildReconstructedToolCallItem(call, resultMessage, this.cwd),
        });
      }
    }
  }

  get features(): AgentFeature[] {
    return buildOpenAICompatFeatures({
      autoCompact: this.autoCompact,
      autoCompactDefault: this.autoCompactDefault,
      hideAutoCompact: this.autoCompactHidden,
    });
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    // null clears back to the model default; "off" omits reasoning_effort
    // from requests entirely.
    if (thinkingOptionId === null) {
      this.reasoningEffort = OPENAI_COMPAT_DEFAULT_THINKING_OPTION_ID;
      return;
    }
    if (normalizeOpenAICompatReasoningEffort(thinkingOptionId) !== thinkingOptionId) {
      throw new Error(`Invalid effort option: ${String(thinkingOptionId)}`);
    }
    this.reasoningEffort = thinkingOptionId as OpenAICompatReasoningEffort;
  }

  async applyPersonality(update: AgentPersonalityUpdate): Promise<void> {
    this.config.personalitySnapshot = update.personalitySnapshot;
    this.config.systemPrompt = update.systemPrompt;
    this.config.daemonAppendSystemPrompt = update.daemonAppendSystemPrompt;
    // The daemon owns this conversation: the system prompt is just messages[0],
    // re-sent wholesale on every request, so rebuilding it in place applies the
    // new personality prompt from the very next turn — no session restart.
    const rebuilt = { role: "system" as const, content: this.buildSystemPrompt(this.config) };
    if (this.messages[0]?.role === "system") {
      this.messages[0] = rebuilt;
    } else {
      this.messages.unshift(rebuilt);
    }
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    // COMPAT(openaiCompatReasoningFeature): added in v0.4.5 — effort is no
    // longer advertised as a feature, but old clients may still send the
    // reasoning_effort select; drop when floor >= v0.4.5 (target 2027-01).
    if (featureId === "reasoning_effort") {
      if (normalizeOpenAICompatReasoningEffort(value) !== value) {
        throw new Error(`Invalid reasoning effort value: ${String(value)}`);
      }
      this.reasoningEffort = value as OpenAICompatReasoningEffort;
      return;
    }
    if (featureId === "auto_compact") {
      if (!OPENAI_COMPAT_AUTO_COMPACT_VALUES.includes(value as OpenAICompatAutoCompact)) {
        throw new Error(`Invalid auto-compact value: ${String(value)}`);
      }
      this.autoCompact = value as OpenAICompatAutoCompact;
      // A deliberate setting change is a fresh mandate — retry even if a
      // previous auto-compaction was paused for lack of gain.
      this.autoCompactDisarmed = false;
      return;
    }
    throw new Error(`Unknown feature: ${featureId}`);
  }

  /**
   * Live re-apply of provider-level compaction config so settings edits reach
   * running chats without a restart. Sessions still sitting on the old default
   * follow the new default; an explicit per-agent pick is kept unless the
   * selector is hidden, which always forces the default.
   */
  applyCompactionConfig(compaction: ProviderCompactionConfig | null): boolean {
    const previousDefault = this.autoCompactDefault;
    const previousHidden = this.autoCompactHidden;
    const previousValue = this.autoCompact;

    this.autoCompactDefault = resolveAutoCompactDefault(compaction);
    this.autoCompactHidden = compaction?.hideSelector === true;
    this.keepRecentTokens = resolveKeepRecentTokens(compaction);
    if (this.autoCompactHidden || previousValue === previousDefault) {
      this.autoCompact = this.autoCompactDefault;
    }
    if (this.autoCompact !== previousValue) {
      // Same fresh-mandate rule as setFeature: a deliberate settings change
      // re-arms a paused auto-compaction.
      this.autoCompactDisarmed = false;
    }
    return (
      this.autoCompact !== previousValue ||
      this.autoCompactHidden !== previousHidden ||
      this.autoCompactDefault !== previousDefault
    );
  }

  /**
   * Live re-apply of the provider-level max-tool-rounds override so a settings
   * edit reaches running chats without a restart. Takes effect on the next turn
   * (a turn already mid-loop keeps the bound it started with).
   */
  applyMaxToolRounds(maxToolRounds: number | null): boolean {
    const next = resolveMaxToolRounds(maxToolRounds);
    if (next === this.maxToolRounds) {
      return false;
    }
    this.maxToolRounds = next;
    return true;
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
        "- Read pages with browser_page_text (cheap reader-mode text); use browser_snapshot only when you need element refs to click or fill.",
        "- Tabs you open stay in the background. Call browser_focus_tab when you have something worth showing the user.",
      );
    }
    return lines.join("\n");
  }

  private availableToolSpecs(): CompatToolSpec[] {
    return COMPAT_TOOL_SPECS.filter((spec) => {
      // Read-only "plan" mode offers no actions against the local machine.
      // "network" tools (web_fetch) stay available for research but prompt.
      if (this.modeId === "plan" && spec.kind !== "read" && spec.kind !== "network") return false;
      // The builtin web tools (web_search/web_fetch) are gated by the "web"
      // tool group, just like the injected Otto tool groups.
      if (ottoToolGroupForName(spec.name) === "web" && !this.isOttoToolGroupEnabled(spec.name)) {
        return false;
      }
      return true;
    });
  }

  private toolNeedsApproval(spec: CompatToolSpec, args: Record<string, unknown>): boolean {
    if (spec.kind === "read") return false;
    if (this.modeId === "bypassPermissions") return false;
    if (this.modeId === "acceptEdits" && spec.kind === "edit") {
      // Auto-approval is scoped to the workspace: a write to ~/.bashrc or
      // Otto's own config is not the "file edits" the mode label promises,
      // so anything outside the cwd subtree still prompts.
      const target = args["path"];
      return typeof target !== "string" || !isPathInsideWorkspace(this.cwd, target);
    }
    // Everything else that can act — execute always, and network because an
    // unprompted web_fetch is an exfiltration channel for unprompted reads.
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

  /** Built-in slash commands plus MCP prompts from connected servers. */
  async listCommands(): Promise<AgentSlashCommand[]> {
    const commands: AgentSlashCommand[] = [COMPACT_COMMAND];
    if (!this.mcpManager) {
      return commands;
    }
    const prompts = await this.mcpManager.listPrompts();
    return commands.concat(
      prompts.map((prompt) => ({
        name: prompt.commandName,
        description: prompt.description ?? `MCP prompt from server '${prompt.serverName}'`,
        argumentHint: prompt.argumentNames.join(" "),
      })),
    );
  }

  /**
   * Handle `/compact [instruction]` by summarizing the older conversation
   * history while keeping the most recent slice verbatim, then splicing the
   * summary in ahead of the retained tail. Runs entirely in-process — no
   * external compaction service. Returns the turn's usage so the caller can
   * attach it to turn_completed.
   *
   * Pipeline (adapted from oh-my-pi's compaction design):
   *   1. Prune tool outputs (zero-LLM): elide uneventful results, truncate
   *      oversized older ones, protect the newest.
   *   2. Split at the keep-recent boundary: [system] + [older → summarize] +
   *      [recent → keep verbatim].
   *   3. Summarize the older region. If a prior compaction summary is present,
   *      merge into it (incremental update) instead of re-summarizing a summary.
   *   4. Rebuild: [system, summary, ...recent].
   */
  private async handleCompact(
    turn: ActiveTurn,
    instruction: string | null,
    trigger: "auto" | "manual",
  ): Promise<AgentUsage> {
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId: turn.turnId,
      item: { type: "compaction", status: "loading", trigger },
    });

    // Pre-compaction context size: prefer the server-measured figure from the
    // last round (what the context ring currently shows); fall back to a local
    // estimate of the full request payload.
    const preTokens = this.lastContextTokens ?? this.estimateFullContextTokens();

    // 1. Zero-LLM pruning first, so both the summary input and the retained
    //    tail are already free of noise and oversized old tool dumps.
    this.pruneToolOutputs();

    // 2. Split at the keep-recent boundary. keepFromIndex is the first message
    //    (after the system prompt at index 0) that stays verbatim.
    const keepFromIndex = this.computeCompactionKeepFromIndex();
    const summarizeRegion = this.messages.slice(1, keepFromIndex);
    const keptRegion = this.messages.slice(keepFromIndex);

    if (summarizeRegion.length === 0) {
      // Nothing old enough to summarize (conversation already within the
      // keep-recent budget). Report a no-op rather than summarizing nothing.
      const postTokens = this.estimateFullContextTokens();
      this.lastContextTokens = postTokens;
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: { type: "compaction", status: "completed", trigger, preTokens, postTokens },
      });
      const maxTokens = await this.resolveContextWindowMaxTokens();
      const usage: AgentUsage = {
        contextWindowUsedTokens: postTokens,
        ...(maxTokens !== null ? { contextWindowMaxTokens: maxTokens } : {}),
      };
      this.emit({ type: "usage_updated", provider: this.provider, usage, turnId: turn.turnId });
      return usage;
    }

    // 3. Incremental update when a prior summary sits in the region: feed it as
    //    <previous-summary> and merge the newer messages into it, rather than
    //    summarizing a summary (which degrades badly across repeated compacts).
    const priorSummaryIndex = summarizeRegion.findIndex(
      (message) => message.role === "user" && message.isCompactionSummary === true,
    );
    const priorSummary =
      priorSummaryIndex >= 0 ? summarizeRegion[priorSummaryIndex]!.content : null;
    const messagesToSummarize =
      priorSummaryIndex >= 0
        ? summarizeRegion.filter((_, index) => index !== priorSummaryIndex)
        : summarizeRegion;
    const conversationText = this.serializeConversationForCompaction(messagesToSummarize);

    const endpoint = resolveEndpoint(this.env, this.label);
    const model = await this.resolveModel(endpoint);

    const systemPrompt =
      priorSummary !== null
        ? this.buildCompactionUpdateSystemPrompt(instruction)
        : this.buildCompactionSystemPrompt(instruction);
    const userContent =
      priorSummary !== null
        ? `<previous-summary>\n${priorSummary}\n</previous-summary>\n\n<new-messages>\n${conversationText}\n</new-messages>`
        : conversationText;

    const summaryResult = await this.runCompactionCompletion({
      endpoint,
      model,
      systemPrompt,
      userContent,
      signal: turn.abort.signal,
    });
    const summary = summaryResult.content;

    // 4. Rebuild: system + summary (marked for future incremental updates) +
    //    the retained recent tail, untouched.
    this.messages.length = 0;
    this.messages.push({ role: "system", content: this.buildSystemPrompt(this.config) });
    this.messages.push({
      role: "user",
      content: summary,
      messageId: randomUUID(),
      isCompactionSummary: true,
    });
    // Assistant ack keeps the roles alternating so the next user turn doesn't
    // sit directly after the synthetic summary user message.
    this.messages.push({ role: "assistant", content: "Conversation history has been compacted." });
    this.messages.push(...keptRegion);

    // Post-compaction context size. Must count the rebuilt system prompt and
    // the tool schemas — both are re-sent with every request — or the ring
    // reads near-zero here and jumps back up on the next real turn.
    const postTokens = this.estimateFullContextTokens();
    this.lastContextTokens = postTokens;

    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId: turn.turnId,
      item: {
        type: "compaction",
        status: "completed",
        trigger,
        preTokens,
        postTokens,
      },
    });

    // usage_updated replaces agent.lastUsage wholesale and the client hides
    // the context ring unless both bounds are present, so the compaction
    // usage must carry the post-compaction context size alongside the
    // request's own token cost.
    const maxTokens = await this.resolveContextWindowMaxTokens();
    const usageData = summaryResult.usage;
    const usage: AgentUsage = {
      ...(typeof usageData?.prompt_tokens === "number"
        ? { inputTokens: usageData.prompt_tokens }
        : {}),
      ...(typeof usageData?.completion_tokens === "number"
        ? { outputTokens: usageData.completion_tokens }
        : {}),
      contextWindowUsedTokens: postTokens,
      ...(maxTokens !== null ? { contextWindowMaxTokens: maxTokens } : {}),
    };
    this.emit({
      type: "usage_updated",
      provider: this.provider,
      usage,
      turnId: turn.turnId,
    });
    return usage;
  }

  /**
   * Auto-compaction check, run at turn start (before the new user message
   * joins the conversation, so it always survives verbatim) and before every
   * subsequent model round. Uses the freshest server-measured context size —
   * the active turn's last round, falling back to the previous turn's final
   * figure. Endpoints that report no context length never auto-compact:
   * without a denominator there is no percentage (manual /compact still
   * works).
   *
   * Loop protection: a compaction that fails or can't bring usage back under
   * the threshold disarms the trigger. Without that, a conversation whose
   * retained tail alone exceeds the threshold would re-summarize on every
   * round, burning a model call each time for no reclaimed space. The trigger
   * re-arms once measured usage drops below the threshold by other means
   * (rewind, manual /compact, a model switch to a larger window) or when the
   * user changes the auto-compact setting.
   *
   * Auto-compaction failures never fail the user's turn — the turn proceeds
   * with the uncompacted conversation (interrupts still propagate).
   */
  private async maybeAutoCompact(turn: ActiveTurn): Promise<void> {
    if (this.autoCompact === "off") {
      return;
    }
    const maxTokens = await this.resolveContextWindowMaxTokens();
    if (maxTokens === null) {
      return;
    }
    const threshold = Math.floor((Number(this.autoCompact) / 100) * maxTokens);
    const used =
      turn.usage && typeof turn.usage.inputTokens === "number"
        ? turn.usage.inputTokens + (turn.usage.outputTokens ?? 0)
        : this.lastContextTokens;
    if (used === null || used < threshold) {
      if (used !== null) {
        this.autoCompactDisarmed = false;
      }
      return;
    }
    if (this.autoCompactDisarmed) {
      return;
    }
    let usage: AgentUsage;
    try {
      usage = await this.handleCompact(turn, null, "auto");
    } catch (error) {
      // Settle the "loading" compaction row before deciding how to proceed.
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: { type: "compaction", status: "failed", trigger: "auto" },
      });
      if (turn.abort.signal.aborted) {
        throw error;
      }
      this.autoCompactDisarmed = true;
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: {
          type: "error",
          message: `Auto-compaction failed: ${message}. Auto-compaction is paused until context usage drops below the threshold — run /compact to retry manually.`,
        },
      });
      return;
    }
    // The pre-compaction round figures no longer describe the conversation;
    // the next round's stream re-measures it.
    turn.usage = null;
    const postTokens = usage.contextWindowUsedTokens ?? this.lastContextTokens;
    if (typeof postTokens === "number" && postTokens >= threshold) {
      this.autoCompactDisarmed = true;
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId: turn.turnId,
        item: {
          type: "error",
          message:
            `Auto-compaction reclaimed too little space (still ~${postTokens} of ` +
            `${maxTokens} tokens). Auto-compaction is paused until usage ` +
            `drops below the ${this.autoCompact}% threshold — run /compact with an ` +
            `instruction, rewind, or start a fresh agent.`,
        },
      });
    }
  }

  /**
   * Pre-summarization pruning (zero-LLM). Mutates the message array in place:
   * elides uneventful tool results everywhere, then truncates oversized tool
   * results older than the protected-recent window to head + tail. Structure is
   * never changed (only tool `content`), so tool_call ordering stays valid.
   */
  private pruneToolOutputs(): void {
    for (const message of this.messages) {
      if (message.role === "tool" && isUneventfulToolResult(message.content)) {
        message.content = UNEVENTFUL_RESULT_PLACEHOLDER;
      }
    }
    // Walk tool results newest → oldest; protect the freshest by token budget,
    // truncate the rest.
    let protectedTokens = 0;
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index]!;
      if (message.role !== "tool") {
        continue;
      }
      const tokens = estimateTokens(message.content);
      if (protectedTokens < PRUNE_PROTECT_RECENT_TOOL_TOKENS) {
        protectedTokens += tokens;
        continue;
      }
      if (message.content.length > PRUNE_TOOL_RESULT_MIN_CHARS) {
        const { content } = message;
        message.content = `${content.slice(0, PRUNE_TOOL_RESULT_HEAD_CHARS)}\n[... ${
          content.length - PRUNE_TOOL_RESULT_HEAD_CHARS - PRUNE_TOOL_RESULT_TAIL_CHARS
        } chars pruned ...]\n${content.slice(-PRUNE_TOOL_RESULT_TAIL_CHARS)}`;
      }
    }
  }

  /**
   * Index of the first message (after the system prompt at 0) to keep verbatim
   * through compaction: walk newest → oldest accumulating token estimates until
   * the keep-recent budget is exceeded, then advance past any leading tool
   * results so the retained tail never starts with a tool message orphaned from
   * its assistant tool_calls. Returns messages.length when the whole
   * conversation is older than the budget (summarize everything, keep none).
   */
  private computeCompactionKeepFromIndex(): number {
    let keepFrom = this.messages.length;
    let recentTokens = 0;
    for (let index = this.messages.length - 1; index >= 1; index -= 1) {
      recentTokens += estimateTokens(JSON.stringify(this.messages[index]));
      if (recentTokens > this.keepRecentTokens) {
        break;
      }
      keepFrom = index;
    }
    // Never keep the entire conversation: a manual /compact should always
    // compress something, so a conversation within the budget summarizes fully.
    if (keepFrom <= 1) {
      return this.messages.length;
    }
    // Don't strand tool results at the head of the retained tail.
    while (keepFrom < this.messages.length && this.messages[keepFrom]!.role === "tool") {
      keepFrom += 1;
    }
    return keepFrom;
  }

  /**
   * POST a non-streaming chat completion for compaction and return the assistant
   * text plus raw usage. Throws on transport failure or an empty response.
   */
  private async runCompactionCompletion(options: {
    endpoint: ResolvedEndpoint;
    model: string;
    systemPrompt: string;
    userContent: string;
    signal: AbortSignal;
  }): Promise<{ content: string; usage?: Record<string, unknown> }> {
    const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(options.endpoint),
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userContent },
        ],
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

    const data = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== "object") {
      throw new Error(`${this.label} returned an empty compaction response`);
    }
    const responseMessage = (firstChoice as Record<string, unknown>).message;
    if (!responseMessage || typeof responseMessage !== "object") {
      throw new Error(`${this.label} returned an empty compaction response`);
    }
    const rawContent = (responseMessage as Record<string, unknown>).content;
    const content = typeof rawContent === "string" ? rawContent : "";
    if (!content) {
      throw new Error(`${this.label} returned an empty compaction summary`);
    }
    const usage =
      data.usage && typeof data.usage === "object"
        ? (data.usage as Record<string, unknown>)
        : undefined;
    return { content, ...(usage ? { usage } : {}) };
  }

  /**
   * Local estimate of the full next-request context: conversation messages
   * (including the system prompt) plus the tool schemas that are re-sent with
   * every request. Char-based, so it's approximate — the next real turn's
   * server-measured usage replaces it.
   */
  private estimateFullContextTokens(): number {
    const toolsPayload = [
      ...buildOpenAIToolsPayload(this.availableToolSpecs()),
      ...this.buildOttoToolPayload(),
      ...this.buildMcpToolPayload(),
    ];
    return (
      estimateTokens(JSON.stringify(toolsPayload)) +
      this.messages.reduce((sum, message) => sum + estimateTokens(JSON.stringify(message)), 0)
    );
  }

  /**
   * Serialize the given conversation messages into a text blob suitable for a
   * compaction prompt. Tool calls are summarized rather than included verbatim
   * to keep the payload manageable.
   */
  private serializeConversationForCompaction(messages: ChatMessage[]): string {
    const lines: string[] = [];
    const conversationMessages = messages.filter((message) => message.role !== "system");

    for (const message of conversationMessages) {
      if (message.role === "user") {
        lines.push(`[user]: ${message.content}`);
      } else if (message.role === "assistant") {
        if (message.tool_calls && message.tool_calls.length > 0) {
          const toolSummaries = message.tool_calls
            .map((call) => {
              let argsPreview = "";
              try {
                const parsed = JSON.parse(call.function.arguments);
                argsPreview = ` (${JSON.stringify(parsed).slice(0, 500)})`;
              } catch {
                argsPreview = ` (${call.function.arguments.slice(0, 500)})`;
              }
              return `  - called ${call.function.name}${argsPreview}`;
            })
            .join("\n");
          lines.push(`[assistant]: (tool calls)`);
          lines.push(toolSummaries);
          if (message.content) {
            lines.push(`  text: ${message.content}`);
          }
        } else {
          lines.push(`[assistant]: ${message.content}`);
        }
      } else if (message.role === "tool") {
        // Keep head + tail of large results: file reads and command output
        // carry their signal at both ends, and the summarizer can't preserve
        // what it never sees.
        const content = message.content;
        const contentPreview =
          content.length > TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS
            ? `${content.slice(0, TOOL_RESULT_HEAD_CHARS)}\n[... ${
                content.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS
              } chars truncated ...]\n${content.slice(-TOOL_RESULT_TAIL_CHARS)}`
            : content;
        lines.push(`[tool result ${message.tool_call_id}]: ${contentPreview}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * System prompt for a fresh compaction summary. The older conversation is
   * summarized while recent messages are kept verbatim, so this summary becomes
   * the model's memory of the distant past — it must preserve exact references,
   * not paraphrase them away. Modeled on oh-my-pi's structured handoff format.
   */
  private buildCompactionSystemPrompt(instruction: string | null): string {
    const base = `You summarize a coding-agent conversation into a structured handoff summary so another LLM can resume the task. Only the older part of the conversation is being summarized; recent messages are retained verbatim after your summary. Preserve detail — a thorough summary is expected. Do NOT aim for brevity.

NEVER continue the conversation. NEVER answer questions found in it. Output ONLY the structured summary below.

If the conversation ends with an unanswered question or a request awaiting a response (e.g. "run this and paste the output"), you MUST preserve that exact question/request under Critical Context.

Use this format (omit a section only if it truly does not apply):

## Goal
[The user's goals; list multiple if the session covers different tasks.]

## Constraints & Preferences
- [Requirements, constraints, and preferences the user stated]

## Progress
### Done
- [x] [Completed changes/tasks]
### In Progress
- [ ] [Work underway when compaction ran]
### Blocked
- [Anything preventing progress]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Files & Changes
- [Exact path — what was read/created/modified and why it matters; include the important code snippets verbatim]

## Next Steps
1. [Ordered next actions, aligned with the user's most recent request]

## Critical Context
- [Important data, exact error messages, repository state (branch, uncommitted changes), and any pending question awaiting a user response]

## Additional Notes
[Anything important not captured above]

You MUST preserve exact file paths, function names, error messages, and relevant tool outputs or command results.`;

    const instructionPart = instruction
      ? `\n\nAdditional user instruction — follow it for emphasis and focus, on top of the format above:\n<user-instruction>${instruction}</user-instruction>`
      : "";

    return base + instructionPart;
  }

  /**
   * System prompt for an incremental compaction: merge newer messages into an
   * existing summary rather than re-summarizing a summary (which degrades fast
   * across repeated compacts). The prior summary arrives in <previous-summary>
   * tags and the newer messages in <new-messages> tags.
   */
  private buildCompactionUpdateSystemPrompt(instruction: string | null): string {
    const base = `You update an existing structured handoff summary by incorporating newer conversation messages, so another LLM can resume the task. The prior summary is in <previous-summary> tags; the newer messages are in <new-messages> tags.

NEVER continue the conversation. NEVER answer questions found in it. Output ONLY the updated structured summary.

Rules:
- Preserve ALL information from the previous summary that is still relevant.
- Fold in new progress, decisions, files, and context from the newer messages.
- Move items from "In Progress" to "Done" when completed; update "Next Steps".
- You MAY drop anything the newer messages made irrelevant.
- If the newer messages end with an unanswered question or a request awaiting a response, record it under Critical Context (replacing a prior pending question once answered).
- You MUST preserve exact file paths, function names, error messages, and relevant tool outputs or command results.

Keep the same section format as the previous summary (## Goal, ## Constraints & Preferences, ## Progress with Done/In Progress/Blocked, ## Key Decisions, ## Files & Changes, ## Next Steps, ## Critical Context, ## Additional Notes).`;

    const instructionPart = instruction
      ? `\n\nAdditional user instruction — follow it for emphasis and focus:\n<user-instruction>${instruction}</user-instruction>`
      : "";

    return base + instructionPart;
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
      roundReasoning: "",
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
    const promptImages = promptToImages(prompt);
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

    void this.executeTurn(turn, promptText, userMessageId, promptImages);
    return { turnId };
  }

  private async executeTurn(
    turn: ActiveTurn,
    promptText: string,
    userMessageId: string,
    promptImages: PromptImage[],
  ): Promise<void> {
    this.emit({ type: "turn_started", provider: this.provider, turnId: turn.turnId });

    // Intercept built-in slash commands before delegating to the model.
    const slashCommand = parseSlashCommandInput(promptText);
    if (slashCommand && slashCommand.commandName === "compact") {
      let usage: AgentUsage;
      try {
        usage = await this.handleCompact(turn, slashCommand.args, "manual");
      } catch (error) {
        // Settle the "loading" compaction row — without this it spins
        // forever. Clients that predate the "failed" status drop this event
        // and keep the spinning row, which matches their pre-fix behavior.
        this.emit({
          type: "timeline",
          provider: this.provider,
          turnId: turn.turnId,
          item: { type: "compaction", status: "failed", trigger: "manual" },
        });
        this.settleTurnFailure(turn, error);
        return;
      }
      if (this.activeTurn !== turn) {
        return;
      }
      this.activeTurn = null;
      // turn_completed is the manager's terminal signal — without it the
      // foreground turn stream never ends and the agent stays "running".
      this.emit({
        type: "turn_completed",
        provider: this.provider,
        turnId: turn.turnId,
        usage,
      });
      turn.resolve({
        sessionId: this.id,
        finalText: "",
        usage,
        timeline: [],
        canceled: false,
      });
      return;
    }

    try {
      await this.ensureMcpReady(turn);
      // The timeline keeps the typed `/command args` text; the model receives
      // the resolved MCP prompt (or the raw text when nothing matches).
      const modelText = await this.resolveMcpPromptText(promptText);
      // Turn-start auto-compaction runs before the new user message joins the
      // conversation: when the whole history is summarized ("never keep the
      // entire conversation"), the instruction the model is about to act on
      // must not be folded into the summary with it.
      await this.maybeAutoCompact(turn);
      this.messages.push({
        role: "user",
        content: modelText,
        messageId: userMessageId,
        ...(promptImages.length > 0 ? { images: promptImages } : {}),
      });
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
    // Warm the context-window cache before streaming: emitStreamUsageUpdated
    // runs on the hot chunk path and can only read the cached value, and a
    // usage_updated without contextWindowMaxTokens blanks the client's
    // context ring (agent.lastUsage is replaced wholesale, and the ring
    // needs both bounds). Cached per model, so this is one probe per session.
    await this.resolveContextWindowMaxTokens();
    for (let round = 0; round < this.maxToolRounds; round += 1) {
      // Round 0 was already checked at turn start; re-check between tool
      // rounds so a long tool loop compacts mid-turn instead of overflowing.
      if (round > 0) {
        await this.maybeAutoCompact(turn);
      }
      await this.streamCompletion(turn);

      const toolCalls = [...turn.pendingToolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
      if (turn.roundText || turn.roundReasoning || toolCalls.length > 0) {
        this.messages.push({
          role: "assistant",
          content: turn.roundText,
          ...(turn.roundReasoning ? { reasoning: turn.roundReasoning } : {}),
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
      }
      // Consumed — settleTurnFailure must not re-append these if a later
      // tool round gets interrupted.
      turn.roundText = "";
      turn.roundReasoning = "";

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
        message: `Stopped after ${this.maxToolRounds} tool rounds without a final answer.`,
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

    if (this.toolNeedsApproval(spec, args)) {
      const response = await this.requestPermission(turn, {
        name: spec.name,
        title: spec.name,
        description: COMPAT_TOOL_PROMPT_DESCRIPTIONS[spec.kind],
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
    turn.roundReasoning = "";
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
      turn.roundReasoning += delta.reasoning;
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
      this.emitStreamUsageUpdated(turn);
    }
  }

  /**
   * Emit a usage_updated event so the agent manager updates agent.lastUsage
   * and pushes the context usage to the client immediately, rather than
   * waiting for turn_completed at the end of the entire tool loop.
   *
   * resolveContextWindowMaxTokens() is async (it may probe the endpoint) and
   * this runs on the hot streaming path, so only the already-cached value is
   * included. The event is always emitted regardless — the client and agent
   * manager handle partial usage snapshots correctly.
   */
  private emitStreamUsageUpdated(turn: ActiveTurn): void {
    if (!turn.usage || typeof turn.usage.inputTokens !== "number") {
      return;
    }
    const usage: AgentUsage = {
      ...turn.usage,
      contextWindowUsedTokens: turn.usage.inputTokens + (turn.usage.outputTokens ?? 0),
    };
    if (this.contextWindowMaxTokens !== null) {
      usage.contextWindowMaxTokens = this.contextWindowMaxTokens;
    }
    this.emit({
      type: "usage_updated",
      provider: this.provider,
      usage,
      turnId: turn.turnId,
    });
  }

  /**
   * A turn can end (interrupt or failure) between an assistant message's
   * tool_calls and their tool results — e.g. the user interrupts during call
   * #1 of 3. Strict OpenAI-compatible servers reject the next request over
   * such a conversation with a 400, so append synthetic results for the
   * unanswered calls. Resume gets the equivalent repair from
   * sanitizeRestoredMessages; this covers the live conversation.
   */
  private repairDanglingToolCalls(): void {
    // Only the trailing round can dangle: earlier rounds pushed all their
    // results before the loop moved on.
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index]!;
      if (message.role === "user") {
        return;
      }
      if (message.role !== "assistant" || !message.tool_calls) {
        continue;
      }
      const answered = new Set(
        this.messages
          .slice(index + 1)
          .flatMap((candidate) => (candidate.role === "tool" ? [candidate.tool_call_id] : [])),
      );
      for (const call of message.tool_calls) {
        if (!answered.has(call.id)) {
          this.messages.push({
            role: "tool",
            content: "[Tool call was interrupted before it completed]",
            tool_call_id: call.id,
          });
        }
      }
      return;
    }
  }

  private settleTurnFailure(turn: ActiveTurn, error: unknown): void {
    if (this.activeTurn !== turn) {
      return;
    }
    this.activeTurn = null;
    this.failPendingPermissions();
    this.repairDanglingToolCalls();
    if (turn.abort.signal.aborted) {
      this.emit({
        type: "turn_canceled",
        provider: this.provider,
        reason: "Interrupted",
        turnId: turn.turnId,
      });
      if (turn.roundText || turn.roundReasoning) {
        if (turn.roundText) {
          turn.finalTextParts.push(turn.roundText);
        }
        this.messages.push({
          role: "assistant",
          content: turn.roundText,
          ...(turn.roundReasoning ? { reasoning: turn.roundReasoning } : {}),
        });
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
        messages: this.messages,
      },
    };
  }

  async setModel(modelId: string | null): Promise<void> {
    this.modelId = modelId;
  }

  /**
   * Rewind the daemon-owned conversation to just before the given user
   * message. The full conversation persists (no message cap), so any
   * previous user message is a valid rewind target — the not-found error
   * below only fires for a truly unknown messageId.
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

  /**
   * Retain what streamHistory replays: user messages, assistant messages
   * (coalesced per messageId so streamed deltas don't accumulate one event
   * each), reasoning (coalesced per contiguous block), and tool calls
   * (coalesced per callId so a call's running → completed/failed/canceled
   * transitions collapse to its latest status instead of replaying every
   * intermediate state). Usage and permission events aren't part of the
   * displayed transcript and are dropped. Copies are stored so coalescing
   * never mutates an event a listener already received.
   */
  private retainForHistory(event: AgentStreamEvent): void {
    if (event.type !== "timeline") {
      return;
    }
    const item = event.item;
    if (item.type === "user_message") {
      this.eventHistory.push({ ...event, item: { ...item } });
      return;
    }
    if (item.type === "tool_call") {
      const existingIdx = this.eventHistory.findIndex(
        (candidate) =>
          candidate.type === "timeline" &&
          candidate.item.type === "tool_call" &&
          candidate.item.callId === item.callId,
      );
      const copy = { ...event, item: { ...item } };
      if (existingIdx >= 0) {
        this.eventHistory[existingIdx] = copy;
      } else {
        this.eventHistory.push(copy);
      }
      return;
    }
    if (item.type === "reasoning") {
      // Reasoning deltas stream contiguously within a round, so appending to
      // a trailing reasoning event coalesces one block per round; assistant
      // text or a tool call in between starts the next block naturally.
      const last = this.eventHistory[this.eventHistory.length - 1];
      if (last?.type === "timeline" && last.item.type === "reasoning") {
        last.item.text += item.text;
        return;
      }
      this.eventHistory.push({ ...event, item: { ...item } });
      return;
    }
    if (item.type !== "assistant_message") {
      return;
    }
    const last = this.eventHistory[this.eventHistory.length - 1];
    if (
      last?.type === "timeline" &&
      last.item.type === "assistant_message" &&
      last.item.messageId === item.messageId
    ) {
      last.item.text += item.text;
      return;
    }
    this.eventHistory.push({ ...event, item: { ...item } });
  }

  private emit(event: AgentStreamEvent): void {
    this.retainForHistory(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger?.warn({ err: error }, "OpenAI-compatible listener failed");
      }
    }
  }
}
