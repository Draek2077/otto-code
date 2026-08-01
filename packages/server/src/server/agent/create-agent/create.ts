import type { Logger } from "pino";

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
import type { AgentPromptInput, AgentRunOptions, AgentSessionConfig } from "../agent-sdk-types.js";
import type { AgentStorage } from "../agent-storage.js";
import type {
  ProviderSnapshotManager,
  ResolvedProviderCreateConfig,
} from "../provider-snapshot-manager.js";
import type { AgentOwner } from "../agent-owner.js";
import { setupFinishNotification, startCreatedAgentInitialPrompt } from "../agent-prompt.js";
import type { AgentAutoTitleRequest } from "../agent-auto-title.js";
import { resolveCreateAgentTitles } from "../create-agent-title.js";
import { buildAgentPrompt } from "../prompt-attachments.js";
import { normalizeClientMessageId, resolveClientMessageId } from "../../client-message-id.js";
import { resolveRequiredProviderModel, type ResolvedProviderModel } from "../mcp-shared.js";
import {
  appendTimelineItemIfAgentKnown,
  emitLiveTimelineItemIfAgentKnown,
} from "../timeline-append.js";
import { resolveCreateAgentIntent } from "./intent.js";

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
  providerSnapshotManager: Pick<ProviderSnapshotManager, "resolveCreateConfig">;
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
  owner?: AgentOwner;
  env?: Record<string, string>;
  onCreated?: (created: {
    agentId: string;
    createdWorktree: CreateOttoWorktreeWorkflowResult | null;
  }) => void;
  onWorktreeCreated?: (createdWorktree: CreateOttoWorktreeWorkflowResult) => void;
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
  createdWorktree?: CreateOttoWorktreeWorkflowResult;
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
  createdWorktree?: CreateOttoWorktreeWorkflowResult;
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
  if (input.kind === "mcp") {
    input.onCreated?.({ agentId: snapshot.id, createdWorktree: resolved.createdWorktree ?? null });
  }
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
      requireParentOwnership: true,
      logger: dependencies.logger,
    });
  }

  return {
    snapshot,
    liveSnapshot,
    background: resolved.background,
    initialPromptStarted,
    initialPromptError,
    ...(resolved.createdWorktree ? { createdWorktree: resolved.createdWorktree } : {}),
  };
}

async function resolveSessionCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromSessionInput,
): Promise<ResolvedCreateAgent> {
  const trimmedPrompt = input.initialPrompt?.trim();
  const {
    sessionConfig: builtSessionConfig,
    setupContinuation,
    createdWorkspaceId,
  } = await input.buildSessionConfig(
    input.config,
    input.git,
    input.worktreeName,
    input.firstAgentContext,
  );
  // Validate the requested mode against the provider's modes for the resolved
  // cwd. The app remembers mode preferences globally, so a saved mode can be
  // stale for a workspace whose provider config no longer defines it — reject
  // it here instead of letting the provider fail mid-turn.
  //
  // This runs after buildSessionConfig, which may already have created a
  // worktree and/or workspace record — cwd (required to resolve modes) is
  // only known once that step completes. If validation throws, any
  // worktree/workspace buildSessionConfig created is the caller's
  // responsibility to clean up (session.ts's handleCreateAgentRequest does
  // this for the worktree path via cleanupCreatedWorktreeAfterFailedAgentCreate;
  // this is a pre-existing gap for directory-only workspace creates, not
  // introduced by this validation).
  const resolvedCreateConfig = await dependencies.providerSnapshotManager.resolveCreateConfig({
    cwd: builtSessionConfig.cwd,
    provider: builtSessionConfig.provider,
    requestedMode: builtSessionConfig.modeId,
    featureValues: builtSessionConfig.featureValues,
    parent: null,
    unattended: false,
  });
  const sessionConfig: AgentSessionConfig = {
    ...builtSessionConfig,
    modeId: resolvedCreateConfig.modeId,
    featureValues: resolvedCreateConfig.featureValues,
  };
  const prompt = buildAgentPrompt(trimmedPrompt ?? "", input.images, input.attachments);
  const hasPromptContent = Array.isArray(prompt) ? prompt.length > 0 : prompt.length > 0;
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const runOptions: AgentRunOptions | undefined =
    input.outputSchema || clientMessageId
      ? {
          ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
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
            currentSelection: autoTitleCurrentSelection(sessionConfig),
          }
        : undefined,
  };
}

/**
 * Where an MCP-created agent runs: its working directory (creating a worktree
 * when asked), and the workspace/labels intent that follows from it.
 */
