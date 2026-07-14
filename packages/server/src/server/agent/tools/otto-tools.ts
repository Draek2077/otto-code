import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { Logger } from "pino";

import type { AgentMode, AgentModelDefinition, AgentProvider } from "../agent-sdk-types.js";
import type { AgentManager } from "../agent-manager.js";
import { resolveEffortOption } from "../effort-levels.js";
import { resolvePersonality, type ResolvedPersonalitySnapshot } from "../agent-personalities.js";
import {
  composeTeamAndPersonalityPrompt,
  resolveTeamSnapshotForPersonality,
  type ResolvedTeamSnapshot,
} from "../agent-teams.js";
import {
  getActiveAgentTeam,
  isTeamMember,
  type AgentTeamsConfigView,
} from "@otto-code/protocol/agent-teams";
import {
  isPersonalityRole,
  normalizePersonalityRoles,
  personalityHasRole,
  summarizePersonalityForSelection,
} from "@otto-code/protocol/agent-personalities";
import type { AgentPersonality } from "@otto-code/protocol/messages";
import {
  AgentFeatureSchema,
  AgentPermissionRequestPayloadSchema,
  AgentListItemPayloadSchema,
  AgentPermissionResponseSchema,
  AgentSnapshotPayloadSchema,
} from "../../messages.js";
import type { AgentListItemPayload, FirstAgentContext } from "../../messages.js";
import {
  buildStoredAgentPayload,
  toAgentListItemPayload,
  toAgentPayload,
} from "../agent-projections.js";
import { curateAgentActivity } from "../activity-curator.js";
import { selectItemsByProjectedLimit } from "../timeline-projection.js";
import type { AgentStorage } from "../agent-storage.js";
import { ensureAgentLoaded } from "../agent-loading.js";
import { isStoredAgentProviderAvailable } from "../../persistence-hooks.js";
import {
  killTerminalsForWorkspace,
  type ArchiveDependencies,
} from "../../workspace-archive-service.js";
import { createAgentCommand, type CreateAgentFromMcpInput } from "../create-agent/create.js";
import { RunPlanSchema } from "@otto-code/protocol/orchestration";
import { summarizeRunOutput } from "../../orchestration/run-engine.js";
import type { RunService, RunSpawnPort } from "../../orchestration/run-service.js";
import { resolveTeamRoleMember } from "../../orchestration/resolve-team-role.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "../../voice-types.js";
import { expandUserPath, isSameOrDescendantPath, resolvePathFromBase } from "../../path-utils.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { CreateOttoWorktreeWorkflowFn } from "../../worktree-session.js";
import type { ScheduleService } from "../../schedule/service.js";
import {
  ScheduleRunSchema,
  ScheduleSummarySchema,
  StoredScheduleSchema,
  type ScheduleCadence,
  type UpdateScheduleInput,
} from "@otto-code/protocol/schedule/types";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  AgentModelSchema,
  AgentProviderEnum,
  AgentStatusEnum,
  ProviderModeSchema,
  ProviderSummarySchema,
  parseDurationString,
  resolveRequiredProviderModel,
  sanitizePermissionRequest,
  serializeSnapshotWithMetadata,
  toScheduleSummary,
  waitForAgentWithTimeout,
} from "../mcp-shared.js";
import { sendPromptToAgent, setupFinishNotification } from "../agent-prompt.js";
import { respondToAgentPermission } from "../permission-response.js";
import {
  archiveAgentCommand,
  cancelAgentRunCommand,
  closeAgentCommand,
  setAgentModeCommand,
  updateAgentCommand,
} from "../lifecycle-command.js";
import type { GitHubService } from "../../../services/github-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import { WorktreeRequestError } from "../../worktree-errors.js";
import {
  archiveCommand,
  type ArchiveCommandDependencies,
  createOttoWorktreeCommand,
  type CreateOttoWorktreeCommandInput,
  listOttoWorktreesCommand,
} from "../../worktree/commands.js";
import { registerBrowserTools } from "../../browser-tools/tools.js";
import type { BrowserToolsBroker } from "../../browser-tools/broker.js";
import { registerPreviewTools } from "../../preview/preview-tools.js";
import type { DevServerManager } from "../../preview/dev-server-manager.js";
import type { ArtifactService } from "../../artifact/artifact-service.js";
import type { ActivityIncrementFn } from "../../activity-stats/activity-stats-store.js";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { StoredArtifactSchema } from "@otto-code/protocol/artifacts/types";
import type {
  OttoToolCatalog,
  OttoToolConfig,
  OttoToolDefinition,
  OttoToolExecutionContext,
  OttoToolResult,
} from "./types.js";

export interface OttoToolHostDependencies {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager?: TerminalManager | null;
  getDaemonTcpPort?: () => number | null;
  scheduleService?: ScheduleService | null;
  /**
   * Daemon-owned orchestration runtime. Enables the start_run / get_run_status /
   * wait_for_agents tools so an orchestrator agent can declare a multi-agent
   * plan the daemon executes. Absent on hosts that don't wire orchestration.
   */
  runService?: RunService | null;
  providerSnapshotManager: ProviderSnapshotManager;
  /**
   * Reads the live Agent Personalities roster from the daemon config. Enables
   * spawn-by-personality in create_agent and the list_personalities tool. Absent
   * on hosts that don't wire personalities.
   */
  readAgentPersonalities?: () => AgentPersonality[];
  /**
   * Reads the live Agent Teams section (teams + active team id) from the
   * daemon config. Lets create_agent stamp the frozen team layer onto member
   * spawns. Absent on hosts that don't wire teams — spawns are then teamless,
   * exactly the no-active-team behavior.
   */
  readAgentTeams?: () => AgentTeamsConfigView | undefined;
  github?: GitHubService;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot"
  >;
  findWorkspaceIdForCwd?: ArchiveDependencies["findWorkspaceIdForCwd"];
  listActiveWorkspaces?: ArchiveDependencies["listActiveWorkspaces"];
  archiveWorkspaceRecord?: ArchiveDependencies["archiveWorkspaceRecord"];
  emitWorkspaceUpdatesForWorkspaceIds?: ArchiveDependencies["emitWorkspaceUpdatesForWorkspaceIds"];
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "upsert">;
  /**
   * Resolves a workspace's project grouping key to the project's canonical
   * root path, so create_artifact can stamp artifacts with the same
   * path-shaped projectId the client's create sheet stores.
   */
  projectRegistry?: Pick<ProjectRegistry, "get">;
  markWorkspaceArchiving?: ArchiveDependencies["markWorkspaceArchiving"];
  clearWorkspaceArchiving?: ArchiveDependencies["clearWorkspaceArchiving"];
  createOttoWorktree?: CreateOttoWorktreeWorkflowFn;
  // Mints a fresh directory workspace for a cwd and returns its id.
  ensureWorkspaceForCreate?: (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ) => Promise<string>;
  browserToolsEnabled?: boolean;
  browserToolsBroker?: BrowserToolsBroker | null;
  previewDevServers?: DevServerManager | null;
  /**
   * Daemon-global artifact service so agents can create artifacts via the
   * create_artifact tool. Absent on hosts that don't wire artifacts.
   */
  artifactService?: ArtifactService | null;
  /** Broadcasts artifact.created.notification to every connected client. */
  emitArtifactCreated?: (artifact: ArtifactMetadata) => void;
  /** Broadcasts artifact.updated.notification to every connected client. */
  emitArtifactUpdated?: (artifact: ArtifactMetadata) => void;
  ottoHome?: string;
  worktreesRoot?: string;
  /**
   * ID of the agent that is using this tool catalog.
   * Used for cwd/mode inheritance when agents spawn child agents.
   */
  callerAgentId?: string;
  /**
   * Optional resolver for session-bound speak handlers.
   * Used by hidden voice agents to narrate through daemon-managed TTS.
   */
  resolveSpeakHandler?: (callerAgentId: string) => VoiceSpeakHandler | null;
  resolveCallerContext?: (callerAgentId: string) => VoiceCallerContext | null;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
  /** Fun-stats counters — see packages/server/src/server/activity-stats. */
  onActivity?: ActivityIncrementFn;
  logger: Logger;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveAgentListActivityTime(agent: AgentListItemPayload): number {
  return Math.max(
    parseTimestamp(agent.updatedAt),
    parseTimestamp(agent.lastUserMessageAt),
    parseTimestamp(agent.attentionTimestamp),
    parseTimestamp(agent.archivedAt),
    parseTimestamp(agent.createdAt),
  );
}

interface ProviderSummary {
  id: AgentProvider;
  label: string;
  description: string;
  enabled: boolean;
  modes: AgentMode[];
  status: string;
  error?: string;
}

function toProviderSummary(entry: {
  provider: AgentProvider;
  label?: string;
  description?: string;
  enabled: boolean;
  modes?: AgentMode[];
  status: string;
  error?: string;
}): ProviderSummary {
  return {
    id: entry.provider,
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    enabled: entry.enabled,
    modes: entry.modes ?? [],
    status: entry.status === "ready" ? "available" : entry.status,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function compareAgentListItems(a: AgentListItemPayload, b: AgentListItemPayload): number {
  const attentionDelta =
    Number(b.requiresAttention ?? false) - Number(a.requiresAttention ?? false);
  if (attentionDelta !== 0) {
    return attentionDelta;
  }

  const statusOrder = {
    running: 0,
    initializing: 1,
    idle: 2,
    error: 3,
    closed: 4,
  } as Record<string, number>;
  const statusDelta = (statusOrder[a.status] ?? 999) - (statusOrder[b.status] ?? 999);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return resolveAgentListActivityTime(b) - resolveAgentListActivityTime(a);
}

function resolveScheduleProviderAndModel(params: {
  provider?: string;
  defaultProvider: AgentProvider;
}): { provider: AgentProvider; model?: string } {
  const providerInput = params.provider?.trim() || params.defaultProvider;
  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return { provider: providerInput };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const model = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !model) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }

  return {
    provider: provider,
    model,
  };
}

function resolveScheduleUpdateProviderAndModel(params: {
  provider?: string;
  model?: string | null;
}): { provider?: string; model?: string | null } {
  const providerInput = params.provider?.trim();
  const modelInput = typeof params.model === "string" ? params.model.trim() : params.model;

  if (params.model !== undefined && modelInput === "") {
    throw new Error("model cannot be empty");
  }

  if (!providerInput) {
    return params.model !== undefined ? { model: modelInput } : {};
  }

  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: providerInput,
      ...(params.model !== undefined ? { model: modelInput } : {}),
    };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !modelFromProvider) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }
  if (params.model === null) {
    throw new Error("provider specifies a model but model is null");
  }
  if (typeof modelInput === "string" && modelInput !== modelFromProvider) {
    throw new Error("Conflicting model values provided");
  }

  return {
    provider,
    model: modelInput ?? modelFromProvider,
  };
}

interface ScheduleUpdateToolInput {
  id: string;
  every?: string;
  cron?: string;
  timezone?: string;
  name?: string | null;
  prompt?: string;
  maxRuns?: number | null;
  provider?: string;
  personality?: string | null;
  model?: string | null;
  mode?: string | null;
  thinkingOptionId?: string | null;
  cwd?: string;
  expiresIn?: string;
  clearExpires?: boolean;
}

