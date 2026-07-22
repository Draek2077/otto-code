import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promises } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AgentDefinition,
  type CanUseTool,
  type McpServerConfig as ClaudeSdkMcpServerConfig,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import {
  mapClaudeCanceledToolCall,
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "./tool-call-mapper.js";
import {
  mapTaskNotificationSystemRecordToToolCall,
  mapTaskNotificationUserContentToToolCall,
} from "./task-notification-tool-call.js";
import {
  findClaudeModel,
  getClaudeModelsWithSettings,
  normalizeClaudeRuntimeModelId,
} from "./models.js";
import {
  CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  claudeManifestModelAutoModeSupport,
} from "./model-manifest.js";
import { deniedToolsForAccess, resolveWorkspaceAccess } from "../../workspace-access.js";
import { parsePartialJsonObject } from "./partial-json.js";
import { ClaudeSidechainTracker } from "./sidechain-tracker.js";
import { buildClaudeFeatures, claudeModelSupportsFastMode } from "./feature-definitions.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
} from "../diagnostic-utils.js";
import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "../provider-runner.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import { claudeQuery, type ClaudeOptions, type ClaudeQueryFactory } from "./query.js";
import { realClaudeRewindSdk, revertClaudeConversation, revertClaudeFiles } from "./rewind.js";
import { normalizeProviderReplayTimestamp } from "../../provider-history-timestamps.js";
import { SubagentUsageAccumulator, grandTotalTokens } from "../../subagent-usage.js";

import { claudeProjectDirSync } from "./project-dir.js";
import { readClaudeModelUsageSlices, verifyClaudeTreePricing } from "./claude-pricing.js";
import { readUsageTotals, toClaudeSubagentUsage } from "./claude-subagent-usage.js";
import { WorkflowTranscriptWatcher } from "./workflow-transcript-watcher.js";
import {
  TaskTranscriptWatcher,
  readClaudeSubagentAgentIdFromToolResult,
} from "./task-transcript-watcher.js";
import { SETTING_APPLIES_NEXT_TURN_NOTICE } from "../../provider-notices.js";
import {
  isProviderImageMarkdown,
  materializeProviderImage,
  renderProviderImageOutputAsAssistantMarkdown,
  type ProviderImageOutput,
} from "../provider-image-output.js";

import {
  getAgentStreamEventTurnId,
  type AgentBareCompletionOptions,
  type AgentBareCompletionResult,
  type AgentPermissionAction,
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentContextUsage,
  type AgentBehaviorSettings,
  type AgentCreateSessionOptions,
  type AgentFeature,
  type AgentLaunchContext,
  type AgentMetadata,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionRequestKind,
  type AgentPermissionResponse,
  type AgentPermissionUpdate,
  type AgentPersistenceHandle,
  type AgentPersonalityUpdate,
  type AgentProviderNotice,
  type AgentPromptInput,
  type AgentRateLimitInfo,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentSession,
  type AgentSessionConfig,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type AgentUsage,
  type AgentRuntimeInfo,
  type FetchCatalogOptions,
  type ImportableProviderSession,
  type ImportProviderSessionContext,
  type ImportProviderSessionInput,
  type ListImportableSessionsOptions,
  type McpServerConfig,
  type ProviderCatalog,
  type ResolveAgentCreateConfigInput,
  type ResolveAgentCreateConfigResult,
} from "../../agent-sdk-types.js";
import { resolveDefaultAgentCreateConfig } from "../../create-agent-mode.js";
import { importSessionFromPersistence } from "../../provider-session-import.js";
import {
  checkProviderLaunchAvailable,
  createProviderEnv,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
  type ResolvedProviderLaunch,
} from "../../provider-launch-config.js";
import { withTimeout } from "../../../../utils/promise-timeout.js";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import { execCommand } from "../../../../utils/spawn.js";
import { composeSystemPromptParts } from "../../system-prompt.js";

const fsPromises = promises;
const CLAUDE_SETTING_SOURCES: NonNullable<ClaudeOptions["settingSources"]> = [
  "user",
  "project",
  "local",
];

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeClaudeAskUserQuestionRequestInput(
  toolName: string,
  input: AgentMetadata,
): AgentMetadata {
  if (toolName !== "AskUserQuestion" || !Array.isArray(input.questions)) {
    return input;
  }

  // Claude Code's AskUserQuestion schema says "Other" is host-provided, not a
  // model-supplied option. Otto's shared question UI uses allowOther for that
  // freeform answer path.
  return {
    ...input,
    questions: input.questions.map((item) => {
      if (!isMetadata(item)) {
        return item;
      }
      return {
        ...item,
        allowOther: true,
      };
    }),
  };
}

function stripClaudeAskUserQuestionUiMetadata(input: AgentMetadata): AgentMetadata {
  if (!Array.isArray(input.questions)) {
    return input;
  }

  return {
    ...input,
    questions: input.questions.map((item) => {
      if (!isMetadata(item) || !("allowOther" in item)) {
        return item;
      }
      const itemForClaude: AgentMetadata = { ...item };
      delete itemForClaude.allowOther;
      return itemForClaude;
    }),
  };
}

export function normalizeClaudeAskUserQuestionUpdatedInput(
  updatedInput: AgentMetadata | undefined,
  fallbackInput: AgentMetadata | undefined,
): AgentMetadata {
  const fallback = isMetadata(fallbackInput) ? fallbackInput : {};
  const base = isMetadata(updatedInput) ? updatedInput : {};
  // Otto's shared question UI serializes answers by question header, but Claude's
  // AskUserQuestion tool expects answer keys to match the full question text. Merge
  // the original request payload back in so provider callbacks that only return
  // `{ answers }` still satisfy Claude's full tool input schema.
  const merged = stripClaudeAskUserQuestionUiMetadata({ ...fallback, ...base });
  const questions =
    (Array.isArray(base.questions) ? base.questions : null) ??
    (Array.isArray(fallback.questions) ? fallback.questions : null);
  const answers = isMetadata(base.answers) ? base.answers : null;

  if (!questions || !answers) {
    return merged;
  }

  const normalizedAnswers: Record<string, string> = {};
  for (const item of questions) {
    const question = isMetadata(item) ? item : null;
    if (!question) {
      continue;
    }

    const questionText = readNonEmptyString(question.question);
    if (!questionText) {
      continue;
    }

    const header = readNonEmptyString(question.header);
    const answer =
      readNonEmptyString(answers[questionText]) ??
      (header ? readNonEmptyString(answers[header]) : null);
    if (answer) {
      normalizedAnswers[questionText] = answer;
    }
  }

  if (Object.keys(normalizedAnswers).length === 0) {
    return merged;
  }

  return {
    ...merged,
    answers: normalizedAnswers,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isImageMimeType(
  value: string,
): value is "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  return (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/gif" ||
    value === "image/webp"
  );
}

type TurnState = "idle" | "foreground" | "autonomous";

interface EventIdentifiers {
  taskId: string | null;
  parentMessageId: string | null;
  messageId: string | null;
}

interface AutonomousTurnState {
  id: string;
}

interface AsyncMessageInput<T> {
  push: (item: T) => void;
  end: () => void;
  iterable: AsyncIterable<T>;
}

interface PersistedTimelineEntry {
  item: AgentTimelineItem;
  timestamp?: string;
}

interface ClaudeRewindTurnAnchor {
  userMessageId: string;
  assistantMessageId: string | null;
}

type ClaudeConversationRewindTarget =
  | { kind: "fresh-session" }
  | { kind: "fork"; messageId: string };

const CLAUDE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: true,
  supportsRewindBoth: true,
  // Enforced in applyWorkspaceAccess: the level's denied tools are added to
  // disallowedTools and stripped from allowedTools at every option build.
  supportsWorkspaceAccess: true,
};

const DEFAULT_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission the first time a tool is used",
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description: "Automatically approves edit-focused tools without prompting",
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Analyze the codebase without executing tools or edits",
  },
  {
    id: "auto",
    label: "Auto mode",
    description: "Uses a model classifier to review permission prompts automatically",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    // Guardrail-bearing description (same principle as preview tools): the mode
    // never prompts, but anything not covered by a permission allow-rule is
    // DENIED rather than run. This is the default unattended target — listed
    // before bypassPermissions so resolveDefaultAgentCreateConfig picks it as
    // the coercion target for schedules/loops/artifacts.
    description: "Runs without prompting — actions not pre-approved are denied",
    isUnattended: true,
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
    isUnattended: true,
  },
];

const VALID_CLAUDE_MODES = new Set(DEFAULT_MODES.map((mode) => mode.id));

const REWIND_COMMAND_NAME = "rewind";
const REWIND_COMMAND: AgentSlashCommand = {
  name: REWIND_COMMAND_NAME,
  description: "Rewind tracked files to a previous user message",
  argumentHint: "[user_message_uuid]",
};
const CLAUDE_ROOT_ONLY_COMMANDS = new Set([
  "clear",
  "compact",
  "context",
  "debug",
  "extra-usage",
  "heapdump",
  "init",
  "loop",
  "schedule",
  "usage",
]);
const INTERRUPT_TOOL_USE_PLACEHOLDER = "[Request interrupted by user for tool use]";
const INTERRUPT_PLACEHOLDER_PATTERN = /^\[Request interrupted by user(?:[^\]]*)\]$/;
const NO_RESPONSE_REQUESTED_PLACEHOLDER = "No response requested.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * True for the SDK errors raised when a control-plane call (interrupt/return)
 * is issued against a CLI process that has already exited or been aborted.
 * These are expected during session teardown, not real failures.
 */
export function isExpectedTransportTeardownError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  return (
    message.includes("is not ready for writing") ||
    message.includes("Operation aborted") ||
    message.includes("process aborted by user")
  );
}

interface SlashCommandInvocation {
  commandName: string;
  args?: string;
  rawInput: string;
}

function classifyClaudeSlashCommand(commandName: string): AgentSlashCommand["kind"] {
  // Claude exposes commands and skills as one flat SDK list, without structured source
  // metadata. Keep obvious root-only/session controls out of inline autocomplete and
  // treat the rest as skills; the worst failure mode is an inert inline suggestion.
  return CLAUDE_ROOT_ONLY_COMMANDS.has(commandName) ? "command" : "skill";
}

type ClaudeAgentConfig = AgentSessionConfig & { provider: "claude" };

export interface ClaudeContentChunk {
  type: string;
  [key: string]: unknown;
}

interface ClaudeAgentClientOptions {
  defaults?: { agents?: Record<string, AgentDefinition> };
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  queryFactory?: ClaudeQueryFactory;
  resolveBinary?: () => Promise<string>;
  configDir?: string;
}

interface ClaudeAgentSessionOptions {
  defaults?: { agents?: Record<string, AgentDefinition> };
  runtimeSettings?: ProviderRuntimeSettings;
  handle?: AgentPersistenceHandle;
  agentId?: string;
  launchEnv?: Record<string, string>;
  persistSession?: boolean;
  logger: Logger;
  queryFactory?: ClaudeQueryFactory;
  resolveBinary: () => Promise<string>;
  // Resolved daemon-wide behavior toggles for this launch (undefined = old
  // manager / not provided → treat as all-on). Claude consumes promptSuggestions
  // and agentProgressSummaries; notifyOnFinishDefault is an Otto-tools concern.
  agentBehaviors?: AgentBehaviorSettings;
}

type ClaudeThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";
type ClaudeThinkingOption = ClaudeThinkingEffort | typeof CLAUDE_ULTRACODE_THINKING_OPTION_ID;

function resolvePathEnvKey(): "Path" | "PATH" | null {
  if (process.env["Path"] !== undefined) return "Path";
  if (process.env["PATH"] !== undefined) return "PATH";
  return null;
}

function errorToMessageString(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function firstStringField(
  input: Record<string, unknown>,
  primaryKey: string,
  secondaryKey: string,
): string | undefined {
  const primary = input[primaryKey];
  if (typeof primary === "string") return primary;
  const secondary = input[secondaryKey];
  if (typeof secondary === "string") return secondary;
  return undefined;
}

function extractSessionIdRaw(msg: {
  session_id?: unknown;
  sessionId?: unknown;
  session?: { id?: unknown } | null;
}): string {
  if (typeof msg.session_id === "string") return msg.session_id;
  if (typeof msg.sessionId === "string") return msg.sessionId;
  if (typeof msg.session?.id === "string") return msg.session.id;
  return "";
}

function isClaudeThinkingEffort(value: string | null | undefined): value is ClaudeThinkingEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function isClaudeThinkingOption(value: string | null | undefined): value is ClaudeThinkingOption {
  return value === CLAUDE_ULTRACODE_THINKING_OPTION_ID || isClaudeThinkingEffort(value);
}

// Map a resolved thinkingOptionId onto a Claude `effort` for a bare completion.
// Metadata generation wants no thinking by default (cheaper, faster); only a
// personality-carried effort turns it on. Ultracode collapses to the highest
// real effort tier since the bare path has no adaptive-thinking machinery.
function resolveClaudeBareCompletionEffort(
  thinkingOptionId: string | undefined,
): ClaudeThinkingEffort | undefined {
  if (!thinkingOptionId || thinkingOptionId === "default") {
    return undefined;
  }
  if (thinkingOptionId === CLAUDE_ULTRACODE_THINKING_OPTION_ID) {
    return "xhigh";
  }
  return isClaudeThinkingEffort(thinkingOptionId) ? thinkingOptionId : undefined;
}

/**
 * Map a bare-completion result message's usage into AgentUsage (WP-G). Standalone
 * from the session's `buildResultUsage` (which also drives the context-window
 * ring) — a bare completion has no session/ring, so this only carries the
 * billing slices the cost ledger needs: the three input categories, output, and
 * Claude's real `total_cost_usd`.
 */
function buildBareCompletionUsage(message: SDKResultMessage): AgentUsage | undefined {
  if (!message.usage) {
    return undefined;
  }
  const usage: AgentUsage = {
    inputTokens: message.usage.input_tokens,
    cachedInputTokens: message.usage.cache_read_input_tokens,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
    outputTokens: message.usage.output_tokens,
    totalCostUsd: message.total_cost_usd,
  };
  return usage;
}

// Concatenate the text blocks of an assistant SDK message. Used only as the
// fallback when a bare completion's result message carries no `result` string.
function extractClaudeAssistantMessageText(message: SDKMessage & { type: "assistant" }): string {
  const container = toObjectRecord(message.message);
  const content = container?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  let text = "";
  for (const block of content) {
    const record = toObjectRecord(block);
    if (record?.type === "text" && typeof record.text === "string") {
      text += record.text;
    }
  }
  return text;
}

interface ClaudeOptionsLogSummary {
  cwd: string | null;
  permissionMode: string | null;
  model: string | null;
  includePartialMessages: boolean;
  settingSources: string[];
  enableFileCheckpointing: boolean;
  hasResume: boolean;
  maxThinkingTokens: number | null;
  hasEnv: boolean;
  envKeyCount: number;
  hasMcpServers: boolean;
  mcpServerNames: string[];
  systemPromptMode: "none" | "string" | "preset" | "custom";
  systemPromptPreset: string | null;
  hasCanUseTool: boolean;
  hasSpawnOverride: boolean;
  hasStderrHandler: boolean;
  pathToClaudeCodeExecutable: string | null;
  persistSession: boolean | null;
  fastMode: boolean | null;
}

const MAX_RECENT_STDERR_CHARS = 4000;
const STDERR_FLUSH_WAIT_MS = 150;
const STDERR_FLUSH_POLL_INTERVAL_MS = 10;

function summarizeClaudeOptionsForLog(options: ClaudeOptions): ClaudeOptionsLogSummary {
  const systemPromptRaw = options.systemPrompt;
  const systemPromptSummary = (() => {
    if (!systemPromptRaw) {
      return { mode: "none" as const, preset: null };
    }
    if (typeof systemPromptRaw === "string") {
      return { mode: "string" as const, preset: null };
    }
    const prompt = toObjectRecord(systemPromptRaw);
    const promptType = typeof prompt?.type === "string" ? prompt.type : "custom";
    return {
      mode: promptType === "preset" ? ("preset" as const) : ("custom" as const),
      preset: typeof prompt?.preset === "string" && prompt.preset.length > 0 ? prompt.preset : null,
    };
  })();
  const mcpServerNames = options.mcpServers ? Object.keys(options.mcpServers).sort() : [];

  return {
    cwd: typeof options.cwd === "string" ? options.cwd : null,
    permissionMode: typeof options.permissionMode === "string" ? options.permissionMode : null,
    model: typeof options.model === "string" ? options.model : null,
    includePartialMessages: options.includePartialMessages === true,
    settingSources: Array.isArray(options.settingSources) ? options.settingSources : [],
    enableFileCheckpointing: options.enableFileCheckpointing === true,
    hasResume: typeof options.resume === "string" && options.resume.length > 0,
    maxThinkingTokens:
      typeof options.maxThinkingTokens === "number" ? options.maxThinkingTokens : null,
    hasEnv: !!options.env,
    envKeyCount: Object.keys(options.env ?? {}).length,
    hasMcpServers: mcpServerNames.length > 0,
    mcpServerNames,
    systemPromptMode: systemPromptSummary.mode,
    systemPromptPreset: systemPromptSummary.preset,
    hasCanUseTool: typeof options.canUseTool === "function",
    hasSpawnOverride: typeof options.spawnClaudeCodeProcess === "function",
    hasStderrHandler: typeof options.stderr === "function",
    pathToClaudeCodeExecutable:
      typeof options.pathToClaudeCodeExecutable === "string"
        ? options.pathToClaudeCodeExecutable
        : null,
    persistSession: typeof options.persistSession === "boolean" ? options.persistSession : null,
    fastMode: readClaudeFastModeSetting(options.settings),
  };
}

function readClaudeFastModeSetting(settings: ClaudeOptions["settings"]): boolean | null {
  if (!settings || typeof settings === "string") {
    return null;
  }
  return typeof settings.fastMode === "boolean" ? settings.fastMode : null;
}

function mergeClaudeSettings(
  settings: ClaudeOptions["settings"],
  updates: NonNullable<Exclude<ClaudeOptions["settings"], string>>,
): ClaudeOptions["settings"] {
  if (!settings || typeof settings === "string") {
    return settings ?? updates;
  }
  return { ...settings, ...updates };
}

function isToolResultTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function normalizeForDeterministicString(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForDeterministicString(entry, seen));
  }
  if (typeof value === "object") {
    const objectValue = value;
    if (seen.has(objectValue)) {
      return "[circular]";
    }
    seen.add(objectValue);
    const record = toObjectRecord(value);
    if (!record) {
      seen.delete(objectValue);
      return "[invalid]";
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeForDeterministicString(record[key], seen);
    }
    seen.delete(objectValue);
    return normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "[unsupported]";
}

function deterministicStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return "";
  }
  try {
    const normalized = normalizeForDeterministicString(value, new WeakSet<object>());
    if (typeof normalized === "string") {
      return normalized;
    }
    return JSON.stringify(normalized);
  } catch {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "[unserializable]";
  }
}

function coerceToolResultContentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content.every((block) => isToolResultTextBlock(block))) {
    return content.map((block) => block.text).join("");
  }
  return deterministicStringify(content);
}

function toBase64ImageOutput(block: unknown): ProviderImageOutput | null {
  const record = toObjectRecord(block);
  if (!record || record.type !== "image") {
    return null;
  }
  const source = toObjectRecord(record.source);
  if (!source || source.type !== "base64" || typeof source.data !== "string") {
    return null;
  }
  return {
    data: source.data,
    mimeType: typeof source.media_type === "string" ? source.media_type : null,
  };
}

// Claude returns images inside tool_result content as base64 Anthropic blocks. Left in place they
// reach coerceToolResultContentToString, which JSON.stringifies the whole array — dumping base64
// into the tool output. We pull those blocks out to render them as image markdown and leave a
// "[image]" placeholder so image-only results still produce non-empty output.
function splitClaudeToolResultImages(content: unknown): {
  images: ProviderImageOutput[];
  text: unknown;
} {
  if (!Array.isArray(content)) {
    return { images: [], text: content };
  }
  const images: ProviderImageOutput[] = [];
  const text = content.map((block) => {
    const image = toBase64ImageOutput(block);
    if (image) {
      images.push(image);
      return { type: "text", text: "[image]" };
    }
    return block;
  });
  return { images, text };
}

function normalizeClaudeTranscriptText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isClaudeInterruptPlaceholderText(value: unknown): boolean {
  const normalized = normalizeClaudeTranscriptText(value);
  return normalized !== null && INTERRUPT_PLACEHOLDER_PATTERN.test(normalized);
}

function isClaudeNoResponsePlaceholderText(value: unknown): boolean {
  return normalizeClaudeTranscriptText(value) === NO_RESPONSE_REQUESTED_PLACEHOLDER;
}

const LOCAL_COMMAND_STDOUT_PATTERN =
  /^\s*<local-command-stdout>[\s\S]*<\/local-command-stdout>\s*$/;
const CLAUDE_COMMAND_MESSAGE_PATTERN = /<command-message>([\s\S]*?)<\/command-message>/;
const CLAUDE_COMMAND_ARGS_PATTERN = /<command-args>([\s\S]*?)<\/command-args>/;
const CLAUDE_COMMAND_NAME_PATTERN = /<command-name>([\s\S]*?)<\/command-name>/;

function isClaudeLocalCommandStdout(value: unknown): boolean {
  const normalized = normalizeClaudeTranscriptText(value);
  return normalized !== null && LOCAL_COMMAND_STDOUT_PATTERN.test(normalized);
}

function isClaudeTranscriptNoiseText(value: unknown): boolean {
  return (
    isClaudeInterruptPlaceholderText(value) ||
    isClaudeNoResponsePlaceholderText(value) ||
    isClaudeLocalCommandStdout(value)
  );
}

function collectClaudeTextContentParts(content: unknown): string[] {
  if (typeof content === "string") {
    const normalized = normalizeClaudeTranscriptText(content);
    return normalized ? [normalized] : [];
  }

  if (!isUnknownArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const block of content) {
    const blockRecord = toObjectRecord(block);
    if (!blockRecord) {
      continue;
    }
    const text = normalizeClaudeTranscriptText(blockRecord.text);
    if (text) {
      parts.push(text);
      continue;
    }
    const input = normalizeClaudeTranscriptText(blockRecord.input);
    if (input) {
      parts.push(input);
    }
  }

  return parts;
}

function isClaudeTranscriptNoiseContent(content: unknown): boolean {
  const parts = collectClaudeTextContentParts(content);
  return parts.length > 0 && parts.every((part) => isClaudeTranscriptNoiseText(part));
}

export function extractUserMessageText(content: unknown): string | null {
  if (typeof content === "string") {
    const normalized = content.trim();
    if (!normalized || isClaudeTranscriptNoiseText(normalized)) {
      return null;
    }
    return normalizeClaudeUserPromptText(normalized);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const text = typeof block.text === "string" ? block.text : undefined;
    if (text && text.trim()) {
      const trimmed = text.trim();
      if (!isClaudeTranscriptNoiseText(trimmed)) {
        const normalized = normalizeClaudeUserPromptText(trimmed);
        if (normalized) {
          parts.push(normalized);
        }
      }
      continue;
    }
    const input = typeof block.input === "string" ? block.input : undefined;
    if (input && input.trim()) {
      const trimmed = input.trim();
      if (!isClaudeTranscriptNoiseText(trimmed)) {
        const normalized = normalizeClaudeUserPromptText(trimmed);
        if (normalized) {
          parts.push(normalized);
        }
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  const combined = parts.join("\n\n").trim();
  return combined.length > 0 ? combined : null;
}

interface PendingPermission {
  request: AgentPermissionRequest;
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
}

type ToolUseClassification = "generic" | "command" | "file_change";
interface ToolUseCacheEntry {
  id: string;
  name: string;
  server: string;
  classification: ToolUseClassification;
  started: boolean;
  commandText?: string;
  files?: { path: string; kind: string }[];
  input?: AgentMetadata | null;
}
function isMetadata(value: unknown): value is AgentMetadata {
  return typeof value === "object" && value !== null;
}

function createDefaultToolUseCacheEntry(id: string, block: ClaudeContentChunk): ToolUseCacheEntry {
  const nameFromBlock =
    typeof block.name === "string" && block.name.length > 0 ? block.name : "tool";
  let server: string;
  if (typeof block.server === "string" && block.server.length > 0) {
    server = block.server;
  } else if (typeof block.name === "string" && block.name.length > 0) {
    server = block.name;
  } else {
    server = "tool";
  }
  return {
    id,
    name: nameFromBlock,
    server,
    classification: "generic",
    started: false,
  };
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isMetadata(value)) {
    return false;
  }
  const type = value.type;
  if (type === "stdio") {
    return typeof value.command === "string";
  }
  if (type === "http" || type === "sse") {
    return typeof value.url === "string";
  }
  return false;
}

function isMcpServersRecord(value: unknown): value is Record<string, McpServerConfig> {
  if (!isMetadata(value)) {
    return false;
  }
  for (const config of Object.values(value)) {
    if (!isMcpServerConfig(config)) {
      return false;
    }
  }
  return true;
}

function isPermissionMode(value: string | undefined): value is PermissionMode {
  return typeof value === "string" && VALID_CLAUDE_MODES.has(value);
}

function isTruthyEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized !== undefined &&
    normalized.length > 0 &&
    normalized !== "0" &&
    normalized !== "false" &&
    normalized !== "no" &&
    normalized !== "off"
  );
}

function detectNonAnthropicApiTransport(env: NodeJS.ProcessEnv): "Bedrock" | "Vertex" | null {
  if (isTruthyEnvValue(env.CLAUDE_CODE_USE_BEDROCK)) {
    return "Bedrock";
  }
  if (isTruthyEnvValue(env.CLAUDE_CODE_USE_VERTEX)) {
    return "Vertex";
  }
  return null;
}

type ClaudeAutoModeVerdict = { supported: true } | { supported: false; reason: string };

/**
 * Whether the Auto permission mode (Claude's model-classifier approvals) can
 * run for the given model + auth path. Mirrors the Claude Code support matrix
 * (see ClaudeAutoModeSupport in model-manifest.ts); the CLI enforces the same
 * matrix itself with a mid-session error, so this gate exists to hide/refuse
 * Auto up front instead of surfacing a runtime toast. Unknown models fail open
 * to the legacy transport-only rule.
 */
