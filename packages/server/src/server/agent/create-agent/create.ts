import type { Logger } from "pino";

import { PARENT_AGENT_ID_LABEL } from "@otto-code/protocol/agent-labels";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { CreateOttoWorktreeInput } from "../../otto-worktree-service.js";
import { expandUserPath, resolvePathFromBase } from "../../path-utils.js";
import { toWorktreeRequestError } from "../../worktree-errors.js";
import type {
  AgentWorktreeSetupContinuation,
  CreateOttoWorktreeSetupContinuationInput,
  CreateOttoWorktreeWorkflowFn,
  CreateOttoWorktreeWorkflowResult,
} from "../../worktree-session.js";
import type { AgentAttachment, FirstAgentContext, GitSetupOptions } from "../../messages.js";
import type { AgentManager, CreateAgentOptions, ManagedAgent } from "../agent-manager.js";
import type {
  AgentPromptContentBlock,
  AgentPromptInput,
  AgentRunOptions,
  AgentSessionConfig,
} from "../agent-sdk-types.js";
import type { AgentStorage } from "../agent-storage.js";
import type {
  ProviderSnapshotManager,
  ResolvedProviderCreateConfig,
} from "../provider-snapshot-manager.js";
import { setupFinishNotification, startCreatedAgentInitialPrompt } from "../agent-prompt.js";
import type { AgentAutoTitleRequest } from "../agent-auto-title.js";
import { resolveCreateAgentTitles } from "../create-agent-title.js";
import { normalizeClientMessageId, resolveClientMessageId } from "../../client-message-id.js";
import { resolveRequiredProviderModel, type ResolvedProviderModel } from "../mcp-shared.js";
import {
  appendTimelineItemIfAgentKnown,
  emitLiveTimelineItemIfAgentKnown,
} from "../timeline-append.js";

export interface CreateAgentSessionWorktreeResult {
  sessionConfig: AgentSessionConfig;
  setupContinuation?: AgentWorktreeSetupContinuation;
  // Set when this build created a fresh worktree workspace. The agent must be
  // stamped with it so workspaceId-scoped archive can find the agent later.
  createdWorkspaceId?: string;
}

export interface CreateAgentCommandDependencies {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  ottoHome?: string;
  worktreesRoot?: string;
  terminalManager?: TerminalManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  createOttoWorktree?: CreateOttoWorktreeWorkflowFn;
  // Mints a fresh directory workspace for a cwd and returns its id.
  ensureWorkspaceForCreate?: EnsureWorkspaceForCreate;
  // Schedules an AI-written short chat title from the first message, off the
  // create hot path. Absent in contexts that don't wire structured generation
  // (e.g. tests) — the chat then keeps its provisional first-line title.
  scheduleAutoTitle?: (request: AgentAutoTitleRequest) => void;
}

export type EnsureWorkspaceForCreate = (
  cwd: string,
  firstAgentContext?: FirstAgentContext,
) => Promise<string>;

export interface CreateAgentFromSessionInput {
  kind: "session";
  config: AgentSessionConfig;
  workspaceId: string;
  worktreeName?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  git?: GitSetupOptions;
  labels: Record<string, string>;
  env?: Record<string, string>;
  provisionalTitle: string | null;
  firstAgentContext: FirstAgentContext;
  buildSessionConfig: (
    config: AgentSessionConfig,
    gitOptions?: GitSetupOptions,
    legacyWorktreeName?: string,
    firstAgentContext?: FirstAgentContext,
  ) => Promise<CreateAgentSessionWorktreeResult>;
}