async function resolveMcpCreatePlacement(params: {
  dependencies: CreateAgentCommandDependencies;
  input: CreateAgentFromMcpInput;
  parentAgent: ReturnType<typeof requireParentAgent> | null;
}) {
  const { dependencies, input, parentAgent } = params;
  const cwd = resolveMcpInitialCwd(input, parentAgent);
  const { resolvedCwd, setupContinuation, createdWorkspaceId, createdWorktree } =
    await resolveMcpCwd({
      dependencies,
      cwd,
      worktree: input.worktree,
      initialPrompt: input.initialPrompt ?? "",
    });
  if (createdWorktree) input.onWorktreeCreated?.(createdWorktree);

  const intent = await resolveCreateAgentIntent({
    explicitWorkspaceId: setupContinuation ? createdWorkspaceId : input.workspaceId,
    caller: parentAgent
      ? { id: parentAgent.id, cwd: parentAgent.cwd, workspaceId: parentAgent.workspaceId }
      : null,
    labels: input.labels,
    childAgentDefaultLabels: input.callerContext?.childAgentDefaultLabels,
    legacyDetached: input.detached ?? false,
    resolveWorkspace: async (workspaceId) => ({ workspaceId, cwd: resolvedCwd }),
    createWorkspace: async () => ({
      workspaceId: requireResolvedWorkspaceId(
        await ensureWorkspaceForMcpCreate(dependencies, resolvedCwd, input.initialPrompt ?? ""),
      ),
      cwd: resolvedCwd,
    }),
  });

  return { resolvedCwd, setupContinuation, createdWorktree, intent };
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
  const { resolvedCwd, setupContinuation, createdWorktree, intent } =
    await resolveMcpCreatePlacement({ dependencies, input, parentAgent });
  const resolvedCreateConfig = await resolveMcpProviderCreateConfig({
    dependencies,
    input,
    provider,
    resolvedCwd,
    parentAgent,
    model: resolvedProviderModel.model ?? input.config?.model,
  });

  const trimmedPrompt = input.initialPrompt?.trim() ?? "";
  // Only auto-name when the caller left the title blank: an explicit MCP/caller
  // title (a spawned subagent's task name, an orchestration phase, …) must win.
  const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
    configTitle: input.config?.title ?? input.title,
    initialPrompt: trimmedPrompt,
  });
  const isInternal = input.internal ?? input.config?.internal ?? false;
  const mcpSessionConfig = buildMcpSessionConfig({
    input,
    resolvedProviderModel,
    provider,
    resolvedCwd,
    trimmedPrompt,
    resolvedMode: resolvedCreateConfig.modeId,
    resolvedFeatures: resolvedCreateConfig.featureValues,
    resolvedUnattended: resolvedCreateConfig.unattended,
  });
  return {
    config: mcpSessionConfig,
    createOptions: {
      ...(Object.keys(intent.labels).length > 0 ? { labels: intent.labels } : {}),
      workspaceId: intent.workspaceId,
      owner: input.owner,
      env: input.env,
    },
    prompt: trimmedPrompt ? trimmedPrompt : undefined,
    setupContinuation,
    createdWorktree,
    background: input.background,
    promptFailure: input.promptFailure ?? "log",
    autoTitle:
      trimmedPrompt && !explicitTitle && !isInternal
        ? {
            cwd: resolvedCwd,
            firstAgentContext: { prompt: trimmedPrompt },
            provisionalTitle,
            currentSelection: autoTitleCurrentSelection(mcpSessionConfig),
          }
        : undefined,
  };
}

/**
 * Last-resort entry in the auto-title provider chain: the chat's OWN provider and model.
 *
 * The chain is the cheap ladder (haiku, gpt-5.4-mini, minimax-m3, …) plus any role-matched Writer
 * personality, and `resolveStructuredGenerationProviders` appends this selection at the end — so
 * preference order is unchanged and this only decides what happens when none of the preferred
 * models are reachable. Without it a host that has only one provider configured (LM Studio, Codex,
 * the deterministic e2e mock) silently gets no titles at all: every laddered candidate is either
 * absent or, as on CI, present-but-unauthenticated.
 */
function autoTitleCurrentSelection(config: {
  provider?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
}): { provider?: string | null; model?: string | null; thinkingOptionId?: string | null } {
  return {
    provider: config.provider ?? null,
    model: config.model ?? null,
    thinkingOptionId: config.thinkingOptionId ?? null,
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
  createdWorktree?: CreateOttoWorktreeWorkflowResult;
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
    resolvedCwd: createdWorktree.workspace.cwd,
    setupContinuation: createdWorktree.setupContinuation,
    createdWorkspaceId: createdWorktree.workspace.workspaceId,
    createdWorktree,
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