export function checkClaudeAutoModeSupport(
  modelId: string | null | undefined,
  env: NodeJS.ProcessEnv,
): ClaudeAutoModeVerdict {
  const support = claudeManifestModelAutoModeSupport(
    normalizeClaudeRuntimeModelId(modelId) ?? modelId,
  );
  if (support === "none") {
    return {
      supported: false,
      reason: `Claude Auto mode is not supported by model '${modelId}'. Select another permission mode or a newer model.`,
    };
  }
  if (support === "all") {
    return { supported: true };
  }
  // "anthropic-api" tier or unknown model: Bedrock/Vertex never qualify.
  const transport = detectNonAnthropicApiTransport(env);
  if (transport !== null) {
    return {
      supported: false,
      reason: `Claude Auto mode requires the Anthropic API and is not supported when Claude Code uses ${transport}. Select another permission mode or unset the ${transport === "Bedrock" ? "CLAUDE_CODE_USE_BEDROCK" : "CLAUDE_CODE_USE_VERTEX"} environment variable.`,
    };
  }
  // API-key presence is the best available signal for Anthropic API billing
  // vs claude.ai subscription sign-in (OAuth leaves no env marker).
  if (support === "anthropic-api" && !isTruthyEnvValue(env.ANTHROPIC_API_KEY)) {
    return {
      supported: false,
      reason: `Claude Auto mode on model '${modelId}' requires Anthropic API-key authentication and is not available with claude.ai sign-in. Select another permission mode or a newer model.`,
    };
  }
  return { supported: true };
}

function assertClaudeAutoModeEligible(
  mode: PermissionMode,
  modelId: string | null | undefined,
  env: NodeJS.ProcessEnv,
): void {
  if (mode !== "auto") {
    return;
  }
  const verdict = checkClaudeAutoModeSupport(modelId, env);
  if (!verdict.supported) {
    throw new Error(verdict.reason);
  }
}

function coerceSessionMetadata(metadata: AgentMetadata | undefined): Partial<AgentSessionConfig> {
  if (!isMetadata(metadata)) {
    return {};
  }

  const result: Partial<AgentSessionConfig> = {};
  if (metadata.provider === "claude" || metadata.provider === "codex") {
    result.provider = metadata.provider;
  }
  if (typeof metadata.cwd === "string") {
    result.cwd = metadata.cwd;
  }
  if (typeof metadata.modeId === "string") {
    result.modeId = metadata.modeId;
  }
  if (typeof metadata.model === "string") {
    result.model = metadata.model;
  }
  if (typeof metadata.title === "string" || metadata.title === null) {
    result.title = metadata.title;
  }
  if (typeof metadata.approvalPolicy === "string") {
    result.approvalPolicy = metadata.approvalPolicy;
  }
  if (typeof metadata.sandboxMode === "string") {
    result.sandboxMode = metadata.sandboxMode;
  }
  if (typeof metadata.networkAccess === "boolean") {
    result.networkAccess = metadata.networkAccess;
  }
  if (typeof metadata.webSearch === "boolean") {
    result.webSearch = metadata.webSearch;
  }
  if (isMetadata(metadata.extra)) {
    const extra: AgentSessionConfig["extra"] = {};
    if (isMetadata(metadata.extra.codex)) {
      extra.codex = metadata.extra.codex;
    }
    if (isClaudeExtra(metadata.extra.claude)) {
      extra.claude = metadata.extra.claude;
    }
    if (extra.codex || extra.claude) {
      result.extra = extra;
    }
  }
  if (typeof metadata.systemPrompt === "string") {
    result.systemPrompt = metadata.systemPrompt;
  }
  if (isMcpServersRecord(metadata.mcpServers)) {
    result.mcpServers = metadata.mcpServers;
  }

  return result;
}

export function toClaudeSdkMcpConfig(config: McpServerConfig): ClaudeSdkMcpServerConfig {
  switch (config.type) {
    case "stdio":
      return {
        type: "stdio",
        command: config.command,
        args: config.args,
        env: config.env,
        alwaysLoad: config.alwaysLoad,
      };
    case "http":
      return {
        type: "http",
        url: config.url,
        headers: config.headers,
        alwaysLoad: config.alwaysLoad,
      };
    case "sse":
      return {
        type: "sse",
        url: config.url,
        headers: config.headers,
        alwaysLoad: config.alwaysLoad,
      };
  }
  throw new Error("Unhandled MCP server config type");
}

function isClaudeContentChunk(value: unknown): value is ClaudeContentChunk {
  return isMetadata(value) && typeof value.type === "string";
}

function isClaudeExtra(value: unknown): value is Partial<ClaudeOptions> {
  return isMetadata(value);
}

function isPermissionUpdate(value: AgentPermissionUpdate): value is PermissionUpdate {
  if (!isMetadata(value)) {
    return false;
  }
  const type = value.type;
  if (type !== "addRules" && type !== "replaceRules" && type !== "removeRules") {
    return false;
  }
  const rules = value.rules;
  const behavior = value.behavior;
  const destination = value.destination;
  return Array.isArray(rules) && typeof behavior === "string" && typeof destination === "string";
}

// Otto tools that only draw or withdraw a suggestion card — they have no side
// effect until the user clicks Start on the card, so the real approval gate is
// that Start button, not the act of suggesting. Auto-approved in every mode
// (including Always-ask) so the model never has to ask permission to suggest.
// The suggestion still appears in the transcript, so full visibility is kept.
const AUTO_APPROVED_OTTO_TOOL_NAMES = new Set<string>([
  "mcp__otto__spawn_task",
  "mcp__otto__dismiss_task",
]);

function resolvePermissionKind(
  toolName: string,
  input: Record<string, unknown>,
): AgentPermissionRequestKind {
  if (toolName === "ExitPlanMode") return "plan";
  if (toolName === "AskUserQuestion" && Array.isArray(input.questions)) {
    return "question";
  }
  return "tool";
}

function getClaudeModeLabel(modeId: PermissionMode): string {
  return DEFAULT_MODES.find((mode) => mode.id === modeId)?.label ?? modeId;
}

function buildClaudePlanPermissionActions(
  resumeMode: PermissionMode | null,
): AgentPermissionAction[] {
  const actions: AgentPermissionAction[] = [
    {
      id: "reject",
      label: "Reject",
      behavior: "deny",
      variant: "danger",
      intent: "dismiss",
    },
    {
      id: "implement",
      label: "Implement",
      behavior: "allow",
      variant: "primary",
      intent: "implement",
    },
  ];

  if (resumeMode === "bypassPermissions") {
    actions.push({
      id: "implement_resume",
      label: `Implement with ${getClaudeModeLabel(resumeMode)}`,
      behavior: "allow",
      variant: "secondary",
      intent: "implement_resume",
    });
  }

  return actions;
}

interface TimelineFragment {
  kind: "assistant" | "reasoning";
  text: string;
}

interface TimelineMessageState {
  id: string;
  assistantText: string;
  reasoningText: string;
  emittedAssistantLength: number;
  emittedReasoningLength: number;
  stopped: boolean;
}

class TimelineAssembler {
  private readonly messages = new Map<string, TimelineMessageState>();
  private readonly finalizedMessageIds = new Set<string>();
  private readonly activeMessageByRun = new Map<string, string>();
  private syntheticMessageCounter = 0;

  consume(input: {
    message: SDKMessage;
    runId: string | null;
    messageIdHint?: string | null;
  }): AgentTimelineItem[] {
    if (input.message.type === "assistant") {
      return this.consumeAssistantMessage(input.message, input.runId, input.messageIdHint ?? null);
    }
    if (input.message.type === "stream_event") {
      return this.consumeStreamEvent(input.message, input.runId, input.messageIdHint ?? null);
    }
    return [];
  }

  private consumeAssistantMessage(
    message: SDKMessage & { type: "assistant" },
    runId: string | null,
    messageIdHint: string | null,
  ): AgentTimelineItem[] {
    const messageId =
      this.readMessageIdFromAssistantMessage(message) ??
      messageIdHint ??
      this.resolveMessageId({ runId, createIfMissing: true, messageId: null });
    if (!messageId) {
      return [];
    }
    if (this.finalizedMessageIds.has(messageId)) {
      return [];
    }
    const state = this.ensureMessageState(messageId, runId);
    const fragments = this.extractFragments(message.message?.content);
    return this.applyAbsoluteFragments(state, fragments);
  }

  private consumeStreamEvent(
    message: SDKMessage & { type: "stream_event" },
    runId: string | null,
    messageIdHint: string | null,
  ): AgentTimelineItem[] {
    const event = toObjectRecord(message.event) ?? {};
    const eventType = readTrimmedString(event.type);
    const streamEventMessageId = this.readMessageIdFromStreamEvent(event) ?? messageIdHint;

    if (eventType === "message_start") {
      const messageId = this.resolveMessageId({
        runId,
        createIfMissing: true,
        messageId: streamEventMessageId,
      });
      if (!messageId) {
        return [];
      }
      this.ensureMessageState(messageId, runId);
      return [];
    }

    if (eventType === "message_stop") {
      const messageId = this.resolveMessageId({
        runId,
        createIfMissing: false,
        messageId: streamEventMessageId,
      });
      if (!messageId) {
        return [];
      }
      return this.finalizeMessage(messageId, runId);
    }

    if (eventType === "content_block_start") {
      return this.consumeDeltaContent(event.content_block, runId, streamEventMessageId);
    }

    if (eventType === "content_block_delta") {
      return this.consumeDeltaContent(event.delta, runId, streamEventMessageId);
    }

    return [];
  }

  private consumeDeltaContent(
    content: unknown,
    runId: string | null,
    messageIdHint: string | null,
  ): AgentTimelineItem[] {
    const fragments = this.extractFragments(content);
    if (fragments.length === 0) {
      return [];
    }
    const messageId = this.resolveMessageId({
      runId,
      createIfMissing: true,
      messageId: messageIdHint,
    });
    if (!messageId) {
      return [];
    }
    const state = this.ensureMessageState(messageId, runId);
    return this.appendFragments(state, fragments);
  }

  private appendFragments(
    state: TimelineMessageState,
    fragments: TimelineFragment[],
  ): AgentTimelineItem[] {
    for (const fragment of fragments) {
      if (fragment.kind === "assistant") {
        state.assistantText += fragment.text;
      } else {
        state.reasoningText += fragment.text;
      }
    }
    return this.emitNewContent(state);
  }

  private applyAbsoluteFragments(
    state: TimelineMessageState,
    fragments: TimelineFragment[],
  ): AgentTimelineItem[] {
    const assistantText = fragments
      .filter((fragment) => fragment.kind === "assistant")
      .map((fragment) => fragment.text)
      .join("");
    const reasoningText = fragments
      .filter((fragment) => fragment.kind === "reasoning")
      .map((fragment) => fragment.text)
      .join("");

    if (assistantText.length > 0) {
      if (!assistantText.startsWith(state.assistantText)) {
        state.emittedAssistantLength = 0;
      }
      state.assistantText = assistantText;
    }
    if (reasoningText.length > 0) {
      if (!reasoningText.startsWith(state.reasoningText)) {
        state.emittedReasoningLength = 0;
      }
      state.reasoningText = reasoningText;
    }
    return this.emitNewContent(state);
  }

  private finalizeMessage(messageId: string, runId: string | null): AgentTimelineItem[] {
    const state = this.messages.get(messageId);
    if (!state) {
      return [];
    }
    state.stopped = true;
    const items = this.emitNewContent(state);
    if (runId && this.activeMessageByRun.get(runId) === messageId) {
      this.activeMessageByRun.delete(runId);
    }
    this.finalizedMessageIds.add(messageId);
    this.messages.delete(messageId);
    return items;
  }

  private emitNewContent(state: TimelineMessageState): AgentTimelineItem[] {
    const items: AgentTimelineItem[] = [];
    const nextAssistantText = state.assistantText.slice(state.emittedAssistantLength);
    if (
      nextAssistantText.length > 0 &&
      nextAssistantText !== INTERRUPT_TOOL_USE_PLACEHOLDER &&
      !isClaudeTranscriptNoiseText(nextAssistantText)
    ) {
      state.emittedAssistantLength = state.assistantText.length;
      items.push({ type: "assistant_message", text: nextAssistantText, messageId: state.id });
    }

    const nextReasoningText = state.reasoningText.slice(state.emittedReasoningLength);
    if (nextReasoningText.length > 0) {
      state.emittedReasoningLength = state.reasoningText.length;
      items.push({ type: "reasoning", text: nextReasoningText });
    }
    return items;
  }

  private ensureMessageState(messageId: string, runId: string | null): TimelineMessageState {
    const existing = this.messages.get(messageId);
    if (existing) {
      existing.stopped = false;
      if (runId) {
        this.activeMessageByRun.set(runId, messageId);
      }
      return existing;
    }
    const created: TimelineMessageState = {
      id: messageId,
      assistantText: "",
      reasoningText: "",
      emittedAssistantLength: 0,
      emittedReasoningLength: 0,
      stopped: false,
    };
    this.messages.set(messageId, created);
    if (runId) {
      this.activeMessageByRun.set(runId, messageId);
    }
    return created;
  }

  private resolveMessageId(input: {
    runId: string | null;
    createIfMissing: boolean;
    messageId: string | null;
  }): string | null {
    if (input.messageId) {
      return input.messageId;
    }
    if (input.runId) {
      const active = this.activeMessageByRun.get(input.runId);
      if (active) {
        return active;
      }
    }
    if (!input.createIfMissing) {
      return null;
    }
    const synthetic = `synthetic-message-${++this.syntheticMessageCounter}`;
    if (input.runId) {
      this.activeMessageByRun.set(input.runId, synthetic);
    }
    return synthetic;
  }

  private extractFragments(content: unknown): TimelineFragment[] {
    if (typeof content === "string") {
      if (content.length === 0) {
        return [];
      }
      return [{ kind: "assistant", text: content }];
    }
    const blocks = Array.isArray(content) ? content : [content];
    const fragments: TimelineFragment[] = [];
    for (const rawBlock of blocks) {
      if (!isClaudeContentChunk(rawBlock)) {
        continue;
      }
      if (
        (rawBlock.type === "text" || rawBlock.type === "text_delta") &&
        typeof rawBlock.text === "string" &&
        rawBlock.text.length > 0
      ) {
        fragments.push({ kind: "assistant", text: rawBlock.text });
      }
      if (
        (rawBlock.type === "thinking" || rawBlock.type === "thinking_delta") &&
        typeof rawBlock.thinking === "string" &&
        rawBlock.thinking.length > 0
      ) {
        fragments.push({ kind: "reasoning", text: rawBlock.thinking });
      }
    }
    return fragments;
  }

  private readMessageIdFromAssistantMessage(
    message: SDKMessage & { type: "assistant" },
  ): string | null {
    const candidate = toObjectRecord(message);
    const messageContainer = toObjectRecord(candidate?.message);
    return (
      readTrimmedString(candidate?.message_id) ?? readTrimmedString(messageContainer?.id) ?? null
    );
  }

  private readMessageIdFromStreamEvent(event: Record<string, unknown>): string | null {
    const messageContainer = toObjectRecord(event.message);
    return readTrimmedString(event.message_id) ?? readTrimmedString(messageContainer?.id) ?? null;
  }
}

function isSyntheticUserEntry(entry: unknown): boolean {
  const candidate = toObjectRecord(entry);
  if (!candidate) {
    return false;
  }
  return (
    candidate.isSynthetic === true || candidate.isMeta === true || Boolean(candidate.toolUseResult)
  );
}

function isToolResultUserEntry(entry: unknown): boolean {
  const candidate = toObjectRecord(entry);
  if (!candidate) {
    return false;
  }
  const message = toObjectRecord(candidate.message);
  const content = message?.content;
  return (
    Array.isArray(content) && content.some((block) => toObjectRecord(block)?.type === "tool_result")
  );
}

function isSyntheticHistoryUserEntry(entry: Record<string, unknown>): boolean {
  return isSyntheticUserEntry(entry) && !isToolResultUserEntry(entry);
}

function firstTrimmedString(sources: readonly unknown[]): string | null {
  for (const source of sources) {
    const value = readTrimmedString(source);
    if (value) {
      return value;
    }
  }
  return null;
}

function readTranscriptUuid(message: SDKMessage): string | null {
  const root = toObjectRecord(message) ?? {};
  const messageType = readTrimmedString(root.type);
  if (messageType !== "user" && messageType !== "assistant") {
    return null;
  }
  return firstTrimmedString([root.uuid]);
}

export function readEventIdentifiers(message: SDKMessage): EventIdentifiers {
  const root = toObjectRecord(message) ?? {};
  const messageType = readTrimmedString(root.type);
  const streamEvent = toObjectRecord(root.event);
  const streamEventMessage = toObjectRecord(streamEvent?.message);
  const messageContainer = toObjectRecord(root.message);

  const messageIdFromUuid =
    messageType === "user" || messageType === "assistant" || messageType === "system"
      ? root.uuid
      : undefined;

  return {
    taskId: firstTrimmedString([
      root.task_id,
      streamEvent?.task_id,
      streamEventMessage?.task_id,
      messageContainer?.task_id,
    ]),
    parentMessageId: firstTrimmedString([
      root.parent_message_id,
      streamEvent?.parent_message_id,
      streamEventMessage?.parent_message_id,
      messageContainer?.parent_message_id,
    ]),
    messageId: firstTrimmedString([
      root.message_id,
      streamEvent?.message_id,
      streamEventMessage?.id,
      streamEventMessage?.message_id,
      messageContainer?.id,
      messageContainer?.message_id,
      messageIdFromUuid,
    ]),
  };
}

export class ClaudeAgentClient implements AgentClient {
  readonly provider = "claude" as const;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private readonly defaults?: { agents?: Record<string, AgentDefinition> };
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly queryFactory?: ClaudeQueryFactory;
  private readonly resolveBinary: () => Promise<string>;
  private readonly configDir?: string;

  constructor(options: ClaudeAgentClientOptions) {
    this.defaults = options.defaults;
    this.logger = options.logger.child({ module: "agent", provider: "claude" });
    this.runtimeSettings = options.runtimeSettings;
    this.queryFactory = options.queryFactory;
    this.resolveBinary = options.resolveBinary ?? (() => resolveClaudeBinary(this.runtimeSettings));
    this.configDir = options.configDir;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    const claudeConfig = this.assertConfig(config);
    return new ClaudeAgentSession(claudeConfig, {
      defaults: this.defaults,
      runtimeSettings: this.runtimeSettings,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      persistSession: options?.persistSession,
      logger: this.logger,
      queryFactory: this.queryFactory,
      resolveBinary: this.resolveBinary,
      agentBehaviors: launchContext?.agentBehaviors,
    });
  }

  /**
   * Tool-less one-shot completion for internal metadata generation (chat
   * titles, branch names, commit/PR text, …). Runs a minimal `claudeQuery`
   * with NO `claude_code` preset, NO CLAUDE.md (`settingSources: []`), NO tools
   * (`allowedTools: []`), and NO MCP — everything the model needs is in the
   * self-contained prompt. This is the whole cost win: a full spawn carries the
   * preset + CLAUDE.md + the Otto tool catalog (15–25K input tokens) just to
   * emit a few words; this path is a few hundred. Auth still flows through the
   * Claude Code CLI (subscription/OAuth), so no separate API key is needed.
   */
  async generateBareCompletion(
    options: AgentBareCompletionOptions,
  ): Promise<AgentBareCompletionResult> {
    const claudeBinary = await this.resolveBinary();
    const env = createProviderEnv({
      baseEnv: process.env,
      runtimeSettings: this.runtimeSettings,
    });
    const effort = resolveClaudeBareCompletionEffort(options.thinkingOptionId);
    const queryOptions: ClaudeOptions = {
      cwd: options.cwd,
      pathToClaudeCodeExecutable: claudeBinary,
      settingSources: [],
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: false,
      persistSession: false,
      env,
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(effort ? { effort } : {}),
    };
    const handle = claudeQuery(
      { prompt: options.prompt, options: queryOptions },
      { runtimeSettings: this.runtimeSettings, queryFactory: this.queryFactory },
    );
    let assistantText = "";
    let resultText = "";
    // Capture the result message's usage so the manager can attribute this
    // generation's spend to the "generations" cost category (WP-G). Without it
    // the bare-completion path bypasses the turn counter entirely and reads zero.
    let usage: AgentUsage | undefined;
    try {
      for await (const message of handle) {
        if (message.type === "assistant") {
          assistantText += extractClaudeAssistantMessageText(message);
        } else if (message.type === "result" && message.subtype === "success") {
          resultText = typeof message.result === "string" ? message.result : "";
          usage = buildBareCompletionUsage(message);
        }
      }
    } finally {
      try {
        await handle.return?.(undefined);
      } catch {
        // Best-effort teardown of the underlying CLI process on early exit.
      }
    }
    return { text: resultText.trim() || assistantText.trim(), ...(usage ? { usage } : {}) };
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadata = coerceSessionMetadata(handle.metadata);
    const merged: Partial<AgentSessionConfig> = { ...metadata, ...overrides };
    if (!merged.cwd) {
      throw new Error("Claude resume requires the original working directory in metadata");
    }
    const mergedConfig: AgentSessionConfig = {
      ...merged,
      provider: "claude",
      cwd: merged.cwd,
    };
    const claudeConfig = this.assertConfig(mergedConfig);
    return new ClaudeAgentSession(claudeConfig, {
      defaults: this.defaults,
      runtimeSettings: this.runtimeSettings,
      handle,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      logger: this.logger,
      queryFactory: this.queryFactory,
      resolveBinary: this.resolveBinary,
      agentBehaviors: launchContext?.agentBehaviors,
    });
  }

  async fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog> {
    // Claude exposes a global catalog here; cwd/force are intentionally irrelevant.
    // Models carry supportsAutoMode: false only for the model-intrinsic "none"
    // tier (stamped by the manifest builder); auth-path-dependent Auto
    // eligibility is enforced per session where the env is well-defined.
    const models = await getClaudeModelsWithSettings(this.logger, this.configDir);
    return { models, modes: DEFAULT_MODES };
  }

  resolveCreateConfig(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult {
    // Unattended Claude runs default to `dontAsk` (first isUnattended mode in
    // DEFAULT_MODES). Upgrade that target to `auto` when the model + auth path
    // supports the classifier: Auto then auto-approves safe actions (including
    // safe Bash) and escalations are auto-denied by the unattended responder.
    // process.env is the auth-path signal (ANTHROPIC_API_KEY / Bedrock / Vertex
    // markers live there); the per-session buildOptions re-checks with the full
    // SDK env, so a mismatch fails visibly rather than silently mis-running.
    const preferredUnattendedModeId = checkClaudeAutoModeSupport(input.model, process.env).supported
      ? "auto"
      : undefined;
    return resolveDefaultAgentCreateConfig({ ...input, preferredUnattendedModeId });
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const claudeConfig = this.assertConfig(config);
    return buildClaudeFeatures({
      modelId: claudeConfig.model,
      fastModeEnabled: claudeConfig.featureValues?.fast_mode === true,
    });
  }

  async listImportableSessions(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]> {
    const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
    const projectsRoot = path.join(configDir, "projects");
    if (!(await pathExists(projectsRoot))) {
      return [];
    }
    const limit = options?.limit ?? 20;
    const candidates = await collectRecentClaudeSessions(projectsRoot, limit * 3);
    const parsed = await Promise.all(
      candidates.map((candidate) => parseClaudeSessionDescriptor(candidate.path, candidate.mtime)),
    );
    return parsed
      .filter((session): session is ImportableProviderSession => session !== null)
      .slice(0, limit);
  }

  async importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext) {
    return importSessionFromPersistence({
      provider: "claude",
      request: input,
      context,
      resumeSession: this.resumeSession.bind(this),
    });
  }

  async isAvailable(): Promise<boolean> {
    const launch = await resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: "claude",
    });
    const availability = await checkProviderLaunchAvailable(launch);
    return availability.available;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await resolveProviderLaunch({
        commandConfig: this.runtimeSettings?.command,
        defaultBinary: "claude",
      });
      const availability = await checkProviderLaunchAvailable(launch);
      const auth = availability.available
        ? await resolveClaudeAuth(launch, availability, this.runtimeSettings)
        : null;

      return {
        diagnostic: formatProviderDiagnostic("Claude Code", [
          ...(await buildCommandResolutionDiagnosticRows(launch, {
            knownBinaryNames: ["claude"],
          })),
          ...(await buildBinaryDiagnosticRows(launch, availability)),
          ...(auth ? [{ label: "Auth", value: auth }] : []),
        ]),
      };
    } catch (error) {
      return {
        diagnostic: formatProviderDiagnosticError("Claude Code", error),
      };
    }
  }

  private assertConfig(config: AgentSessionConfig): ClaudeAgentConfig {
    if (config.provider !== "claude") {
      throw new Error(`ClaudeAgentClient received config for provider '${config.provider}'`);
    }
    return { ...config, provider: "claude" } as ClaudeAgentConfig;
  }
}

type ClaudeRateLimitInfo = Extract<SDKMessage, { type: "rate_limit_event" }>["rate_limit_info"];

function mapClaudeRateLimitInfo(info: ClaudeRateLimitInfo): AgentRateLimitInfo {
  let status: AgentRateLimitInfo["status"] = "allowed";
  if (info.status === "rejected") {
    status = "rejected";
  } else if (info.status === "allowed_warning") {
    status = "warning";
  }
  const mapped: AgentRateLimitInfo = { status };
  // The rate_limit_event `utilization` is a 0-1 FRACTION (verified against a live
  // event: 0.42 while the /usage dialog showed the weekly window at ~43%). Note
  // this differs from the /usage structured API, whose utilization is documented
  // 0-100 — the two SDK sources use different scales. Multiply to a percent.
  if (typeof info.utilization === "number" && Number.isFinite(info.utilization)) {
    mapped.utilizationPercent = Math.min(100, Math.max(0, Math.round(info.utilization * 100)));
  }
  if (info.rateLimitType) {
    mapped.limitType = info.rateLimitType;
  }
  // SDK resetsAt is epoch seconds (verified against a live rate_limit_event).
  if (typeof info.resetsAt === "number" && Number.isFinite(info.resetsAt)) {
    mapped.resetsAt = new Date(info.resetsAt * 1000).toISOString();
  }
  if (typeof info.isUsingOverage === "boolean") {
    mapped.isUsingOverage = info.isUsingOverage;
  }
  return mapped;
}

async function resolveClaudeBinary(runtimeSettings?: ProviderRuntimeSettings): Promise<string> {
  const launch = await resolveProviderLaunch({
    commandConfig: runtimeSettings?.command,
    defaultBinary: "claude",
  });
  const availability = await checkProviderLaunchAvailable(launch);
  if (availability.available) {
    return availability.resolvedPath ?? launch.command;
  }
  throw new Error(
    "Claude binary not found. Install Claude Code (https://github.com/anthropics/claude-code) and ensure it is available in your shell PATH.",
  );
}