export interface CreateAgentFromMcpInput {
  kind: "mcp";
  provider: string;
  title?: string;
  initialPrompt?: string;
  config?: Partial<AgentSessionConfig>;
  cwd?: string;
  workspaceId?: string;
  thinking?: string;
  features?: Record<string, unknown>;
  labels?: Record<string, string>;
  mode?: string;
  unattended?: boolean;
  promptFailure?: CreateAgentPromptFailureMode;
  background: boolean;
  notifyOnFinish: boolean;
  internal?: boolean;
  detached?: boolean;
  callerAgentId?: string;
  callerContext?: {
    lockedCwd?: string;
    allowCustomCwd?: boolean;
    childAgentDefaultLabels?: Record<string, string>;
  } | null;
  worktree?: {
    worktreeName?: string;
    branchName?: string;
    baseBranch?: string;
    refName?: string;
    action?: "branch-off" | "checkout";
    githubPrNumber?: number;
  };
}

export type CreateAgentCommandInput = CreateAgentFromSessionInput | CreateAgentFromMcpInput;
export type CreateAgentPromptFailureMode = "throw" | "log" | "return-error";

export interface CreateAgentCommandResult {
  snapshot: ManagedAgent;
  liveSnapshot: ManagedAgent;
  background: boolean;
  initialPromptStarted: boolean;
  initialPromptError: unknown | null;
}

export type BoundCreateAgentCommand = (
  input: CreateAgentCommandInput,
) => Promise<CreateAgentCommandResult>;

function requireResolvedWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) {
    throw new Error("createAgentCommand requires a resolved workspaceId");
  }
  return workspaceId;
}

export function formatProviderModel(provider: string, model: string | null | undefined): string {
  if (!model || provider.includes("/")) {
    return provider;
  }
  return `${provider}/${model}`;
}

function resolveProviderModel(providerValue: string): ResolvedProviderModel {
  const providerInput = providerValue.trim();
  if (providerInput.includes("/")) {
    return resolveRequiredProviderModel(providerInput);
  }
  if (!providerInput) {
    throw new Error("provider is required");
  }
  return { provider: providerInput, model: undefined };
}

interface ResolvedCreateAgent {
  config: AgentSessionConfig;
  createOptions: CreateAgentOptions;
  prompt?: AgentPromptInput;
  runOptions?: AgentRunOptions;
  setupContinuation?: AgentWorktreeSetupContinuation;
  background: boolean;
  promptFailure: CreateAgentPromptFailureMode;
  promptLogger?: Logger;
  // Present when this chat should get an AI-written title from its first
  // message. Omitted for internal/utility agents, which never carry a
  // user-facing title.
  autoTitle?: Omit<AgentAutoTitleRequest, "agentId">;
}

export async function createAgentCommand(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentCommandInput,
): Promise<CreateAgentCommandResult> {
  const resolved =
    input.kind === "session"
      ? await resolveSessionCreateAgent(dependencies, input)
      : await resolveMcpCreateAgent(dependencies, input);

  const snapshot = await dependencies.agentManager.createAgent(
    resolved.config,
    undefined,
    resolved.createOptions,
  );

  resolved.setupContinuation?.startAfterAgentCreate({
    agentId: snapshot.id,
  });

  let liveSnapshot = snapshot;
  let initialPromptStarted = false;
  let initialPromptError: unknown | null = null;
  if (resolved.prompt !== undefined) {
    const sendResult = await sendInitialPrompt(dependencies, resolved, snapshot);
    initialPromptStarted = sendResult.started;
    liveSnapshot = sendResult.liveSnapshot;
    initialPromptError = sendResult.error ?? null;
  }

  if (resolved.autoTitle && dependencies.scheduleAutoTitle) {
    dependencies.scheduleAutoTitle({ agentId: snapshot.id, ...resolved.autoTitle });
  }

  if (input.kind === "mcp" && input.notifyOnFinish && input.callerAgentId && initialPromptStarted) {
    setupFinishNotification({
      agentManager: dependencies.agentManager,
      agentStorage: dependencies.agentStorage,
      childAgentId: snapshot.id,
      callerAgentId: input.callerAgentId,
      logger: dependencies.logger,
    });
  }

  return {
    snapshot,
    liveSnapshot,
    background: resolved.background,
    initialPromptStarted,
    initialPromptError,
  };
}