function normalizeScheduleCadenceArg(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function normalizeScheduleTimeZoneArg(value: string | undefined): string | undefined {
  return normalizeScheduleCadenceArg(value);
}

function resolveScheduleUpdateCadence(input: ScheduleUpdateToolInput): ScheduleCadence | undefined {
  const every = normalizeScheduleCadenceArg(input.every);
  const cron = normalizeScheduleCadenceArg(input.cron);
  const timeZone = normalizeScheduleTimeZoneArg(input.timezone);

  if (every !== undefined && cron !== undefined) {
    throw new Error("Specify at most one of every or cron");
  }
  if (timeZone !== undefined && cron === undefined) {
    throw new Error("timezone can only be used with cron");
  }
  if (every !== undefined) {
    return { type: "every", everyMs: parseDurationString(every) };
  }
  if (cron !== undefined) {
    return {
      type: "cron",
      expression: cron,
      ...(timeZone !== undefined ? { timezone: timeZone } : {}),
    };
  }
  return undefined;
}

function resolveScheduleUpdateExpiresAt(input: ScheduleUpdateToolInput): string | null | undefined {
  if (input.expiresIn !== undefined && input.clearExpires) {
    throw new Error("Specify at most one of expiresIn or clearExpires");
  }
  if (input.expiresIn !== undefined) {
    return new Date(Date.now() + parseDurationString(input.expiresIn)).toISOString();
  }
  if (input.clearExpires) {
    return null;
  }
  return undefined;
}

function buildScheduleUpdateInput(input: ScheduleUpdateToolInput): UpdateScheduleInput {
  const cadence = resolveScheduleUpdateCadence(input);
  const expiresAt = resolveScheduleUpdateExpiresAt(input);
  const providerModelPatch = resolveScheduleUpdateProviderAndModel({
    provider: input.provider,
    model: input.model,
  });
  const newAgentConfig = {
    ...(providerModelPatch.provider !== undefined ? { provider: providerModelPatch.provider } : {}),
    ...(input.personality !== undefined ? { personality: input.personality } : {}),
    ...(providerModelPatch.model !== undefined ? { model: providerModelPatch.model } : {}),
    ...(input.mode !== undefined ? { modeId: input.mode } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  };

  return {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(cadence !== undefined ? { cadence } : {}),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(Object.keys(newAgentConfig).length > 0 ? { newAgentConfig } : {}),
  };
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

const TerminalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
});

const WorktreeSummarySchema = z.object({
  path: z.string(),
  createdAt: z.string(),
  branchName: z.string().optional(),
  head: z.string().optional(),
});

function resolveTerminalKeyToken(key: string, literal: boolean): string {
  if (literal) {
    return key;
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Escape":
      return "\u001b";
    case "Space":
      return " ";
    case "BSpace":
      return "\u007f";
    case "C-c":
      return "\u0003";
    case "C-d":
      return "\u0004";
    case "C-z":
      return "\u001a";
    case "C-l":
      return "\u000c";
    case "C-a":
      return "\u0001";
    case "C-e":
      return "\u0005";
    default:
      return key;
  }
}

function resolveArtifactProviderModel(params: {
  providerArg?: string;
  modelArg?: string;
  callerProvider?: AgentProvider;
  callerModel?: string;
}): { provider: AgentProvider; model: string | undefined } {
  const hasProviderOverride = Boolean(params.providerArg?.trim());
  if (!hasProviderOverride && !params.callerProvider) {
    throw new Error("provider is required outside an agent-scoped session");
  }
  const resolved = resolveScheduleProviderAndModel({
    provider: params.providerArg,
    defaultProvider: params.callerProvider ?? "",
  });
  // Model precedence: explicit model arg > provider/<model> > the caller's
  // own model, but only when the caller's provider is the one generating.
  const model =
    params.modelArg?.trim() ||
    resolved.model ||
    (!hasProviderOverride ? params.callerModel : undefined) ||
    undefined;
  return { provider: resolved.provider, model };
}

/**
 * Thinking options and modes are provider-scoped, so the caller's own effort
 * level and permission mode only carry over when the caller's provider is the
 * one generating. The mode is a request, not a demand: the artifact service
 * only honors unattended modes and otherwise resolves the provider's
 * unattended default, so an attended caller mode can never stall generation
 * on an approval prompt.
 */
function resolveArtifactGenerationSettings(params: {
  provider: AgentProvider;
  thinkingOptionIdArg?: string;
  modeIdArg?: string;
  callerProvider?: AgentProvider;
  callerThinkingOptionId?: string;
  callerModeId?: string;
}): { thinkingOptionId: string | undefined; modeId: string | undefined } {
  const sameProviderAsCaller = params.callerProvider === params.provider;
  return {
    thinkingOptionId:
      params.thinkingOptionIdArg ??
      (sameProviderAsCaller ? params.callerThinkingOptionId : undefined),
    modeId: params.modeIdArg ?? (sameProviderAsCaller ? params.callerModeId : undefined),
  };
}

const EFFORT_INPUT_DESCRIPTION =
  "Effort: a canonical level (off, minimal, low, medium, high, xhigh, max), resolved to the nearest option the target model supports, or an exact option id from the model's thinkingOptions in list_models.";

// Lets a caller start an agent with no task in hand — "just open a new chat".
// When create_agent omits initialPrompt, the new agent gets this generic ask so
// it immediately greets the user and asks what to work on, instead of the caller
// having to invent a reason up front (which otherwise stalls the spawn while the
// caller goes back to ask "what should it do?"). A missing title falls back the
// same way, but only when there's no prompt to derive one from.
const DEFAULT_BARE_AGENT_INITIAL_PROMPT =
  "I've just started a new chat with you and haven't given you a task yet. Briefly introduce yourself and ask what I'd like to work on.";
const DEFAULT_BARE_AGENT_TITLE = "New chat";

// Fill the generic defaults for a bare "just open a new chat" spawn. A real
// prompt with no title keeps deriving its title from the prompt (undefined here
// → derived downstream); only a title-less AND prompt-less spawn gets the
// placeholder title.
function resolveBareSpawnTitleAndPrompt(input: {
  title: string | undefined;
  initialPrompt: string | undefined;
}): { title: string | undefined; initialPrompt: string } {
  return {
    title: input.title ?? (input.initialPrompt ? undefined : DEFAULT_BARE_AGENT_TITLE),
    initialPrompt: input.initialPrompt ?? DEFAULT_BARE_AGENT_INITIAL_PROMPT,
  };
}

/**
 * Resolve a requested effort — canonical level or exact option id — against a
 * provider's advertised models. Levels clamp to the nearest supported option.
 * When the target model (or its thinkingOptions) isn't in the snapshot the
 * request passes through unchanged and the provider normalizes it like any
 * hand-typed id.
 */
function resolveEffortAgainstModels(params: {
  requested: string;
  models: readonly AgentModelDefinition[];
  model: string | undefined;
}): string {
  const definition = params.model
    ? params.models.find((candidate) => candidate.id === params.model)
    : (params.models.find((candidate) => candidate.isDefault) ?? params.models[0]);
  const thinkingOptions = definition?.thinkingOptions;
  if (!thinkingOptions || thinkingOptions.length === 0) {
    return params.requested;
  }
  return resolveEffortOption({ requested: params.requested, thinkingOptions }).optionId;
}

/**
 * Fold a resolved personality's prompt + frozen snapshot into a partial agent
 * config, or undefined when there's nothing to carry. Kept top-level so the
 * create_agent handler stays under the complexity budget.
 */
function buildPersonalityAgentConfig(brain: {
  systemPrompt?: string;
  personalitySnapshot?: ResolvedPersonalitySnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
}):
  | {
      systemPrompt?: string;
      personalitySnapshot?: ResolvedPersonalitySnapshot;
      teamSnapshot?: ResolvedTeamSnapshot;
    }
  | undefined {
  if (
    brain.systemPrompt === undefined &&
    brain.personalitySnapshot === undefined &&
    brain.teamSnapshot === undefined
  ) {
    return undefined;
  }
  const config: {
    systemPrompt?: string;
    personalitySnapshot?: ResolvedPersonalitySnapshot;
    teamSnapshot?: ResolvedTeamSnapshot;
  } = {};
  if (brain.systemPrompt !== undefined) {
    config.systemPrompt = brain.systemPrompt;
  }
  if (brain.personalitySnapshot !== undefined) {
    config.personalitySnapshot = brain.personalitySnapshot;
  }
  if (brain.teamSnapshot !== undefined) {
    config.teamSnapshot = brain.teamSnapshot;
  }
  return config;
}

const ArtifactToolSummarySchema = z.object({
  artifactId: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  modeId: z.string().nullable(),
  projectId: z.string(),
  updatedAt: z.string(),
  errorMessage: z.string().nullable(),
});

function toArtifactToolSummary(artifact: ArtifactMetadata) {
  return {
    artifactId: artifact.id,
    name: artifact.name,
    description: artifact.description,
    status: artifact.status,
    provider: artifact.generationProvider,
    model: artifact.generationModel,
    thinkingOptionId: artifact.generationThinkingOptionId ?? null,
    modeId: artifact.generationModeId ?? null,
    projectId: artifact.projectId,
    updatedAt: artifact.updatedAt,
    errorMessage: artifact.errorMessage,
  };
}

async function requireArtifact(
  artifactService: ArtifactService,
  artifactId: string,
): Promise<ArtifactMetadata> {
  const artifact = (await artifactService.list()).find((candidate) => candidate.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found. Call list_artifacts for ids.`);
  }
  return artifact;
}

interface ArtifactUpdateToolInput {
  artifactId: string;
  name?: string;
  description?: string;
  provider?: string;
  model?: string | null;
  thinkingOptionId?: string | null;
  projectId?: string;
}

/**
 * Work out the provider/model the update leaves the artifact on: the patch
 * values to store (undefined = unchanged, null model = clear) and the
 * effective pair to resolve a requested effort against.
 */
function resolveArtifactUpdateTargets(
  input: ArtifactUpdateToolInput,
  existing: ArtifactMetadata,
): {
  provider: AgentProvider | undefined;
  model: string | null | undefined;
  effortProvider: AgentProvider | null;
  effortModel: string | undefined;
} {
  const providerPatch = input.provider
    ? resolveScheduleProviderAndModel({
        provider: input.provider,
        defaultProvider: input.provider as AgentProvider,
      })
    : undefined;
  // An explicit model arg beats one embedded in provider/<model>.
  const model = input.model !== undefined ? input.model : providerPatch?.model;
  const effortProvider = (providerPatch?.provider ??
    existing.generationProvider) as AgentProvider | null;
  const effortModel = model === null ? undefined : (model ?? existing.generationModel ?? undefined);
  return { provider: providerPatch?.provider, model, effortProvider, effortModel };
}

/**
 * Effort patch for update_artifact: undefined = unchanged, null = clear
 * (the service stores empty string as null), string = resolve strictly.
 */
function resolveArtifactUpdateEffort(params: {
  requested: string | null | undefined;
  models: readonly AgentModelDefinition[];
  model: string | undefined;
}): string | undefined {
  if (params.requested === undefined) {
    return undefined;
  }
  if (params.requested === null) {
    return "";
  }
  return resolveEffortAgainstModels({
    requested: params.requested,
    models: params.models,
    model: params.model,
  });
}

function buildArtifactUpdateServiceInput(
  input: ArtifactUpdateToolInput,
  targets: { provider: AgentProvider | undefined; model: string | null | undefined },
  thinkingPatch: string | undefined,
) {
  return {
    artifactId: input.artifactId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(targets.provider ? { provider: targets.provider } : {}),
    // The service stores empty string as null (clear back to provider default).
    ...(targets.model !== undefined ? { model: targets.model ?? "" } : {}),
    ...(thinkingPatch !== undefined ? { thinkingOptionId: thinkingPatch } : {}),
  };
}

/**
 * Effort resolution for values that may be inherited rather than asked for:
 * an explicit request resolves strictly (unknown values throw), while an
 * effort inherited from a caller on another provider gets clamped, or
 * dropped (undefined) when it can't be mapped.
 */
function resolveEffortOrDropInherited(params: {
  requested: string | undefined;
  explicit: boolean;
  models: readonly AgentModelDefinition[] | undefined;
  model: string | undefined;
}): string | undefined {
  if (!params.requested) {
    return undefined;
  }
  try {
    return resolveEffortAgainstModels({
      requested: params.requested,
      models: params.models ?? [],
      model: params.model,
    });
  } catch (error) {
    if (params.explicit) {
      throw error;
    }
    return undefined;
  }
}

const MAX_DERIVED_ARTIFACT_NAME_LENGTH = 60;

// Fallback title when the agent passes only a description: first non-empty
// line, stripped of leading markdown markers, truncated at a word boundary.
function deriveArtifactName(description: string): string {
  const firstLine = description.split("\n").find((line) => line.trim().length > 0) ?? "";
  const cleaned = firstLine
    .replace(/^[#>\-*\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "Untitled artifact";
  }
  if (cleaned.length <= MAX_DERIVED_ARTIFACT_NAME_LENGTH) {
    return cleaned;
  }
  const truncated = cleaned.slice(0, MAX_DERIVED_ARTIFACT_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  const clipped =
    lastSpace > MAX_DERIVED_ARTIFACT_NAME_LENGTH / 2 ? truncated.slice(0, lastSpace) : truncated;
  return `${clipped.trimEnd()}…`;
}

/**
 * Resolve the projectId to stamp on a created artifact. Artifacts store the
 * project's canonical *root path* (matching what the client's create sheet
 * stores and what the app's project pickers/filters key on) — NOT the
 * registry's opaque grouping key (`remote:host/owner/repo` for repos with a
 * git remote), which nothing client-side can display or match against a
 * workspace. The workspace record only carries the grouping key, so map it
 * through the project registry to the project's rootPath; fall back to the
 * workspace's cwd when the project record is missing.
 */
async function resolveArtifactProjectId(params: {
  projectIdArg?: string;
  callerWorkspaceId?: string;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "upsert">;
  projectRegistry?: Pick<ProjectRegistry, "get">;
}): Promise<string> {
  const explicitProjectId = params.projectIdArg?.trim();
  if (explicitProjectId) {
    return explicitProjectId;
  }
  if (params.callerWorkspaceId && params.workspaceRegistry) {
    const record = await params.workspaceRegistry.get(params.callerWorkspaceId);
    if (record) {
      const project = record.projectId ? await params.projectRegistry?.get(record.projectId) : null;
      if (project?.rootPath) {
        return project.rootPath;
      }
      if (record.cwd) {
        return record.cwd;
      }
    }
  }
  throw new Error("projectId is required because it could not be derived from your workspace");
}

export function createOttoToolCatalog(options: OttoToolHostDependencies): OttoToolCatalog {
  const {
    agentManager,
    agentStorage,
    terminalManager,
    scheduleService,
    runService,
    providerSnapshotManager,
    readAgentPersonalities,
    readAgentTeams,
    callerAgentId,
    resolveSpeakHandler,
    resolveCallerContext,
    onActivity,
    logger,
  } = options;
  const childLogger = logger.child({ module: "agent", component: "otto-tool-catalog" });
  const callerContext = callerAgentId ? (resolveCallerContext?.(callerAgentId) ?? null) : null;

  const parseToolInput = async (tool: OttoToolDefinition, input: unknown): Promise<unknown> => {
    const inputSchema = tool.inputSchema;
    if (!inputSchema) {
      return input;
    }
    const schema =
      typeof inputSchema === "object" &&
      inputSchema !== null &&
      typeof (inputSchema as { safeParseAsync?: unknown }).safeParseAsync === "function"
        ? (inputSchema as z.ZodType)
        : z.object(inputSchema as z.ZodRawShape).passthrough();
    return schema.parseAsync(input);
  };

  const tools = new Map<string, OttoToolDefinition>();
  const registerTool = (
    name: string,
    config: OttoToolConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
    handler: (input: any, context: OttoToolExecutionContext) => Promise<OttoToolResult>,
  ) => {
    tools.set(name, {
      name,
      title: config.title,
      description: config.description ?? name,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      handler: handler as OttoToolDefinition["handler"],
    });
  };
  const toCatalog = (): OttoToolCatalog => ({
    tools,
    getTool(name: string): OttoToolDefinition | undefined {
      return tools.get(name);
    },
    async executeTool(
      name: string,
      input: unknown,
      context: OttoToolExecutionContext = {},
    ): Promise<OttoToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Otto tool not found: ${name}`);
      }
      return tool.handler(await parseToolInput(tool, input), context);
    },
  });

  const buildCronScheduleCadence = (input: {
    cron: string | undefined;
    timezone?: string;
  }): ScheduleCadence => {
    const expression = input.cron?.trim() ?? "";
    if (!expression) {
      throw new Error("cron is required");
    }
    const timezone = normalizeScheduleTimeZoneArg(input.timezone);
    return {
      type: "cron",
      expression,
      ...(timezone !== undefined ? { timezone } : {}),
    };
  };

  const buildScheduleExpiry = (expiresIn: string | undefined): string | undefined => {
    return expiresIn === undefined
      ? undefined
      : new Date(Date.now() + parseDurationString(expiresIn)).toISOString();
  };

  const resolveCallerAgent = () => {
    if (!callerAgentId) {
      return null;
    }
    const parentAgent = agentManager.getAgent(callerAgentId);
    if (!parentAgent) {
      throw new Error(`Parent agent ${callerAgentId} not found`);
    }
    return parentAgent;
  };

  const resolveScopedCwd = (requestedCwd?: string, opts?: { required?: boolean }): string => {
    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return resolveChildAgentCwd({
        parentCwd: callerAgent.cwd,
        requestedCwd,
        lockedCwd: callerContext?.lockedCwd,
        allowCustomCwd: callerContext?.allowCustomCwd ?? true,
      });
    }

    const trimmedCwd = requestedCwd?.trim();
    if (!trimmedCwd) {
      if (opts?.required) {
        throw new Error("cwd is required");
      }
      throw new Error("cwd is required outside an agent-scoped session");
    }

    return expandUserPath(trimmedCwd);
  };

  async function resolveTerminalWorkspaceId(resolvedCwd: string): Promise<string> {
    // An agent-spawned terminal belongs to the caller agent's workspace. Only if
    // the caller has no workspace do we mint one for the cwd.
    const callerAgent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
    if (callerAgent?.workspaceId) {
      return callerAgent.workspaceId;
    }

    if (!options.ensureWorkspaceForCreate) {
      throw new Error(
        callerAgentId
          ? `Caller agent ${callerAgentId} has no workspace and workspace minting is not configured`
          : "workspaceId is required outside an agent-scoped session",
      );
    }

    return options.ensureWorkspaceForCreate(resolvedCwd);
  }

  function resolveWorkspaceIdForRename(requestedWorkspaceId?: string): string {
    const explicitWorkspaceId = requestedWorkspaceId?.trim();
    if (explicitWorkspaceId) {
      return explicitWorkspaceId;
    }

    if (callerAgentId) {
      const callerAgent = resolveCallerAgent();
      if (!callerAgent?.workspaceId) {
        throw new Error(`Caller agent ${callerAgentId} has no current workspace`);
      }
      return callerAgent.workspaceId;
    }
    throw new Error("workspaceId is required outside an agent-scoped session");
  }

  const buildCallerAgentScheduleConfigExtras = (
    callerAgent: NonNullable<ReturnType<typeof resolveCallerAgent>>,
  ): Record<string, unknown> => {
    return {
      ...(callerAgent.config.thinkingOptionId
        ? { thinkingOptionId: callerAgent.config.thinkingOptionId }
        : {}),
      ...(callerAgent.config.approvalPolicy
        ? { approvalPolicy: callerAgent.config.approvalPolicy }
        : {}),
      ...(callerAgent.config.sandboxMode ? { sandboxMode: callerAgent.config.sandboxMode } : {}),
      ...(typeof callerAgent.config.networkAccess === "boolean"
        ? { networkAccess: callerAgent.config.networkAccess }
        : {}),
      ...(typeof callerAgent.config.webSearch === "boolean"
        ? { webSearch: callerAgent.config.webSearch }
        : {}),
      ...(callerAgent.config.title ? { title: callerAgent.config.title } : {}),
      ...(callerAgent.config.extra ? { extra: callerAgent.config.extra } : {}),
      ...(callerAgent.config.featureValues
        ? { featureValues: callerAgent.config.featureValues }
        : {}),
      ...(callerAgent.config.systemPrompt ? { systemPrompt: callerAgent.config.systemPrompt } : {}),
      ...(callerAgent.config.mcpServers ? { mcpServers: callerAgent.config.mcpServers } : {}),
    };
  };

  const buildCallerAgentScheduleConfig = (
    callerAgent: NonNullable<ReturnType<typeof resolveCallerAgent>>,
    params?: { provider?: string; cwd?: string },
  ) => {
    const hasProviderOverride = params?.provider !== undefined;
    const resolvedProviderModel = hasProviderOverride
      ? resolveScheduleProviderAndModel({
          provider: params?.provider,
          defaultProvider: callerAgent.provider,
        })
      : null;
    const resolvedProvider = resolvedProviderModel?.provider ?? callerAgent.provider;
    let resolvedModel: string | undefined;
    if (resolvedProviderModel?.model) {
      resolvedModel = resolvedProviderModel.model;
    } else if (!hasProviderOverride && callerAgent.config.model) {
      resolvedModel = callerAgent.config.model;
    }
    return {
      provider: resolvedProvider,
      cwd: params?.cwd?.trim() ? expandUserPath(params.cwd) : callerAgent.cwd,
      ...(callerAgent.currentModeId && callerAgent.provider === resolvedProvider
        ? {
            modeId: callerAgent.currentModeId,
          }
        : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...buildCallerAgentScheduleConfigExtras(callerAgent),
    };
  };

  const listProviderModels = async (provider: AgentProvider): Promise<AgentModelDefinition[]> => {
    const entry = (await providerSnapshotManager.listProviders({ wait: true })).find(
      (candidate) => candidate.provider === provider,
    );
    return entry?.models ?? [];
  };

  const getPersonalityRoster = (): AgentPersonality[] => readAgentPersonalities?.() ?? [];

  const findPersonalityByName = (name: string): AgentPersonality | undefined => {
    const trimmed = name.trim();
    const roster = getPersonalityRoster();
    return (
      roster.find((p) => p.name === trimmed) ??
      roster.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    );
  };

  interface ResolvedCreateAgentBrain {
    providerModel: string;
    modeId?: string;
    thinkingOptionId?: string;
    systemPrompt?: string;
    personalitySnapshot?: ResolvedPersonalitySnapshot;
    teamSnapshot?: ResolvedTeamSnapshot;
  }

  // Turn the create_agent brain inputs — a personality name and/or explicit
  // provider/settings — into the concrete provider/model/effort/mode/prompt to
  // spawn with. A personality expands to its resolved snapshot; explicit sibling
  // fields override it per-field (no heuristic substitution). Without a
  // personality this is the plain provider/model path.
  const resolveCreateAgentBrain = async (input: {
    personalityName: string | undefined;
    providerOverride: string | undefined;
    modeOverride: string | undefined;
    thinkingOverride: string | undefined;
    cwd: string | undefined;
  }): Promise<ResolvedCreateAgentBrain> => {
    const resolveThinkingAgainstProvider = async (
      requested: string,
      providerModel: string,
    ): Promise<string> => {
      const { provider, model } = resolveScheduleProviderAndModel({
        provider: providerModel,
        defaultProvider: providerModel,
      });
      return resolveEffortAgainstModels({
        requested,
        models: await listProviderModels(provider),
        model,
      });
    };

    if (input.personalityName) {
      const personality = findPersonalityByName(input.personalityName);
      if (!personality) {
        const names = getPersonalityRoster()
          .map((p) => p.name)
          .join(", ");
        throw new Error(
          `Personality "${input.personalityName}" not found.${names ? ` Available: ${names}.` : " No personalities are configured on this host."}`,
        );
      }
      const entries = await providerSnapshotManager.listProviders({ cwd: input.cwd, wait: true });
      const resolution = resolvePersonality(personality, entries);
      if (resolution.status === "unavailable") {
        throw new Error(
          `Personality "${personality.name}" is unavailable here: ${resolution.reason}`,
        );
      }
      const snapshot = resolution.snapshot;
      // An active-team member carries the frozen team layer; the team prompt
      // stacks ahead of the personality prompt. Explicit spawn of a non-member
      // stays deliberate and teamless (explicit is explicit).
      const teamSnapshot = resolveTeamSnapshotForPersonality(
        readAgentTeams?.(),
        snapshot.personalityId,
      );
      const composedPrompt = composeTeamAndPersonalityPrompt(
        teamSnapshot,
        snapshot.systemPrompt,
        snapshot.roles,
      );
      // Explicit args override the personality per-field.
      const snapshotProviderModel = snapshot.model
        ? `${snapshot.provider}/${snapshot.model}`
        : snapshot.provider;
      const providerModel = input.providerOverride?.trim() || snapshotProviderModel;
      const modeId = input.modeOverride ?? snapshot.modeId;
      const thinkingOptionId = input.thinkingOverride
        ? await resolveThinkingAgainstProvider(input.thinkingOverride, providerModel)
        : snapshot.thinkingOptionId;
      return {
        providerModel,
        ...(modeId !== undefined ? { modeId } : {}),
        ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
        ...(composedPrompt !== undefined ? { systemPrompt: composedPrompt } : {}),
        personalitySnapshot: snapshot,
        ...(teamSnapshot ? { teamSnapshot } : {}),
      };
    }

    const providerModel = input.providerOverride?.trim();
    if (!providerModel) {
      throw new Error("Either provider or personality is required.");
    }
    const thinkingOptionId = input.thinkingOverride
      ? await resolveThinkingAgainstProvider(input.thinkingOverride, providerModel)
      : undefined;
    return {
      providerModel,
      ...(input.modeOverride !== undefined ? { modeId: input.modeOverride } : {}),
      ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
    };
  };

  const resolveNewAgentScheduleTarget = (params?: { provider?: string; cwd?: string }) => {
    if (!params?.provider?.trim()) {
      throw new Error("provider is required when target is new-agent");
    }

    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return {
        type: "new-agent" as const,
        config: buildCallerAgentScheduleConfig(callerAgent, params),
      };
    }

    const resolvedProviderModel = resolveScheduleProviderAndModel({
      provider: params?.provider,
      defaultProvider: params.provider,
    });
    return {
      type: "new-agent" as const,
      config: {
        provider: resolvedProviderModel.provider,
        cwd: params?.cwd?.trim() ? expandUserPath(params.cwd) : process.cwd(),
        ...(resolvedProviderModel.model ? { model: resolvedProviderModel.model } : {}),
      },
    };
  };
  const ProviderModelInputSchema = AgentProviderEnum.trim()
    .refine((value) => value.includes("/"), {
      message: "provider must be provider/model, for example codex/gpt-5.4",
    })
    .refine(
      (value) => {
        try {
          resolveRequiredProviderModel(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "provider must be provider/model, for example codex/gpt-5.4" },
    );
  const ProviderOrProviderModelInputSchema = AgentProviderEnum.trim()
    .min(1, "provider is required")
    .refine(
      (value) => {
        if (!value.includes("/")) {
          return true;
        }
        try {
          resolveRequiredProviderModel(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "provider must be provider or provider/model, for example codex/gpt-5.4" },
    );
  const CreateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode to configure before the first run."),
      thinkingOptionId: z.string().optional().describe(EFFORT_INPUT_DESCRIPTION),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
    })
    .strict();
  const UpdateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode ID."),
      model: z.string().nullable().optional().describe("Model ID. Pass null to clear."),
      thinkingOptionId: z
        .string()
        .nullable()
        .optional()
        .describe(`${EFFORT_INPUT_DESCRIPTION} Pass null to clear.`),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
    })
    .strict();
  const InspectProviderSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Draft session mode ID."),
      model: z.string().optional().describe("Draft model ID."),
      thinkingOptionId: z.string().optional().describe("Draft effort option id."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Draft provider feature values."),
    })
    .strict();
  const AgentRelationshipInputSchema = z.discriminatedUnion("kind", [
    z
      .object({ kind: z.literal("subagent") })
      .strict()
      .describe("Create a child agent under this agent's subagent track."),
    z
      .object({ kind: z.literal("detached") })
      .strict()
      .describe("Create a root agent that does not appear in this agent's subagent track."),
  ]);
  const AgentCreateWorktreeTargetInputSchema = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("branch-off"),
        worktreeSlug: z
          .string()
          .min(1)
          .optional()
          .describe("Optional worktree slug/path label. Omit to let Otto generate one."),
        branchName: z
          .string()
          .min(1)
          .optional()
          .describe("Optional git branch name. Defaults to the worktree slug."),
        baseBranch: z
          .string()
          .min(1)
          .optional()
          .describe("Optional base branch. Defaults to the repository default branch."),
      })
      .strict()
      .describe("Create a new branch in a new Otto worktree."),
    z
      .object({
        kind: z.literal("checkout-branch"),
        branch: z.string().min(1).describe("Existing branch to check out."),
      })
      .strict()
      .describe("Check out an existing branch in a new Otto worktree."),
    z
      .object({
        kind: z.literal("checkout-pr"),
        githubPrNumber: z.number().int().positive().describe("GitHub pull request number."),
      })
      .strict()
      .describe("Check out a GitHub pull request in a new Otto worktree."),
  ]);
  const AgentWorkspaceInputSchema = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("current"),
        cwd: z.string().optional().describe("Optional runtime cwd. Defaults to the caller's cwd."),
      })
      .strict()
      .describe("Use the caller's current workspace."),
    z
      .object({
        kind: z.literal("existing"),
        workspaceId: z.string().min(1).describe("Existing workspace id to attach the agent to."),
        cwd: z
          .string()
          .optional()
          .describe("Optional runtime cwd. Defaults to the existing workspace cwd."),
      })
      .strict()
      .describe("Attach the agent to an existing workspace."),
    z
      .object({
        kind: z.literal("create"),
        source: z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("directory"),
              path: z
                .string()
                .optional()
                .describe("Optional directory path. Defaults to the caller's cwd."),
            })
            .strict(),
          z
            .object({
              kind: z.literal("worktree"),
              cwd: z
                .string()
                .optional()
                .describe("Optional source repository. Defaults to the caller's cwd."),
              target: AgentCreateWorktreeTargetInputSchema,
            })
            .strict(),
        ]),
      })
      .strict()
      .describe("Create a new workspace for the agent."),
  ]);
  const commonCreateAgentInputSchema = {
    relationship: AgentRelationshipInputSchema.describe(
      "Whether the created agent is a subagent under you or a detached root agent.",
    ),
    workspace: AgentWorkspaceInputSchema.describe(
      "Workspace ownership/location for the created agent.",
    ),
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be empty")
      .max(60, "Title must be 60 characters or fewer")
      .optional()
      .describe(
        "Short descriptive title (<= 60 chars) summarizing the agent's focus. Optional — omit to let Otto derive one from the prompt (or name a bare new chat).",
      ),
    provider: ProviderModelInputSchema.optional().describe(
      "Provider/model pair, for example codex/gpt-5.4. Required unless `personality` is given; when both are given, this overrides the personality's provider/model.",
    ),
    personality: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Spawn from a named Agent Personality configured on this host. Expands to its provider/model/effort/mode/prompt; explicit provider/settings override per-field. Any agent may spawn by personality name (see list_personalities for each one's guidance and tier — coordinators delegate; focused writer/coder/judger personalities are spawned to finish one task). Fails loudly if the personality is unavailable here — no fallback.",
      ),
    labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
    settings: CreateAgentSettingsInputSchema.optional().describe(
      "Initial runtime settings for the new agent.",
    ),
    initialPrompt: z
      .string()
      .trim()
      .min(1, "initialPrompt cannot be empty")
      .optional()
      .describe(
        "First task to run immediately after creation. Optional — omit to just open a new chat; the agent then greets the user and asks what to work on. Don't refuse to spawn just because there's no task yet.",
      ),
  };
  const agentToAgentInputSchema = {
    ...commonCreateAgentInputSchema,
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Get notified when the created agent finishes, errors, or needs permission. Set false only for truly fire-and-forget agents.",
      ),
  };
  const canonicalTopLevelInputSchema = {
    ...commonCreateAgentInputSchema,
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run agent in background. If false (default), waits for completion or permission request. If true, returns immediately.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the created agent finishes, errors, or needs permission.",
      ),
  };
  const legacyTopLevelCreateAgentInputSchema = {
    relationship: commonCreateAgentInputSchema.relationship.optional(),
    workspace: commonCreateAgentInputSchema.workspace.optional(),
    cwd: z
      .string()
      .optional()
      .describe("Legacy top-level working directory. Prefer workspace.source.path."),
    mode: z.string().optional().describe("Legacy session mode ID. Prefer settings.modeId."),
    thinking: z
      .string()
      .optional()
      .describe("Legacy thinking option ID. Prefer settings.thinkingOptionId."),
    features: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Legacy feature values. Prefer settings.features."),
    worktreeName: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy worktree slug. Prefer workspace.source.target.worktreeSlug."),
    branchName: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy branch name. Prefer workspace.source.target.branchName."),
    baseBranch: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy base branch. Prefer workspace.source.target.baseBranch."),
    refName: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy branch/ref to check out. Prefer workspace.source.target.branch."),
    githubPrNumber: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Legacy GitHub PR number. Prefer workspace.source.target.githubPrNumber."),
  };
  const topLevelInputSchema = {
    ...canonicalTopLevelInputSchema,
    ...legacyTopLevelCreateAgentInputSchema,
  };

  const createAgentInputSchema = callerAgentId ? agentToAgentInputSchema : topLevelInputSchema;
  const agentToAgentCreateAgentArgsSchema = z.object(agentToAgentInputSchema).strict();
  const canonicalTopLevelCreateAgentArgsSchema = z.object(canonicalTopLevelInputSchema).strict();
  const topLevelCreateAgentArgsSchema = z.object(topLevelInputSchema).strict();
  const commonSendAgentPromptInputSchema = {
    agentId: z.string(),
    prompt: z.string(),
    sessionMode: z.string().optional().describe("Optional mode to set before running the prompt."),
  };
  const agentToAgentSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    background: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Run agent in background. Agent-scoped default is true so you can continue until the finish notification arrives. Set false only when you need a blocking response.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Get notified when the prompted agent finishes, errors, or needs permission. Set false only for truly fire-and-forget prompts.",
      ),
  };
  const topLevelSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run agent in background. If false (default), waits for completion or permission request. If true, returns immediately.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the prompted agent finishes, errors, or needs permission.",
      ),
  };
  const sendAgentPromptInputSchema = callerAgentId
    ? agentToAgentSendAgentPromptInputSchema
    : topLevelSendAgentPromptInputSchema;
  const inspectProviderInputSchema = {
    provider: ProviderOrProviderModelInputSchema.describe(
      "Provider ID, optionally with a model ID (for example codex or codex/gpt-5.4).",
    ),
    cwd: z
      .string()
      .optional()
      .describe("Working directory used to resolve provider feature availability."),
    settings: InspectProviderSettingsInputSchema.optional().describe(
      "Draft provider settings used to compute available features.",
    ),
  };
  type AgentToAgentCreateAgentArgs = z.infer<typeof agentToAgentCreateAgentArgsSchema>;
  type TopLevelCreateAgentArgs = z.infer<typeof canonicalTopLevelCreateAgentArgsSchema>;
  type TopLevelCreateAgentToolArgs = z.infer<typeof topLevelCreateAgentArgsSchema>;

  if (options.voiceOnly || options.enableVoiceTools || callerContext?.enableVoiceTools) {
    registerTool(
      "speak",
      {
        title: "Speak",
        description:
          "Speak text to the user via daemon-managed voice output. Blocks until playback completes.",
        inputSchema: {
          text: z
            .string()
            .trim()
            .min(1, "text is required")
            .max(4000, "text must be 4000 characters or fewer"),
        },
        outputSchema: {
          ok: z.boolean(),
        },
      },
      async (args, context) => {
        if (!callerAgentId) {
          throw new Error("speak is only available to agent-scoped tool sessions");
        }
        const handler = resolveSpeakHandler?.(callerAgentId) ?? null;
        if (!handler) {
          throw new Error(`No speak handler registered for your session '${callerAgentId}'`);
        }
        await handler({
          text: args.text,
          callerAgentId,
          signal: context?.signal,
        });
        return {
          content: [],
          structuredContent: ensureValidJson({ ok: true }),
        };
      },
    );
  }

  if (options.voiceOnly) {
    return toCatalog();
  }

  if (options.browserToolsEnabled && options.browserToolsBroker) {
    registerBrowserTools({
      registerTool,
      broker: options.browserToolsBroker,
      callerAgentId,
      resolveCallerAgent,
      previewServers: options.previewDevServers ?? null,
    });
  }

  if (options.previewDevServers) {
    registerPreviewTools({
      registerTool,
      manager: options.previewDevServers,
      broker: options.browserToolsBroker ?? null,
      resolveCallerAgent,
    });
  }

  registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Create an agent. Requires relationship, workspace, and either a provider/model (for example codex/gpt-5.4) or a personality name. Title and initialPrompt are optional — omit both to just open a new chat that greets the user and asks what to work on. Prefer a personality when the host has them (call list_personalities). Do not guess the provider; call list_providers and list_models first if uncertain.",
      inputSchema: createAgentInputSchema,
      outputSchema: {
        agentId: z.string(),
        type: AgentProviderEnum,
        status: AgentStatusEnum,
        cwd: z.string(),
        workspaceId: z.string().optional(),
        currentModeId: z.string().nullable(),
        availableModes: z.array(ProviderModeSchema),
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
        guidance: z.string().optional(),
      },
    },
    async (args: unknown) => {
      const resolvedArgs = await resolveCreateAgentToolArgs(args);
      const { parsedArgs, worktree } = resolvedArgs;
      let requestedBackground: boolean;
      let notifyOnFinish: boolean;
      let detached: boolean;
      if (resolvedArgs.kind === "agent-scoped") {
        requestedBackground = true;
        notifyOnFinish = parsedArgs.notifyOnFinish;
        detached = resolvedArgs.relationship.kind === "detached";
      } else {
        requestedBackground = resolvedArgs.parsedArgs.background;
        notifyOnFinish = resolvedArgs.parsedArgs.notifyOnFinish ?? false;
        detached = resolvedArgs.parsedArgs.relationship.kind === "detached";
      }
      const brain = await resolveCreateAgentBrain({
        personalityName: parsedArgs.personality,
        providerOverride: parsedArgs.provider,
        modeOverride: parsedArgs.settings?.modeId,
        thinkingOverride: parsedArgs.settings?.thinkingOptionId,
        cwd: resolvedArgs.cwd,
      });
      // A personality carries a systemPrompt and its frozen snapshot onto the
      // agent config (spread first in buildMcpSessionConfig, so nothing below
      // clobbers them).
      const personalityConfig = buildPersonalityAgentConfig(brain);
      const bareSpawn = resolveBareSpawnTitleAndPrompt({
        title: parsedArgs.title,
        initialPrompt: parsedArgs.initialPrompt,
      });
      const {
        snapshot,
        background: createdInBackground,
        initialPromptStarted,
      } = await createAgentCommand(
        {
          agentManager,
          agentStorage,
          logger: childLogger,
          ottoHome: options.ottoHome,
          worktreesRoot: options.worktreesRoot,
          terminalManager,
          providerSnapshotManager,
          createOttoWorktree: options.createOttoWorktree,
          ...(options.ensureWorkspaceForCreate
            ? { ensureWorkspaceForCreate: options.ensureWorkspaceForCreate }
            : {}),
        },
        {
          kind: "mcp",
          provider: brain.providerModel,
          ...(personalityConfig ? { config: personalityConfig } : {}),
          title: bareSpawn.title,
          initialPrompt: bareSpawn.initialPrompt,
          cwd: resolvedArgs.cwd,
          workspaceId: resolvedArgs.workspaceId,
          thinking: brain.thinkingOptionId,
          features: parsedArgs.settings?.features,
          labels: parsedArgs.labels,
          mode: brain.modeId,
          background: requestedBackground,
          notifyOnFinish,
          detached,
          callerAgentId,
          callerContext,
          worktree,
        },
      );
      onActivity?.("backgroundTasksInvoked", Number(createdInBackground));

      try {
        if (!createdInBackground && initialPromptStarted) {
          const result = await waitForAgentWithTimeout(agentManager, snapshot.id, {
            waitForActive: true,
          });

          const liveSnapshot = agentManager.getAgent(snapshot.id) ?? snapshot;
          const responseData = {
            agentId: snapshot.id,
            type: snapshot.provider,
            status: result.status,
            cwd: liveSnapshot.cwd,
            ...(liveSnapshot.workspaceId ? { workspaceId: liveSnapshot.workspaceId } : {}),
            currentModeId: liveSnapshot.currentModeId,
            availableModes: liveSnapshot.availableModes,
            lastMessage: result.lastMessage,
            permission: sanitizePermissionRequest(result.permission),
          };
          const validJson = ensureValidJson(responseData);

          const response = {
            content: [],
            structuredContent: validJson,
          };
          return response;
        }
      } catch (error) {
        childLogger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
        throw error;
      }

      // Return immediately for async creation.
      const currentSnapshot = agentManager.getAgent(snapshot.id) ?? snapshot;
      const guidance =
        callerAgentId && notifyOnFinish && initialPromptStarted
          ? "You will get notified when the created agent finishes, errors, or needs permission. Do not poll for status; continue with other work until the notification arrives."
          : undefined;
      const response = {
        content: [],
        structuredContent: ensureValidJson({
          agentId: currentSnapshot.id,
          type: snapshot.provider,
          status: currentSnapshot.lifecycle,
          cwd: currentSnapshot.cwd,
          ...(currentSnapshot.workspaceId ? { workspaceId: currentSnapshot.workspaceId } : {}),
          currentModeId: currentSnapshot.currentModeId,
          availableModes: currentSnapshot.availableModes,
          lastMessage: null,
          permission: null,
          ...(guidance ? { guidance } : {}),
        }),
      };
      return response;
    },
  );

  if (readAgentPersonalities) {
    registerTool(
      "list_personalities",
      {
        title: "List personalities",
        description:
          "List the Agent Personalities configured on this host — named templates binding a provider/model, effort, mode, prompt, and roles. Use a personality's name with create_agent's `personality` argument to spawn it. Availability is resolved against a workspace; unavailable personalities cannot be spawned there. Any agent may call this to see the roster and pick a teammate. Each entry carries `guidance` (why you'd choose it), a `tier` (`coordinator` = delegates/orchestrates, `focused` = a worker that stays on one task), and `canLaunch`.",
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              "Workspace directory to resolve availability against. Defaults to your current cwd.",
            ),
          role: z
            .string()
            .optional()
            .describe(
              "Only return personalities carrying this role (for example writer, coder, judger, advisor).",
            ),
        },
        outputSchema: {
          personalities: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              roles: z.array(z.string()),
              provider: z.string(),
              model: z.string(),
              available: z.boolean(),
              tier: z
                .string()
                .describe("coordinator (delegates/orchestrates) or focused (worker)."),
              canLaunch: z
                .boolean()
                .describe(
                  "Whether this personality is meant to spawn other agents and orchestrate.",
                ),
              guidance: z
                .string()
                .describe("Why you'd choose this personality — its roles' intent."),
              unavailableReason: z.string().optional(),
              modeId: z.string().optional(),
              thinkingOptionId: z.string().optional(),
              effortLevel: z.string().optional(),
            }),
          ),
          activeTeam: z
            .object({ id: z.string(), name: z.string(), note: z.string() })
            .optional()
            .describe(
              "Present when an Agent Team is active — the list above is scoped to its members.",
            ),
        },
      },
      async (args: { cwd?: string; role?: string }) => {
        const roleFilter = args.role?.trim();
        const caller = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
        const cwd = args.cwd?.trim() || caller?.cwd || undefined;
        const entries = await providerSnapshotManager.listProviders({ cwd, wait: true });
        // With a team active, the bench is the team: only members are listed
        // (create_agent by explicit name still resolves the full roster — an
        // off-team specialist can be pulled in deliberately, without the team
        // prompt). No active team = the full roster, exactly as before.
        const activeTeam = getActiveAgentTeam(readAgentTeams?.());
        const personalities = getPersonalityRoster()
          .filter((personality) => !activeTeam || isTeamMember(activeTeam, personality.id))
          .filter(
            (personality) =>
              !roleFilter ||
              (isPersonalityRole(roleFilter) && personalityHasRole(personality, roleFilter)),
          )
          .map((personality) => {
            const resolution = resolvePersonality(personality, entries);
            const selection = summarizePersonalityForSelection(personality);
            const entryOut: {
              id: string;
              name: string;
              roles: string[];
              provider: string;
              model: string;
              available: boolean;
              tier: string;
              canLaunch: boolean;
              guidance: string;
              unavailableReason?: string;
              modeId?: string;
              thinkingOptionId?: string;
              effortLevel?: string;
            } = {
              id: personality.id,
              name: personality.name,
              roles: normalizePersonalityRoles(personality.roles),
              provider: personality.provider,
              model: personality.model,
              available: resolution.status === "available",
              tier: selection.tier,
              canLaunch: selection.canLaunch,
              guidance: selection.guidance,
            };
            if (resolution.status === "unavailable") {
              entryOut.unavailableReason = resolution.reason;
              return entryOut;
            }
            const snapshot = resolution.snapshot;
            if (snapshot.modeId !== undefined) {
              entryOut.modeId = snapshot.modeId;
            }
            if (snapshot.thinkingOptionId !== undefined) {
              entryOut.thinkingOptionId = snapshot.thinkingOptionId;
            }
            if (snapshot.effortLevel !== undefined) {
              entryOut.effortLevel = snapshot.effortLevel;
            }
            return entryOut;
          });
        return {
          content: [],
          structuredContent: ensureValidJson({
            personalities,
            ...(activeTeam
              ? {
                  activeTeam: {
                    id: activeTeam.id,
                    name: activeTeam.name,
                    note: `Team "${activeTeam.name}" is active; this list is its bench. create_agent with an off-team personality name still works but spawns without the team prompt.`,
                  },
                }
              : {}),
          }),
        };
      },
    );
  }

  type ResolvedCreateAgentToolArgs =
    | {
        kind: "agent-scoped";
        parsedArgs: AgentToAgentCreateAgentArgs;
        relationship: AgentToAgentCreateAgentArgs["relationship"];
        cwd: string | undefined;
        workspaceId: string | undefined;
        worktree: CreateAgentFromMcpInput["worktree"];
      }
    | {
        kind: "top-level";
        parsedArgs: TopLevelCreateAgentArgs;
        cwd: string | undefined;
        workspaceId: string | undefined;
        worktree: CreateAgentFromMcpInput["worktree"];
      };

  async function resolveCreateAgentToolArgs(args: unknown): Promise<ResolvedCreateAgentToolArgs> {
    if (callerAgentId) {
      const parsed = agentToAgentCreateAgentArgsSchema.parse(args);
      const { cwd, workspaceId, worktree } = await resolveCreateAgentWorkspace(parsed.workspace, {
        prompt: parsed.initialPrompt,
      });
      return {
        kind: "agent-scoped",
        parsedArgs: parsed,
        relationship: parsed.relationship,
        cwd,
        workspaceId,
        worktree,
      };
    }
    const parsedArgs = normalizeTopLevelCreateAgentArgs(topLevelCreateAgentArgsSchema.parse(args));
    if (parsedArgs.relationship.kind === "subagent") {
      throw new Error("relationship subagent requires an agent-scoped tool session");
    }
    const { cwd, workspaceId, worktree } = await resolveCreateAgentWorkspace(parsedArgs.workspace, {
      prompt: parsedArgs.initialPrompt,
    });
    return {
      kind: "top-level",
      parsedArgs,
      cwd,
      workspaceId,
      worktree,
    };
  }

  function normalizeTopLevelCreateAgentArgs(
    args: TopLevelCreateAgentToolArgs,
  ): TopLevelCreateAgentArgs {
    const {
      cwd,
      mode,
      thinking,
      features,
      worktreeName,
      branchName,
      baseBranch,
      refName,
      githubPrNumber,
      ...canonicalCandidate
    } = args;
    const settings = {
      ...canonicalCandidate.settings,
      ...(mode ? { modeId: mode } : {}),
      ...(thinking ? { thinkingOptionId: thinking } : {}),
      ...(features ? { features } : {}),
    };

    if (canonicalCandidate.relationship && canonicalCandidate.workspace) {
      return canonicalTopLevelCreateAgentArgsSchema.parse({
        ...canonicalCandidate,
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
      });
    }

    if (canonicalCandidate.relationship || canonicalCandidate.workspace) {
      throw new Error("relationship and workspace must be provided together");
    }

    if (!cwd?.trim()) {
      throw new Error("cwd is required for legacy top-level create_agent calls");
    }

    const legacyWorktreeTarget = resolveLegacyCreateAgentWorktreeTarget({
      worktreeName,
      branchName,
      baseBranch,
      refName,
      githubPrNumber,
    });
    const workspace = legacyWorktreeTarget
      ? {
          kind: "create" as const,
          source: {
            kind: "worktree" as const,
            cwd,
            target: legacyWorktreeTarget,
          },
        }
      : {
          kind: "create" as const,
          source: {
            kind: "directory" as const,
            path: cwd,
          },
        };

    return canonicalTopLevelCreateAgentArgsSchema.parse({
      ...canonicalCandidate,
      relationship: { kind: "detached" },
      workspace,
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
    });
  }

  function resolveLegacyCreateAgentWorktreeTarget(input: {
    worktreeName?: string;
    branchName?: string;
    baseBranch?: string;
    refName?: string;
    githubPrNumber?: number;
  }): z.infer<typeof AgentCreateWorktreeTargetInputSchema> | null {
    if (input.githubPrNumber !== undefined) {
      return {
        kind: "checkout-pr",
        githubPrNumber: input.githubPrNumber,
      };
    }

    if (input.refName) {
      return {
        kind: "checkout-branch",
        branch: input.refName,
      };
    }

    if (input.worktreeName || input.branchName || input.baseBranch) {
      return {
        kind: "branch-off",
        worktreeSlug: input.worktreeName,
        branchName: input.branchName,
        baseBranch: input.baseBranch,
      };
    }

    return null;
  }

  async function resolveCreateAgentWorkspace(
    workspace: AgentToAgentCreateAgentArgs["workspace"] | TopLevelCreateAgentArgs["workspace"],
    firstAgentContext: FirstAgentContext | undefined,
  ): Promise<{
    cwd: string | undefined;
    workspaceId: string | undefined;
    worktree: CreateAgentFromMcpInput["worktree"];
  }> {
    if (workspace.kind === "current") {
      if (!callerAgentId) {
        throw new Error("workspace current requires an agent-scoped tool session");
      }
      const callerAgent = resolveCallerAgent();
      if (!callerAgent?.workspaceId) {
        throw new Error(`Caller agent ${callerAgentId} has no current workspace`);
      }
      return {
        cwd: workspace.cwd,
        workspaceId: callerAgent.workspaceId,
        worktree: undefined,
      };
    }

    if (workspace.kind === "existing") {
      if (!options.listActiveWorkspaces) {
        throw new Error("Workspace lookup is not configured");
      }
      const existingWorkspace = (await options.listActiveWorkspaces()).find(
        (candidate) => candidate.workspaceId === workspace.workspaceId,
      );
      if (!existingWorkspace) {
        throw new Error(`Workspace ${workspace.workspaceId} not found`);
      }
      const cwd = workspace.cwd
        ? resolveScopedCwd(workspace.cwd, { required: true })
        : existingWorkspace.cwd;
      const lockedCwd = callerContext?.lockedCwd?.trim();
      if (lockedCwd && !isSameOrDescendantPath(expandUserPath(lockedCwd), cwd)) {
        throw new Error(`Workspace ${workspace.workspaceId} is outside the allowed cwd`);
      }
      return {
        cwd,
        workspaceId: workspace.workspaceId,
        worktree: undefined,
      };
    }

    if (workspace.source.kind === "directory") {
      const cwd = resolveScopedCwd(workspace.source.path, { required: true });
      if (!options.ensureWorkspaceForCreate) {
        throw new Error("Workspace creation is not configured");
      }
      return {
        cwd,
        workspaceId: await options.ensureWorkspaceForCreate(cwd, firstAgentContext),
        worktree: undefined,
      };
    }

    const cwd = resolveScopedCwd(workspace.source.cwd, { required: true });
    return {
      cwd,
      workspaceId: undefined,
      worktree: resolveCreateAgentWorktree(workspace.source.target),
    };
  }

  function resolveCreateAgentWorktree(
    target: z.infer<typeof AgentCreateWorktreeTargetInputSchema>,
  ): NonNullable<CreateAgentFromMcpInput["worktree"]> {
    switch (target.kind) {
      case "branch-off":
        return {
          action: "branch-off",
          worktreeName: target.worktreeSlug,
          branchName: target.branchName,
          baseBranch: target.baseBranch,
        };
      case "checkout-branch":
        return {
          action: "checkout",
          refName: target.branch,
        };
      case "checkout-pr":
        return {
          action: "checkout",
          githubPrNumber: target.githubPrNumber,
        };
      default:
        throw new Error("unreachable");
    }
  }

  registerTool(
    "send_agent_prompt",
    {
      title: "Send agent prompt",
      description:
        "Send a task to a running agent. Agent-scoped callers run in background by default; top-level callers wait by default.",
      inputSchema: sendAgentPromptInputSchema,
      outputSchema: {
        success: z.boolean(),
        status: AgentStatusEnum,
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
        guidance: z.string().optional(),
      },
    },
    async ({
      agentId,
      prompt,
      sessionMode,
      background = Boolean(callerAgentId),
      notifyOnFinish = Boolean(callerAgentId),
    }) => {
      const shouldNotifyOnFinish = Boolean(callerAgentId && notifyOnFinish && background);
      onActivity?.("backgroundTasksInvoked", Number(background));

      await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        sessionMode,
        logger: childLogger,
      });

      if (shouldNotifyOnFinish && callerAgentId) {
        setupFinishNotification({
          agentManager,
          agentStorage,
          childAgentId: agentId,
          callerAgentId,
          logger: childLogger,
        });
      }

      // If not running in background, wait for completion
      if (!background) {
        const result = await waitForAgentWithTimeout(agentManager, agentId, {
          waitForActive: true,
        });

        const responseData = {
          success: true,
          status: result.status,
          lastMessage: result.lastMessage,
          permission: sanitizePermissionRequest(result.permission),
        };
        const validJson = ensureValidJson(responseData);

        const response = {
          content: [],
          structuredContent: validJson,
        };
        return response;
      }

      // Return immediately if background=true
      // Re-fetch snapshot since the state may have changed
      const currentSnapshot = agentManager.getAgent(agentId);

      const responseData = {
        success: true,
        status: currentSnapshot?.lifecycle ?? "idle",
        lastMessage: null,
        permission: null,
        ...(shouldNotifyOnFinish
          ? {
              guidance:
                "You will get notified when the prompted agent finishes, errors, or needs permission. Do not poll for status; continue with other work until the notification arrives.",
            }
          : {}),
      };
      const validJson = ensureValidJson(responseData);

      const response = {
        content: [],
        structuredContent: validJson,
      };
      return response;
    },
  );

  registerTool(
    "get_agent_status",
    {
      title: "Get agent status",
      description:
        "Return the latest snapshot for an agent, including lifecycle state, capabilities, and pending permissions.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        status: AgentStatusEnum,
        snapshot: AgentSnapshotPayloadSchema,
      },
    },
    async ({ agentId }) => {
      const snapshot = agentManager.getAgent(agentId);
      if (snapshot) {
        const structuredSnapshot = await serializeSnapshotWithMetadata(
          agentStorage,
          snapshot,
          childLogger,
        );
        return {
          content: [],
          structuredContent: ensureValidJson({
            status: snapshot.lifecycle,
            snapshot: structuredSnapshot,
          }),
        };
      }

      const record = await agentStorage.get(agentId);
      if (!record || record.internal) {
        throw new Error(`Agent ${agentId} not found`);
      }

      const structuredSnapshot = buildStoredAgentPayload(
        record,
        new Set(providerSnapshotManager.listRegisteredProviderIds()),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({
          status: structuredSnapshot.status,
          snapshot: structuredSnapshot,
        }),
      };
    },
  );

  registerTool(
    "list_agents",
    {
      title: "List agents",
      description: "List recent agents as compact metadata.",
      inputSchema: {
        includeArchived: z.boolean().optional().default(false),
        cwd: z.string().optional(),
        sinceHours: z
          .number()
          .int()
          .positive()
          .max(24 * 30)
          .optional()
          .default(48),
        statuses: z.array(AgentStatusEnum).optional(),
        limit: z.number().int().positive().max(200).optional().default(50),
      },
      outputSchema: {
        agents: z.array(AgentListItemPayloadSchema),
      },
    },
    async ({ includeArchived = false, cwd, sinceHours = 48, statuses, limit = 50 }) => {
      const callerCwd = callerAgentId ? resolveCallerAgent()?.cwd : undefined;
      const requestedCwd = cwd?.trim() ? expandUserPath(cwd) : callerCwd;
      const statusFilter = statuses && statuses.length > 0 ? new Set(statuses) : null;
      const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000;
      const liveSnapshots = agentManager.listAgents();
      const liveAgents = await Promise.all(
        liveSnapshots.map((snapshot) =>
          serializeSnapshotWithMetadata(agentStorage, snapshot, childLogger),
        ),
      );
      const liveIds = new Set(liveSnapshots.map((snapshot) => snapshot.id));
      const storedRecords = await agentStorage.list();
      const registeredProviderIds = new Set(providerSnapshotManager.listRegisteredProviderIds());
      const storedAgents = storedRecords
        .filter((record) => !record.internal && !liveIds.has(record.id))
        .filter((record) => includeArchived || !record.archivedAt)
        .filter(
          (record) =>
            includeArchived || isStoredAgentProviderAvailable(record, registeredProviderIds),
        )
        .map((record) => buildStoredAgentPayload(record, registeredProviderIds));
      const agents = [...liveAgents, ...storedAgents]
        .map(toAgentListItemPayload)
        .filter((agent) => !requestedCwd || isSameOrDescendantPath(requestedCwd, agent.cwd))
        .filter((agent) => !statusFilter || statusFilter.has(agent.status))
        .filter((agent) => !agent.archivedAt || resolveAgentListActivityTime(agent) >= sinceMs)
        .sort(compareAgentListItems)
        .slice(0, limit);

      return {
        content: [],
        structuredContent: ensureValidJson({ agents }),
      };
    },
  );

  registerTool(
    "cancel_agent",
    {
      title: "Cancel agent run",
      description: "Abort the agent's current run but keep the agent alive for future tasks.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      const { cancelled } = await cancelAgentRunCommand(
        { agentManager, logger: childLogger },
        agentId,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ success: cancelled }),
      };
    },
  );

  registerTool(
    "archive_agent",
    {
      title: "Archive agent",
      description:
        "Archive an agent (soft-delete). The agent is interrupted if running and removed from the active list.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await archiveAgentCommand(
        {
          agentManager,
          agentStorage,
          logger: childLogger,
        },
        agentId,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "kill_agent",
    {
      title: "Kill agent",
      description: "Terminate an agent session permanently.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await closeAgentCommand({ agentManager }, agentId);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_agent",
    {
      title: "Update agent",
      description: "Update an agent name, labels, and/or runtime settings.",
      inputSchema: {
        agentId: z.string(),
        name: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
        settings: UpdateAgentSettingsInputSchema.optional().describe(
          "Runtime settings to apply to the agent.",
        ),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, name, labels, settings }) => {
      if (settings?.modeId !== undefined) {
        await agentManager.setAgentMode(agentId, settings.modeId);
      }
      if (settings?.model !== undefined) {
        await agentManager.setAgentModel(agentId, settings.model);
      }
      if (settings?.thinkingOptionId !== undefined) {
        let thinkingOptionId = settings.thinkingOptionId;
        const agent = agentManager.getAgent(agentId);
        if (thinkingOptionId !== null && agent) {
          // Resolve against the model this call leaves the agent on.
          const targetModel =
            settings.model !== undefined ? (settings.model ?? undefined) : agent.config.model;
          thinkingOptionId = resolveEffortAgainstModels({
            requested: thinkingOptionId,
            models: await listProviderModels(agent.provider),
            model: targetModel,
          });
        }
        await agentManager.setAgentThinkingOption(agentId, thinkingOptionId);
      }
      if (settings?.features) {
        for (const [featureId, value] of Object.entries(settings.features)) {
          await agentManager.setAgentFeature(agentId, featureId, value);
        }
      }

      await updateAgentCommand({ agentManager }, { agentId, name, labels });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "rename_workspace",
    {
      title: "Rename workspace",
      description:
        "Rename a workspace by setting its user-visible title. Omit workspaceId to rename your current workspace.",
      inputSchema: {
        workspaceId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Workspace id to rename. Omit to rename your current workspace."),
        title: z
          .string()
          .trim()
          .min(1, "title is required")
          .describe("New user-visible workspace title."),
      },
      outputSchema: {
        success: z.boolean(),
        workspaceId: z.string(),
        title: z.string(),
      },
    },
    async ({ workspaceId: requestedWorkspaceId, title }) => {
      if (!options.workspaceRegistry) {
        throw new Error("Workspace registry is required to rename workspaces");
      }
      if (!options.emitWorkspaceUpdatesForWorkspaceIds) {
        throw new Error("Workspace update emitter is required to rename workspaces");
      }

      const workspaceId = resolveWorkspaceIdForRename(requestedWorkspaceId);
      const existing = await options.workspaceRegistry.get(workspaceId);
      if (!existing) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      if (existing.archivedAt) {
        throw new Error(`Workspace ${workspaceId} is archived`);
      }

      await options.workspaceRegistry.upsert({
        ...existing,
        title,
        updatedAt: new Date().toISOString(),
      });
      await options.emitWorkspaceUpdatesForWorkspaceIds([workspaceId]);

      return {
        content: [],
        structuredContent: ensureValidJson({
          success: true,
          workspaceId,
          title,
        }),
      };
    },
  );

  registerTool(
    "create_artifact",
    {
      title: "Create artifact",
      description:
        'Create an artifact: a self-contained HTML page (report, dashboard, visualization, mockup) generated by a dedicated background agent and shown in the client\'s Artifacts screen. Returns immediately with status "generating"; the artifact flips to "ready" (or "error") on its own, typically within a few minutes — no need to wait or poll. The generator always runs unattended (bypass/no approval prompts) and inherits your provider, model, effort, and mode unless overridden. The generator cannot see this conversation, so the description must carry all content, data, and requirements it needs.',
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "User-visible artifact title. Omit to derive one from the description's first line.",
          ),
        description: z
          .string()
          .trim()
          .min(1, "description is required")
          .describe(
            "Generation prompt. Self-contained: include all content, data, and requirements — the generator has no access to this conversation.",
          ),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Provider to generate with, as <provider> or <provider>/<model> (for example codex/gpt-5.4). Defaults to your own provider and model; call list_providers or list_models if uncertain.",
          ),
        model: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Model id for the generation agent. Takes precedence over a model embedded in provider.",
          ),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `${EFFORT_INPUT_DESCRIPTION} Defaults to your own effort option when generating with your provider.`,
          ),
        modeId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Permission mode id for the generation agent (see modes with isUnattended: true in list_providers or inspect_provider). Only unattended (bypass) modes are honored — anything else falls back to the provider's unattended default, so generation never stalls on approval prompts. Defaults to your own mode when generating with your provider.",
          ),
        projectId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Project to file the artifact under, as the project's root directory path. Defaults to your workspace's project.",
          ),
      },
      outputSchema: {
        artifactId: z.string(),
        name: z.string(),
        status: z.string(),
        provider: z.string(),
        model: z.string().nullable(),
        thinkingOptionId: z.string().nullable(),
        modeId: z.string().nullable(),
        projectId: z.string(),
        guidance: z.string(),
      },
    },
    async (input: {
      name?: string;
      description: string;
      provider?: string;
      model?: string;
      thinkingOptionId?: string;
      modeId?: string;
      projectId?: string;
    }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }

      const callerAgent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
      const { provider, model } = resolveArtifactProviderModel({
        providerArg: input.provider,
        modelArg: input.model,
        callerProvider: callerAgent?.provider,
        callerModel: callerAgent?.config.model,
      });
      const { thinkingOptionId, modeId } = resolveArtifactGenerationSettings({
        provider,
        thinkingOptionIdArg: input.thinkingOptionId,
        modeIdArg: input.modeId,
        callerProvider: callerAgent?.provider,
        callerThinkingOptionId: callerAgent?.config.thinkingOptionId,
        callerModeId: callerAgent?.config.modeId,
      });
      const name = input.name?.trim() || deriveArtifactName(input.description);

      const providerEntry = (await providerSnapshotManager.listProviders({ wait: true })).find(
        (entry) => entry.provider === provider,
      );
      if (!providerEntry?.enabled) {
        throw new Error(
          `Provider "${provider}" is not available. Call list_providers for options.`,
        );
      }

      const resolvedThinkingOptionId = resolveEffortOrDropInherited({
        requested: thinkingOptionId,
        explicit: Boolean(input.thinkingOptionId),
        models: providerEntry.models,
        model,
      });

      const projectId = await resolveArtifactProjectId({
        projectIdArg: input.projectId,
        callerWorkspaceId: callerAgent?.workspaceId,
        workspaceRegistry: options.workspaceRegistry,
        projectRegistry: options.projectRegistry,
      });

      const artifact = await artifactService.create({
        name,
        description: input.description,
        projectId,
        provider,
        ...(model ? { model } : {}),
        ...(resolvedThinkingOptionId ? { thinkingOptionId: resolvedThinkingOptionId } : {}),
        ...(modeId ? { modeId } : {}),
      });
      options.emitArtifactCreated?.(artifact);

      return {
        content: [],
        structuredContent: ensureValidJson({
          artifactId: artifact.id,
          name: artifact.name,
          status: artifact.status,
          provider,
          model: artifact.generationModel,
          thinkingOptionId: artifact.generationThinkingOptionId ?? null,
          modeId: artifact.generationModeId ?? null,
          projectId: artifact.projectId,
          guidance:
            'Generation runs unattended in the background; the artifact appears in the Artifacts screen and flips to "ready" when done. You do not need to wait or poll.',
        }),
      };
    },
  );

  registerTool(
    "list_artifacts",
    {
      title: "List artifacts",
      description:
        "List generated artifacts with their ids, status, and generation settings, optionally filtered by project.",
      inputSchema: {
        projectId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Filter by project root directory path. Omit to list every project."),
      },
      outputSchema: {
        artifacts: z.array(ArtifactToolSummarySchema),
      },
    },
    async ({ projectId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const artifacts = (await artifactService.list(projectId)).map(toArtifactToolSummary);
      return {
        content: [],
        structuredContent: ensureValidJson({ artifacts }),
      };
    },
  );

  registerTool(
    "inspect_artifact",
    {
      title: "Inspect artifact",
      description: "Inspect an artifact and its generation run history.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to inspect; call list_artifacts for ids."),
      },
      outputSchema: StoredArtifactSchema.shape,
    },
    async ({ artifactId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const record = await artifactService.inspect(artifactId);
      return {
        content: [],
        structuredContent: ensureValidJson(record),
      };
    },
  );

  registerTool(
    "update_artifact",
    {
      title: "Update artifact",
      description:
        "Edit an artifact's metadata — name, prompt, project, provider, model, effort — WITHOUT re-running generation. Call generate_artifact afterwards to re-generate with the new settings.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to edit; call list_artifacts for ids."),
        name: z.string().trim().min(1).optional().describe("New name."),
        description: z.string().trim().min(1).optional().describe("New generation prompt."),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New provider, as <provider> or <provider>/<model>."),
        model: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New model id (null to clear back to the provider default)."),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(`New effort (null to clear). ${EFFORT_INPUT_DESCRIPTION}`),
        projectId: z.string().trim().min(1).optional().describe("New project root directory path."),
      },
      outputSchema: ArtifactToolSummarySchema.shape,
    },
    async (input: ArtifactUpdateToolInput) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const existing = await requireArtifact(artifactService, input.artifactId);
      const targets = resolveArtifactUpdateTargets(input, existing);
      if (targets.provider) {
        const entry = (await providerSnapshotManager.listProviders({ wait: true })).find(
          (candidate) => candidate.provider === targets.provider,
        );
        if (!entry?.enabled) {
          throw new Error(
            `Provider "${targets.provider}" is not available. Call list_providers for options.`,
          );
        }
      }
      const effortModels =
        input.thinkingOptionId && targets.effortProvider
          ? await listProviderModels(targets.effortProvider)
          : [];
      const thinkingPatch = resolveArtifactUpdateEffort({
        requested: input.thinkingOptionId,
        models: effortModels,
        model: targets.effortModel,
      });
      const updated = await artifactService.update(
        buildArtifactUpdateServiceInput(input, targets, thinkingPatch),
      );
      options.emitArtifactUpdated?.(updated);
      return {
        content: [],
        structuredContent: ensureValidJson(toArtifactToolSummary(updated)),
      };
    },
  );

  registerTool(
    "generate_artifact",
    {
      title: "Generate artifact",
      description:
        "Re-run generation for an existing artifact using its stored settings (prompt, provider, model, effort). Edit those first via update_artifact. Generation runs unattended in the background.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to regenerate; call list_artifacts for ids."),
      },
      outputSchema: {
        ...ArtifactToolSummarySchema.shape,
        guidance: z.string(),
      },
    },
    async ({ artifactId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const existing = await requireArtifact(artifactService, artifactId);
      if (existing.status === "generating") {
        throw new Error(
          `Artifact ${artifactId} is already generating. Wait for it to finish or cancel it from the Artifacts screen first.`,
        );
      }
      const artifact = await artifactService.regenerate(artifactId);
      options.emitArtifactUpdated?.(artifact);
      return {
        content: [],
        structuredContent: ensureValidJson({
          ...toArtifactToolSummary(artifact),
          guidance:
            'Generation runs unattended in the background; the artifact appears in the Artifacts screen and flips to "ready" when done. You do not need to wait or poll.',
        }),
      };
    },
  );

  registerTool(
    "list_terminals",
    {
      title: "List terminals",
      description: "List terminals for a working directory or across all working directories.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory. Defaults to your current working directory."),
        all: z.boolean().optional().describe("List terminals across all working directories."),
      },
      outputSchema: {
        terminals: z.array(TerminalSummarySchema),
      },
    },
    async ({ cwd, all }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const terminals = all
        ? (
            await Promise.all(
              terminalManager.listDirectories().map(async (directory) =>
                (await terminalManager.getTerminals(directory)).map((terminal) => ({
                  id: terminal.id,
                  name: terminal.name,
                  cwd: terminal.cwd,
                })),
              ),
            )
          ).flat()
        : (await terminalManager.getTerminals(resolveScopedCwd(cwd, { required: true }))).map(
            (terminal) => ({
              id: terminal.id,
              name: terminal.name,
              cwd: terminal.cwd,
            }),
          );

      return {
        content: [],
        structuredContent: ensureValidJson({ terminals }),
      };
    },
  );

  registerTool(
    "create_terminal",
    {
      title: "Create terminal",
      description: "Create a terminal session for a working directory.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory. Defaults to your current working directory."),
        name: z.string().optional().describe("Optional terminal name."),
      },
      outputSchema: TerminalSummarySchema.shape,
    },
    async ({ cwd, name }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      const workspaceId = await resolveTerminalWorkspaceId(resolvedCwd);

      const terminal = await terminalManager.createTerminal({
        cwd: resolvedCwd,
        workspaceId,
        ...(name?.trim() ? { name: name.trim() } : {}),
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          id: terminal.id,
          name: terminal.name,
          cwd: terminal.cwd,
        }),
      };
    },
  );

  registerTool(
    "kill_terminal",
    {
      title: "Kill terminal",
      description: "Kill an existing terminal session.",
      inputSchema: {
        terminalId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ terminalId }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const terminal = terminalManager.getTerminal(terminalId);
      if (!terminal) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      terminal.kill();

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "capture_terminal",
    {
      title: "Capture terminal",
      description: "Capture plain-text terminal output lines from a terminal session.",
      inputSchema: {
        terminalId: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        scrollback: z.boolean().optional(),
        stripAnsi: z.boolean().optional().default(true),
      },
      outputSchema: {
        terminalId: z.string(),
        lines: z.array(z.string()),
        totalLines: z.number().int().nonnegative(),
      },
    },
    async ({ terminalId, start, end, scrollback, stripAnsi = true }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      if (!terminalManager.getTerminal(terminalId)) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      const capture = await terminalManager.captureTerminal(terminalId, {
        start: scrollback ? 0 : start,
        end,
        stripAnsi,
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          terminalId,
          lines: capture.lines,
          totalLines: capture.totalLines,
        }),
      };
    },
  );

  registerTool(
    "send_terminal_keys",
    {
      title: "Send terminal keys",
      description: "Send literal text or special key tokens to a terminal session.",
      inputSchema: {
        terminalId: z.string(),
        keys: z.string(),
        literal: z.boolean().optional(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ terminalId, keys, literal = false }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const terminal = terminalManager.getTerminal(terminalId);
      if (!terminal) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      terminal.send({
        type: "input",
        data: resolveTerminalKeyToken(keys, literal),
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  // Build a new-agent schedule config from either a personality binding or a
  // raw provider. A personality is validated + resolved now (to fill the
  // required provider field and fail fast), and its name is stored so each run
  // re-resolves it authoritatively.
  const buildScheduleNewAgentConfig = async (input: {
    provider?: string;
    personality?: string;
    cwd?: string;
    thinkingOptionId?: string;
  }) => {
    const personalityName = input.personality?.trim();
    if (personalityName) {
      const brain = await resolveCreateAgentBrain({
        personalityName,
        providerOverride: input.provider,
        modeOverride: undefined,
        thinkingOverride: input.thinkingOptionId,
        cwd: input.cwd,
      });
      const baseTarget = resolveNewAgentScheduleTarget({
        provider: brain.providerModel,
        cwd: input.cwd,
      });
      return {
        ...baseTarget.config,
        personality: personalityName,
        ...(brain.modeId !== undefined ? { modeId: brain.modeId } : {}),
        ...(brain.thinkingOptionId !== undefined
          ? { thinkingOptionId: brain.thinkingOptionId }
          : {}),
      };
    }

    const baseTarget = resolveNewAgentScheduleTarget({ provider: input.provider, cwd: input.cwd });
    const config: typeof baseTarget.config & { thinkingOptionId?: string } = {
      ...baseTarget.config,
    };
    const inheritedEffort =
      typeof config.thinkingOptionId === "string" ? config.thinkingOptionId : undefined;
    const requestedEffort = input.thinkingOptionId ?? inheritedEffort;
    if (requestedEffort) {
      const resolved = resolveEffortOrDropInherited({
        requested: requestedEffort,
        explicit: Boolean(input.thinkingOptionId),
        models: await listProviderModels(config.provider),
        model: config.model,
      });
      if (resolved === undefined) {
        delete config.thinkingOptionId;
      } else {
        config.thinkingOptionId = resolved;
      }
    }
    return config;
  };

  registerTool(
    "create_schedule",
    {
      title: "Create schedule",
      description: "Create a recurring schedule that starts a new agent on a cron cadence.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        cron: z.string().trim().min(1, "cron is required"),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("IANA time zone for the cron cadence. For example: America/New_York."),
        name: z.string().optional(),
        provider: AgentProviderEnum.optional().describe(
          "Provider, or provider/model (for example: codex or codex/gpt-5.4). Required unless `personality` is given.",
        ),
        personality: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Bind this schedule to an Agent Personality by name. Each run re-resolves it against the run workspace and hard-fails if it's unavailable. Requires the Orchestrator role when called by an agent.",
          ),
        cwd: z.string().optional(),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `${EFFORT_INPUT_DESCRIPTION} Defaults to your own effort option when scheduling your provider.`,
          ),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({
      prompt,
      cron,
      timezone,
      name,
      provider,
      personality,
      cwd,
      thinkingOptionId,
      maxRuns,
      expiresIn,
    }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const config = await buildScheduleNewAgentConfig({
        provider,
        personality,
        cwd,
        thinkingOptionId,
      });

      const expiresAt = buildScheduleExpiry(expiresIn);
      const schedule = await scheduleService.createOrReplace({
        prompt: prompt.trim(),
        cadence: buildCronScheduleCadence({
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
        target: { type: "new-agent", config },
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  registerTool(
    "create_heartbeat",
    {
      title: "Create heartbeat",
      description: "Create a recurring heartbeat that sends you a prompt on a cron cadence.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        cron: z.string().trim().min(1, "cron is required"),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("IANA time zone for the cron cadence. For example: America/New_York."),
        name: z.string().optional(),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({ prompt, cron, timezone, name, maxRuns, expiresIn }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }
      if (!callerAgentId) {
        throw new Error("create_heartbeat requires an agent-scoped session");
      }
      resolveCallerAgent();

      const expiresAt = buildScheduleExpiry(expiresIn);
      const schedule = await scheduleService.createOrReplace({
        prompt: prompt.trim(),
        cadence: buildCronScheduleCadence({
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
        target: { type: "agent", agentId: callerAgentId },
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  registerTool(
    "list_schedules",
    {
      title: "List schedules",
      description: "List all schedules managed by the daemon.",
      inputSchema: {},
      outputSchema: {
        schedules: z.array(ScheduleSummarySchema),
      },
    },
    async () => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedules = (await scheduleService.list()).map((schedule) =>
        toScheduleSummary(schedule),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ schedules }),
      };
    },
  );

  registerTool(
    "inspect_schedule",
    {
      title: "Inspect schedule",
      description: "Inspect a schedule and its run history.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedule = await scheduleService.inspect(id);
      return {
        content: [],
        structuredContent: ensureValidJson(schedule),
      };
    },
  );

  registerTool(
    "pause_schedule",
    {
      title: "Pause schedule",
      description: "Pause an active schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.pause(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "resume_schedule",
    {
      title: "Resume schedule",
      description: "Resume a paused schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.resume(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "delete_schedule",
    {
      title: "Delete schedule",
      description: "Delete a schedule permanently.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.delete(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_schedule",
    {
      title: "Update schedule",
      description:
        "Update an existing schedule. Only provided fields are changed; omitted fields remain unchanged.",
      inputSchema: {
        id: z.string(),
        every: z.string().optional().describe("New interval duration string (e.g. 5m, 1h)."),
        cron: z.string().optional().describe("New cron expression."),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "IANA time zone for cron cadence; requires cron. For example: America/New_York.",
          ),
        name: z.string().nullable().optional().describe("New name (null to clear)."),
        prompt: z.string().trim().min(1).optional().describe("New prompt text."),
        maxRuns: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("New max runs limit (null to clear)."),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New provider for new-agent target."),
        personality: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(
            "Bind (or, with null, unbind) an Agent Personality by name for the new-agent target. Re-resolved at each run.",
          ),
        model: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New model for new-agent target (null to clear)."),
        mode: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New mode for new-agent target (null to clear)."),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(`New effort for new-agent target (null to clear). ${EFFORT_INPUT_DESCRIPTION}`),
        cwd: z.string().trim().min(1).optional().describe("New cwd for new-agent target."),
        expiresIn: z
          .string()
          .optional()
          .describe("New relative expiry duration (for example: 1h, 2d)."),
        clearExpires: z.boolean().optional().describe("Clear any schedule expiry."),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async (input) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      let resolvedInput = input;
      if (typeof input.thinkingOptionId === "string") {
        // Resolve against the provider/model the schedule ends up with —
        // either from this same update or from the stored target.
        const existing = await scheduleService.inspect(input.id);
        const existingConfig =
          existing?.target.type === "new-agent" ? existing.target.config : undefined;
        const providerModelPatch = resolveScheduleUpdateProviderAndModel({
          provider: input.provider,
          model: input.model,
        });
        const provider = providerModelPatch.provider ?? existingConfig?.provider;
        const model =
          providerModelPatch.model !== undefined
            ? (providerModelPatch.model ?? undefined)
            : existingConfig?.model;
        if (provider) {
          resolvedInput = {
            ...input,
            thinkingOptionId: resolveEffortAgainstModels({
              requested: input.thinkingOptionId,
              models: await listProviderModels(provider as AgentProvider),
              model,
            }),
          };
        }
      }

      const schedule = await scheduleService.update(buildScheduleUpdateInput(resolvedInput));

      return {
        content: [],
        structuredContent: ensureValidJson(schedule),
      };
    },
  );

  registerTool(
    "schedule_logs",
    {
      title: "Schedule logs",
      description: "Get the run history (logs) for a schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        runs: z.array(ScheduleRunSchema),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const runs = await scheduleService.logs(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ runs }),
      };
    },
  );

  registerTool(
    "list_providers",
    {
      title: "List providers",
      description: "List configured agent providers, availability, and their modes.",
      inputSchema: {},
      outputSchema: {
        providers: z.array(ProviderSummarySchema),
      },
    },
    async () => {
      const providers = (await providerSnapshotManager.listProviders({ wait: true })).map(
        toProviderSummary,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ providers }),
      };
    },
  );

  registerTool(
    "list_models",
    {
      title: "List models",
      description: "List models for an agent provider.",
      inputSchema: {
        provider: AgentProviderEnum,
      },
      outputSchema: {
        provider: z.string(),
        models: z.array(AgentModelSchema),
      },
    },
    async ({ provider }) => {
      const models = await providerSnapshotManager.listModels({
        provider,
        wait: true,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider,
          models,
        }),
      };
    },
  );

  registerTool(
    "inspect_provider",
    {
      title: "Inspect provider",
      description:
        "Inspect compact provider capabilities for orchestration, including modes and draft feature settings. Use list_models for the full model list.",
      inputSchema: inspectProviderInputSchema,
      outputSchema: {
        provider: AgentProviderEnum,
        label: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        enabled: z.boolean(),
        status: z.string(),
        modes: z.array(ProviderModeSchema).nullish(),
        selectedModel: z.string().nullable(),
        features: z.array(AgentFeatureSchema),
      },
    },
    async ({ provider, cwd, settings }) => {
      const resolvedProviderModel = resolveScheduleProviderAndModel({
        provider,
        defaultProvider: provider,
      });
      const providerId = resolvedProviderModel.provider;
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      const entry = await providerSnapshotManager.getProvider({
        cwd: resolvedCwd,
        provider: providerId,
        wait: true,
      });
      const summary = toProviderSummary(entry);
      if (!entry.enabled) {
        throw new Error(`Provider '${providerId}' is disabled`);
      }
      if (entry.status !== "ready") {
        throw new Error(entry.error ?? `Provider '${providerId}' is unavailable`);
      }
      const selectedModel = settings?.model ?? resolvedProviderModel.model;
      const features = await agentManager.listDraftFeatures({
        provider: providerId,
        cwd: resolvedCwd,
        ...(settings?.modeId ? { modeId: settings.modeId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(settings?.thinkingOptionId ? { thinkingOptionId: settings.thinkingOptionId } : {}),
        ...(settings?.features ? { featureValues: settings.features } : {}),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider: providerId,
          label: summary.label,
          description: summary.description,
          enabled: summary.enabled,
          status: summary.status,
          modes: summary.modes,
          selectedModel: selectedModel ?? null,
          features,
        }),
      };
    },
  );

  registerTool(
    "list_worktrees",
    {
      title: "List worktrees",
      description: "List Otto-managed git worktrees for a repository.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional repository cwd. Defaults to your current working directory."),
      },
      outputSchema: {
        worktrees: z.array(WorktreeSummarySchema),
      },
    },
    async ({ cwd }) => {
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      if (!options.workspaceGitService) {
        throw new Error("WorkspaceGitService is required to list worktrees");
      }
      const worktrees = await listOttoWorktreesCommand(
        { workspaceGitService: options.workspaceGitService },
        {
          cwd: resolvedCwd,
          reason: "mcp:list-worktrees",
        },
      );

      return {
        content: [],
        structuredContent: ensureValidJson({ worktrees }),
      };
    },
  );

  registerTool(
    "create_worktree",
    {
      title: "Create worktree",
      description:
        "Create a Otto-managed git worktree. Branch off a new branch, check out an existing branch, or check out a GitHub PR.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository directory. Defaults to the agent's cwd."),
        target: AgentCreateWorktreeTargetInputSchema.describe("What the worktree should contain."),
      },
      outputSchema: {
        branchName: z.string(),
        worktreePath: z.string(),
        workspaceId: z.string(),
      },
    },
    async ({ cwd, target }) => {
      const repoRoot = resolveScopedCwd(cwd, { required: true });
      const commandResult = await createOttoWorktreeCommand(
        {
          ottoHome: options.ottoHome,
          worktreesRoot: options.worktreesRoot,
          createOttoWorktreeWorkflow: options.createOttoWorktree,
        },
        createMcpWorktreeCommandInput(repoRoot, target),
      );
      if (!commandResult.ok) {
        throw new WorktreeRequestError(commandResult.error);
      }
      const { worktree, workspace } = commandResult.createdWorktree;
      await options.workspaceGitService?.listWorktrees?.(repoRoot, {
        force: true,
        reason: "mcp:create-worktree",
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          branchName: worktree.branchName,
          worktreePath: worktree.worktreePath,
          workspaceId: workspace.workspaceId,
        }),
      };
    },
  );

  registerTool(
    "archive_worktree",
    {
      title: "Archive worktree",
      description: "Delete a Otto-managed git worktree.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional repository cwd. Defaults to your current working directory."),
        worktreePath: z.string().optional(),
        worktreeSlug: z.string().optional(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ cwd, worktreePath, worktreeSlug }) => {
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      if (!worktreePath && !worktreeSlug) {
        throw new Error("worktreePath or worktreeSlug is required");
      }
      if (!options.workspaceGitService) {
        throw new Error("WorkspaceGitService is required to archive worktrees");
      }
      const repoRoot = await options.workspaceGitService.resolveRepoRoot(resolvedCwd);

      const result = await archiveCommand(
        archiveWorktreeDependencies(options, {
          agentManager,
          agentStorage,
          terminalManager: terminalManager ?? null,
          logger: childLogger,
        }),
        {
          requestId: "mcp:archive_worktree",
          repoRoot,
          worktreePath,
          worktreeSlug,
          // This tool archives every workspace on the directory, then removes the
          // directory. Disk removal is derived from scope + last-reference.
          scope: "worktree",
        },
      );
      if (!result.ok) {
        throw new Error(result.message);
      }
      await options.workspaceGitService.listWorktrees(repoRoot, {
        force: true,
        reason: "mcp:archive-worktree",
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "get_agent_activity",
    {
      title: "Get agent activity",
      description: "Return recent agent timeline entries as a curated summary.",
      inputSchema: {
        agentId: z.string(),
        limit: z
          .number()
          .optional()
          .describe("Optional limit for number of activities to include (most recent first)."),
      },
      outputSchema: {
        agentId: z.string(),
        updateCount: z.number(),
        currentModeId: z.string().nullable(),
        content: z.string(),
      },
    },
    async ({ agentId, limit }) => {
      await ensureAgentLoaded(agentId, {
        agentManager,
        agentStorage,
        logger: childLogger,
      });
      const timeline = agentManager.getTimeline(agentId);
      const snapshot = agentManager.getAgent(agentId);

      const selection = selectItemsByProjectedLimit({
        items: timeline,
        direction: "tail",
        limit: limit ?? 0,
      });
      const curatedContent = curateAgentActivity(selection.items);
      const { totalProjected, shownProjected } = selection;

      const noun = totalProjected === 1 ? "activity" : "activities";
      const countHeader =
        limit && shownProjected < totalProjected
          ? `Showing ${shownProjected} of ${totalProjected} ${noun} (limited to ${limit})`
          : `Showing all ${totalProjected} ${noun}`;

      const contentWithCount = `${countHeader}\n\n${curatedContent}`;

      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId,
          updateCount: timeline.length,
          currentModeId: snapshot?.currentModeId ?? null,
          content: contentWithCount,
        }),
      };
    },
  );

  registerTool(
    "set_agent_mode",
    {
      title: "Set agent session mode",
      description:
        "Switch the agent's session mode (plan, bypassPermissions, read-only, auto, etc.).",
      inputSchema: {
        agentId: z.string(),
        modeId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
        newMode: z.string(),
      },
    },
    async ({ agentId, modeId }) => {
      const result = await setAgentModeCommand({ agentManager }, { agentId, modeId });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true, newMode: result.modeId }),
      };
    },
  );

  registerTool(
    "list_pending_permissions",
    {
      title: "List pending permissions",
      description:
        "Return all pending permission requests across all agents with the normalized payloads.",
      inputSchema: {},
      outputSchema: {
        permissions: z.array(
          z.object({
            agentId: z.string(),
            status: AgentStatusEnum,
            request: AgentPermissionRequestPayloadSchema,
          }),
        ),
      },
    },
    async () => {
      const permissions = agentManager.listAgents().flatMap((agent) => {
        const payload = toAgentPayload(agent);
        return payload.pendingPermissions.map((request) => ({
          agentId: agent.id,
          status: payload.status,
          request: sanitizePermissionRequest(request),
        }));
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ permissions }),
      };
    },
  );

  registerTool(
    "respond_to_permission",
    {
      title: "Respond to permission",
      description:
        "Approve or deny a pending permission request with an AgentManager-compatible response payload.",
      inputSchema: {
        agentId: z.string(),
        requestId: z.string(),
        response: AgentPermissionResponseSchema,
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, requestId, response }) => {
      await respondToAgentPermission({
        agentManager,
        agentId,
        requestId,
        response,
        logger: childLogger,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  // ── Orchestration runtime tools ───────────────────────────────────────────
  // wait_for_agents: the multi-agent gather barrier the daemon lacked. Useful on
  // its own (a conductor hand-tracking children) and reused by the run runtime.
  registerTool(
    "wait_for_agents",
    {
      title: "Wait for agents",
      description:
        "Block until every listed agent reaches a terminal state (idle/error) or needs permission, then return each one's final message. The gather barrier for fan-out work.",
      inputSchema: {
        agentIds: z.array(z.string()).min(1).max(32),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(30 * 60)
          .optional(),
      },
      outputSchema: {
        results: z.array(
          z.object({
            agentId: z.string(),
            status: AgentStatusEnum,
            lastMessage: z.string().nullable(),
          }),
        ),
      },
    },
    async ({ agentIds, timeoutSeconds }: { agentIds: string[]; timeoutSeconds?: number }) => {
      const controller = new AbortController();
      const timer = timeoutSeconds
        ? setTimeout(() => controller.abort(new Error("wait timeout")), timeoutSeconds * 1000)
        : null;
      try {
        const results = await Promise.all(
          agentIds.map(async (id) => {
            try {
              const result = await agentManager.waitForAgentEvent(id, {
                signal: controller.signal,
                waitForActive: true,
              });
              const lastMessage =
                result.lastMessage ?? (await agentManager.getLastAssistantMessage(id));
              return { agentId: id, status: result.status, lastMessage: lastMessage ?? null };
            } catch {
              const snapshot = agentManager.getAgent(id);
              return { agentId: id, status: snapshot?.lifecycle ?? "idle", lastMessage: null };
            }
          }),
        );
        return { content: [], structuredContent: ensureValidJson({ results }) };
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
  );

  if (runService) {
    const activeRunService = runService;

    // Resolve (and cache) which active-team member fills a role for this run.
    const roleMemberCache = new Map<string, AgentPersonality | null>();
    const resolveRoleMember = (role: string): AgentPersonality | null => {
      const cached = roleMemberCache.get(role);
      if (cached !== undefined) {
        return cached;
      }
      const member = resolveTeamRoleMember({
        team: getActiveAgentTeam(readAgentTeams?.()),
        roster: getPersonalityRoster(),
        role,
      });
      roleMemberCache.set(role, member);
      return member;
    };

    // Spawn one candidate child agent from a personality, parented to the
    // conductor, in the conductor's workspace. Mirrors the create_agent spawn.
    const spawnRunChild = async (input: {
      personalityName: string;
      task: string;
      title: string;
      cwd: string;
      workspaceId?: string;
    }): Promise<string> => {
      const brain = await resolveCreateAgentBrain({
        personalityName: input.personalityName,
        providerOverride: undefined,
        modeOverride: undefined,
        thinkingOverride: undefined,
        cwd: input.cwd,
      });
      const personalityConfig = buildPersonalityAgentConfig(brain);
      const { snapshot } = await createAgentCommand(
        {
          agentManager,
          agentStorage,
          logger: childLogger,
          ottoHome: options.ottoHome,
          worktreesRoot: options.worktreesRoot,
          terminalManager,
          providerSnapshotManager,
          createOttoWorktree: options.createOttoWorktree,
          ...(options.ensureWorkspaceForCreate
            ? { ensureWorkspaceForCreate: options.ensureWorkspaceForCreate }
            : {}),
        },
        {
          kind: "mcp",
          provider: brain.providerModel,
          ...(personalityConfig ? { config: personalityConfig } : {}),
          title: input.title,
          initialPrompt: input.task,
          cwd: input.cwd,
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          thinking: brain.thinkingOptionId,
          mode: brain.modeId,
          background: true,
          notifyOnFinish: false,
          detached: false,
          ...(callerAgentId ? { callerAgentId } : {}),
          callerContext,
        },
      );
      return snapshot.id;
    };

    registerTool(
      "start_run",
      {
        title: "Start orchestration run",
        description:
          "Declare a multi-agent plan the daemon executes as a Run: typed phases (research/plan/implement/design/verify/gate/deliver), fanning out candidates, judging them, looping until enough pass, and pausing at gates for approval. Each phase dispatches to the active team's member for its role — fails loudly if the team lacks one. Blocks until the run finishes (returning `result`, the final deliverable, which you should relay to the user) or pauses at a gate (returning a `note` to relay). Prefer this over hand-spawning and tracking agents yourself.",
        inputSchema: RunPlanSchema,
        outputSchema: {
          runId: z.string(),
          status: z.string(),
          title: z.string(),
          phaseCount: z.number(),
          result: z.string().optional(),
          note: z.string().optional(),
          error: z.string().optional(),
        },
      },
      async (plan: unknown) => {
        const parsedPlan = RunPlanSchema.parse(plan);
        const conductor = resolveCallerAgent();
        const cwd = resolveScopedCwd(undefined);
        const workspaceId = conductor?.workspaceId;

        const spawnPort: RunSpawnPort = {
          resolveRole: async (role) => {
            const member = resolveRoleMember(role);
            return member ? { personalityId: member.id } : null;
          },
          spawn: async (spawnInput) => {
            const member = spawnInput.role ? resolveRoleMember(spawnInput.role) : null;
            if (!member) {
              throw new Error(`No active-team member fills role "${spawnInput.role ?? "?"}"`);
            }
            const agentId = await spawnRunChild({
              personalityName: member.name,
              task: spawnInput.task,
              title: `${spawnInput.role ?? spawnInput.phaseType}: ${spawnInput.phaseId}`,
              cwd,
              ...(workspaceId ? { workspaceId } : {}),
            });
            return { agentId, personalityId: member.id };
          },
          awaitAgent: async ({ agentId, signal }) => {
            try {
              // Wait for the whole subtree to settle, not just the worker's first
              // idle — a worker that spawns its own helpers gets re-invoked when
              // they finish and writes its real answer in a later turn.
              const result = await agentManager.waitForAgentFullySettled(agentId, { signal });
              const finalMessage =
                result.lastMessage ?? (await agentManager.getLastAssistantMessage(agentId));
              return { finalMessage: finalMessage ?? null, failed: result.status === "error" };
            } catch {
              return { finalMessage: null, failed: true };
            }
          },
        };

        // Record the active team on the run so the Runs display can filter by it.
        const activeTeam = getActiveAgentTeam(readAgentTeams?.());
        const { run, settled } = activeRunService.startRun({
          plan: parsedPlan,
          spawnPort,
          ...(callerAgentId ? { conductorAgentId: callerAgentId } : {}),
          cwd,
          ...(workspaceId ? { workspaceId } : {}),
          ...(activeTeam ? { teamId: activeTeam.id, teamName: activeTeam.name } : {}),
        });
        // Block until the run settles or parks at a gate, so the conductor comes
        // back with the actual deliverable to relay — not just a fire-and-forget id.
        const outcome = await activeRunService.settleOrPause({ runId: run.id, settled });
        const result = summarizeRunOutput(outcome);
        return {
          content: [],
          structuredContent: ensureValidJson({
            runId: outcome.id,
            status: outcome.status,
            title: outcome.title,
            phaseCount: outcome.phases.length,
            ...(result ? { result } : {}),
            ...(outcome.status === "paused"
              ? {
                  note: "A gate is awaiting approval. Approve or reject it in the Runs screen, then the run continues.",
                }
              : {}),
            ...(outcome.error ? { error: outcome.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "get_run_status",
      {
        title: "Get run status",
        description:
          "Return the current projection of an orchestration run — its phases, statuses, and structured judge verdicts.",
        inputSchema: {
          runId: z.string(),
        },
      },
      async ({ runId }: { runId: string }) => {
        const run = activeRunService.getRun(runId);
        if (!run) {
          throw new Error(`Run ${runId} not found`);
        }
        return { content: [], structuredContent: ensureValidJson({ run }) };
      },
    );
  }

  return toCatalog();
}

type McpCreateWorktreeTarget =
  | { kind: "branch-off"; worktreeSlug?: string; branchName?: string; baseBranch?: string }
  | { kind: "checkout-branch"; branch: string }
  | { kind: "checkout-pr"; githubPrNumber: number };

interface ArchiveWorktreeCommandContext {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager | null;
  logger: Logger;
}

function archiveWorktreeDependencies(
  options: OttoToolHostDependencies,
  context: ArchiveWorktreeCommandContext,
): ArchiveCommandDependencies {
  if (!options.github) {
    throw new Error("GitHub service is required to archive worktrees");
  }
  if (!options.workspaceGitService) {
    throw new Error("WorkspaceGitService is required to archive worktrees");
  }
  if (!options.archiveWorkspaceRecord) {
    throw new Error("Workspace registry archiver is required to archive worktrees");
  }
  if (!options.findWorkspaceIdForCwd) {
    throw new Error("Workspace resolver is required to archive worktrees");
  }
  if (!options.listActiveWorkspaces) {
    throw new Error("Active workspace lister is required to archive worktrees");
  }
  if (!options.emitWorkspaceUpdatesForWorkspaceIds) {
    throw new Error("Workspace update emitter is required to archive worktrees");
  }
  if (!options.markWorkspaceArchiving) {
    throw new Error("Workspace archiving marker is required to archive worktrees");
  }
  if (!options.clearWorkspaceArchiving) {
    throw new Error("Workspace archiving clearer is required to archive worktrees");
  }
  return {
    ottoHome: options.ottoHome,
    ottoWorktreesBaseRoot: options.worktreesRoot,
    github: options.github,
    workspaceGitService: options.workspaceGitService,
    agentManager: context.agentManager,
    agentStorage: context.agentStorage,
    findWorkspaceIdForCwd: options.findWorkspaceIdForCwd,
    listActiveWorkspaces: options.listActiveWorkspaces,
    archiveWorkspaceRecord: options.archiveWorkspaceRecord,
    emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
    markWorkspaceArchiving: options.markWorkspaceArchiving,
    clearWorkspaceArchiving: options.clearWorkspaceArchiving,
    killTerminalsForWorkspace: (workspaceId: string) =>
      killTerminalsForWorkspace(
        {
          terminalManager: context.terminalManager,
          sessionLogger: context.logger,
        },
        workspaceId,
      ),
    sessionLogger: context.logger,
  };
}

function createMcpWorktreeCommandInput(
  repoRoot: string,
  target: McpCreateWorktreeTarget,
): CreateOttoWorktreeCommandInput {
  const base = { cwd: repoRoot } as const;
  switch (target.kind) {
    case "branch-off":
      return {
        ...base,
        worktreeSlug: target.worktreeSlug,
        branchName: target.branchName,
        action: "branch-off",
        ...(target.baseBranch ? { refName: target.baseBranch } : {}),
      };
    case "checkout-branch":
      return { ...base, action: "checkout", refName: target.branch };
    case "checkout-pr":
      return { ...base, action: "checkout", githubPrNumber: target.githubPrNumber };
    default:
      throw new Error("unreachable");
  }
}