async function resolveClaudeAuth(
  launch: ResolvedProviderLaunch,
  availability: { resolvedPath: string | null },
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<string | null> {
  const run = async (
    executable: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    try {
      return await execCommand(executable, args, {
        ...createProviderEnvSpec({ runtimeSettings }),
        timeout: 5_000,
      });
    } catch (error) {
      const err = toObjectRecord(error);
      const stdout = typeof err?.stdout === "string" ? err.stdout : "";
      const stderr = typeof err?.stderr === "string" ? err.stderr : "";
      const fallbackMessage = typeof err?.message === "string" ? err.message : "";
      return { stdout, stderr: stderr || fallbackMessage };
    }
  };

  try {
    const executable = availability.resolvedPath ?? launch.command;
    const result = await run(executable, [...launch.args, "auth", "status"]);

    const combined = [result.stdout, result.stderr]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join("\n");
    return combined || null;
  } catch {
    return null;
  }
}

function extractContextWindowSize(modelUsage: unknown): number | undefined {
  const usageRecord = toObjectRecord(modelUsage);
  if (!usageRecord) {
    return undefined;
  }

  let maxContextWindow: number | undefined;
  for (const value of Object.values(usageRecord)) {
    const valueRecord = toObjectRecord(value);
    if (!valueRecord) {
      continue;
    }
    const contextWindow = valueRecord.contextWindow;
    if (
      typeof contextWindow !== "number" ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0
    ) {
      continue;
    }
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
  }

  return maxContextWindow;
}

function readStreamRequestInputTokens(event: Record<string, unknown>): number | undefined {
  const messageUsage = toObjectRecord(toObjectRecord(event.message)?.usage);
  if (!messageUsage) {
    return undefined;
  }
  const usage = messageUsage;
  const inputTokens =
    typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens)
      ? usage.input_tokens
      : undefined;
  const cacheCreationInputTokens =
    typeof usage.cache_creation_input_tokens === "number" &&
    Number.isFinite(usage.cache_creation_input_tokens)
      ? usage.cache_creation_input_tokens
      : 0;
  const cacheReadInputTokens =
    typeof usage.cache_read_input_tokens === "number" &&
    Number.isFinite(usage.cache_read_input_tokens)
      ? usage.cache_read_input_tokens
      : 0;
  if (typeof inputTokens !== "number" || inputTokens < 0) {
    return undefined;
  }
  return inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
}

function readStreamRequestOutputTokens(event: Record<string, unknown>): number | undefined {
  const outputTokens = toObjectRecord(event.usage)?.output_tokens;
  if (typeof outputTokens !== "number" || !Number.isFinite(outputTokens) || outputTokens < 0) {
    return undefined;
  }
  return outputTokens;
}