async function resolveSessionCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromSessionInput,
): Promise<ResolvedCreateAgent> {
  const trimmedPrompt = input.initialPrompt?.trim();
  const { sessionConfig, setupContinuation, createdWorkspaceId } = await input.buildSessionConfig(
    input.config,
    input.git,
    input.worktreeName,
    input.firstAgentContext,
  );
  const prompt = buildAgentPrompt(trimmedPrompt ?? "", input.images, input.attachments);
  const hasPromptContent = Array.isArray(prompt) ? prompt.length > 0 : prompt.length > 0;
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const runOptions: AgentRunOptions | undefined =
    input.outputSchema || clientMessageId
      ? {
          ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
          ...(clientMessageId ? { messageId: clientMessageId } : {}),
        }
      : undefined;
  const workspaceId = setupContinuation ? createdWorkspaceId : input.workspaceId;

  return {
    config: sessionConfig,
    createOptions: {
      labels: input.labels,
      initialPrompt: trimmedPrompt,
      env: input.env,
      initialTitle: input.provisionalTitle,
      // A legacy git/worktreeName worktree creates a fresh workspace, so the
      // agent belongs to that workspace, not the source one. createdWorkspaceId
      // is the freshly created worktree's workspace.
      workspaceId: requireResolvedWorkspaceId(workspaceId),
    },
    prompt: hasPromptContent ? prompt : undefined,
    runOptions,
    setupContinuation,
    background: true,
    promptFailure: "throw",
    promptLogger: dependencies.logger.child({
      clientMessageId: resolveClientMessageId(input.clientMessageId),
    }),
    // Auto-name only a normal new chat: skip when the caller pinned an explicit
    // title or the agent is internal (its title is a fixed utility label).
    autoTitle:
      hasPromptContent && !input.config.title && !input.config.internal
        ? {
            cwd: sessionConfig.cwd,
            firstAgentContext: input.firstAgentContext,
            provisionalTitle: input.provisionalTitle,
          }
        : undefined,
  };
}

async function resolveMcpCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromMcpInput,
): Promise<ResolvedCreateAgent> {
  const resolvedProviderModel = resolveProviderModel(input.provider);
  const provider = resolvedProviderModel.provider;
  const parentAgent = input.callerAgentId
    ? requireParentAgent(dependencies.agentManager, input.callerAgentId)
    : null;
  const cwd = resolveMcpInitialCwd(input, parentAgent);
  const { resolvedCwd, setupContinuation, createdWorkspaceId } = await resolveMcpCwd({
    dependencies,
    cwd,
    worktree: input.worktree,
    initialPrompt: input.initialPrompt ?? "",
  });

  const workspaceId = await resolveMcpWorkspaceId({
    dependencies,
    input,
    parentAgent,
    setupContinuation,
    createdWorkspaceId,
    resolvedCwd,
  });
  const resolvedCreateConfig = await resolveMcpProviderCreateConfig({
    dependencies,
    input,
    provider,
    resolvedCwd,
    parentAgent,
    model: resolvedProviderModel.model ?? input.config?.model,
  });

  const labels = mergeLabels({
    callerAgentId: input.callerAgentId,
    detached: input.detached ?? false,
    childAgentDefaultLabels: input.callerContext?.childAgentDefaultLabels,
    labels: input.labels,
  });

  const trimmedPrompt = input.initialPrompt?.trim() ?? "";
  // Only auto-name when the caller left the title blank: an explicit MCP/caller
  // title (a spawned subagent's task name, an orchestration phase, …) must win.
  const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
    configTitle: input.config?.title ?? input.title,
    initialPrompt: trimmedPrompt,
  });
  const isInternal = input.internal ?? input.config?.internal ?? false;
  return {
    config: buildMcpSessionConfig({
      input,
      resolvedProviderModel,
      provider,
      resolvedCwd,
      trimmedPrompt,
      resolvedMode: resolvedCreateConfig.modeId,
      resolvedFeatures: resolvedCreateConfig.featureValues,
      resolvedUnattended: resolvedCreateConfig.unattended,
    }),
    createOptions: {
      ...(labels ? { labels } : {}),
      workspaceId: requireResolvedWorkspaceId(workspaceId),
    },
    prompt: trimmedPrompt ? trimmedPrompt : undefined,
    setupContinuation,
    background: input.background,
    promptFailure: input.promptFailure ?? "log",
    autoTitle:
      trimmedPrompt && !explicitTitle && !isInternal
        ? {
            cwd: resolvedCwd,
            firstAgentContext: { prompt: trimmedPrompt },
            provisionalTitle,
          }
        : undefined,
  };
}