function readLastUsageIteration(usage: unknown): Record<string, unknown> | undefined {
  const iterations = toObjectRecord(usage)?.iterations;
  if (!Array.isArray(iterations)) {
    return undefined;
  }
  for (let index = iterations.length - 1; index >= 0; index -= 1) {
    const candidate = toObjectRecord(iterations[index]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function readUsageTokenTotal(usage: Record<string, unknown>): number | undefined {
  const usageWithCacheCreation = usage as typeof usage & {
    cache_creation_input_tokens?: unknown;
  };
  const inputTokens =
    typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens)
      ? usage.input_tokens
      : 0;
  const cacheCreationInputTokens =
    typeof usageWithCacheCreation.cache_creation_input_tokens === "number" &&
    Number.isFinite(usageWithCacheCreation.cache_creation_input_tokens)
      ? usageWithCacheCreation.cache_creation_input_tokens
      : 0;
  const cacheReadInputTokens =
    typeof usage.cache_read_input_tokens === "number" &&
    Number.isFinite(usage.cache_read_input_tokens)
      ? usage.cache_read_input_tokens
      : 0;
  const outputTokens =
    typeof usage.output_tokens === "number" && Number.isFinite(usage.output_tokens)
      ? usage.output_tokens
      : 0;
  const total = inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens;
  return total > 0 ? total : undefined;
}

function readActiveUsageTokens(usage: unknown): number | undefined {
  const activeUsage = readLastUsageIteration(usage);
  return activeUsage ? readUsageTokenTotal(activeUsage) : undefined;
}

function readLegacyResultUsageTokens(usage: unknown): number | undefined {
  const usageRecord = toObjectRecord(usage);
  return usageRecord ? readUsageTokenTotal(usageRecord) : undefined;
}

function isClaudeSubagentToolName(name: string | undefined): boolean {
  return name === "Task" || name === "Agent";
}

// Claude's Bash tool used with run_in_background: true reports its lifecycle
// through the same task_started/task_progress/task_notification stream as
// subagents. See projects/observed-subagents/observed-subagents.md's note
// that Otto today ignores shell/monitor/workflow task events.
function isClaudeBackgroundShellToolName(name: string | undefined): boolean {
  return name === "Bash";
}

// Claude's Workflow tool (deterministic multi-agent orchestration —
// agent()/parallel()/pipeline(), progress phases, task-completion notifications)
// is a DIFFERENT spawn path than plain Task subagents, but it reports through the
// same task_started/task_progress/task_notification stream. Unlike a Task
// subagent it is backgrounded (its tool_result is an immediate "running" ack, real
// completion arrives via task_notification), so it is settled like a background
// shell task, not on tool_result. We surface the orchestration run as a read-only
// observed subagent so it can be watched. See projects/observed-subagents/observed-subagents.md.
function isClaudeWorkflowToolName(name: string | undefined): boolean {
  return name === "Workflow";
}

// The SDK tags a workflow-orchestration task with task_type "local_workflow"
// (the friendly BackgroundTaskSummary label is "workflow"). Only task_started
// carries task_type/workflow_name; later task_progress/task_notification omit
// them, so the classification is remembered via observedKeyByTaskId once the
// run is announced.
function isClaudeWorkflowTaskType(taskType: string | undefined): boolean {
  return taskType === "local_workflow" || taskType === "workflow";
}

// Background-tasks track membership, decided by the SDK's task_type discriminant
// ('shell' | 'subagent' | 'monitor' | 'workflow' | a raw string for unknown
// types). Subagents and workflows have their own richer observed-subagent rows,
// so the background track takes everything else the CLI backgrounds — shell
// (Bash run_in_background), monitors, and any future/unknown background type.
// Previously only the Bash tool name was recognized, so monitors and other
// non-shell background tasks were silently dropped. Returns false for an absent
// task_type (later task_progress omits it); those events fall back to the
// remembered classification, so this only decides first-sighting (task_started /
// level-signal) routing.
function isClaudeBackgroundTaskType(taskType: string | undefined): boolean {
  if (!taskType) {
    return false;
  }
  return taskType !== "subagent" && !isClaudeWorkflowTaskType(taskType);
}

// Frozen row label for an observed workflow run. workflow_name is meta.name from
// the script (e.g. "spec"); prefix it so the observed track reads it as a
// workflow rather than a plain subagent. Fed through the subAgentType title
// source, which deriveObservedSubagentTitle freezes at birth.
function readClaudeWorkflowLabel(workflowName: unknown): string {
  const name = readObservedSubagentText(workflowName);
  return name ? `Workflow: ${name}` : "Workflow";
}

function readObservedSubagentText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function readClaudeParentToolUseId(message: SDKMessage): string | null {
  if (!("parent_tool_use_id" in message)) {
    return null;
  }
  const parentToolUseId = (message as { parent_tool_use_id?: unknown }).parent_tool_use_id;
  return typeof parentToolUseId === "string" && parentToolUseId.length > 0 ? parentToolUseId : null;
}

class ClaudeContextUsageState {
  private contextWindowMaxTokens: number | undefined;
  private streamRequestInputTokens: number | undefined;
  private streamRequestOutputTokens: number | undefined;
  private compactedContextWindowUsedTokens: number | undefined;
  private completedResultTurns = 0;
  // Watermark for de-cumulating `total_cost_usd`: the SDK reports it CUMULATIVE
  // across all turns of one CLI process (proven 2026-07-19: 0.59 → 1.05 → 1.09
  // over three turns), while the ledger books usage per turn — passing it
  // through verbatim inflated a chat ~2.5×. Reset on process init.
  private lastCumulativeCostUsd = 0;

  constructor(initialContextWindowMaxTokens?: number) {
    this.contextWindowMaxTokens = initialContextWindowMaxTokens;
  }

  beginTurn(): void {
    this.streamRequestInputTokens = undefined;
    this.streamRequestOutputTokens = undefined;
    this.compactedContextWindowUsedTokens = undefined;
  }

  /** A new CLI process started (system init): its cumulative cost restarts at 0. */
  beginProcess(): void {
    this.lastCumulativeCostUsd = 0;
  }

  // The per-turn share of the process-cumulative `total_cost_usd`. A reported
  // value below the watermark means the process restarted without an observed
  // init — the report is that process's own spend, so take it whole.
  private takeTurnCostUsd(cumulative: number | undefined): number | undefined {
    if (typeof cumulative !== "number" || !Number.isFinite(cumulative) || cumulative < 0) {
      return cumulative;
    }
    const turnCost =
      cumulative >= this.lastCumulativeCostUsd
        ? cumulative - this.lastCumulativeCostUsd
        : cumulative;
    this.lastCumulativeCostUsd = cumulative;
    return turnCost;
  }

  setInitialContextWindowMaxTokens(contextWindowMaxTokens: number | undefined): void {
    this.contextWindowMaxTokens = contextWindowMaxTokens;
  }

  recordModelUsage(modelUsage: unknown): number | undefined {
    const contextWindowMaxTokens = extractContextWindowSize(modelUsage);
    if (contextWindowMaxTokens !== undefined) {
      this.contextWindowMaxTokens = contextWindowMaxTokens;
    }
    return this.contextWindowMaxTokens;
  }

  buildStreamUsageEvent(event: unknown): AgentStreamEvent | null {
    const streamEvent = toObjectRecord(event);
    if (!streamEvent) {
      return null;
    }
    const eventType = readTrimmedString(streamEvent.type);
    if (eventType === "message_start") {
      const inputTokens = readStreamRequestInputTokens(streamEvent);
      if (typeof inputTokens !== "number") {
        return null;
      }
      this.streamRequestInputTokens = inputTokens;
      this.streamRequestOutputTokens = 0;
    } else if (eventType === "message_delta") {
      const outputTokens = readStreamRequestOutputTokens(streamEvent);
      if (typeof outputTokens !== "number") {
        return null;
      }
      this.streamRequestOutputTokens = outputTokens;
    } else {
      return null;
    }

    const usedTokens = this.streamUsedTokens();
    if (usedTokens === undefined) {
      return null;
    }
    return this.createUsageUpdatedEvent(usedTokens);
  }

  buildResultUsage(message: SDKResultMessage, modelUsage: unknown): AgentUsage | undefined {
    try {
      if (!message.usage) {
        return undefined;
      }
      const usage: AgentUsage = {
        inputTokens: message.usage.input_tokens,
        cachedInputTokens: message.usage.cache_read_input_tokens,
        // Cache-write spend — billed at a premium and previously dropped here,
        // making prompt-cache priming invisible to the cost ledger. (WP-D)
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
        outputTokens: message.usage.output_tokens,
        totalCostUsd: this.takeTurnCostUsd(message.total_cost_usd),
      };

      const modelContextWindowMaxTokens = this.recordModelUsage(modelUsage ?? message.modelUsage);
      if (this.contextWindowMaxTokens !== undefined) {
        usage.contextWindowMaxTokens = this.contextWindowMaxTokens;
      } else if (modelContextWindowMaxTokens !== undefined) {
        usage.contextWindowMaxTokens = modelContextWindowMaxTokens;
      }

      const activeResultUsageTokens =
        readActiveUsageTokens(message.usage) ??
        (this.completedResultTurns === 0 ? readLegacyResultUsageTokens(message.usage) : undefined);
      const usedTokens =
        this.streamUsedTokens() ?? activeResultUsageTokens ?? this.compactedContextWindowUsedTokens;
      if (usedTokens !== undefined) {
        usage.contextWindowUsedTokens = usedTokens;
      }
      return usage;
    } finally {
      this.compactedContextWindowUsedTokens = undefined;
      this.completedResultTurns += 1;
    }
  }

  private streamUsedTokens(): number | undefined {
    if (
      typeof this.streamRequestInputTokens !== "number" ||
      typeof this.streamRequestOutputTokens !== "number"
    ) {
      return undefined;
    }
    const usedTokens = this.streamRequestInputTokens + this.streamRequestOutputTokens;
    return usedTokens > 0 ? usedTokens : undefined;
  }

  private createUsageUpdatedEvent(contextWindowUsedTokens: number): AgentStreamEvent {
    const usage: AgentUsage = {
      contextWindowUsedTokens,
    };
    if (this.contextWindowMaxTokens !== undefined) {
      usage.contextWindowMaxTokens = this.contextWindowMaxTokens;
    }
    return {
      type: "usage_updated",
      provider: "claude",
      usage,
    };
  }

  buildCompactionUsageEvent(postTokens: number | undefined): AgentStreamEvent {
    this.streamRequestInputTokens = undefined;
    this.streamRequestOutputTokens = undefined;
    this.compactedContextWindowUsedTokens = postTokens;
    const usage: AgentUsage = {};
    if (this.contextWindowMaxTokens !== undefined) {
      usage.contextWindowMaxTokens = this.contextWindowMaxTokens;
    }
    if (postTokens !== undefined) {
      usage.contextWindowUsedTokens = postTokens;
    }
    return {
      type: "usage_updated",
      provider: "claude",
      usage,
    };
  }
}

class ClaudeAgentSession implements AgentSession {
  readonly provider = "claude" as const;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private readonly config: ClaudeAgentConfig;
  private readonly launchEnv?: Record<string, string>;
  private readonly agentId?: string;
  private readonly defaults?: { agents?: Record<string, AgentDefinition> };
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly persistSession?: boolean;
  private readonly logger: Logger;
  private readonly queryFactory?: ClaudeQueryFactory;
  private readonly resolveBinary: () => Promise<string>;
  // Resolved daemon-wide behavior toggles captured at launch. Absent = all-on.
  private readonly agentBehaviors?: AgentBehaviorSettings;
  private query: Query | null = null;
  private childProcess: ChildProcess | null = null;
  private input: AsyncMessageInput<SDKUserMessage> | null = null;
  private claudeSessionId: string | null;
  private persistence: AgentPersistenceHandle | null;
  private currentMode: PermissionMode;
  private planResumeMode: PermissionMode | null = null;
  private toolUseCache = new Map<string, ToolUseCacheEntry>();
  private toolUseIndexToId = new Map<number, string>();
  private toolUseInputBuffers = new Map<string, string>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private activeForegroundTurnId: string | null = null;
  private autonomousTurn: AutonomousTurnState | null = null;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly timelineAssembler = new TimelineAssembler();
  private readonly sidechainTracker = new ClaudeSidechainTracker({
    getToolInput: (toolUseId) => this.toolUseCache.get(toolUseId)?.input ?? null,
  });
  // Observed-subagent bookkeeping (projects/observed-subagents/observed-subagents.md). Keys are the
  // parent Task tool_use ids seen live this session — history replay never
  // announces, so stale tasks from persisted history cannot materialize rows.
  private readonly announcedObservedSubagents = new Set<string>();
  private readonly observedKeyByTaskId = new Map<string, string>();
  // Nested fan-out: a subagent's own Task tool_use appears inside ITS
  // sidechain — record child tool_use id -> spawning sidechain's key so the
  // child's observed row parents to the spawning subagent, not the root agent
  // (trees render as trees). See docs/agent-lifecycle.md.
  private readonly observedParentKeyByToolUseId = new Map<string, string>();
  // Real per-sub-agent token accounting for plain Task fan-out: the live
  // sidechain assistant frames carry the full `message.usage` split + model
  // (workflow runs get theirs from the on-disk watcher instead). Keyed by the
  // observed row key (parent Task tool_use id) so each row is priced on its own
  // usage, not a roll-up. See [[subagent-real-accounting]].
  private readonly observedSubagentUsage = new Map<string, SubagentUsageAccumulator>();
  // Keys whose row reached a terminal status (idle/error/closed) — the
  // turn-end sweep settles anything still open, since a foreground Task
  // cannot outlive the turn that spawned it (a lost/garbled task_notification
  // otherwise left the row running forever).
  private readonly settledObservedSubagents = new Set<string>();
  // Workflow runs are backgrounded (they legitimately outlive the turn) —
  // exempt from the turn-end sweep; they settle via their own task_notification.
  private readonly workflowObservedKeys = new Set<string>();
  // Synthetic-event sources for Workflow (ultracode) runs: the live SDK stream
  // carries no per-internal-agent identity, so a watcher tails each run's
  // on-disk transcripts and re-emits observed-subagent events per internal
  // agent, nested under the workflow row. See
  // projects/workflow-decomposition/workflow-decomposition.md. Keyed by the
  // workflow observed key; claimedDirs is shared so two concurrent runs in one
  // session never bind the same on-disk dir.
  private readonly workflowWatchers = new Map<string, WorkflowTranscriptWatcher>();
  private readonly workflowClaimedDirs = new Set<string>();
  // Disk-backed usage source for plain Task/Agent sub-agents: tails each
  // sub-agent's <sessionId>/subagents/agent-<id>.jsonl once its tool_result
  // reveals the agentId. Authoritative over the live sidechain accumulator
  // (real output counts; depth ≥ 2 sub-agents never stream at all). See
  // task-transcript-watcher.ts.
  private readonly taskTranscriptWatcher: TaskTranscriptWatcher;
  // Workflow keys whose task_started arrived before claudeSessionId existed
  // (the watcher needs the session id to resolve the on-disk dir). Drained by
  // drainPendingWorkflowArms() at every point a session id gets assigned.
  // Value = the SDK task_id used for on-disk identity confirmation.
  private readonly pendingWorkflowArms = new Map<string, string | undefined>();
  private pendingObservedEvents: AgentStreamEvent[] = [];
  // Serialized last-emitted rate-limit payload; rate_limit_event fires per API
  // request, so only meaningful changes are forwarded to clients.
  private lastRateLimitEventKey: string | null = null;
  // Task ids from the last system/background_tasks_changed level payload
  // (REPLACE semantics). An id present in the previous payload but absent from
  // the next has settled even if its task_notification edge was lost — the
  // reconcile in appendBackgroundTasksChangedEvents is the safety net that
  // guarantees stuck workflow/background rows eventually settle. Edge events
  // still own row creation and rich terminal status.
  private lastBackgroundTaskIds = new Set<string>();
  // Background-shell-task bookkeeping, same shape as the observed-subagent
  // maps above but for Bash run_in_background tasks (not AI subagents).
  private readonly announcedBackgroundShellTasks = new Set<string>();
  private readonly backgroundShellKeyByTaskId = new Map<string, string>();
  private persistedHistory: PersistedTimelineEntry[] = [];
  private historyPending = false;
  private turnState: TurnState = "idle";
  private nextTurnOrdinal = 1;
  private cancelCurrentTurn: (() => void) | null = null;
  private cachedRuntimeInfo: AgentRuntimeInfo | null = null;
  private lastOptionsModel: string | null = null;
  private lastRuntimeModel: string | null = null;
  private compacting = false;
  private queryPumpPromise: Promise<void> | null = null;
  private queryRestartNeeded = false;
  private pendingInterruptAbort = false;
  private foregroundHasVisibleActivity = false;
  private activeTurnHasAssistantText = false;
  private readonly contextUsage: ClaudeContextUsageState;
  private userMessageIds: string[] = [];
  private readonly emittedUserMessageIds = new Set<string>();
  private readonly rewindTurnAnchors: ClaudeRewindTurnAnchor[] = [];
  private pendingFreshSessionId: string | null = null;
  private recentStderr = "";
  private closed = false;

  constructor(config: ClaudeAgentConfig, options: ClaudeAgentSessionOptions) {
    this.config = config;
    this.launchEnv = options.launchEnv;
    this.agentId = options.agentId;
    this.defaults = options.defaults;
    this.runtimeSettings = options.runtimeSettings;
    this.persistSession = options.persistSession;
    this.logger = options.logger.child({ agentId: this.agentId });
    this.queryFactory = options.queryFactory;
    this.resolveBinary = options.resolveBinary;
    this.agentBehaviors = options.agentBehaviors;
    this.contextUsage = new ClaudeContextUsageState(
      findClaudeModel(this.config.model)?.contextWindowMaxTokens,
    );
    this.taskTranscriptWatcher = new TaskTranscriptWatcher({
      cwd: this.config.cwd,
      getSessionId: () => this.claudeSessionId,
      emit: (event) => this.pushEvent(event),
      logger: this.logger,
    });
    const handle = options.handle;

    if (handle) {
      if (!handle.sessionId) {
        throw new Error("Cannot resume: persistence handle has no sessionId");
      }
      this.claudeSessionId = handle.sessionId;
      this.persistence = handle;
      this.loadPersistedHistory(handle.sessionId);
    } else {
      this.claudeSessionId = null;
      this.persistence = null;
    }

    // Validate mode if provided
    if (config.modeId && !VALID_CLAUDE_MODES.has(config.modeId)) {
      const validModesList = Array.from(VALID_CLAUDE_MODES).join(", ");
      throw new Error(
        `Invalid mode '${config.modeId}' for Claude provider. Valid modes: ${validModesList}`,
      );
    }

    // Note: an auto mode the model can't run is NOT coerced here — the
    // buildOptions assert fails the first turn with the specific reason
    // instead, keeping the mismatch visible (clients hide Auto up front via
    // the catalog's supportsAutoMode stamp and getAvailableModes filtering).
    this.currentMode = isPermissionMode(config.modeId) ? config.modeId : "default";
    if (this.currentMode !== "plan") {
      this.planResumeMode = this.currentMode;
    }
  }

  get id(): string | null {
    return this.claudeSessionId;
  }

  get features(): AgentFeature[] {
    return buildClaudeFeatures({
      modelId: this.config.model,
      fastModeEnabled: this.config.featureValues?.fast_mode === true,
    });
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    if (this.cachedRuntimeInfo) {
      return { ...this.cachedRuntimeInfo };
    }
    const info: AgentRuntimeInfo = {
      provider: "claude",
      sessionId: this.claudeSessionId,
      model: this.lastOptionsModel,
      modeId: this.currentMode ?? null,
      ...(this.lastRuntimeModel
        ? {
            extra: {
              runtimeModel: this.lastRuntimeModel,
            },
          }
        : {}),
    };
    this.cachedRuntimeInfo = info;
    return { ...info };
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const result = await runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.claudeSessionId ?? "",
      reduceFinalText: appendOrReplaceGrowingAssistantMessage,
    });

    this.cachedRuntimeInfo = {
      provider: "claude",
      sessionId: this.claudeSessionId,
      model: this.lastOptionsModel,
      modeId: this.currentMode ?? null,
    };

    if (!this.claudeSessionId) {
      throw new Error("Session ID not set after run completed");
    }

    return result;
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.closed) {
      throw new Error("Claude session is closed");
    }
    if (this.activeForegroundTurnId) {
      throw new Error("A foreground turn is already active");
    }

    const slashCommand = this.resolveSlashCommandInvocation(prompt);
    if (slashCommand?.commandName === REWIND_COMMAND_NAME) {
      const turnId = this.createTurnId("foreground");
      this.activeForegroundTurnId = turnId;
      this.transitionTurnState("foreground", "rewind command");
      void this.executeRewindTurn(turnId, slashCommand);
      return { turnId };
    }

    if (this.autonomousTurn) {
      this.completeAutonomousTurn();
    }

    const sdkMessage = this.toSdkUserMessage(prompt);
    const sdkUserMessageId =
      typeof sdkMessage.uuid === "string" && sdkMessage.uuid.length > 0 ? sdkMessage.uuid : null;
    this.rememberRewindUserAnchor(sdkUserMessageId);
    const turnId = this.createTurnId("foreground");
    this.activeForegroundTurnId = turnId;
    this.foregroundHasVisibleActivity = false;
    this.activeTurnHasAssistantText = false;
    this.contextUsage.beginTurn();
    this.transitionTurnState("foreground", "foreground turn started");
    this.clearRecentStderr();

    let cancelIssued = false;
    const requestCancel = () => {
      if (cancelIssued) {
        return;
      }
      cancelIssued = true;
      if (this.cancelCurrentTurn === requestCancel) {
        this.cancelCurrentTurn = null;
      }
      this.rejectAllPendingPermissions(new Error("Permission request aborted"));
      this.finishForegroundTurn({
        type: "turn_canceled",
        provider: "claude",
        reason: "Interrupted",
      });
      void this.interruptActiveTurn().catch((error) => {
        this.logger.warn({ err: error }, "Failed to interrupt during cancel");
      });
    };
    this.cancelCurrentTurn = requestCancel;

    this.beginTurn();

    try {
      await this.ensureQuery();
      if (!this.input) {
        throw new Error("Claude session input stream not initialized");
      }
      this.startQueryPump();
      this.input.push(sdkMessage);
      setTimeout(() => {
        if (this.activeForegroundTurnId === turnId) {
          this.emitSubmittedUserMessage(sdkMessage, turnId);
        }
      }, 0);
    } catch (error) {
      this.finishForegroundTurn(
        this.buildTurnFailedEvent(error instanceof Error ? error.message : "Claude stream failed"),
      );
    }

    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async interrupt(): Promise<void> {
    if (this.cancelCurrentTurn) {
      this.cancelCurrentTurn();
      return;
    }

    if (this.autonomousTurn) {
      this.flushPendingToolCalls();
      this.completeAutonomousTurn();
    }

    await this.interruptActiveTurn();
  }

  /**
   * Stop a provider-managed subagent task (observed subagent) without touching
   * the parent turn. A task_notification with status "stopped" follows and
   * settles the observed row. See projects/observed-subagents/observed-subagents.md.
   */
  async stopTask(taskId: string): Promise<void> {
    const activeQuery = this.query;
    if (!activeQuery) {
      throw new Error("No active Claude session to stop the subagent task");
    }
    await activeQuery.stopTask(taskId);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    if (!this.historyPending || this.persistedHistory.length === 0) {
      return;
    }
    const history = this.persistedHistory;
    this.persistedHistory = [];
    this.historyPending = false;
    for (const entry of history) {
      yield {
        type: "timeline",
        item: entry.item,
        provider: "claude",
        timestamp: entry.timestamp,
      };
    }
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    // Computed per call so the list tracks the current model: Auto is hidden
    // whenever the classifier can't run for this model + auth path (the CLI
    // would reject it with "auto mode unavailable for this model").
    const verdict = checkClaudeAutoModeSupport(
      this.currentModelId(),
      this.buildSdkEnv(this.config.extra?.claude),
    );
    if (verdict.supported) {
      return DEFAULT_MODES;
    }
    return DEFAULT_MODES.filter((mode) => mode.id !== "auto");
  }

  /** Best-known current model: runtime-reported (init message) over configured. */
  private currentModelId(): string | null {
    return this.lastOptionsModel ?? this.config.model ?? null;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentMode ?? null;
  }

  /**
   * When a query restart is already pending, live SDK setters must not call
   * ensureQuery(): with a turn active it would recycle the CLI mid-turn — the
   * replaced query's pump deliberately skips failActiveTurns and no pump
   * starts until the next startTurn, orphaning the foreground turn forever.
   * The doomed query is rebuilt from config anyway, so staging the change in
   * config and letting the pending lazy restart pick it up is both safe and
   * cheaper (idle case: skips an eager teardown + respawn).
   */
  private mustStageSettingChange(): boolean {
    return this.queryRestartNeeded;
  }

  private hasActiveTurn(): boolean {
    return Boolean(this.activeForegroundTurnId || this.autonomousTurn);
  }

  async setMode(modeId: string): Promise<void | AgentProviderNotice> {
    // Validate mode
    if (!VALID_CLAUDE_MODES.has(modeId)) {
      const validModesList = Array.from(VALID_CLAUDE_MODES).join(", ");
      throw new Error(
        `Invalid mode '${modeId}' for Claude provider. Valid modes: ${validModesList}`,
      );
    }

    const normalized = isPermissionMode(modeId) ? modeId : "default";
    assertClaudeAutoModeEligible(
      normalized,
      this.currentModelId(),
      this.buildSdkEnv(this.config.extra?.claude),
    );
    const previousMode = this.currentMode;
    const stagedOnly = this.mustStageSettingChange();
    if (!stagedOnly) {
      const activeQuery = await this.ensureQuery();
      await activeQuery.setPermissionMode(normalized);
    }
    if (normalized === "plan") {
      if (previousMode !== "plan") {
        this.planResumeMode = previousMode;
      }
    } else {
      this.planResumeMode = normalized;
    }
    // The rebuilt query reads permissionMode from currentMode in buildOptions,
    // so the staged value applies at the pending restart.
    this.currentMode = normalized;
    if (stagedOnly && this.hasActiveTurn()) {
      return SETTING_APPLIES_NEXT_TURN_NOTICE;
    }
  }

  async setModel(modelId: string | null): Promise<void> {
    const normalizedModelId =
      typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;
    if (!this.mustStageSettingChange()) {
      const activeQuery = await this.ensureQuery();
      await activeQuery.setModel(normalizedModelId ?? undefined);
    }
    // Staged case: buildOptions reads config.model when the pending restart
    // rebuilds the query.
    this.config.model = normalizedModelId ?? undefined;
    if (!claudeModelSupportsFastMode(this.config.model) && this.config.featureValues?.fast_mode) {
      await this.applyFastModeFeature(false);
    }
    this.contextUsage.setInitialContextWindowMaxTokens(
      findClaudeModel(this.config.model)?.contextWindowMaxTokens,
    );
    this.lastOptionsModel = normalizedModelId ?? this.lastOptionsModel;
    this.lastRuntimeModel = null;
    this.cachedRuntimeInfo = null;
    // Model change affects persistence metadata, so invalidate cached handle.
    this.persistence = null;
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void | AgentProviderNotice> {
    const normalizedThinkingOptionId =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
        ? thinkingOptionId
        : null;

    if (!normalizedThinkingOptionId || normalizedThinkingOptionId === "default") {
      this.config.thinkingOptionId = undefined;
    } else if (isClaudeThinkingOption(normalizedThinkingOptionId)) {
      this.config.thinkingOptionId = normalizedThinkingOptionId;
    } else {
      throw new Error(`Unknown thinking option: ${normalizedThinkingOptionId}`);
    }
    this.queryRestartNeeded = true;
    if (this.activeForegroundTurnId || this.autonomousTurn) {
      return SETTING_APPLIES_NEXT_TURN_NOTICE;
    }
  }

  async applyPersonality(update: AgentPersonalityUpdate): Promise<void | AgentProviderNotice> {
    this.config.personalitySnapshot = update.personalitySnapshot;
    this.config.systemPrompt = update.systemPrompt;
    this.config.daemonAppendSystemPrompt = update.daemonAppendSystemPrompt;
    // The system prompt is baked into the query options; recreate the query on
    // the next turn (resuming the same session id) so the new prompt applies.
    this.queryRestartNeeded = true;
    if (this.activeForegroundTurnId || this.autonomousTurn) {
      return SETTING_APPLIES_NEXT_TURN_NOTICE;
    }
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId !== "fast_mode") {
      throw new Error(`Unknown Claude feature: ${featureId}`);
    }

    const enabled = Boolean(value);
    if (enabled && !claudeModelSupportsFastMode(this.config.model)) {
      throw new Error(
        `Claude fast mode is not available for model '${this.config.model ?? "default"}'`,
      );
    }

    await this.applyFastModeFeature(enabled);
  }

  async getContextUsage(): Promise<AgentContextUsage | null> {
    // Passive read for the client's context popup: only report from an already
    // live query. Spawning the CLI just to answer a popup would be wasteful.
    const activeQuery = this.query;
    if (!activeQuery) {
      return null;
    }
    const breakdown = await activeQuery.getContextUsage();
    return {
      categories: breakdown.categories.map((category) => ({
        name: category.name,
        tokens: category.tokens,
        ...(category.isDeferred ? { isDeferred: true } : {}),
      })),
      totalTokens: breakdown.totalTokens,
      maxTokens: breakdown.maxTokens,
    };
  }

  private async applyFastModeFeature(enabled: boolean, query?: Query): Promise<void> {
    this.config.featureValues = {
      ...this.config.featureValues,
      fast_mode: enabled,
    };
    const activeQuery = query ?? this.query;
    if (activeQuery) {
      await activeQuery.applyFlagSettings({ fastMode: enabled });
    }
    this.cachedRuntimeInfo = null;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return Array.from(this.pendingPermissions.values()).map((entry) => entry.request);
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with id '${requestId}'`);
    }
    this.pendingPermissions.delete(requestId);
    pending.cleanup?.();

    if (response.behavior === "allow") {
      if (pending.request.kind === "plan") {
        const selectedActionId = response.selectedActionId;
        const shouldResumePriorMode =
          selectedActionId === "implement_resume" && this.planResumeMode === "bypassPermissions";
        const targetMode: PermissionMode = shouldResumePriorMode
          ? "bypassPermissions"
          : "acceptEdits";
        await this.setMode(targetMode);
        this.pushToolCall(
          mapClaudeCompletedToolCall({
            name: "plan_approval",
            callId: pending.request.id,
            input: pending.request.input ?? null,
            output: {
              approved: true,
              actionId: selectedActionId ?? "implement",
            },
          }),
        );
      }
      const updatedInput =
        pending.request.kind === "question"
          ? normalizeClaudeAskUserQuestionUpdatedInput(
              response.updatedInput,
              pending.request.input ?? undefined,
            )
          : (response.updatedInput ?? pending.request.input ?? {});
      const result: PermissionResult = {
        behavior: "allow",
        updatedInput,
        updatedPermissions: this.normalizePermissionUpdates(response.updatedPermissions),
      };
      pending.resolve(result);
    } else {
      if (pending.request.kind === "tool") {
        this.pushToolCall(
          mapClaudeFailedToolCall({
            name: pending.request.name,
            callId:
              (typeof pending.request.metadata?.toolUseId === "string"
                ? pending.request.metadata.toolUseId
                : null) ?? pending.request.id,
            input: pending.request.input ?? null,
            output: null,
            error: { message: response.message ?? "Permission denied" },
          }),
        );
      }
      const result: PermissionResult = {
        behavior: "deny",
        message: response.message ?? "Permission request denied",
        interrupt: response.interrupt,
      };
      pending.resolve(result);
    }

    this.pushEvent({
      type: "permission_resolved",
      provider: "claude",
      requestId,
      resolution: response,
    });
  }

  describePersistence(): AgentPersistenceHandle | null {
    if (this.persistence) {
      return this.persistence;
    }
    if (!this.claudeSessionId) {
      return null;
    }
    this.persistence = {
      provider: "claude",
      sessionId: this.claudeSessionId,
      nativeHandle: this.claudeSessionId,
      metadata: { ...this.config },
    };
    return this.persistence;
  }

  private isChildProcessAlive(): boolean {
    const child = this.childProcess;
    return child !== null && child.exitCode === null && child.signalCode === null;
  }

  async close(): Promise<void> {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.claudeSessionId,
        turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
        turnState: this.turnState,
        hasQuery: Boolean(this.query),
        hasInput: Boolean(this.input),
        hasActiveForegroundTurnId: Boolean(this.activeForegroundTurnId),
      },
      "provider.claude.session_close.start",
    );
    this.closed = true;
    this.rejectAllPendingPermissions(new Error("Claude session closed"));
    this.cancelCurrentTurn?.();
    // Disarm workflow watchers BEFORE dropping subscribers: disarm emits the
    // terminal 'closed' observed_subagent_updated events for still-running
    // workflow children via pushEvent → notifySubscribers, which is a no-op
    // against an empty subscriber set (the child rows would stay "running"
    // forever after a mid-run close).
    for (const watcher of this.workflowWatchers.values()) {
      watcher.disarm("closed");
    }
    this.workflowWatchers.clear();
    this.workflowClaimedDirs.clear();
    this.pendingWorkflowArms.clear();
    this.taskTranscriptWatcher.close();
    this.subscribers.clear();
    this.activeForegroundTurnId = null;
    this.autonomousTurn = null;
    this.cancelCurrentTurn = null;
    this.turnState = "idle";
    this.sidechainTracker.clear();
    this.workflowObservedKeys.clear();
    this.announcedObservedSubagents.clear();
    this.observedKeyByTaskId.clear();
    this.observedSubagentUsage.clear();
    this.pendingObservedEvents = [];
    this.announcedBackgroundShellTasks.clear();
    this.backgroundShellKeyByTaskId.clear();
    this.input?.end();
    this.query?.close?.();
    // interrupt() issues a control-plane request that writes to the CLI's stdin.
    // Only worth doing while the process is still running: one-shot internal
    // agents (commit-message / PR / branch-name generators) have already exited
    // by the time we close them, so the write hits a dead transport and throws
    // "ProcessTransport is not ready for writing". An in-flight turn was already
    // interrupted above via cancelCurrentTurn(). return() takes no such request
    // (it just cancels the input reader), so it stays unconditional.
    if (this.isChildProcessAlive()) {
      await this.awaitWithTimeout(this.query?.interrupt?.(), "close query interrupt");
    }
    await this.awaitWithTimeout(this.query?.return?.(), "close query return");
    this.query = null;
    this.input = null;
    // Terminate the entire process tree (claude + MCP children) to prevent
    // orphan accumulation. The SDK's internal cleanup may only kill the
    // direct child process.
    if (this.childProcess) {
      const result = await terminateWithTreeKill(this.childProcess, {
        gracefulTimeoutMs: 2_000,
        forceTimeoutMs: 2_000,
      });
      if (result === "kill-timeout") {
        this.logger.warn(
          { pid: this.childProcess.pid, agentId: this.agentId },
          "Claude process tree did not report exit after SIGKILL",
        );
      }
      this.childProcess = null;
    }
    if (this.persistSession === false && this.claudeSessionId) {
      // Claude Code currently ignores --no-session-persistence outside --print mode
      // (see `claude --help`), so the SDK's persistSession=false is silently dropped
      // in stream-json mode. Sweep the transcript ourselves so ephemeral runs
      // (metadata generator, branch-name generator) don't show up as resumable.
      const historyPath = this.resolveHistoryPath(this.claudeSessionId);
      if (historyPath) {
        try {
          await promises.rm(historyPath, { force: true });
        } catch (error) {
          this.logger.warn(
            { err: error, historyPath, claudeSessionId: this.claudeSessionId },
            "Failed to delete ephemeral Claude session transcript",
          );
        }
      }
    }
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.claudeSessionId,
        turnState: this.turnState,
      },
      "provider.claude.session_close.complete",
    );
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    const q = await this.ensureQuery();
    const commands = await q.supportedCommands();
    const commandMap = new Map<string, AgentSlashCommand>();
    for (const cmd of commands) {
      if (!commandMap.has(cmd.name)) {
        commandMap.set(cmd.name, {
          name: cmd.name,
          description: cmd.description,
          argumentHint: cmd.argumentHint,
          kind: classifyClaudeSlashCommand(cmd.name),
        });
      }
    }
    if (!commandMap.has(REWIND_COMMAND_NAME)) {
      commandMap.set(REWIND_COMMAND_NAME, REWIND_COMMAND);
    }
    return Array.from(commandMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async revertConversation(input: { messageId: string }): Promise<void> {
    const target = this.resolveConversationRewindTarget(input.messageId);
    if (target.kind === "fresh-session") {
      this.startFreshConversationSession();
      return;
    }
    await revertClaudeConversation({
      sdk: realClaudeRewindSdk,
      sessionId: this.claudeSessionId,
      messageId: target.messageId,
      resolveMessageId: (messageId) => this.resolveClaudeMessageId(messageId),
      setSessionId: (sessionId) => {
        this.rebindConversationSession(sessionId);
      },
    });
  }

  async revertFiles(input: { messageId: string }): Promise<void> {
    const messageId = await this.resolveClaudeMessageId(input.messageId);
    await revertClaudeFiles({
      query: await this.ensureQuery(),
      messageId,
    });
  }

  async revertBoth(input: { messageId: string }): Promise<void> {
    await this.revertFiles(input);
    await this.revertConversation(input);
  }

  private resolveSlashCommandInvocation(prompt: AgentPromptInput): SlashCommandInvocation | null {
    if (typeof prompt !== "string") {
      return null;
    }
    const parsed = this.parseSlashCommandInput(prompt);
    if (!parsed) {
      return null;
    }
    return parsed.commandName === REWIND_COMMAND_NAME ? parsed : null;
  }

  private parseSlashCommandInput(text: string): SlashCommandInvocation | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/") || trimmed.length <= 1) {
      return null;
    }
    const withoutPrefix = trimmed.slice(1);
    const firstWhitespaceIdx = withoutPrefix.search(/\s/);
    const commandName =
      firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
    if (!commandName || commandName.includes("/")) {
      return null;
    }
    const rawArgs =
      firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
    return rawArgs.length > 0
      ? { commandName, args: rawArgs, rawInput: trimmed }
      : { commandName, rawInput: trimmed };
  }

  private buildRewindSuccessMessage(
    targetUserMessageId: string,
    rewindResult: {
      filesChanged?: string[];
      insertions?: number;
      deletions?: number;
    },
  ): string {
    const fileCount = Array.isArray(rewindResult.filesChanged)
      ? rewindResult.filesChanged.length
      : undefined;
    const stats: string[] = [];
    if (typeof fileCount === "number") {
      stats.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
    }
    if (typeof rewindResult.insertions === "number") {
      stats.push(`${rewindResult.insertions} insertions`);
    }
    if (typeof rewindResult.deletions === "number") {
      stats.push(`${rewindResult.deletions} deletions`);
    }
    if (stats.length > 0) {
      return `Rewound tracked files to message ${targetUserMessageId} (${stats.join(", ")}).`;
    }
    return `Rewound tracked files to message ${targetUserMessageId}.`;
  }

  private async attemptRewind(args: string | undefined): Promise<{
    messageId: string | null;
    result?: {
      filesChanged?: string[];
      insertions?: number;
      deletions?: number;
    };
    error?: string;
  }> {
    if (typeof args === "string" && args.trim().length > 0) {
      const candidate = args.trim().split(/\s+/)[0] ?? "";
      if (!UUID_PATTERN.test(candidate)) {
        return {
          messageId: null,
          error: "Invalid message UUID. Usage: /rewind <user_message_uuid> or /rewind",
        };
      }
      const rewindResult = await this.rewindFilesOnce(candidate);
      if (rewindResult.canRewind) {
        return { messageId: candidate, result: rewindResult };
      }
      return {
        messageId: null,
        error: rewindResult.error ?? `No file checkpoint found for message ${candidate}.`,
      };
    }

    const candidates = this.getRewindCandidateUserMessageIds();
    if (candidates.length === 0) {
      return {
        messageId: null,
        error: "No prior user message available to rewind. Use /rewind <user_message_uuid>.",
      };
    }

    let lastError: string | undefined;
    for (const candidate of candidates) {
      try {
        const rewindResult = await this.rewindFilesOnce(candidate);
        if (rewindResult.canRewind) {
          return { messageId: candidate, result: rewindResult };
        }
        if (rewindResult.error) {
          lastError = rewindResult.error;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Failed to rewind tracked files.";
      }
    }

    return {
      messageId: null,
      error: lastError ?? "No rewind checkpoints are currently available for this session.",
    };
  }

  private async rewindFilesOnce(messageId: string): Promise<{
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
  }> {
    try {
      const activeQuery = await this.ensureFreshQuery();
      return await activeQuery.rewindFiles(messageId, { dryRun: false });
    } catch (error) {
      // The Claude SDK transport can close after a rewind call.
      // If that happens, mark the query stale so a follow-up attempt uses a fresh query.
      this.queryRestartNeeded = true;
      throw error;
    }
  }

  private async ensureFreshQuery(): Promise<Query> {
    if (this.query) {
      this.queryRestartNeeded = true;
    }
    return this.ensureQuery();
  }

  private getRewindCandidateUserMessageIds(): string[] {
    const candidates: string[] = [];
    const pushUnique = (value: string | null | undefined) => {
      if (typeof value === "string" && value.length > 0 && !candidates.includes(value)) {
        candidates.push(value);
      }
    };

    for (let idx = this.persistedHistory.length - 1; idx >= 0; idx -= 1) {
      const entry = this.persistedHistory[idx];
      if (entry?.item.type === "user_message") {
        pushUnique(entry.item.messageId);
      }
    }
    for (let idx = this.userMessageIds.length - 1; idx >= 0; idx -= 1) {
      pushUnique(this.userMessageIds[idx]);
    }

    return candidates;
  }

  private rebindConversationSession(sessionId: string): void {
    const oldSessionId = this.claudeSessionId;
    this.claudeSessionId = sessionId;
    this.pendingFreshSessionId = null;
    this.persistence = null;
    this.cachedRuntimeInfo = null;
    this.queryRestartNeeded = true;
    this.persistedHistory = [];
    this.historyPending = false;
    this.userMessageIds = [];
    this.emittedUserMessageIds.clear();
    this.rewindTurnAnchors.length = 0;
    this.loadPersistedHistory(sessionId);
    this.drainPendingWorkflowArms();
    if (oldSessionId && oldSessionId !== sessionId) {
      this.dispatchEvents([
        {
          type: "timeline",
          provider: "claude",
          item: this.createClaudeSessionChangedNotice(oldSessionId, sessionId),
        },
        {
          type: "thread_started",
          provider: "claude",
          sessionId,
        },
      ]);
    }
  }

  private startFreshConversationSession(): void {
    const sessionId = randomUUID();
    this.claudeSessionId = sessionId;
    this.pendingFreshSessionId = sessionId;
    this.persistence = null;
    this.cachedRuntimeInfo = null;
    this.queryRestartNeeded = true;
    this.persistedHistory = [];
    this.historyPending = false;
    this.userMessageIds = [];
    this.emittedUserMessageIds.clear();
    this.rewindTurnAnchors.length = 0;
    this.drainPendingWorkflowArms();
  }

  private rememberUserMessageId(messageId: string | null | undefined): void {
    if (typeof messageId !== "string" || messageId.length === 0) {
      return;
    }
    const last = this.userMessageIds[this.userMessageIds.length - 1];
    if (last === messageId) {
      return;
    }
    this.userMessageIds.push(messageId);
  }

  private rememberEmittedUserMessageId(messageId: string | null | undefined): void {
    if (typeof messageId !== "string" || messageId.length === 0) {
      return;
    }
    this.emittedUserMessageIds.add(messageId);
  }

  private rememberRewindUserAnchor(userMessageId: string | null | undefined): void {
    if (typeof userMessageId !== "string" || userMessageId.length === 0) {
      return;
    }
    if (this.rewindTurnAnchors.some((anchor) => anchor.userMessageId === userMessageId)) {
      return;
    }
    this.rewindTurnAnchors.push({
      userMessageId,
      assistantMessageId: null,
    });
  }

  private rememberRewindAssistantAnchor(assistantMessageId: string | null | undefined): void {
    if (typeof assistantMessageId !== "string" || assistantMessageId.length === 0) {
      return;
    }
    for (let index = this.rewindTurnAnchors.length - 1; index >= 0; index -= 1) {
      const anchor = this.rewindTurnAnchors[index];
      if (!anchor) {
        continue;
      }
      anchor.assistantMessageId = assistantMessageId;
      return;
    }
  }

  private rememberTranscriptProgress(message: SDKMessage, messageId: string | null): void {
    if (!messageId) {
      return;
    }
    if (
      message.type === "user" &&
      !isSyntheticUserEntry(message) &&
      !isToolResultUserEntry(message)
    ) {
      this.rememberRewindUserAnchor(messageId);
      return;
    }
    if (message.type === "assistant") {
      this.rememberRewindAssistantAnchor(messageId);
      return;
    }
    if (message.type === "stream_event") {
      const event = toObjectRecord(message.event) ?? {};
      const eventType = readTrimmedString(event.type);
      if (eventType === "message_start") {
        this.rememberRewindAssistantAnchor(messageId);
      }
      return;
    }
  }

  private resolveClaudeMessageId(messageId: string): string {
    return messageId;
  }

  private resolveConversationRewindTarget(messageId: string): ClaudeConversationRewindTarget {
    const targetUserMessageId = this.resolveClaudeMessageId(messageId);
    const index = this.rewindTurnAnchors.findIndex(
      (anchor) => anchor.userMessageId === targetUserMessageId,
    );
    if (index < 0) {
      throw new Error(`Claude rewind target ${messageId} is not in the tracked conversation`);
    }

    if (index === 0) {
      return { kind: "fresh-session" };
    }

    const previousTurn = this.rewindTurnAnchors[index - 1];
    if (!previousTurn?.assistantMessageId) {
      throw new Error(
        `Claude rewind cannot preserve turn ${index} because its assistant response id was not observed`,
      );
    }
    return { kind: "fork", messageId: previousTurn.assistantMessageId };
  }

  private async ensureQuery(): Promise<Query> {
    if (this.query && !this.queryRestartNeeded) {
      return this.query;
    }

    if (this.queryRestartNeeded && this.query) {
      const oldQuery = this.query;
      const oldInput = this.input;
      // Null out query/input BEFORE awaiting the old iterator's return so the
      // old pump sees this.query !== activeQuery and skips failActiveTurns.
      this.query = null;
      this.input = null;
      this.queryPumpPromise = null;
      this.queryRestartNeeded = false;
      oldInput?.end();
      oldQuery.close?.();
      try {
        await oldQuery.return?.();
      } catch {
        /* ignore */
      }
      // Tree-kill the old process tree now that the SDK has cleaned up.
      // If we skip this, MCP children of the previous claude process can
      // survive as orphans when the session spawns a replacement query.
      if (this.childProcess) {
        await terminateWithTreeKill(this.childProcess, {
          gracefulTimeoutMs: 2_000,
          forceTimeoutMs: 2_000,
        }).catch(() => {
          /* process may already be dead */
        });
        this.childProcess = null;
      }
    }

    // Preserve claudeSessionId across query recreation so buildOptions() passes
    // resume: sessionId and the new query continues the existing conversation.
    this.persistence = null;

    const input = createAsyncMessageInput<SDKUserMessage>();
    const options = await this.buildOptions();
    this.logger.debug({ options: summarizeClaudeOptionsForLog(options) }, "claude query");
    this.input = input;
    this.query = claudeQuery(
      { prompt: input.iterable, options },
      {
        runtimeSettings: this.runtimeSettings,
        launchEnv: this.launchEnv,
        queryFactory: this.queryFactory,
        onChildProcess: (child) => {
          this.childProcess = child;
        },
      },
    );
    const fastMode = this.resolveFastModeSetting();
    if (fastMode !== null) {
      await this.query.applyFlagSettings({ fastMode });
    }
    // Do not kick off background control-plane queries here. Methods like
    // supportedCommands()/setPermissionMode() may execute immediately after
    // ensureQuery() (for listCommands()/setMode()), and sharing the same query
    // control plane can cause those calls to wait behind supportedModels().
    return this.query;
  }

  private async awaitWithTimeout(
    promise: Promise<unknown> | undefined,
    label: string,
  ): Promise<void> {
    if (!promise) {
      this.logger.trace(
        {
          agentId: this.agentId,
          provider: "claude",
          sessionId: this.claudeSessionId,
          turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
          label,
        },
        "provider.claude.query_operation.skip",
      );
      return;
    }
    const startedAt = Date.now();
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.claudeSessionId,
        turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
        label,
      },
      "provider.claude.query_operation.start",
    );
    try {
      await withTimeout(promise, 3_000, "timeout");
      this.logger.trace(
        {
          agentId: this.agentId,
          provider: "claude",
          sessionId: this.claudeSessionId,
          turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
          label,
          durationMs: Date.now() - startedAt,
        },
        "provider.claude.query_operation.settled",
      );
    } catch (error) {
      // A query whose CLI process has already exited rejects control-plane calls
      // with "ProcessTransport is not ready for writing" / "Operation aborted".
      // That is expected during teardown (and covered by the liveness gate in
      // close()); only a race can still reach here, so don't log it as a warning.
      if (isExpectedTransportTeardownError(error)) {
        this.logger.debug(
          { err: error, label },
          "Claude query operation skipped on closed transport",
        );
      } else {
        this.logger.warn({ err: error, label }, "Claude query operation did not settle cleanly");
      }
    }
  }

  private resolveThinkingConfig(): {
    thinking: ClaudeOptions["thinking"];
    effort: ClaudeOptions["effort"];
    ultracode: boolean;
  } {
    const thinkingOptionId =
      this.config.thinkingOptionId && this.config.thinkingOptionId !== "default"
        ? this.config.thinkingOptionId
        : undefined;
    if (thinkingOptionId === CLAUDE_ULTRACODE_THINKING_OPTION_ID) {
      return { thinking: { type: "adaptive" }, effort: "xhigh", ultracode: true };
    }
    if (thinkingOptionId && isClaudeThinkingEffort(thinkingOptionId)) {
      return { thinking: { type: "adaptive" }, effort: thinkingOptionId, ultracode: false };
    }
    return { thinking: undefined, effort: undefined, ultracode: false };
  }

  private buildAppendedSystemPrompt(): string {
    return (
      composeSystemPromptParts(this.config.systemPrompt, this.config.daemonAppendSystemPrompt) ?? ""
    );
  }

  // Whether to ask the Claude CLI to emit next-user-prompt suggestions after
  // each turn. Two independent off paths: the daemon behavior toggle
  // (agentBehaviors.promptSuggestions), and the CLI env kill-switch
  // CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false (audit-verified). Default on.
  private resolvePromptSuggestionsEnabled(): boolean {
    if (this.agentBehaviors?.promptSuggestions === false) {
      return false;
    }
    const envValue =
      this.launchEnv?.["CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION"] ??
      process.env["CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION"];
    if (typeof envValue === "string" && envValue.trim().toLowerCase() === "false") {
      return false;
    }
    return true;
  }

  // Periodic AI progress summaries for observed subagents. Default on; the
  // daemon behavior toggle is the only off path. When off, observed-subagent
  // rows keep free tool-level activity but lose the ~30s progress blurb.
  private resolveAgentProgressSummariesEnabled(): boolean {
    return this.agentBehaviors?.agentProgressSummaries !== false;
  }

  private buildSdkEnv(extraClaudeOptions: Partial<ClaudeOptions> | undefined): NodeJS.ProcessEnv {
    return createProviderEnv({
      baseEnv: process.env,
      runtimeSettings: this.runtimeSettings,
      overlays: [
        extraClaudeOptions?.env,
        {
          // Increase MCP timeouts for long-running tool calls (10 minutes)
          MCP_TIMEOUT: "600000",
          MCP_TOOL_TIMEOUT: "600000",
        },
        this.launchEnv,
      ],
    });
  }

  private async buildOptions(): Promise<ClaudeOptions> {
    const { thinking, effort, ultracode } = this.resolveThinkingConfig();
    const appendedSystemPrompt = this.buildAppendedSystemPrompt();
    const extraClaudeOptions = this.config.extra?.claude;
    const settingsOptions = this.buildSettingsOptions(extraClaudeOptions, { ultracode });
    const sdkEnv = this.buildSdkEnv(extraClaudeOptions);
    assertClaudeAutoModeEligible(this.currentMode, this.currentModelId(), sdkEnv);

    const claudeBinary = await this.resolveBinary();
    this.logger.debug(
      {
        claudeBinary,
        pathEnvKey: resolvePathEnvKey(),
        pathIncludesClaudeLocalBin: (process.env["Path"] ?? process.env["PATH"] ?? "")
          .toLowerCase()
          .includes("\\.local\\bin"),
      },
      "Resolved Claude executable",
    );
    const sessionBinding: Pick<ClaudeOptions, "resume" | "sessionId"> = {};
    if (this.pendingFreshSessionId) {
      sessionBinding.sessionId = this.pendingFreshSessionId;
    } else if (this.claudeSessionId) {
      sessionBinding.resume = this.claudeSessionId;
    }

    const base: ClaudeOptions = {
      cwd: this.config.cwd,
      includePartialMessages: true,
      // Forward the full subagent conversation (not just tool_use/tool_result
      // heartbeats) and periodic progress summaries so observed subagents can be
      // promoted to first-class, separately-watchable track rows. See
      // projects/observed-subagents/observed-subagents.md.
      forwardSubagentText: true,
      // Periodic AI progress summaries for observed subagents. Gated by the
      // daemon behavior toggle (default on); other providers ignore this.
      agentProgressSummaries: this.resolveAgentProgressSummariesEnabled(),
      // Predicted next-user-prompt suggestions, emitted after each turn's result.
      // Nearly free (piggyback on the parent prompt cache); the app decides whether
      // to render them as composer ghost text via the promptSuggestions setting.
      // Generation is gated by the daemon behavior toggle (default on) and the
      // CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false CLI kill-switch.
      promptSuggestions: this.resolvePromptSuggestionsEnabled(),
      permissionMode: this.currentMode,
      // Dynamic mode switching can recreate the underlying Claude query. Keep the
      // bypass launch capability available so later setPermissionMode("bypassPermissions")
      // calls do not fail after a model/thinking/rewind-driven restart.
      allowDangerouslySkipPermissions: true,
      agents: this.defaults?.agents,
      canUseTool: this.handlePermissionRequest,
      pathToClaudeCodeExecutable: claudeBinary,
      // Use Claude Code preset system prompt and load CLAUDE.md files
      // Append provider-agnostic system prompts for agents.
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: appendedSystemPrompt,
      },
      settingSources: CLAUDE_SETTING_SOURCES,
      stderr: (data: string) => {
        this.captureStderr(data);
        this.logger.error({ stderr: data.trim() }, "Claude Agent SDK stderr");
      },
      // Required for provider-level /rewind support.
      enableFileCheckpointing: true,
      // If we have a session ID from a previous query (e.g., after interrupt),
      // resume that session to continue the conversation history.
      ...sessionBinding,
      ...(thinking ? { thinking } : {}),
      ...(effort ? { effort } : {}),
      ...extraClaudeOptions,
      ...settingsOptions,
      ...(this.persistSession === undefined ? {} : { persistSession: this.persistSession }),
      env: sdkEnv,
    };

    if (this.config.mcpServers) {
      base.mcpServers = this.normalizeMcpServers(this.config.mcpServers);
    }

    if (this.config.model) {
      base.model = this.config.model;
    }
    this.lastOptionsModel = base.model ?? null;
    if (this.claudeSessionId && !this.pendingFreshSessionId) {
      base.resume = this.claudeSessionId;
    }
    if (this.runtimeSettings?.disallowedTools?.length) {
      base.disallowedTools = [
        ...(base.disallowedTools ?? []),
        ...this.runtimeSettings.disallowedTools,
      ];
    }
    this.applyDontAskAllowlist(base);
    this.applyWorkspaceAccess(base);
    return base;
  }

  /**
   * Impose the session's workspace access ceiling by denying the tools the
   * level forbids (see agent/workspace-access.ts).
   *
   * Applied LAST, after the dontAsk allowlist, because a deny here must win: an
   * allowlist grants Edit/Write for unattended coding work, and a node that
   * declared "read" must not get them back that way. The SDK resolves
   * disallowedTools over allowedTools, and this ordering keeps the intent
   * legible to the next reader as well.
   */
  private applyWorkspaceAccess(base: ClaudeOptions): void {
    const denied = deniedToolsForAccess(resolveWorkspaceAccess(this.config.workspaceAccess));
    if (denied.length === 0) {
      return;
    }
    base.disallowedTools = [...new Set([...(base.disallowedTools ?? []), ...denied])];
    // A denial that only removed the tool would still leave the allowlist
    // advertising it, so drop it from there too.
    if (base.allowedTools?.length) {
      const deniedSet = new Set(denied);
      base.allowedTools = base.allowedTools.filter((tool) => !deniedSet.has(tool));
    }
  }

  /**
   * Under `dontAsk` the SDK denies anything not pre-approved, so merge a
   * baseline allow list onto the options (no-op in every other mode). Merge,
   * never clobber: config/settings may already carry an allowedTools list (user
   * pre-approvals, runtime settings); dedup keeps the union stable.
   *
   * The baseline is the minimum that lets the two unattended workloads function
   * without opening the dangerous surface:
   *
   *  - Otto MCP server tools (`mcp__otto…`): the Team Scheduler's entire job is
   *    orchestration via Otto's MCP tools (create/list/prompt agents); denying
   *    them makes scheduled orchestration inert. Whole-server grants so new
   *    Otto tools don't need re-listing here.
   *  - Edit / Write / MultiEdit / NotebookEdit: coding schedules must apply
   *    workspace file changes.
   *  - TodoWrite: harness-internal task tracking, no external effect.
   *  - Task: spawning Claude's own subagents (fan-out) is in-model, not a shell.
   *
   * Deliberately EXCLUDED (stay denied under dontAsk):
   *  - Bash: arbitrary shell is exactly the "rm -rf" surface the charter guards
   *    against — an unattended run must not run unreviewed commands.
   *  - WebFetch / WebSearch: unattended network egress is out of scope here.
   *  - Read / Glob / Grep: intentionally omitted — the SDK auto-approves these
   *    read-only tools in cwd already, so listing them would be redundant.
   */
  private applyDontAskAllowlist(base: ClaudeOptions): void {
    if (this.currentMode !== "dontAsk") {
      return;
    }
    const allow = ["Edit", "Write", "MultiEdit", "NotebookEdit", "TodoWrite", "Task"];
    for (const serverName of Object.keys(this.config.mcpServers ?? {})) {
      if (serverName === "otto" || serverName.startsWith("otto_")) {
        // `mcp__<server>` grants every tool exposed by that MCP server.
        allow.push(`mcp__${serverName}`);
      }
    }
    base.allowedTools = Array.from(new Set([...(base.allowedTools ?? []), ...allow]));
  }

  private buildSettingsOptions(
    extraClaudeOptions: Partial<ClaudeOptions> | undefined,
    input: { ultracode: boolean },
  ): Pick<ClaudeOptions, "settings"> | Record<string, never> {
    const fastMode = this.resolveFastModeSetting();
    if (fastMode === null && !input.ultracode) {
      return {};
    }
    return {
      settings: mergeClaudeSettings(extraClaudeOptions?.settings, {
        ...(fastMode === null ? {} : { fastMode }),
        ...(input.ultracode ? { ultracode: true } : {}),
      }),
    };
  }

  private resolveFastModeSetting(): boolean | null {
    if (!claudeModelSupportsFastMode(this.config.model)) {
      return null;
    }
    return this.config.featureValues?.fast_mode === true;
  }

  private normalizeMcpServers(
    servers: Record<string, McpServerConfig>,
  ): Record<string, ClaudeSdkMcpServerConfig> {
    const result: Record<string, ClaudeSdkMcpServerConfig> = {};
    for (const [name, config] of Object.entries(servers)) {
      result[name] = toClaudeSdkMcpConfig(config);
    }
    return result;
  }

  private toSdkUserMessage(prompt: AgentPromptInput): SDKUserMessage {
    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            data: string;
          };
        }
    > = [];
    if (Array.isArray(prompt)) {
      for (const chunk of prompt) {
        if (chunk.type === "text") {
          content.push({ type: "text", text: chunk.text });
        } else if (chunk.type === "image") {
          if (isImageMimeType(chunk.mimeType)) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: chunk.mimeType,
                data: chunk.data,
              },
            });
          }
        } else {
          content.push({ type: "text", text: renderPromptAttachmentAsText(chunk) });
        }
      }
    } else {
      content.push({ type: "text", text: prompt });
    }

    const messageId = randomUUID();
    this.rememberUserMessageId(messageId);

    return {
      type: "user",
      message: {
        role: "user",
        content,
      },
      parent_tool_use_id: null,
      uuid: messageId,
      session_id: this.claudeSessionId ?? "",
    };
  }

  private transitionTurnState(next: TurnState, reason: string): void {
    if (this.turnState === next) {
      return;
    }
    this.logger.debug({ from: this.turnState, to: next, reason }, "Claude turn state transition");
    this.turnState = next;
  }

  private syncTurnState(reason: string): void {
    if (this.activeForegroundTurnId) {
      this.transitionTurnState("foreground", reason);
      return;
    }
    if (this.autonomousTurn) {
      this.transitionTurnState("autonomous", reason);
      return;
    }
    this.transitionTurnState("idle", reason);
  }

  private isAbortError(message: SDKMessage): boolean {
    const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
    return errors.some((e: string) => /\baborted\b/i.test(e));
  }

  private buildTurnFailedEvent(
    errorMessage: string,
  ): Extract<AgentStreamEvent, { type: "turn_failed" }> {
    const normalized = errorMessage.trim() || "Claude run failed";
    const exitCodeMatch = normalized.match(/\bcode\s+(\d+)\b/i);
    const code = exitCodeMatch ? exitCodeMatch[1] : undefined;
    const diagnostic = this.getRecentStderrDiagnostic();
    return {
      type: "turn_failed",
      provider: "claude",
      error: normalized,
      ...(code ? { code } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
  }

  private captureStderr(data: string): void {
    const text = data.trim();
    if (!text) {
      return;
    }
    const combined = this.recentStderr ? `${this.recentStderr}\n${text}` : text;
    this.recentStderr = combined.slice(-MAX_RECENT_STDERR_CHARS);
  }

  private clearRecentStderr(): void {
    this.recentStderr = "";
  }

  private getRecentStderrDiagnostic(): string | undefined {
    return this.recentStderr.trim() || undefined;
  }

  private async awaitRecentStderrAfterProcessExit(error: unknown): Promise<void> {
    if (this.getRecentStderrDiagnostic()) {
      return;
    }
    const message = errorToMessageString(error);
    if (
      !/\bprocess exited with code\b/i.test(message) &&
      !/\bterminated by signal\b/i.test(message)
    ) {
      return;
    }

    const startedAt = Date.now();
    while (!this.closed && !this.getRecentStderrDiagnostic()) {
      if (Date.now() - startedAt >= STDERR_FLUSH_WAIT_MS) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, STDERR_FLUSH_POLL_INTERVAL_MS));
    }
  }

  private createTurnId(owner: "foreground" | "autonomous"): string {
    return `${owner}-turn-${this.nextTurnOrdinal++}`;
  }

  private isTerminalTurnEvent(event: AgentStreamEvent): boolean {
    return (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    );
  }

  private async executeRewindTurn(
    _turnId: string,
    invocation: SlashCommandInvocation,
  ): Promise<void> {
    this.beginTurn();
    try {
      const rewindAttempt = await this.attemptRewind(invocation.args);
      if (!rewindAttempt.messageId || !rewindAttempt.result) {
        this.finishForegroundTurn({
          type: "turn_failed",
          provider: "claude",
          error:
            rewindAttempt.error ??
            "No prior user message available to rewind. Use /rewind <user_message_uuid>.",
        });
        return;
      }
      this.notifySubscribers({
        type: "timeline",
        provider: "claude",
        item: {
          type: "assistant_message",
          text: this.buildRewindSuccessMessage(rewindAttempt.messageId, rewindAttempt.result),
        },
      });
      this.finishForegroundTurn({ type: "turn_completed", provider: "claude" });
    } catch (error) {
      this.finishForegroundTurn({
        type: "turn_failed",
        provider: "claude",
        error: error instanceof Error ? error.message : "Failed to rewind tracked files",
      });
    }
  }

  private shouldRecoverInterruptedQueryAbort(
    error: unknown,
    consecutiveRecoveries: number,
  ): boolean {
    if (consecutiveRecoveries >= 3) {
      return false;
    }
    let message: string;
    if (typeof error === "string") {
      message = error;
    } else if (error instanceof Error) {
      message = `${error.message}\n${error.stack ?? ""}`;
    } else {
      message = JSON.stringify(error);
    }
    return message.toLowerCase().includes("request was aborted");
  }

  private finishForegroundTurn(
    event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" | "turn_canceled" }>,
  ): void {
    if (event.type === "turn_failed" || event.type === "turn_canceled") {
      this.flushPendingToolCalls();
    }
    this.notifySubscribers(event);
    this.activeForegroundTurnId = null;
    this.cancelCurrentTurn = null;
    this.activeTurnHasAssistantText = false;
    this.syncTurnState("foreground turn terminal");
  }

  private dispatchEvents(events: AgentStreamEvent[]): void {
    let terminalSeen = false;
    for (const event of events) {
      this.notifySubscribers(event);
      terminalSeen ||= this.isTerminalTurnEvent(event);
    }

    if (terminalSeen) {
      if (this.activeForegroundTurnId) {
        this.activeForegroundTurnId = null;
        this.cancelCurrentTurn = null;
        this.activeTurnHasAssistantText = false;
        this.syncTurnState("foreground turn terminal");
      } else if (this.autonomousTurn) {
        this.autonomousTurn = null;
        this.activeTurnHasAssistantText = false;
        this.syncTurnState("autonomous turn terminal");
      }
    }
  }

  private startAutonomousTurn(): void {
    if (this.autonomousTurn) {
      return;
    }
    this.autonomousTurn = {
      id: this.createTurnId("autonomous"),
    };
    this.activeTurnHasAssistantText = false;
    this.contextUsage.beginTurn();
    this.beginTurn();
    this.syncTurnState("autonomous turn started");
  }

  private completeAutonomousTurn(): void {
    if (!this.autonomousTurn) {
      return;
    }
    this.notifySubscribers({ type: "turn_completed", provider: "claude" });
    this.autonomousTurn = null;
    this.activeTurnHasAssistantText = false;
    this.syncTurnState("autonomous turn completed");
  }

  private failActiveTurns(errorMessage: string): void {
    const failure = this.buildTurnFailedEvent(errorMessage);
    this.flushPendingToolCalls();
    if (this.activeForegroundTurnId) {
      this.finishForegroundTurn(failure);
      return;
    }
    if (this.autonomousTurn) {
      this.dispatchEvents([failure]);
    }
  }

  private startQueryPump(): void {
    if (this.closed || this.queryPumpPromise) {
      return;
    }

    const pump = this.runQueryPump().catch((error) => {
      this.logger.trace(
        {
          agentId: this.agentId,
          provider: "claude",
          sessionId: this.claudeSessionId,
          turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
          err: error,
        },
        "provider.claude.query_pump.exit_unexpected",
      );
    });

    this.queryPumpPromise = pump;
    void pump.finally(() => {
      if (this.queryPumpPromise === pump) {
        this.queryPumpPromise = null;
      }
    });
  }

  private async runQueryPump(): Promise<void> {
    let activeQuery: Query;
    try {
      activeQuery = await this.ensureQuery();
    } catch (error) {
      this.logger.trace(
        {
          agentId: this.agentId,
          provider: "claude",
          sessionId: this.claudeSessionId,
          turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
          err: error,
        },
        "provider.claude.query_pump.init_failed",
      );
      this.failActiveTurns(error instanceof Error ? error.message : "Claude stream failed");
      return;
    }

    let consecutiveInterruptAbortRecoveries = 0;
    const logRawMessage = (message: SDKMessage): void => {
      this.logger.trace(
        {
          agentId: this.agentId,
          provider: "claude",
          sessionId: this.claudeSessionId,
          turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
          messageType: message.type,
          messageSubtype: "subtype" in message ? message.subtype : undefined,
          messageUuid: "uuid" in message ? message.uuid : undefined,
          rawEvent: message,
        },
        "provider.claude.raw_event",
      );
      // OTTO_DEBUG_WORKFLOW: standing env-gated diagnostic for Claude
      // workflow / subagent routing. This is the single point upstream of
      // routeSdkMessageFromPump that sees every raw SDK message before Otto
      // reclassifies or drops it, so it dumps the per-message identity axes
      // (task_id, tool_use_id, task_type, workflow_name, subagent_type,
      // task_description, parent_tool_use_id, isSidechain) at info level.
      // Off by default (zero cost); set OTTO_DEBUG_WORKFLOW=1 in the daemon
      // env to enable. Primary use: decide whether a Workflow's internal
      // agent() fan-out carries per-agent identity on the live stream (the
      // "Path A" question) — group sidechain messages by parent_tool_use_id
      // and see whether subagent_type/task_description vary per child. See
      // docs/visualizer.md (Debugging) and projects/workflow-decomposition.
      if (process.env.OTTO_DEBUG_WORKFLOW) {
        const raw = message as Record<string, unknown>;
        this.logger.info(
          {
            agentId: this.agentId,
            type: raw.type,
            subtype: raw.subtype,
            task_id: raw.task_id,
            tool_use_id: raw.tool_use_id,
            task_type: raw.task_type,
            workflow_name: raw.workflow_name,
            subagent_type: raw.subagent_type,
            task_description: raw.task_description,
            parent_tool_use_id: readClaudeParentToolUseId(message),
            isSidechain: raw.isSidechain,
          },
          "OTTO_DEBUG_WORKFLOW",
        );
      }
    };
    const handlePumpedMessage = async (message: SDKMessage): Promise<boolean> => {
      logRawMessage(message);
      consecutiveInterruptAbortRecoveries = 0;
      if (await this.handleMissingResumedConversation(message, activeQuery)) {
        return true;
      }
      await this.routeSdkMessageFromPump(message);
      return false;
    };
    const drainActiveQuery = async (): Promise<boolean> => {
      for await (const message of activeQuery) {
        if (await handlePumpedMessage(message)) {
          return true;
        }
      }
      return false;
    };
    try {
      while (!this.closed && this.query === activeQuery) {
        try {
          if (await drainActiveQuery()) {
            return;
          }
          if (!this.closed && this.query === activeQuery) {
            this.failActiveTurns("Claude stream ended before terminal result");
          }
          return;
        } catch (error) {
          if (
            !this.closed &&
            this.query === activeQuery &&
            this.shouldRecoverInterruptedQueryAbort(error, consecutiveInterruptAbortRecoveries)
          ) {
            consecutiveInterruptAbortRecoveries += 1;
            this.logger.debug(
              { recoveries: consecutiveInterruptAbortRecoveries },
              "Recovering Claude query pump after interrupt abort",
            );
            continue;
          }
          if (!this.closed && this.query === activeQuery) {
            await this.awaitRecentStderrAfterProcessExit(error);
            this.failActiveTurns(error instanceof Error ? error.message : "Claude stream failed");
          }
          return;
        }
      }
    } finally {
      if (this.query === activeQuery) {
        this.query = null;
        this.input = null;
      }
    }
  }

  private shouldSuppressStaleResult(message: SDKMessage): boolean {
    // Suppress stale results from interrupted requests. The cancel path already
    // emitted the terminal event; this result is leftover from the killed API
    // request. Consume the flag on ANY result so it doesn't linger.
    if (message.type === "result" && this.pendingInterruptAbort) {
      this.pendingInterruptAbort = false;
      if (message.subtype !== "success") {
        this.logger.debug("Suppressing stale non-success result from interrupted request");
        return true;
      }
    }
    if (message.type === "result" && message.subtype !== "success" && this.isAbortError(message)) {
      this.logger.debug("Suppressing abort result by content");
      return true;
    }
    return false;
  }

  private isAssistantishMessage(message: SDKMessage): boolean {
    return (
      message.type === "assistant" ||
      message.type === "stream_event" ||
      message.type === "tool_progress" ||
      (message.type === "system" && message.subtype === "task_notification")
    );
  }

  private async routeSdkMessageFromPump(message: SDKMessage): Promise<void> {
    if (this.shouldSuppressStaleResult(message)) {
      return;
    }

    const isForeground = Boolean(this.activeForegroundTurnId);
    if (!isForeground && this.isAssistantishMessage(message)) {
      this.startAutonomousTurn();
    }
    if (!isForeground && !this.autonomousTurn && message.type === "result") {
      return;
    }

    const turnId = this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? null;
    const identifiers = readEventIdentifiers(message);
    this.rememberTranscriptProgress(message, readTranscriptUuid(message));

    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.claudeSessionId,
        turnId: turnId ?? undefined,
        messageType: message.type,
        identifiers,
        rawEvent: message,
      },
      "provider.claude.parsed_event",
    );

    const events = await this.buildPumpedMessageEvents(message, identifiers.messageId, turnId);

    if (events.length === 0) {
      return;
    }
    if (
      this.pendingInterruptAbort &&
      message.type === "result" &&
      events.some((event) => event.type === "turn_completed" || event.type === "turn_failed") &&
      (!this.activeForegroundTurnId || !this.foregroundHasVisibleActivity)
    ) {
      this.pendingInterruptAbort = false;
      this.logger.debug("Suppressing stale Claude interrupt terminal result");
      return;
    }
    if (
      events.some((event) => event.type === "timeline" && event.item.type === "assistant_message")
    ) {
      this.activeTurnHasAssistantText = true;
    }
    if (
      this.activeForegroundTurnId &&
      events.some(
        (event) =>
          event.type === "timeline" ||
          event.type === "permission_requested" ||
          event.type === "permission_resolved",
      )
    ) {
      this.foregroundHasVisibleActivity = true;
    }

    this.dispatchEvents(events);
  }

  private async buildPumpedMessageEvents(
    message: SDKMessage,
    messageIdHint: string | null,
    turnId: string | null,
  ): Promise<AgentStreamEvent[]> {
    const messageEvents = this.translateMessageToEvents(message, {
      suppressAssistantText: true,
      suppressReasoning: true,
    });
    const assistantTimelineEvents = readClaudeParentToolUseId(message)
      ? []
      : this.timelineAssembler
          .consume({
            message,
            runId: turnId,
            messageIdHint,
          })
          .map(
            (item) =>
              ({
                type: "timeline",
                item,
                provider: "claude",
              }) satisfies AgentStreamEvent,
          );

    return [...messageEvents, ...assistantTimelineEvents];
  }

  private async handleMissingResumedConversation(
    message: SDKMessage,
    activeQuery: Query,
  ): Promise<boolean> {
    const staleResumeError = this.readMissingResumedConversationError(message);
    if (!staleResumeError) {
      return false;
    }

    this.logger.warn(
      {
        error: staleResumeError,
      },
      "Claude resumed session no longer exists; invalidating persisted session",
    );

    this.failActiveTurns(staleResumeError);
    this.input?.end();
    await this.awaitWithTimeout(
      activeQuery.return?.(),
      "query pump return on missing resumed conversation",
    );
    if (this.query === activeQuery) {
      this.query = null;
      this.input = null;
    }
    this.persistence = null;
    this.persistedHistory = [];
    this.historyPending = false;
    this.cachedRuntimeInfo = null;
    this.queryRestartNeeded = false;
    this.autonomousTurn = null;
    this.activeForegroundTurnId = null;
    this.syncTurnState("missing resumed conversation");
    return true;
  }

  private async interruptActiveTurn(): Promise<void> {
    const queryToInterrupt = this.query;
    if (!queryToInterrupt || typeof queryToInterrupt.interrupt !== "function") {
      this.logger.trace(
        {
          agentId: this.agentId,
          provider: "claude",
          sessionId: this.claudeSessionId,
          turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
        },
        "provider.claude.interrupt.no_query",
      );
      return;
    }
    this.pendingInterruptAbort = true;
    try {
      // interrupt_receipt_v1 CLIs resolve interrupt() with the uuids of queued
      // async user messages that survive this interrupt and WILL still run
      // unless cancelled. Nothing consumes it yet — logged for the steer-queue
      // charter, which needs exactly this to reconcile its queue after an
      // interrupt. See projects/steer-queue/steer-queue.md.
      const interruptAndLogReceipt = async (): Promise<void> => {
        const receipt = await queryToInterrupt.interrupt();
        if (receipt && receipt.still_queued.length > 0) {
          this.logger.debug(
            { agentId: this.agentId, stillQueued: receipt.still_queued },
            "provider.claude.interrupt.still_queued",
          );
        }
      };
      await this.awaitWithTimeout(
        interruptAndLogReceipt(),
        "interruptActiveTurn query.interrupt()",
      );
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to interrupt active turn");
    }
  }

  private translateMessageToEvents(
    message: SDKMessage,
    options?: {
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ): AgentStreamEvent[] {
    const parentToolUseId = readClaudeParentToolUseId(message);
    if (parentToolUseId) {
      const sidechainEvents = this.sidechainTracker.handleMessage(message, parentToolUseId);
      this.appendObservedSubagentSidechainEvents(message, parentToolUseId, sidechainEvents);
      return sidechainEvents;
    }

    const events: AgentStreamEvent[] = [];
    if (message.type !== "system") {
      const sessionCapture = this.captureSessionIdFromMessage(message);
      if (sessionCapture.notice) {
        events.push({
          type: "timeline",
          provider: "claude",
          item: sessionCapture.notice,
        });
      }
      if (sessionCapture.threadStartedSessionId) {
        events.push({
          type: "thread_started",
          provider: "claude",
          sessionId: sessionCapture.threadStartedSessionId,
        });
      }
    }

    switch (message.type) {
      case "system":
        this.appendSystemMessageEvents(message, events);
        break;
      case "user":
        this.appendUserMessageEvents(message, events);
        break;
      case "assistant": {
        const timelineItems = this.mapBlocksToTimeline(message.message.content, {
          suppressAssistantText: options?.suppressAssistantText ?? false,
          suppressReasoning: options?.suppressReasoning ?? false,
        });
        for (const item of timelineItems) {
          events.push({ type: "timeline", item, provider: "claude" });
        }
        break;
      }
      case "stream_event":
        this.appendStreamEventEvents(message, events, options);
        break;
      case "result":
        this.appendResultEvents(message, events);
        break;
      case "prompt_suggestion": {
        const suggestion = message.suggestion.trim();
        if (suggestion) {
          events.push({ type: "prompt_suggestion", provider: "claude", suggestion });
        }
        break;
      }
      case "rate_limit_event": {
        const info = mapClaudeRateLimitInfo(message.rate_limit_info);
        const key = JSON.stringify(info);
        if (key !== this.lastRateLimitEventKey) {
          this.lastRateLimitEventKey = key;
          events.push({ type: "rate_limit_updated", provider: "claude", info });
        }
        break;
      }
      default:
        break;
    }

    // Task tool_result mapping (handleToolResult) can enqueue an observed
    // subagent completion; flush it with the events that carried it.
    if (this.pendingObservedEvents.length > 0) {
      events.push(...this.pendingObservedEvents);
      this.pendingObservedEvents = [];
    }

    return events;
  }

  /**
   * Route a sidechain (subagent) message into the observed subagent's own
   * lifecycle + timeline events, alongside the parent Task row's summary log.
   * Partial stream events are skipped: with forwardSubagentText enabled the
   * complete assistant/user messages carry the full conversation, which is
   * enough for the read-only pane. See projects/observed-subagents/observed-subagents.md.
   */
  private appendObservedSubagentSidechainEvents(
    message: SDKMessage,
    parentToolUseId: string,
    events: AgentStreamEvent[],
  ): void {
    this.recordNestedSubagentSpawns(message, parentToolUseId);
    if (!this.announcedObservedSubagents.has(parentToolUseId)) {
      this.announcedObservedSubagents.add(parentToolUseId);
      const taskInput = this.toolUseCache.get(parentToolUseId)?.input;
      const subAgentType = readObservedSubagentText(taskInput?.subagent_type);
      const description = readObservedSubagentText(taskInput?.description);
      const parentKey = this.observedParentKeyByToolUseId.get(parentToolUseId);
      events.push({
        type: "observed_subagent_updated",
        provider: "claude",
        update: {
          key: parentToolUseId,
          status: "running",
          ...(parentKey ? { parentKey } : {}),
          ...(subAgentType ? { subAgentType } : {}),
          ...(description ? { description } : {}),
        },
      });
    }

    this.appendObservedSubagentUsage(parentToolUseId, message, events);

    let items: AgentTimelineItem[] = [];
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (typeof content === "string" || Array.isArray(content)) {
        items = this.mapBlocksToTimeline(content);
      }
    } else if (message.type === "user") {
      const content = message.message?.content;
      if (typeof content === "string" || Array.isArray(content)) {
        items = this.mapBlocksToTimeline(content, { textMessageType: "user_message" });
      }
    }
    for (const item of items) {
      events.push({
        type: "observed_subagent_timeline",
        provider: "claude",
        key: parentToolUseId,
        item,
      });
    }
  }

  /**
   * Accumulate a plain Task sub-agent's REAL usage from its live sidechain
   * assistant frames (each carries the full `message.usage` split + `message.model`,
   * deduped by message.id), and emit the running split + model on the observed
   * row. This is the non-workflow twin of the on-disk watcher: a Task fan-out has
   * no per-agent SDK identity beyond the sidechain, but the sidechain frames carry
   * everything, so no disk correlation is needed. cumulativeTokens is left to the
   * task_progress/notification path (the SDK's authoritative per-task scalar);
   * cross-checking the two is block 5. See [[subagent-real-accounting]].
   */
  private appendObservedSubagentUsage(
    key: string,
    message: SDKMessage,
    events: AgentStreamEvent[],
  ): void {
    if (message.type !== "assistant") {
      return;
    }
    // Once the on-disk transcript is bound, disk is authoritative: it is a
    // strict superset of the live sidechain (which only ever carries the
    // message_start usage snapshot, so its output counts run low). Mixing the
    // two sources would let a smaller live total overwrite a disk total.
    if (this.taskTranscriptWatcher.isBound(key)) {
      return;
    }
    const betaMessage = message.message;
    let accumulator = this.observedSubagentUsage.get(key);
    if (!accumulator) {
      accumulator = new SubagentUsageAccumulator();
      this.observedSubagentUsage.set(key, accumulator);
    }
    const before = accumulator.isEmpty() ? -1 : grandTotalTokens(accumulator.totals());
    accumulator.observe({
      messageId: typeof betaMessage?.id === "string" ? betaMessage.id : undefined,
      usage: readUsageTotals(betaMessage?.usage),
      model: typeof betaMessage?.model === "string" ? betaMessage.model : undefined,
    });
    const totals = accumulator.totals();
    // Only surface when the real footprint actually grew — a repeated stream
    // frame of the same message.id (or a model-only frame) changes nothing.
    if (grandTotalTokens(totals) <= before) {
      return;
    }
    const model = accumulator.model();
    events.push({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key,
        status: "running",
        usage: toClaudeSubagentUsage(totals, model),
        usageRounds: accumulator.roundCount(),
        ...(model ? { model } : {}),
      },
    });
  }

  /**
   * A Task/Agent tool_use inside a sidechain means THAT subagent is spawning
   * its own child — remember child tool_use id -> spawning key so the child's
   * observed row (announced later by its task events or its own sidechain)
   * parents to the spawning subagent. Recursion gives depth > 2 for free: the
   * child's sidechain records its grandchildren the same way.
   */
  private recordNestedSubagentSpawns(message: SDKMessage, sidechainKey: string): void {
    if (message.type !== "assistant") {
      return;
    }
    const content = message.message?.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "tool_use" &&
        isClaudeSubagentToolName((block as { name?: string }).name) &&
        typeof (block as { id?: unknown }).id === "string"
      ) {
        this.observedParentKeyByToolUseId.set((block as { id: string }).id, sidechainKey);
      }
    }
  }

  private emitSubmittedUserMessage(
    message: Extract<SDKMessage, { type: "user" }>,
    turnId: string,
  ): void {
    const events: AgentStreamEvent[] = [];
    this.appendUserMessageEvents(message, events);
    if (events.length === 0) {
      return;
    }
    this.foregroundHasVisibleActivity = true;
    for (const event of events) {
      if (event.type === "timeline") {
        this.notifySubscribers({ ...event, turnId });
      } else {
        this.notifySubscribers(event);
      }
    }
  }

  private appendSystemMessageEvents(
    message: Extract<SDKMessage, { type: "system" }>,
    events: AgentStreamEvent[],
  ): void {
    if (message.subtype === "init") {
      const sessionUpdate = this.handleSystemMessage(message);
      if (sessionUpdate.notice) {
        events.push({
          type: "timeline",
          provider: "claude",
          item: sessionUpdate.notice,
        });
      }
      if (sessionUpdate.threadStartedSessionId) {
        events.push({
          type: "thread_started",
          provider: "claude",
          sessionId: sessionUpdate.threadStartedSessionId,
        });
      }
      return;
    }
    if (message.subtype === "status") {
      const status = toObjectRecord(message)?.status;
      if (status === "compacting") {
        this.compacting = true;
        events.push({
          type: "timeline",
          item: { type: "compaction", status: "loading" },
          provider: "claude",
        });
      }
      return;
    }
    if (message.subtype === "compact_boundary") {
      const compactMetadata = readCompactionMetadata(message);
      events.push({
        type: "timeline",
        item: {
          type: "compaction",
          status: "completed",
          trigger: compactMetadata?.trigger === "manual" ? "manual" : "auto",
          preTokens: compactMetadata?.preTokens,
        },
        provider: "claude",
      });
      events.push(this.contextUsage.buildCompactionUsageEvent(compactMetadata?.postTokens));
      return;
    }
    if (message.subtype === "background_tasks_changed") {
      this.appendBackgroundTasksChangedEvents(message, events);
      return;
    }
    if (message.subtype === "task_notification") {
      this.appendTaskNotificationEvents(message, events);
      return;
    }
    if (message.subtype === "task_progress") {
      this.appendTaskProgressEvents(message, events);
      return;
    }
    if (message.subtype === "task_started") {
      this.appendTaskStartedEvents(message, events);
      return;
    }
  }

  private appendTaskProgressEvents(
    message: Extract<SDKMessage, { type: "system"; subtype: "task_progress" }>,
    events: AgentStreamEvent[],
  ): void {
    if (this.isBackgroundShellTask(message.tool_use_id, message.task_id)) {
      this.appendBackgroundShellTaskEvent(events, {
        taskId: message.task_id,
        toolUseId: message.tool_use_id,
        description: message.summary ?? message.description,
        status: "running",
      });
      return;
    }
    // task_progress omits task_type; workflow runs are recognized by their
    // remembered observed key or the still-cached Workflow tool call (in
    // appendObservedSubagentTaskEvent's gate). subagent_type is absent for a
    // workflow, so the description carries the live phase summary and the
    // frozen title stays whatever task_started set.
    this.appendObservedSubagentTaskEvent(message, events, {
      taskId: message.task_id,
      toolUseId: message.tool_use_id,
      subAgentType: message.subagent_type,
      description: message.summary ?? message.description,
      status: "running",
      cumulativeTokens: message.usage?.total_tokens,
    });
  }

  private appendTaskStartedEvents(
    message: Extract<SDKMessage, { type: "system"; subtype: "task_started" }>,
    events: AgentStreamEvent[],
  ): void {
    // A workflow orchestration run announces itself here with task_type
    // "local_workflow" (+ workflow_name) or a cached Workflow tool call. Fold
    // its name into the subAgentType title source so the observed row reads
    // "Workflow: <name>"; the rest of the lifecycle flows through the shared
    // observed-subagent path (keyed by the Workflow tool_use id, so its
    // sidechain transcript lands on the same row).
    const cachedTool = message.tool_use_id ? this.toolUseCache.get(message.tool_use_id) : undefined;
    const isWorkflowStart =
      isClaudeWorkflowTaskType(message.task_type) || isClaudeWorkflowToolName(cachedTool?.name);
    const isSubagentStart =
      isClaudeSubagentToolName(cachedTool?.name) ||
      readObservedSubagentText(message.subagent_type) !== undefined ||
      message.task_type === "subagent";
    // Route to the background-tasks track anything the CLI backgrounds that is
    // not an observable AI run: an already-known background task, a Bash
    // run_in_background, a monitor, or any other non-subagent, non-workflow
    // task_type. This is where non-Bash background tasks used to be dropped.
    const isBackgroundTaskStart =
      !isWorkflowStart &&
      !isSubagentStart &&
      (this.isBackgroundShellTask(message.tool_use_id, message.task_id) ||
        isClaudeBackgroundTaskType(message.task_type));
    if (isBackgroundTaskStart) {
      this.appendBackgroundShellTaskEvent(events, {
        taskId: message.task_id,
        toolUseId: message.tool_use_id,
        description: message.description,
        status: "running",
      });
      return;
    }
    if (isWorkflowStart && message.tool_use_id) {
      this.workflowObservedKeys.add(message.tool_use_id);
      this.armWorkflowWatcher(message.tool_use_id, message.task_id);
    }
    this.appendObservedSubagentTaskEvent(message, events, {
      taskId: message.task_id,
      toolUseId: message.tool_use_id,
      subAgentType: isWorkflowStart
        ? readClaudeWorkflowLabel(message.workflow_name)
        : message.subagent_type,
      description: message.description,
      status: "running",
    });
  }

  /**
   * Arm a WorkflowTranscriptWatcher for a just-started Workflow run. It tails
   * the run's on-disk transcripts and re-emits observed-subagent events per
   * internal agent (nested under the workflow row via parentKey) — the live SDK
   * stream carries none of that. Idempotent; without a session id (the watcher
   * needs it to resolve the on-disk dir) the arm is buffered and drained when
   * one is assigned.
   */
  private armWorkflowWatcher(workflowKey: string, taskId?: string): void {
    if (this.workflowWatchers.has(workflowKey)) {
      return;
    }
    if (!this.claudeSessionId) {
      this.pendingWorkflowArms.set(workflowKey, taskId);
      this.logger.debug(
        { agentId: this.agentId, workflowKey },
        "workflow watcher arm buffered — no session id yet",
      );
      return;
    }
    this.pendingWorkflowArms.delete(workflowKey);
    const watcher = new WorkflowTranscriptWatcher({
      workflowKey,
      taskId,
      sessionId: this.claudeSessionId,
      cwd: this.config.cwd,
      emit: (event) => this.pushEvent(event),
      logger: this.logger,
      claimedDirs: this.workflowClaimedDirs,
    });
    this.workflowWatchers.set(workflowKey, watcher);
    watcher.arm();
  }

  /** Arm any workflow watchers buffered while claudeSessionId was unset. */
  private drainPendingWorkflowArms(): void {
    if (!this.claudeSessionId || this.pendingWorkflowArms.size === 0) {
      return;
    }
    const pending = [...this.pendingWorkflowArms.entries()];
    this.pendingWorkflowArms.clear();
    for (const [workflowKey, taskId] of pending) {
      this.armWorkflowWatcher(workflowKey, taskId);
    }
  }

  /** Tear down a workflow watcher, settling any still-running child rows. */
  private disarmWorkflowWatcher(
    workflowKey: string | undefined,
    status: "idle" | "error" | "closed",
  ): void {
    if (!workflowKey) {
      return;
    }
    // A workflow that settles before a session id ever appears must not arm later.
    this.pendingWorkflowArms.delete(workflowKey);
    const watcher = this.workflowWatchers.get(workflowKey);
    if (!watcher) {
      return;
    }
    this.workflowWatchers.delete(workflowKey);
    watcher.disarm(status);
  }

  /**
   * True when a task_* system message belongs to a Bash run_in_background
   * call rather than a Task-tool subagent. See
   * isClaudeBackgroundShellToolName and projects/observed-subagents/observed-subagents.md's
   * note that Otto previously ignored shell task events entirely.
   */
  /**
   * Reconcile against the CLI's background-task level signal (REPLACE
   * semantics — the payload is the full set of live background tasks, each with
   * its task_type + description). Two jobs:
   *
   * 1. CREATE/refresh a background row for every background-type task in the set
   *    (shell, monitor, …) that the observed-subagent path doesn't own — the
   *    authoritative membership signal, so a task whose task_started edge was
   *    lost or late still shows up. Subagents and workflows are skipped (they
   *    keep their richer observed rows and settle via their own path).
   * 2. SETTLE any known background/observed row whose task id vanished from the
   *    set — the case where a lost or garbled task_notification otherwise left
   *    it running forever (workflow rows are exempt from the turn-end sweep, so
   *    they previously had no safety net).
   *
   * Foreground subagents never appear in the level set, so they are untouched.
   * A later-arriving edge for the same transition still lands and refines the
   * terminal status (idle → error/closed); edge and level converge on one row
   * because the key is remembered by task id.
   */
  private appendBackgroundTasksChangedEvents(
    message: Extract<SDKMessage, { type: "system"; subtype: "background_tasks_changed" }>,
    events: AgentStreamEvent[],
  ): void {
    const liveTaskIds = new Set<string>();
    for (const task of message.tasks) {
      liveTaskIds.add(task.task_id);
      // The level set is authoritative for background-task membership and now
      // carries each task's type + description, so create/refresh a background
      // row for any background-type task the edge stream hasn't already surfaced
      // (a lost or late task_started otherwise left it invisible — the very gap
      // that hid non-Bash background tasks). Subagents and workflows keep their
      // observed rows; skip them here so they never double as background rows.
      if (this.observedKeyByTaskId.has(task.task_id)) {
        continue;
      }
      if (!isClaudeBackgroundTaskType(task.task_type)) {
        continue;
      }
      this.appendBackgroundShellTaskEvent(events, {
        taskId: task.task_id,
        toolUseId: undefined,
        description: task.description,
        status: "running",
      });
    }
    for (const taskId of this.lastBackgroundTaskIds) {
      if (liveTaskIds.has(taskId)) {
        continue;
      }
      if (this.backgroundShellKeyByTaskId.has(taskId)) {
        this.appendBackgroundShellTaskEvent(events, {
          taskId,
          toolUseId: undefined,
          status: "idle",
        });
        continue;
      }
      const key = this.observedKeyByTaskId.get(taskId);
      if (key && !this.settledObservedSubagents.has(key)) {
        this.settledObservedSubagents.add(key);
        this.taskTranscriptWatcher.markSettled(key, "idle");
        events.push({
          type: "observed_subagent_updated",
          provider: "claude",
          update: {
            key,
            status: "idle",
            ...(this.observedParentKeyByToolUseId.has(key)
              ? { parentKey: this.observedParentKeyByToolUseId.get(key) }
              : {}),
          },
        });
      }
    }
    this.lastBackgroundTaskIds = liveTaskIds;
  }

  private isBackgroundShellTask(toolUseId: string | undefined, taskId: string): boolean {
    const cachedTool = toolUseId ? this.toolUseCache.get(toolUseId) : undefined;
    return (
      isClaudeBackgroundShellToolName(cachedTool?.name) ||
      this.backgroundShellKeyByTaskId.has(taskId)
    );
  }

  /**
   * Map a task_* system message onto the observed subagent's lifecycle. Only
   * subagent tasks qualify — shell/monitor/workflow background tasks are
   * ignored. See projects/observed-subagents/observed-subagents.md.
   */
  private appendObservedSubagentTaskEvent(
    message: Extract<SDKMessage, { type: "system" }>,
    events: AgentStreamEvent[],
    input: {
      taskId: string;
      toolUseId: string | undefined;
      subAgentType?: string | undefined;
      description?: string | undefined;
      status: "running" | "idle" | "error" | "closed";
      requiresAttention?: boolean;
      cumulativeTokens?: number | undefined;
    },
  ): void {
    void message;
    const cachedTool = input.toolUseId ? this.toolUseCache.get(input.toolUseId) : undefined;
    const isSubagentTask =
      readObservedSubagentText(input.subAgentType) !== undefined ||
      isClaudeSubagentToolName(cachedTool?.name) ||
      // A Workflow orchestration run is observable too — recognize it directly by
      // its cached tool so a task_progress/task_notification seen before (or
      // without) task_started still routes to the observed row.
      isClaudeWorkflowToolName(cachedTool?.name) ||
      this.observedKeyByTaskId.has(input.taskId);
    if (!isSubagentTask) {
      return;
    }
    const key =
      input.toolUseId ?? this.observedKeyByTaskId.get(input.taskId) ?? `task:${input.taskId}`;
    this.observedKeyByTaskId.set(input.taskId, key);
    this.announcedObservedSubagents.add(key);
    if (input.status !== "running") {
      this.settledObservedSubagents.add(key);
      this.taskTranscriptWatcher.markSettled(key, input.status);
    }
    const parentKey = this.observedParentKeyByToolUseId.get(key);
    events.push({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key,
        taskId: input.taskId,
        status: input.status,
        ...(parentKey ? { parentKey } : {}),
        ...(input.requiresAttention !== undefined
          ? { requiresAttention: input.requiresAttention }
          : {}),
        ...(readObservedSubagentText(input.subAgentType)
          ? { subAgentType: readObservedSubagentText(input.subAgentType) }
          : {}),
        ...(readObservedSubagentText(input.description)
          ? { description: readObservedSubagentText(input.description) }
          : {}),
        ...(typeof input.cumulativeTokens === "number" && Number.isFinite(input.cumulativeTokens)
          ? { cumulativeTokens: input.cumulativeTokens }
          : {}),
      },
    });
  }

  /**
   * Map a task_* system message onto a background shell task's lifecycle
   * (Bash run_in_background). Sibling of appendObservedSubagentTaskEvent for
   * the non-AI shell case — see projects/observed-subagents/observed-subagents.md's
   * note that Otto previously ignored these entirely.
   */
  private appendBackgroundShellTaskEvent(
    events: AgentStreamEvent[],
    input: {
      taskId: string;
      toolUseId: string | undefined;
      description?: string | undefined;
      status: "running" | "idle" | "error" | "closed";
      requiresAttention?: boolean;
    },
  ): void {
    // Prefer a key already remembered for this task id so the edge stream
    // (task_started/progress/notification, which carry a tool_use_id) and the
    // level signal (background_tasks_changed, which does not) converge on ONE
    // row. Whichever sighting lands first fixes the key; the rest reuse it.
    const key =
      this.backgroundShellKeyByTaskId.get(input.taskId) ??
      input.toolUseId ??
      `task:${input.taskId}`;
    this.backgroundShellKeyByTaskId.set(input.taskId, key);
    this.announcedBackgroundShellTasks.add(key);
    const description = readObservedSubagentText(input.description);
    events.push({
      type: "background_shell_task_updated",
      provider: "claude",
      update: {
        key,
        taskId: input.taskId,
        status: input.status,
        ...(input.requiresAttention !== undefined
          ? { requiresAttention: input.requiresAttention }
          : {}),
        // `description` on task_started/task_progress is the closest available
        // field to the shell command text; verify with a live run before
        // treating it as authoritative. See projects/ (Background Tasks plan).
        ...(description ? { command: description, description } : {}),
      },
    });
  }

  private appendTaskNotificationEvents(
    message: Extract<SDKMessage, { type: "system"; subtype: "task_notification" }>,
    events: AgentStreamEvent[],
  ): void {
    // Subagent task_notifications arrive without parent_tool_use_id but with
    // tool_use_id pointing at the parent's subagent tool call. Keep them out of
    // the parent timeline, but map them onto the observed subagent's lifecycle
    // — this is where a failed/stopped subagent (e.g. usage exhaustion) becomes
    // visible. See projects/observed-subagents/observed-subagents.md.
    const taskUseId = message.tool_use_id;
    const cachedTool = taskUseId ? this.toolUseCache.get(taskUseId) : undefined;
    if (
      isClaudeBackgroundShellToolName(cachedTool?.name) ||
      this.backgroundShellKeyByTaskId.has(message.task_id)
    ) {
      let status: "idle" | "error" | "closed" = "idle";
      if (message.status === "failed") {
        status = "error";
      } else if (message.status === "stopped") {
        status = "closed";
      }
      this.appendBackgroundShellTaskEvent(events, {
        taskId: message.task_id,
        toolUseId: taskUseId,
        description: message.summary,
        status,
        requiresAttention: message.status === "failed",
      });
      return;
    }
    // A workflow run and a Task subagent settle the same way — the completion
    // notification maps onto the observed row's terminal state (this is where a
    // failed/stopped run finally becomes visible). Both go through the shared
    // observed-subagent path; the gate below recognizes either a Task/Agent or a
    // Workflow tool call, or any already-announced observed task.
    if (
      isClaudeSubagentToolName(cachedTool?.name) ||
      isClaudeWorkflowToolName(cachedTool?.name) ||
      this.observedKeyByTaskId.has(message.task_id)
    ) {
      let status: "idle" | "error" | "closed" = "idle";
      if (message.status === "failed") {
        status = "error";
      } else if (message.status === "stopped") {
        status = "closed";
      }
      this.appendObservedSubagentTaskEvent(message, events, {
        taskId: message.task_id,
        toolUseId: taskUseId,
        description: message.summary,
        status,
        requiresAttention: message.status === "failed",
        cumulativeTokens: message.usage?.total_tokens,
      });
      // A workflow run settling here is also where its watcher tears down: do a
      // final transcript tail + run-state reconcile and settle the child rows.
      this.disarmWorkflowWatcher(
        taskUseId ?? this.observedKeyByTaskId.get(message.task_id),
        status,
      );
      return;
    }
    const taskNotificationItem = mapTaskNotificationSystemRecordToToolCall(message);
    if (taskNotificationItem) {
      events.push({
        type: "timeline",
        item: taskNotificationItem,
        provider: "claude",
      });
    }
  }

  private appendUserMessageEvents(
    message: Extract<SDKMessage, { type: "user" }>,
    events: AgentStreamEvent[],
  ): void {
    if (isSyntheticUserEntry(message)) {
      return;
    }
    if (this.compacting) {
      this.compacting = false;
      return;
    }
    const messageId =
      typeof message.uuid === "string" && message.uuid.length > 0 ? message.uuid : undefined;
    if (messageId && this.emittedUserMessageIds.has(messageId)) {
      return;
    }
    this.rememberUserMessageId(messageId);
    this.rememberEmittedUserMessageId(messageId);
    const content = message.message?.content;
    const taskNotificationItem = mapTaskNotificationUserContentToToolCall({
      content,
      messageId,
    });
    if (taskNotificationItem) {
      events.push({
        type: "timeline",
        item: taskNotificationItem,
        provider: "claude",
      });
      return;
    }
    if (typeof content === "string" && content.length > 0) {
      if (!isClaudeTranscriptNoiseText(content)) {
        events.push({
          type: "timeline",
          item: {
            type: "user_message",
            text: content,
            ...(messageId ? { messageId } : {}),
          },
          provider: "claude",
        });
      }
      return;
    }
    if (Array.isArray(content)) {
      this.appendUserContentArrayEvents(content, messageId, events);
    }
  }

  private appendUserContentArrayEvents(
    content: ReadonlyArray<unknown>,
    messageId: string | undefined,
    events: AgentStreamEvent[],
  ): void {
    const timelineItems = this.mapBlocksToTimeline(content, {
      textMessageType: "user_message",
    });
    for (const item of timelineItems) {
      if (item.type === "user_message" && messageId && !item.messageId) {
        events.push({
          type: "timeline",
          item: { ...item, messageId },
          provider: "claude",
        });
        continue;
      }
      events.push({ type: "timeline", item, provider: "claude" });
    }
  }

  private appendStreamEventEvents(
    message: Extract<SDKMessage, { type: "stream_event" }>,
    events: AgentStreamEvent[],
    options: { suppressAssistantText?: boolean; suppressReasoning?: boolean } | undefined,
  ): void {
    const usageUpdatedEvent = this.contextUsage.buildStreamUsageEvent(message.event);
    if (usageUpdatedEvent) {
      events.push(usageUpdatedEvent);
    }
    const timelineItems = this.mapPartialEvent(message.event, {
      suppressAssistantText: options?.suppressAssistantText ?? false,
      suppressReasoning: options?.suppressReasoning ?? false,
    });
    for (const item of timelineItems) {
      events.push({ type: "timeline", item, provider: "claude" });
    }
  }

  private appendResultEvents(
    message: Extract<SDKMessage, { type: "result" }>,
    events: AgentStreamEvent[],
  ): void {
    this.appendTurnEndObservedSubagentSweep(events);
    this.verifySubagentPricing(message.modelUsage);
    const usage = this.convertUsage(message, message.modelUsage);
    if (message.subtype === "success") {
      // Built-in slash commands (e.g. /voice, /usage, "Unknown command: …")
      // run client-side in the Claude CLI with no model turn — output_tokens
      // is 0 and the user-visible text is carried in `result`. Surface it only
      // when the turn has not already emitted assistant text so zero-token
      // accounting from provider gateways does not duplicate streamed output.
      const resultText = typeof message.result === "string" ? message.result.trim() : "";
      const outputTokens = message.usage?.output_tokens;
      if (resultText.length > 0 && outputTokens === 0 && !this.activeTurnHasAssistantText) {
        events.push({
          type: "timeline",
          provider: "claude",
          item: {
            type: "assistant_message",
            text: resultText,
            messageId: message.uuid,
          },
        });
      }
      events.push({ type: "turn_completed", provider: "claude", usage });
      return;
    }
    const errorMessage =
      "errors" in message && Array.isArray(message.errors) && message.errors.length > 0
        ? message.errors.join("\n")
        : "Claude run failed";
    events.push(this.buildTurnFailedEvent(errorMessage));
  }

  /**
   * Diagnostic self-check on the sub-agent price table: re-price the turn's
   * whole-tree per-model token totals (the SDK's own `modelUsage`) and compare to
   * the SDK's `costUSD`. Purely observational — the books stay balanced by the
   * parent-residual rule regardless — but a mismatch means our list prices have
   * drifted and per-sub-agent cost is skewed, so log it loudly. See
   * [[subagent-real-accounting]] (block 5) and claude-pricing.ts.
   */
  private verifySubagentPricing(modelUsage: unknown): void {
    const slices = readClaudeModelUsageSlices(modelUsage);
    if (slices.length === 0) {
      return;
    }
    const result = verifyClaudeTreePricing(slices);
    if (result.mismatches.length === 0 && result.unpriced.length === 0) {
      return;
    }
    this.logger.warn(
      {
        agentId: this.agentId,
        ourUsd: result.ourUsd,
        sdkUsd: result.sdkUsd,
        mismatches: result.mismatches,
        unpriced: result.unpriced,
      },
      "claude subagent price table drift vs modelUsage — per-subagent cost may be skewed",
    );
  }

  /**
   * A foreground Task cannot outlive the turn that spawned it, but its
   * terminal signal can go missing (nested leaves settle inside their
   * spawner's sidechain, never through the root's tool_result path, and a
   * garbled/backgrounded finish can drop the task_notification) — leaving the
   * row stuck "running" forever and its visualizer node never fading. When
   * the turn ends, settle every announced-but-unsettled row to idle.
   * Backgrounded Workflow runs legitimately span turns and are exempt.
   */
  private appendTurnEndObservedSubagentSweep(events: AgentStreamEvent[]): void {
    for (const key of this.announcedObservedSubagents) {
      if (this.settledObservedSubagents.has(key) || this.workflowObservedKeys.has(key)) {
        continue;
      }
      this.settledObservedSubagents.add(key);
      events.push({
        type: "observed_subagent_updated",
        provider: "claude",
        update: {
          key,
          status: "idle",
          ...(this.observedParentKeyByToolUseId.has(key)
            ? { parentKey: this.observedParentKeyByToolUseId.get(key) }
            : {}),
        },
      });
    }
  }

  private createClaudeSessionChangedNotice(
    oldSessionId: string,
    newSessionId: string,
  ): AgentTimelineItem {
    return {
      type: "assistant_message",
      text: `Claude switched to a new session: ${oldSessionId} -> ${newSessionId}`,
    };
  }

  private captureSessionIdFromMessage(message: SDKMessage): {
    threadStartedSessionId: string | null;
    notice: AgentTimelineItem | null;
  } {
    const msgRecord = toObjectRecord(message) ?? {};
    const sessionId = extractSessionIdRaw({
      session_id: msgRecord.session_id,
      sessionId: msgRecord.sessionId,
      session: isObjectRecord(msgRecord.session) ? { id: msgRecord.session.id } : null,
    }).trim();
    if (!sessionId) {
      return { threadStartedSessionId: null, notice: null };
    }
    if (this.claudeSessionId === null) {
      this.claudeSessionId = sessionId;
      this.pendingFreshSessionId = null;
      this.persistence = null;
      this.drainPendingWorkflowArms();
      return { threadStartedSessionId: sessionId, notice: null };
    }
    if (this.claudeSessionId === sessionId) {
      this.pendingFreshSessionId = null;
      return { threadStartedSessionId: null, notice: null };
    }
    const oldSessionId = this.claudeSessionId;
    // Session ID changed mid-stream (e.g. a hook caused Claude to restart
    // with a new session). Accept the new ID and continue — the turn should
    // not be failed just because the underlying subprocess cycled.
    this.logger.warn(
      { existingSessionId: this.claudeSessionId, newSessionId: sessionId },
      "Claude session ID changed in message; accepting new session",
    );
    this.claudeSessionId = sessionId;
    this.pendingFreshSessionId = null;
    this.persistence = null;
    return {
      threadStartedSessionId: sessionId,
      notice: this.createClaudeSessionChangedNotice(oldSessionId, sessionId),
    };
  }

  private handleSystemMessage(message: SDKSystemMessage): {
    threadStartedSessionId: string | null;
    notice: AgentTimelineItem | null;
  } {
    if (message.subtype !== "init") {
      return { threadStartedSessionId: null, notice: null };
    }
    // Every init is a fresh CLI process, whose cumulative total_cost_usd
    // restarts at 0 — reset the per-turn cost watermark with it.
    this.contextUsage.beginProcess();

    const msgRecord = toObjectRecord(message) ?? {};
    const newSessionId = extractSessionIdRaw({
      session_id: msgRecord.session_id,
      sessionId: msgRecord.sessionId,
      session: isObjectRecord(msgRecord.session) ? { id: msgRecord.session.id } : null,
    }).trim();
    if (!newSessionId) {
      return { threadStartedSessionId: null, notice: null };
    }
    const existingSessionId = this.claudeSessionId;
    let threadStartedSessionId: string | null = null;
    let notice: AgentTimelineItem | null = null;

    if (existingSessionId === null) {
      this.claudeSessionId = newSessionId;
      this.pendingFreshSessionId = null;
      threadStartedSessionId = newSessionId;
      this.drainPendingWorkflowArms();
      this.logger.debug({ sessionId: newSessionId }, "Claude session ID set for the first time");
    } else if (existingSessionId === newSessionId) {
      this.pendingFreshSessionId = null;
      this.logger.debug({ sessionId: newSessionId }, "Claude session ID unchanged (same value)");
    } else {
      // Session ID changed in an init message (e.g. a hook restarted Claude
      // with a new session mid-turn). Accept the new ID and continue.
      this.logger.warn(
        { existingSessionId, newSessionId },
        "Claude session ID changed in init message; accepting new session",
      );
      this.claudeSessionId = newSessionId;
      this.pendingFreshSessionId = null;
      threadStartedSessionId = newSessionId;
      notice = this.createClaudeSessionChangedNotice(existingSessionId, newSessionId);
    }
    this.currentMode = message.permissionMode;
    if (this.currentMode !== "plan") {
      this.planResumeMode = this.currentMode;
    }
    this.persistence = null;
    if (message.model) {
      const normalizedRuntimeModel = normalizeClaudeRuntimeModelId(message.model);
      this.logger.debug(
        { runtimeModel: message.model, normalizedRuntimeModel },
        "Captured runtime model from SDK init",
      );
      if (normalizedRuntimeModel) {
        this.lastOptionsModel = normalizedRuntimeModel;
      } else if (!this.lastOptionsModel) {
        this.lastOptionsModel = this.config.model ?? null;
      }
      this.lastRuntimeModel = message.model;
      this.cachedRuntimeInfo = null;
    }
    return { threadStartedSessionId, notice };
  }

  private readMissingResumedConversationError(message: SDKMessage): string | null {
    if (message.type !== "result" || message.subtype !== "error_during_execution") {
      return null;
    }
    if (!this.claudeSessionId) {
      return null;
    }
    const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
    for (const entry of errors) {
      if (typeof entry !== "string") {
        continue;
      }
      const match = entry.match(/^No conversation found with session ID:\s*(.+)$/);
      if (!match) {
        continue;
      }
      if (match[1]?.trim() === this.claudeSessionId) {
        return entry.trim();
      }
    }
    return null;
  }

  private convertUsage(message: SDKResultMessage, modelUsage?: unknown): AgentUsage | undefined {
    return this.contextUsage.buildResultUsage(message, modelUsage);
  }

  private handlePermissionRequest: CanUseTool = async (
    toolName,
    input,
    options,
  ): Promise<PermissionResult> => {
    // Suggestion tools never prompt — the Start button on the card is the gate.
    if (AUTO_APPROVED_OTTO_TOOL_NAMES.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    const requestId = `permission-${randomUUID()}`;
    const kind = resolvePermissionKind(toolName, input);
    const requestInput = normalizeClaudeAskUserQuestionRequestInput(toolName, input);
    const metadata: AgentMetadata = {};
    if (options.toolUseID) {
      metadata.toolUseId = options.toolUseID;
    }
    if (toolName === "ExitPlanMode" && typeof input.plan === "string") {
      metadata.planText = input.plan;
    }
    const toolDetail =
      kind === "tool"
        ? mapClaudeRunningToolCall({
            name: toolName,
            callId: options.toolUseID ?? requestId,
            input,
            output: null,
          })?.detail
        : undefined;

    const request: AgentPermissionRequest = {
      id: requestId,
      provider: "claude",
      name: toolName,
      kind,
      input: requestInput,
      detail: toolDetail,
      suggestions: options.suggestions?.map((suggestion) => ({
        ...suggestion,
      })),
      actions: kind === "plan" ? buildClaudePlanPermissionActions(this.planResumeMode) : undefined,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    };

    this.pushEvent({
      type: "permission_requested",
      provider: "claude",
      request,
    });

    return await new Promise<PermissionResult>((resolve, reject) => {
      const cleanupFns: Array<() => void> = [];
      const cleanup = () => {
        while (cleanupFns.length) {
          const fn = cleanupFns.pop();
          try {
            fn?.();
          } catch {
            // ignore cleanup errors
          }
        }
      };

      const abortHandler = () => {
        this.pendingPermissions.delete(requestId);
        cleanup();
        reject(new Error("Permission request aborted"));
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          abortHandler();
          return;
        }
        options.signal.addEventListener("abort", abortHandler, { once: true });
        cleanupFns.push(() => options.signal?.removeEventListener("abort", abortHandler));
      }

      this.pendingPermissions.set(requestId, {
        request,
        resolve,
        reject,
        cleanup,
      });
    });
  };

  private enqueueTimeline(item: AgentTimelineItem) {
    this.pushEvent({ type: "timeline", item, provider: "claude" });
  }

  private flushPendingToolCalls() {
    for (const [id, entry] of this.toolUseCache) {
      if (entry.started) {
        this.pushToolCall(
          mapClaudeCanceledToolCall({
            name: entry.name,
            callId: id,
            input: entry.input ?? null,
            output: null,
          }),
        );
        // An interrupted turn takes its in-flight subagents (and workflow runs)
        // down with it — settle their observed rows instead of leaving them
        // "running". Only tasks still in the cache are in-flight; a backgrounded
        // workflow whose tool_result already evicted it is left for its own
        // task_notification, matching the background-shell semantics below.
        if (
          (isClaudeSubagentToolName(entry.name) || isClaudeWorkflowToolName(entry.name)) &&
          this.announcedObservedSubagents.has(id)
        ) {
          this.settledObservedSubagents.add(id);
          this.pushEvent({
            type: "observed_subagent_updated",
            provider: "claude",
            update: { key: id, status: "closed" },
          });
          // Interrupted in-flight workflow → tear down its transcript watcher too.
          if (isClaudeWorkflowToolName(entry.name)) {
            this.disarmWorkflowWatcher(id, "closed");
          }
        }
        // Same teardown for an in-flight background shell task — the process
        // dies with the interrupted turn, so settle its row instead of
        // leaving it stuck "running".
        if (
          isClaudeBackgroundShellToolName(entry.name) &&
          this.announcedBackgroundShellTasks.has(id)
        ) {
          this.pushEvent({
            type: "background_shell_task_updated",
            provider: "claude",
            update: { key: id, status: "closed" },
          });
        }
      }
    }
    this.toolUseCache.clear();
    this.sidechainTracker.clear();
    this.observedSubagentUsage.clear();
  }

  private pushToolCall(
    item: Extract<AgentTimelineItem, { type: "tool_call" }> | null,
    target?: AgentTimelineItem[],
  ) {
    if (!item) {
      return;
    }
    if (target) {
      target.push(item);
      return;
    }
    this.enqueueTimeline(item);
  }

  private pushEvent(event: AgentStreamEvent) {
    this.notifySubscribers(event);
  }

  private notifySubscribers(event: AgentStreamEvent): void {
    const turnId = this.activeForegroundTurnId ?? this.autonomousTurn?.id;
    const tagged = turnId ? { ...event, turnId } : event;
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.claudeSessionId,
        turnId: getAgentStreamEventTurnId(tagged),
        event: tagged,
      },
      "provider.claude.event_emit",
    );
    for (const callback of this.subscribers) {
      try {
        callback(tagged);
      } catch (error) {
        this.logger.warn({ err: error }, "Subscriber callback threw");
      }
    }
  }

  // Every turn opens with this instead of a bare turn_started notify. Re-opening
  // the rate-limit dedup window means the turn's first rate_limit_event always
  // re-emits the current plan status, so a client that (re)connected mid-session
  // — e.g. after an app refresh — gets resynced instead of staying blank because
  // the daemon already delivered this exact payload to an earlier client. Dedup
  // still collapses repeats WITHIN the turn (rate_limit_event fires per request).
  private beginTurn(): void {
    this.lastRateLimitEventKey = null;
    this.notifySubscribers({ type: "turn_started", provider: "claude" });
  }

  private normalizePermissionUpdates(
    updates?: AgentPermissionUpdate[],
  ): PermissionUpdate[] | undefined {
    if (!updates || updates.length === 0) {
      return undefined;
    }
    const normalized = updates.filter(isPermissionUpdate);
    return normalized.length > 0 ? normalized : undefined;
  }

  private rejectAllPendingPermissions(error: Error) {
    for (const [id, pending] of this.pendingPermissions) {
      pending.cleanup?.();
      pending.reject(error);
      this.pendingPermissions.delete(id);
    }
  }

  private loadPersistedHistory(sessionId: string): void {
    try {
      const historyPath = this.resolveHistoryPath(sessionId);
      if (!historyPath || !fs.existsSync(historyPath)) {
        return;
      }
      this.ingestPersistedHistory(fs.readFileSync(historyPath, "utf8"));
    } catch {
      // ignore history load failures
    }
  }

  private ingestPersistedHistory(content: string): void {
    if (!content) {
      return;
    }

    const timeline: PersistedTimelineEntry[] = [];
    for (const line of content.split(/\r?\n/)) {
      this.ingestPersistedHistoryLine(line, timeline);
    }

    if (timeline.length > 0) {
      this.persistedHistory = [...this.persistedHistory, ...timeline];
      this.historyPending = true;
    }
  }

  private ingestPersistedHistoryLine(line: string, timeline: PersistedTimelineEntry[]): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const record = toObjectRecord(parsed);
      if (!record) {
        return;
      }
      entry = record;
    } catch {
      return;
    }

    if (entry.isSidechain) {
      return;
    }

    const historyTimestamp = normalizeProviderReplayTimestamp(entry.timestamp);
    const items = this.convertHistoryEntry(entry);
    const isVisibleUserEntry =
      entry.type === "user" &&
      typeof entry.uuid === "string" &&
      !isSyntheticHistoryUserEntry(entry) &&
      !isToolResultUserEntry(entry);
    if (isVisibleUserEntry && typeof entry.uuid === "string") {
      this.rememberUserMessageId(entry.uuid);
      this.rememberRewindUserAnchor(entry.uuid);
    }
    if (entry.type === "assistant" && typeof entry.uuid === "string") {
      this.rememberRewindAssistantAnchor(entry.uuid);
    }

    if (items.length > 0) {
      timeline.push(
        ...items.map((item) => ({
          item,
          timestamp: historyTimestamp ?? undefined,
        })),
      );
    }
  }

  private resolveHistoryPath(sessionId: string): string | null {
    const cwd = this.config.cwd;
    if (!cwd) return null;
    const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
    const candidates = [cwd];
    try {
      const realCwd = fs.realpathSync(cwd);
      if (realCwd !== cwd) {
        candidates.push(realCwd);
      }
    } catch {
      // Fall back to the configured cwd when the path has already disappeared.
    }
    for (const candidate of candidates) {
      const historyPath = path.join(
        claudeProjectDirSync(candidate, { configDir }),
        `${sessionId}.jsonl`,
      );
      if (fs.existsSync(historyPath)) {
        return historyPath;
      }
    }
    return path.join(claudeProjectDirSync(cwd, { configDir }), `${sessionId}.jsonl`);
  }

  private convertHistoryEntry(entry: ClaudeHistoryEntry): AgentTimelineItem[] {
    return convertClaudeHistoryEntry(entry, (content) => this.mapBlocksToTimeline(content));
  }

  // Maps Claude content blocks into AgentTimelineItems.
  //
  // textMessageType controls what type text blocks emit:
  //   - "assistant_message" (default): one item per text block (streaming granularity)
  //   - "user_message": coalesces all text blocks into a single user_message
  //     (matches extractUserMessageText semantics: trim each block, join with "\n\n")
  //
  // suppressAssistantText only applies when textMessageType is "assistant_message" — user text
  // must never be suppressed since the TimelineAssembler only handles assistant text.
  //
  // NOTE: convertClaudeHistoryEntry uses extractUserMessageText directly instead of this function
  // for user entries. Both paths must produce equivalent user_message items.
  private mapBlocksToTimeline(
    content: string | ReadonlyArray<unknown>,
    options?: {
      textMessageType?: "assistant_message" | "user_message";
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ): AgentTimelineItem[] {
    const textMessageType = options?.textMessageType ?? "assistant_message";
    const suppressText =
      textMessageType === "assistant_message" && (options?.suppressAssistantText ?? false);
    const suppressReasoning = options?.suppressReasoning ?? false;

    if (typeof content === "string") {
      if (
        !content ||
        content === INTERRUPT_TOOL_USE_PLACEHOLDER ||
        isClaudeTranscriptNoiseText(content)
      ) {
        return [];
      }
      if (suppressText) {
        return [];
      }
      return [{ type: textMessageType, text: content }];
    }

    const items: AgentTimelineItem[] = [];
    // User SDK entries can arrive as multiple text blocks, but Otto treats them as one message.
    const userTextParts: string[] = [];
    for (const block of content) {
      if (!isClaudeContentChunk(block)) {
        continue;
      }
      this.mapBlockToTimeline(block, {
        items,
        userTextParts,
        textMessageType,
        suppressText,
        suppressReasoning,
      });
    }

    if (textMessageType === "user_message" && userTextParts.length > 0) {
      items.unshift({
        type: "user_message",
        text: userTextParts.join("\n\n"),
      });
    }

    return items;
  }

  private appendTextBlockToTimeline(
    block: ClaudeContentChunk,
    context: {
      items: AgentTimelineItem[];
      userTextParts: string[];
      textMessageType: "assistant_message" | "user_message";
      suppressText: boolean;
    },
  ): void {
    const { items, userTextParts, textMessageType, suppressText } = context;
    const text = typeof block.text === "string" ? block.text : "";
    if (!text || text === INTERRUPT_TOOL_USE_PLACEHOLDER || isClaudeTranscriptNoiseText(text)) {
      return;
    }
    if (textMessageType === "user_message") {
      const trimmed = text.trim();
      if (trimmed) {
        userTextParts.push(trimmed);
      }
      return;
    }
    if (!suppressText) {
      items.push({ type: "assistant_message", text });
    }
  }

  private mapBlockToTimeline(
    block: ClaudeContentChunk,
    context: {
      items: AgentTimelineItem[];
      userTextParts: string[];
      textMessageType: "assistant_message" | "user_message";
      suppressText: boolean;
      suppressReasoning: boolean;
    },
  ): void {
    switch (block.type) {
      case "text":
      case "text_delta":
        this.appendTextBlockToTimeline(block, context);
        break;
      case "thinking":
      case "thinking_delta":
        if (typeof block.thinking === "string" && block.thinking && !context.suppressReasoning) {
          context.items.push({ type: "reasoning", text: block.thinking });
        }
        break;
      case "tool_use":
      case "server_tool_use":
      case "mcp_tool_use":
        this.handleToolUseStart(block, context.items);
        break;
      case "tool_result":
      case "mcp_tool_result":
      case "web_fetch_tool_result":
      case "web_search_tool_result":
      case "code_execution_tool_result":
      case "bash_code_execution_tool_result":
      case "text_editor_code_execution_tool_result":
        this.handleToolResult(block, context.items);
        break;
      default:
        break;
    }
  }

  private handleToolUseStart(block: ClaudeContentChunk, items: AgentTimelineItem[]): void {
    const entry = this.upsertToolUseEntry(block);
    if (!entry) {
      return;
    }
    if (entry.started) {
      return;
    }
    entry.started = true;
    this.toolUseCache.set(entry.id, entry);
    this.pushToolCall(
      mapClaudeRunningToolCall({
        name: entry.name,
        callId: entry.id,
        input: entry.input ?? this.normalizeToolInput(block.input) ?? null,
        output: null,
      }),
      items,
    );
  }

  private handleToolResult(block: ClaudeContentChunk, items: AgentTimelineItem[]): void {
    const entry =
      typeof block.tool_use_id === "string" ? this.toolUseCache.get(block.tool_use_id) : undefined;
    const blockToolName = typeof block.tool_name === "string" ? block.tool_name : undefined;
    const toolName = entry?.name ?? blockToolName ?? "tool";
    const callId =
      typeof block.tool_use_id === "string" && block.tool_use_id.length > 0
        ? block.tool_use_id
        : (entry?.id ?? null);

    // Pull image blocks out of the result so base64 never reaches the tool output, and render each
    // one as an assistant_message markdown image after the tool_call (matching how Codex emits).
    const { images, text } = splitClaudeToolResultImages(block.content);
    const output = this.buildToolOutput(text, block, entry);

    if (block.is_error) {
      this.pushToolCall(
        mapClaudeFailedToolCall({
          name: toolName,
          callId,
          input: entry?.input ?? null,
          output: output ?? null,
          error: { ...block, content: text },
        }),
        items,
      );
    } else {
      this.pushToolCall(
        this.withSidechainActionsLog(
          mapClaudeCompletedToolCall({
            name: toolName,
            callId,
            input: entry?.input ?? null,
            output: output ?? null,
          }),
          block.tool_use_id,
        ),
        items,
      );
    }

    for (const image of images) {
      const imageItem = renderProviderImageOutputAsAssistantMarkdown(image, {
        materialize: materializeProviderImage,
      });
      if (imageItem) {
        items.push(imageItem);
      }
    }

    if (typeof block.tool_use_id === "string") {
      this.bindTaskTranscriptFromToolResult(toolName, block.tool_use_id, block.content);
      this.enqueueObservedSubagentSettled(toolName, block.tool_use_id, Boolean(block.is_error));
      this.toolUseCache.delete(block.tool_use_id);
      this.sidechainTracker.delete(block.tool_use_id);
    }
  }

  /**
   * Every Task/Agent tool_result (sync completion or async launch ack, at any
   * depth) carries "agentId: <id>" — the sub-agent's on-disk transcript name.
   * Bind the observed row to that transcript so its usage comes from disk (the
   * live sidechain lacks final output counts, and depth ≥ 2 sub-agents never
   * stream at all). Timeline is emitted from disk only for nested keys, which
   * have no live sidechain feed — depth-1 panes are already fed live.
   */
  private bindTaskTranscriptFromToolResult(
    toolName: string,
    toolUseId: string,
    content: unknown,
  ): void {
    if (!isClaudeSubagentToolName(toolName)) {
      return;
    }
    const agentId = readClaudeSubagentAgentIdFromToolResult(content);
    if (!agentId) {
      return;
    }
    this.taskTranscriptWatcher.bind({
      key: toolUseId,
      agentId,
      emitTimeline: this.observedParentKeyByToolUseId.has(toolUseId),
    });
  }

  /**
   * The completed Task/Agent item maps its sub_agent log from the final
   * report only; re-attach the sidechain's accumulated "[Tool] summary"
   * action lines so the finished card keeps the activity history the running
   * updates built up (report first — short consumers truncate from the head).
   */
  private withSidechainActionsLog(
    item: Extract<AgentTimelineItem, { type: "tool_call" }> | null,
    toolUseId: unknown,
  ): Extract<AgentTimelineItem, { type: "tool_call" }> | null {
    if (!item || item.detail.type !== "sub_agent" || typeof toolUseId !== "string") {
      return item;
    }
    const actionsLog = this.sidechainTracker.getAccumulatedLog(toolUseId);
    if (!actionsLog) {
      return item;
    }
    return {
      ...item,
      detail: {
        ...item.detail,
        log: [item.detail.log, actionsLog].filter(Boolean).join("\n"),
      },
    };
  }

  /**
   * Foreground Task settled: mark the observed subagent idle/error. Only keys
   * announced live can enqueue — history replay stays inert. Queued instead of
   * pushed because tool_result mapping runs inside item mapping, not event
   * building; translateMessageToEvents drains the queue.
   *
   * Deliberately NOT mirrored for background shell tasks: a backgrounded Bash
   * call's tool_result fires immediately with a "running in the background"
   * ack, not real completion — treating that as "settled" would mark a still
   * -running shell task idle. Real completion for those arrives via
   * task_notification (see appendBackgroundShellTaskEvent).
   */
  private enqueueObservedSubagentSettled(
    toolName: string,
    toolUseId: string,
    isError: boolean,
  ): void {
    if (!isClaudeSubagentToolName(toolName) || !this.announcedObservedSubagents.has(toolUseId)) {
      return;
    }
    this.settledObservedSubagents.add(toolUseId);
    this.taskTranscriptWatcher.markSettled(toolUseId, isError ? "error" : "idle");
    this.pendingObservedEvents.push({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key: toolUseId,
        status: isError ? "error" : "idle",
        ...(this.observedParentKeyByToolUseId.has(toolUseId)
          ? { parentKey: this.observedParentKeyByToolUseId.get(toolUseId) }
          : {}),
        ...(isError ? { requiresAttention: true } : {}),
      },
    });
  }

  private buildToolOutput(
    content: unknown,
    block: ClaudeContentChunk,
    entry: ToolUseCacheEntry | undefined,
  ): AgentMetadata | undefined {
    if (block.is_error) {
      return undefined;
    }

    const blockServer = typeof block.server === "string" ? block.server : undefined;
    const blockToolName = typeof block.tool_name === "string" ? block.tool_name : undefined;
    const server = entry?.server ?? blockServer ?? "tool";
    const tool = entry?.name ?? blockToolName ?? "tool";
    const coercedContent = coerceToolResultContentToString(content);
    const input = entry?.input;

    // Build structured result based on tool type
    const structured = this.buildStructuredToolResult(server, tool, coercedContent, input);

    if (structured) {
      return structured;
    }

    // Fallback format - try to parse JSON first
    const result: AgentMetadata = {};

    if (coercedContent.length > 0) {
      try {
        // If content is a JSON string, parse it
        result.output = JSON.parse(coercedContent);
      } catch {
        // If not JSON, return unchanged (no extra wrapping)
        result.output = coercedContent;
      }
    }

    // Preserve file changes tracked during tool execution
    if (entry?.files?.length) {
      result.files = entry.files;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private isCommandExecutionTool(
    normalizedServer: string,
    normalizedTool: string,
    input: AgentMetadata | null | undefined,
  ): boolean {
    if (
      normalizedServer.includes("bash") ||
      normalizedServer.includes("shell") ||
      normalizedServer.includes("command")
    ) {
      return true;
    }
    if (
      normalizedTool.includes("bash") ||
      normalizedTool.includes("shell") ||
      normalizedTool.includes("command")
    ) {
      return true;
    }
    return Boolean(input && (typeof input.command === "string" || Array.isArray(input.command)));
  }

  private static isFileWriteTool(normalizedTool: string): boolean {
    return (
      normalizedTool.includes("write") ||
      normalizedTool === "write_file" ||
      normalizedTool === "create_file"
    );
  }

  private static isFileEditTool(normalizedTool: string): boolean {
    return (
      normalizedTool.includes("edit") ||
      normalizedTool.includes("patch") ||
      normalizedTool === "apply_patch" ||
      normalizedTool === "apply_diff"
    );
  }

  private static isFileReadTool(normalizedTool: string): boolean {
    return (
      normalizedTool.includes("read") ||
      normalizedTool === "read_file" ||
      normalizedTool === "view_file"
    );
  }

  private buildStructuredToolResult(
    server: string,
    tool: string,
    output: string,
    input?: AgentMetadata | null,
  ): AgentMetadata | undefined {
    const normalizedServer = server.toLowerCase();
    const normalizedTool = tool.toLowerCase();

    if (this.isCommandExecutionTool(normalizedServer, normalizedTool, input)) {
      const command = this.extractCommandText(input ?? {}) ?? "command";
      return {
        type: "command",
        command,
        output,
        cwd: typeof input?.cwd === "string" ? input.cwd : undefined,
      };
    }

    if (
      ClaudeAgentSession.isFileWriteTool(normalizedTool) &&
      input &&
      typeof input.file_path === "string"
    ) {
      return {
        type: "file_write",
        filePath: input.file_path,
        oldContent: "",
        newContent: typeof input.content === "string" ? input.content : output,
      };
    }

    if (
      ClaudeAgentSession.isFileEditTool(normalizedTool) &&
      input &&
      typeof input.file_path === "string"
    ) {
      // Support both old_str/new_str and old_string/new_string parameter names
      const oldContent = firstStringField(input, "old_str", "old_string");
      const newContent = firstStringField(input, "new_str", "new_string");
      const diff = firstStringField(input, "patch", "diff");
      return {
        type: "file_edit",
        filePath: input.file_path,
        diff,
        oldContent,
        newContent,
      };
    }

    if (
      ClaudeAgentSession.isFileReadTool(normalizedTool) &&
      input &&
      typeof input.file_path === "string"
    ) {
      return {
        type: "file_read",
        filePath: input.file_path,
        content: output,
      };
    }

    return undefined;
  }

  private updatePartialEventToolState(event: SDKPartialAssistantMessage["event"]): boolean {
    if (event.type === "content_block_start") {
      const block = isClaudeContentChunk(event.content_block) ? event.content_block : null;
      if (
        block?.type === "tool_use" &&
        typeof event.index === "number" &&
        typeof block.id === "string"
      ) {
        this.toolUseIndexToId.set(event.index, block.id);
        this.toolUseInputBuffers.delete(block.id);
      }
      return false;
    }
    if (event.type === "content_block_delta") {
      const delta = isClaudeContentChunk(event.delta) ? event.delta : null;
      if (delta?.type === "input_json_delta") {
        const partialJson = typeof delta.partial_json === "string" ? delta.partial_json : undefined;
        this.handleToolInputDelta(event.index, partialJson);
        return true;
      }
      return false;
    }
    if (event.type === "content_block_stop" && typeof event.index === "number") {
      const toolId = this.toolUseIndexToId.get(event.index);
      if (toolId) {
        this.toolUseIndexToId.delete(event.index);
        this.toolUseInputBuffers.delete(toolId);
      }
    }
    return false;
  }

  private mapPartialEvent(
    event: SDKPartialAssistantMessage["event"],
    options?: {
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ): AgentTimelineItem[] {
    if (this.updatePartialEventToolState(event)) {
      return [];
    }

    switch (event.type) {
      case "content_block_start":
        return isClaudeContentChunk(event.content_block)
          ? this.mapBlocksToTimeline([event.content_block], {
              suppressAssistantText: options?.suppressAssistantText,
              suppressReasoning: options?.suppressReasoning,
            })
          : [];
      case "content_block_delta":
        return isClaudeContentChunk(event.delta)
          ? this.mapBlocksToTimeline([event.delta], {
              suppressAssistantText: options?.suppressAssistantText,
              suppressReasoning: options?.suppressReasoning,
            })
          : [];
      default:
        return [];
    }
  }

  private upsertToolUseEntry(block: ClaudeContentChunk): ToolUseCacheEntry | null {
    const id = typeof block.id === "string" ? block.id : undefined;
    if (!id) {
      return null;
    }
    const existing = this.toolUseCache.get(id) ?? createDefaultToolUseCacheEntry(id, block);

    if (typeof block.name === "string" && block.name.length > 0) {
      existing.name = block.name;
    }
    if (typeof block.server === "string" && block.server.length > 0) {
      existing.server = block.server;
    } else if (!existing.server) {
      existing.server = existing.name;
    }

    if (
      block.type === "tool_use" ||
      block.type === "mcp_tool_use" ||
      block.type === "server_tool_use"
    ) {
      const input = this.normalizeToolInput(block.input);
      if (input) {
        this.applyToolInput(existing, input);
      }
    }

    this.toolUseCache.set(id, existing);
    return existing;
  }

  private handleToolInputDelta(index: number | undefined, partialJson: string | undefined): void {
    if (typeof index !== "number" || typeof partialJson !== "string") {
      return;
    }
    const toolId = this.toolUseIndexToId.get(index);
    if (!toolId) {
      return;
    }
    const buffer = (this.toolUseInputBuffers.get(toolId) ?? "") + partialJson;
    this.toolUseInputBuffers.set(toolId, buffer);
    const entry = this.toolUseCache.get(toolId);
    const parsed = parsePartialJsonObject(buffer);
    if (!entry || !parsed) {
      return;
    }
    const normalized = this.normalizeToolInput(parsed.value);
    if (!normalized) {
      return;
    }
    if (!parsed.complete && Object.keys(normalized).length === 0) {
      return;
    }
    if (this.areToolInputsEqual(entry.input ?? undefined, normalized)) {
      return;
    }
    this.applyToolInput(entry, normalized);
    this.toolUseCache.set(toolId, entry);
    this.pushToolCall(
      mapClaudeRunningToolCall({
        name: entry.name,
        callId: toolId,
        input: normalized,
        output: null,
      }),
    );
  }

  private normalizeToolInput(input: unknown): AgentMetadata | null {
    if (!isMetadata(input)) {
      return null;
    }
    return input;
  }

  private areToolInputsEqual(left: AgentMetadata | undefined, right: AgentMetadata): boolean {
    if (!left) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return rightKeys.every((key) => left[key] === right[key]);
  }

  private applyToolInput(entry: ToolUseCacheEntry, input: AgentMetadata): void {
    entry.input = input;
    if (this.isCommandTool(entry.name, input)) {
      entry.classification = "command";
      entry.commandText = this.extractCommandText(input) ?? entry.commandText;
    } else {
      const files = this.extractFileChanges(input);
      if (files?.length) {
        entry.classification = "file_change";
        entry.files = files;
      }
    }
  }

  private isCommandTool(name: string, input: AgentMetadata): boolean {
    const normalized = name.toLowerCase();
    if (
      normalized.includes("bash") ||
      normalized.includes("shell") ||
      normalized.includes("terminal") ||
      normalized.includes("command")
    ) {
      return true;
    }
    if (typeof input.command === "string" || Array.isArray(input.command)) {
      return true;
    }
    return false;
  }

  private extractCommandText(input: AgentMetadata): string | undefined {
    const command = input.command;
    if (typeof command === "string" && command.length > 0) {
      return command;
    }
    if (Array.isArray(command)) {
      const tokens = command.filter((value): value is string => typeof value === "string");
      if (tokens.length > 0) {
        return tokens.join(" ");
      }
    }
    if (typeof input.description === "string" && input.description.length > 0) {
      return input.description;
    }
    return undefined;
  }

  private extractFileChanges(input: AgentMetadata): { path: string; kind: string }[] | undefined {
    if (typeof input.file_path === "string" && input.file_path.length > 0) {
      const relative = this.relativizePath(input.file_path);
      if (relative) {
        return [{ path: relative, kind: this.detectFileKind(input.file_path) }];
      }
    }
    if (typeof input.patch === "string" && input.patch.length > 0) {
      const files = this.parsePatchFileList(input.patch);
      if (files.length > 0) {
        return files.map((entry) => ({
          path: this.relativizePath(entry.path) ?? entry.path,
          kind: entry.kind,
        }));
      }
    }
    if (Array.isArray(input.files)) {
      const files: { path: string; kind: string }[] = [];
      for (const value of input.files) {
        if (typeof value === "string" && value.length > 0) {
          files.push({
            path: this.relativizePath(value) ?? value,
            kind: this.detectFileKind(value),
          });
        }
      }
      if (files.length > 0) {
        return files;
      }
    }
    return undefined;
  }

  private detectFileKind(filePath: string): string {
    try {
      return fs.existsSync(filePath) ? "update" : "add";
    } catch {
      return "update";
    }
  }

  private relativizePath(target?: string): string | undefined {
    if (!target) {
      return undefined;
    }
    const cwd = this.config.cwd;
    if (cwd && target.startsWith(cwd)) {
      const relative = path.relative(cwd, target);
      return relative.length > 0 ? relative : path.basename(target);
    }
    return target;
  }

  private parsePatchFileList(patch: string): { path: string; kind: string }[] {
    const files: { path: string; kind: string }[] = [];
    const seen = new Set<string>();
    for (const line of patch.split(/\r?\n/)) {
      const trimmed = line.trim();
      let kind: string | null = null;
      let parsedPath: string | null = null;
      if (trimmed.startsWith("*** Add File:")) {
        kind = "add";
        parsedPath = trimmed.replace("*** Add File:", "").trim();
      } else if (trimmed.startsWith("*** Delete File:")) {
        kind = "delete";
        parsedPath = trimmed.replace("*** Delete File:", "").trim();
      } else if (trimmed.startsWith("*** Update File:")) {
        kind = "update";
        parsedPath = trimmed.replace("*** Update File:", "").trim();
      }
      if (kind && parsedPath && !seen.has(`${kind}:${parsedPath}`)) {
        seen.add(`${kind}:${parsedPath}`);
        files.push({ path: parsedPath, kind });
      }
    }
    return files;
  }
}

function hasToolLikeBlock(block?: ClaudeContentChunk | null): boolean {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
  return type.includes("tool");
}

function readCompactionMetadata(
  source: unknown,
): { trigger?: string; preTokens?: number; postTokens?: number } | null {
  const sourceRecord = toObjectRecord(source);
  if (!sourceRecord) {
    return null;
  }
  const candidates = [
    sourceRecord.compact_metadata,
    sourceRecord.compactMetadata,
    sourceRecord.compactionMetadata,
  ];
  for (const candidate of candidates) {
    const metadata = toObjectRecord(candidate);
    if (!metadata) {
      continue;
    }
    const trigger = typeof metadata.trigger === "string" ? metadata.trigger : undefined;
    const preTokensRaw = metadata.preTokens ?? metadata.pre_tokens;
    const preTokens = typeof preTokensRaw === "number" ? preTokensRaw : undefined;
    const postTokensRaw = metadata.postTokens ?? metadata.post_tokens;
    const postTokens = typeof postTokensRaw === "number" ? postTokensRaw : undefined;
    return { trigger, preTokens, postTokens };
  }
  return null;
}

function normalizeHistoryBlocks(content: unknown): ClaudeContentChunk[] | null {
  if (Array.isArray(content)) {
    const blocks = content.filter((entry) => isClaudeContentChunk(entry));
    return blocks.length > 0 ? blocks : null;
  }
  if (isClaudeContentChunk(content)) {
    return [content];
  }
  return null;
}

interface ClaudeHistoryEntry {
  type?: unknown;
  subtype?: unknown;
  isCompactSummary?: unknown;
  isSidechain?: unknown;
  uuid?: unknown;
  message?: { content?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

function mapAssistantHistoryBlocksWithMessageId(
  entry: ClaudeHistoryEntry,
  content: string | ClaudeContentChunk[],
  mapBlocks: (content: string | ClaudeContentChunk[]) => AgentTimelineItem[],
): AgentTimelineItem[] {
  const items = mapBlocks(content);
  const assistantMessageId =
    typeof entry.uuid === "string" && entry.uuid.length > 0 ? entry.uuid : null;
  if (!assistantMessageId) {
    return items;
  }
  for (const item of items) {
    if (item.type === "assistant_message" && !item.messageId) {
      item.messageId = assistantMessageId;
    }
  }
  return items;
}

function convertClaudeHistoryEntryPreamble(
  entry: ClaudeHistoryEntry,
): { shortCircuit: AgentTimelineItem[] } | { proceed: { content: unknown } } {
  if (entry.type === "system" && entry.subtype === "compact_boundary") {
    const compactMetadata = readCompactionMetadata(entry);
    return {
      shortCircuit: [
        {
          type: "compaction",
          status: "completed",
          trigger: compactMetadata?.trigger === "manual" ? "manual" : "auto",
          preTokens: compactMetadata?.preTokens,
        },
      ],
    };
  }

  const taskNotificationItem = mapTaskNotificationSystemRecordToToolCall(entry);
  if (taskNotificationItem) {
    return { shortCircuit: [taskNotificationItem] };
  }

  if (entry.isCompactSummary) {
    return { shortCircuit: [] };
  }
  if (entry.type === "user" && isSyntheticHistoryUserEntry(entry)) {
    return { shortCircuit: [] };
  }

  const message = entry?.message;
  if (!message || !("content" in message)) {
    return { shortCircuit: [] };
  }

  const content = message.content;
  if (
    (entry.type === "user" || entry.type === "assistant") &&
    isClaudeTranscriptNoiseContent(content)
  ) {
    return { shortCircuit: [] };
  }

  return { proceed: { content } };
}

function isProviderImageMessage(item: AgentTimelineItem): boolean {
  return item.type === "assistant_message" && isProviderImageMarkdown(item.text);
}

export function convertClaudeHistoryEntry(
  entry: ClaudeHistoryEntry,
  mapBlocks: (content: string | ClaudeContentChunk[]) => AgentTimelineItem[],
): AgentTimelineItem[] {
  const preamble = convertClaudeHistoryEntryPreamble(entry);
  if ("shortCircuit" in preamble) {
    return preamble.shortCircuit;
  }
  const { content } = preamble.proceed;
  const normalizedBlocks = normalizeHistoryBlocks(content);
  const contentValue = typeof content === "string" ? content : normalizedBlocks;
  const hasToolBlock = normalizedBlocks?.some((block) => hasToolLikeBlock(block)) ?? false;
  const userMessageId =
    entry.type === "user" && typeof entry.uuid === "string" && entry.uuid.length > 0
      ? entry.uuid
      : null;

  if (entry.type === "user") {
    const userTaskNotificationItem = mapTaskNotificationUserContentToToolCall({
      content,
      messageId: userMessageId,
    });
    if (userTaskNotificationItem) {
      return [userTaskNotificationItem];
    }
  }

  const timeline: AgentTimelineItem[] = [];

  if (entry.type === "user") {
    const text = extractUserMessageText(content);
    if (text) {
      timeline.push({
        type: "user_message",
        text,
        ...(userMessageId ? { messageId: userMessageId } : {}),
      });
    }
  }

  if (hasToolBlock && normalizedBlocks) {
    const mapped = mapBlocks(normalizedBlocks);
    if (entry.type === "user") {
      // tool_result handling (handleToolResult) emits image markdown as an assistant_message
      // alongside the tool_call. User-entry text blocks also map to assistant_message in this path
      // and must stay suppressed, so keep tool_calls plus only the image assistant_messages.
      const toolItems = mapped.filter(
        (item) => item.type === "tool_call" || isProviderImageMessage(item),
      );
      return timeline.length ? [...timeline, ...toolItems] : toolItems;
    }
    return mapped;
  }

  if (entry.type === "assistant" && contentValue) {
    return mapAssistantHistoryBlocksWithMessageId(entry, contentValue, mapBlocks);
  }

  return timeline;
}

function createAsyncMessageInput<T>(): AsyncMessageInput<T> {
  const queue: T[] = [];
  const resolvers: Array<(value: IteratorResult<T, void>) => void> = [];
  let closed = false;

  return {
    push(item: T) {
      if (closed) {
        return;
      }
      const resolve = resolvers.shift();
      if (resolve) {
        resolve({ value: item, done: false });
        return;
      }
      queue.push(item);
    },
    end() {
      closed = true;
      while (resolvers.length > 0) {
        const resolve = resolvers.shift();
        resolve?.({ value: undefined, done: true });
      }
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T, void> {
        return {
          next: (): Promise<IteratorResult<T, void>> => {
            if (queue.length > 0) {
              const value = queue.shift();
              if (value !== undefined) {
                return Promise.resolve({ value, done: false });
              }
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise<IteratorResult<T, void>>((resolve) => {
              resolvers.push(resolve);
            });
          },
        };
      },
    },
  };
}

interface ClaudeSessionCandidate {
  path: string;
  mtime: Date;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsPromises.access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectRecentClaudeSessions(
  root: string,
  limit: number,
): Promise<ClaudeSessionCandidate[]> {
  let projectDirs: string[];
  try {
    projectDirs = await fsPromises.readdir(root);
  } catch {
    return [];
  }
  const projectFileLists = await Promise.all(
    projectDirs.map(async (dirName) => {
      const projectPath = path.join(root, dirName);
      try {
        const stats = await fsPromises.stat(projectPath);
        if (!stats.isDirectory()) return { projectPath, files: [] as string[] };
        const files = await fsPromises.readdir(projectPath);
        return { projectPath, files };
      } catch {
        return { projectPath, files: [] as string[] };
      }
    }),
  );
  const fileEntries = projectFileLists.flatMap(({ projectPath, files }) =>
    files.filter((f) => f.endsWith(".jsonl")).map((f) => path.join(projectPath, f)),
  );
  const statResults = await Promise.all(
    fileEntries.map(async (fullPath) => {
      try {
        const fileStats = await fsPromises.stat(fullPath);
        return { path: fullPath, mtime: fileStats.mtime };
      } catch {
        return null;
      }
    }),
  );
  const candidates: ClaudeSessionCandidate[] = statResults.filter(
    (entry): entry is ClaudeSessionCandidate => entry !== null,
  );
  return candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, limit);
}

interface ClaudeSessionDescriptorAccumulator {
  sessionId: string | null;
  cwd: string | null;
  title: string | null;
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
}

function isFinishedAccumulator(acc: ClaudeSessionDescriptorAccumulator): boolean {
  return Boolean(acc.sessionId && acc.cwd && acc.title);
}

function applyClaudeSessionEntryToAccumulator(
  entryRaw: unknown,
  acc: ClaudeSessionDescriptorAccumulator,
): void {
  const entry = toObjectRecord(entryRaw);
  if (!entry) {
    return;
  }
  if (entry.isSidechain) {
    return;
  }
  if (entry.type === "user" && isSyntheticUserEntry(entry)) {
    return;
  }
  if (!acc.sessionId && typeof entry.sessionId === "string") {
    acc.sessionId = entry.sessionId;
  }
  if (!acc.cwd && typeof entry.cwd === "string") {
    acc.cwd = entry.cwd;
  }
  if (entry.type === "user" && entry.message) {
    const text = extractClaudeUserText(entry.message);
    if (text) {
      if (!acc.title) {
        acc.title = text;
      }
      const preview = normalizeImportablePromptPreview(text);
      acc.firstPromptPreview ??= preview;
      acc.lastPromptPreview = preview;
    }
    return;
  }
}

async function parseClaudeSessionDescriptor(
  filePath: string,
  mtime: Date,
): Promise<ImportableProviderSession | null> {
  let content: string;
  try {
    content = await fsPromises.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const acc: ClaudeSessionDescriptorAccumulator = {
    sessionId: null,
    cwd: null,
    title: null,
    firstPromptPreview: null,
    lastPromptPreview: null,
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    applyClaudeSessionEntryToAccumulator(entry, acc);
    if (isFinishedAccumulator(acc)) {
      break;
    }
  }

  const { sessionId, cwd, title } = acc;

  if (!sessionId || !cwd) {
    return null;
  }

  return {
    providerHandleId: sessionId,
    cwd,
    title: (title ?? "").trim() || `Claude session ${sessionId.slice(0, 8)}`,
    firstPromptPreview: acc.firstPromptPreview,
    lastPromptPreview: acc.lastPromptPreview,
    lastActivityAt: mtime,
  };
}

function normalizeImportablePromptPreview(text: string): string | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}

function normalizeClaudeUserPromptText(text: string): string | null {
  const normalized = text.trim();
  if (!CLAUDE_COMMAND_MESSAGE_PATTERN.test(normalized)) {
    return normalized || null;
  }

  const command = readClaudeCommandPromptName(normalized);
  if (!command) {
    return null;
  }

  const commandArgs = normalized.match(CLAUDE_COMMAND_ARGS_PATTERN)?.[1]?.trim();
  if (commandArgs) {
    return `${command} ${commandArgs}`;
  }

  return command;
}

function readClaudeCommandPromptName(text: string): string | null {
  const commandName = text.match(CLAUDE_COMMAND_NAME_PATTERN)?.[1]?.trim();
  if (commandName) {
    return commandName.startsWith("/") ? commandName : `/${commandName}`;
  }

  const commandMessage = text.match(CLAUDE_COMMAND_MESSAGE_PATTERN)?.[1]?.trim();
  if (!commandMessage) {
    return null;
  }
  return commandMessage.startsWith("/") ? commandMessage : `/${commandMessage}`;
}

function extractClaudeUserText(messageRaw: unknown): string | null {
  const message = toObjectRecord(messageRaw);
  if (!message) {
    return null;
  }
  if (typeof message.content === "string") {
    const normalized = message.content.trim();
    if (!normalized || isClaudeTranscriptNoiseText(normalized)) return null;
    return normalizeClaudeUserPromptText(normalized);
  }
  if (typeof message.text === "string") {
    const normalized = message.text.trim();
    if (!normalized || isClaudeTranscriptNoiseText(normalized)) return null;
    return normalizeClaudeUserPromptText(normalized);
  }
  if (isUnknownArray(message.content)) {
    for (const block of message.content) {
      const blockRecord = toObjectRecord(block);
      if (blockRecord && typeof blockRecord.text === "string") {
        const normalized = blockRecord.text.trim();
        if (normalized && !isClaudeTranscriptNoiseText(normalized)) {
          return normalizeClaudeUserPromptText(normalized);
        }
      }
    }
  }
  return null;
}