function resolveMcpInitialCwd(
  input: CreateAgentFromMcpInput,
  parentAgent: ManagedAgent | null,
): string {
  if (!parentAgent) {
    return expandUserPath(input.cwd ?? process.cwd());
  }
  return resolveChildAgentCwd({
    parentCwd: parentAgent.cwd,
    requestedCwd: input.cwd,
    lockedCwd: input.callerContext?.lockedCwd,
    allowCustomCwd: input.callerContext?.allowCustomCwd ?? true,
  });
}

async function resolveMcpWorkspaceId(params: {
  dependencies: CreateAgentCommandDependencies;
  input: CreateAgentFromMcpInput;
  parentAgent: ManagedAgent | null;
  setupContinuation?: AgentWorktreeSetupContinuation;
  createdWorkspaceId?: string;
  resolvedCwd: string;
}): Promise<string | undefined> {
  // MCP callers resolve workspace ownership before this point. Worktree
  // creation wins because the new agent lives in the fresh worktree workspace.
  // Otherwise use the explicit workspace id, then the parent workspace for
  // direct internal callers. Ownership is never resolved from cwd.
  if (params.setupContinuation) {
    return params.createdWorkspaceId;
  }
  if (params.input.workspaceId) {
    return params.input.workspaceId;
  }
  if (params.parentAgent?.workspaceId) {
    return params.parentAgent.workspaceId;
  }
  return ensureWorkspaceForMcpCreate(
    params.dependencies,
    params.resolvedCwd,
    params.input.initialPrompt ?? "",
  );
}

async function resolveMcpProviderCreateConfig(params: {
  dependencies: CreateAgentCommandDependencies;
  input: CreateAgentFromMcpInput;
  provider: string;
  resolvedCwd: string;
  parentAgent: ManagedAgent | null;
  model: string | null | undefined;
}): Promise<ResolvedProviderCreateConfig> {
  const passthroughConfig = params.input.config;
  return params.dependencies.providerSnapshotManager.resolveCreateConfig({
    cwd: params.resolvedCwd,
    provider: params.provider,
    requestedMode: params.input.mode ?? passthroughConfig?.modeId,
    featureValues: params.input.features ?? passthroughConfig?.featureValues,
    parent: params.parentAgent,
    unattended: params.input.unattended ?? false,
    // Model-aware unattended-target selection (Claude dontAsk → auto) needs the
    // resolved model here, before the session config is built.
    model: params.model,
  });
}

function buildMcpSessionConfig(params: {
  input: CreateAgentFromMcpInput;
  resolvedProviderModel: ResolvedProviderModel;
  provider: string;
  resolvedCwd: string;
  trimmedPrompt: string;
  resolvedMode?: string;
  resolvedFeatures?: Record<string, unknown>;
  // Effective unattended after OR-ing in an unattended parent (from the
  // resolver), so a child of an unattended parent arms the deny-responder even
  // though the MCP create_agent input never sets `unattended` itself.
  resolvedUnattended: boolean;
}): AgentSessionConfig {
  const passthroughConfig = params.input.config;
  const { provisionalTitle } = resolveCreateAgentTitles({
    configTitle: passthroughConfig?.title ?? params.input.title,
    initialPrompt: params.trimmedPrompt,
  });
  const featureValues = params.resolvedFeatures ?? passthroughConfig?.featureValues;
  const config: AgentSessionConfig = {
    ...passthroughConfig,
    provider: params.provider,
    cwd: params.resolvedCwd,
    modeId: params.resolvedMode ?? passthroughConfig?.modeId,
    model: params.resolvedProviderModel.model ?? passthroughConfig?.model,
    thinkingOptionId: params.input.thinking ?? passthroughConfig?.thinkingOptionId,
    internal: params.input.internal ?? passthroughConfig?.internal,
    // Stamp the creation-time unattended signal onto the config so the daemon's
    // guardrail deny-responder can auto-deny permission escalations for runs
    // nobody is watching. Uses the resolver's effective value (input OR an
    // unattended parent), falling back to an explicit passthrough flag, so a
    // child spawned by an unattended parent is guarded too — matching the mode
    // coercion. See docs/safe-unattended.md.
    unattended: params.resolvedUnattended || passthroughConfig?.unattended === true,
  };
  if (provisionalTitle) {
    config.title = provisionalTitle;
  }
  if (featureValues) {
    config.featureValues = featureValues;
  }
  return config;
}

async function ensureWorkspaceForMcpCreate(
  dependencies: CreateAgentCommandDependencies,
  cwd: string,
  initialPrompt: string,
): Promise<string | undefined> {
  if (!dependencies.ensureWorkspaceForCreate) {
    return undefined;
  }
  return dependencies.ensureWorkspaceForCreate(cwd, { prompt: initialPrompt });
}

async function sendInitialPrompt(
  dependencies: CreateAgentCommandDependencies,
  resolved: ResolvedCreateAgent,
  snapshot: ManagedAgent,
): Promise<{ started: boolean; liveSnapshot: ManagedAgent; error?: unknown }> {
  try {
    const prompt = resolved.prompt;
    if (prompt === undefined) {
      return { started: false, liveSnapshot: snapshot };
    }
    const liveSnapshot = await startCreatedAgentInitialPrompt({
      agentManager: dependencies.agentManager,
      agentId: snapshot.id,
      snapshot,
      prompt,
      runOptions: resolved.runOptions,
      logger: resolved.promptLogger ?? dependencies.logger,
    });
    return { started: true, liveSnapshot };
  } catch (error) {
    if (resolved.promptFailure === "throw") {
      throw error;
    }
    if (resolved.promptFailure === "return-error") {
      return { started: false, liveSnapshot: snapshot, error };
    }
    dependencies.logger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
    return { started: false, liveSnapshot: snapshot };
  }
}

function buildAgentPrompt(
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
  attachments?: AgentAttachment[],
): AgentPromptInput {
  const normalized = text.trim();
  const hasImages = (images?.length ?? 0) > 0;
  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (!hasImages && !hasAttachments) {
    return normalized;
  }
  const blocks: AgentPromptContentBlock[] = [];
  if (normalized.length > 0) {
    blocks.push({ type: "text", text: normalized });
  }
  for (const image of images ?? []) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  for (const attachment of attachments ?? []) {
    blocks.push(attachment);
  }
  return blocks;
}

function requireParentAgent(agentManager: AgentManager, parentAgentId: string): ManagedAgent {
  const parentAgent = agentManager.getAgent(parentAgentId);
  if (!parentAgent) {
    throw new Error(`Parent agent ${parentAgentId} not found`);
  }
  return parentAgent;
}

function resolveChildAgentCwd(params: {
  parentCwd: string;
  requestedCwd?: string;
  lockedCwd?: string;
  allowCustomCwd: boolean;
}): string {
  const lockedCwd = params.lockedCwd?.trim();
  if (lockedCwd) {
    return expandUserPath(lockedCwd);
  }

  const requestedCwd = params.requestedCwd?.trim();
  if (!requestedCwd || !params.allowCustomCwd) {
    return params.parentCwd;
  }

  return resolvePathFromBase(params.parentCwd, requestedCwd);
}

async function resolveMcpCwd(params: {
  dependencies: CreateAgentCommandDependencies;
  cwd: string;
  initialPrompt: string;
  worktree: CreateAgentFromMcpInput["worktree"];
}): Promise<{
  resolvedCwd: string;
  setupContinuation?: AgentWorktreeSetupContinuation;
  createdWorkspaceId?: string;
}> {
  const { dependencies, worktree } = params;
  if (!worktree) {
    return { resolvedCwd: params.cwd };
  }
  const shouldCreateWorktree = Boolean(
    worktree.worktreeName || worktree.refName || worktree.action || worktree.githubPrNumber,
  );
  if (!shouldCreateWorktree) {
    return { resolvedCwd: params.cwd };
  }
  if (
    worktree.worktreeName &&
    !worktree.baseBranch &&
    !worktree.refName &&
    !worktree.action &&
    worktree.githubPrNumber === undefined
  ) {
    throw new Error("baseBranch is required when creating a worktree");
  }
  const baseBranch = worktree.baseBranch;
  const createdWorktree = await createMcpWorktree({
    input: {
      cwd: params.cwd,
      worktreeSlug: worktree.worktreeName,
      branchName: worktree.branchName,
      refName: worktree.refName,
      action: worktree.action,
      githubPrNumber: worktree.githubPrNumber,
      firstAgentContext: { prompt: params.initialPrompt },
      runSetup: false,
      ottoHome: dependencies.ottoHome,
      worktreesRoot: dependencies.worktreesRoot,
    },
    createOttoWorktree: dependencies.createOttoWorktree,
    resolveDefaultBranch: baseBranch ? async () => baseBranch : undefined,
    setupContinuation: {
      kind: "agent",
      terminalManager: dependencies.terminalManager ?? null,
      appendTimelineItem: ({ agentId, item }) =>
        appendTimelineItemIfAgentKnown({
          agentManager: dependencies.agentManager,
          agentId,
          item,
        }),
      emitLiveTimelineItem: ({ agentId, item }) =>
        emitLiveTimelineItemIfAgentKnown({
          agentManager: dependencies.agentManager,
          agentId,
          item,
        }),
      logger: dependencies.logger,
    },
  });
  return {
    resolvedCwd: createdWorktree.worktree.worktreePath,
    setupContinuation: createdWorktree.setupContinuation,
    createdWorkspaceId: createdWorktree.workspace.workspaceId,
  };
}

interface CreateMcpWorktreeOptions {
  input: CreateOttoWorktreeInput;
  createOttoWorktree: CreateOttoWorktreeWorkflowFn | undefined;
  resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  setupContinuation?: CreateOttoWorktreeSetupContinuationInput;
}

async function createMcpWorktree(
  options: CreateMcpWorktreeOptions,
): Promise<CreateOttoWorktreeWorkflowResult> {
  try {
    if (!options.createOttoWorktree) {
      throw new Error("Otto worktree service is not configured");
    }
    return await options.createOttoWorktree(options.input, {
      ...(options.resolveDefaultBranch
        ? { resolveDefaultBranch: options.resolveDefaultBranch }
        : {}),
      ...(options.setupContinuation ? { setupContinuation: options.setupContinuation } : {}),
    });
  } catch (error) {
    throw toWorktreeRequestError(error);
  }
}

function mergeLabels(params: {
  callerAgentId: string | undefined;
  detached: boolean;
  childAgentDefaultLabels: Record<string, string> | undefined;
  labels: Record<string, string> | undefined;
}): Record<string, string> | undefined {
  const mergedLabels = {
    ...(!params.detached && params.callerAgentId
      ? { [PARENT_AGENT_ID_LABEL]: params.callerAgentId }
      : {}),
    ...params.childAgentDefaultLabels,
    ...params.labels,
  };
  if (params.detached) {
    delete mergedLabels[PARENT_AGENT_ID_LABEL];
  }
  return Object.keys(mergedLabels).length > 0 ? mergedLabels : undefined;
}
