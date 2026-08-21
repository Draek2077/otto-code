import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { Logger } from "pino";

import type { AgentMode, AgentModelDefinition, AgentProvider } from "../agent-sdk-types.js";
import type { AgentManager } from "../agent-manager.js";
import { resolveEffortOption } from "../effort-levels.js";
import { resolvePersonality, type ResolvedPersonalitySnapshot } from "../agent-personalities.js";
import type { PersonalityMemoryService } from "../personality-memory/personality-memory-service.js";
import type { ProjectKnowledgeService } from "../project-knowledge/project-knowledge-service.js";
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
import {
  AgentProfileSchema,
  type AgentPersonality,
  type AgentProfile,
} from "@otto-code/protocol/messages";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import { ottoToolGroupForName, type OttoToolGroup } from "@otto-code/protocol/provider-config";
import {
  getOrchestrationPolicyFromLabels,
  getOutputFieldsFromLabels,
  getQueryToolsFromLabels,
  getToolGroupsFromLabels,
} from "@otto-code/protocol/agent-labels";
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

const profileSpinnerSchema = z.object({ glowA: z.string(), glowB: z.string() }).passthrough();
const profileVoiceSchema = z
  .object({ provider: z.string(), model: z.string(), name: z.string() })
  .passthrough();
import type { AgentStorage } from "../agent-storage.js";
import { ensureAgentLoaded } from "../agent-loading.js";
import { isStoredAgentProviderAvailable } from "../../persistence-hooks.js";
import {
  archiveByScope,
  killTerminalsForWorkspace,
  requireActiveWorkspaceForArchive,
  type ArchiveDependencies,
} from "../../workspace-archive-service.js";
import {
  createAgentCommand,
  type CreateAgentCommandDependencies,
  type CreateAgentFromMcpInput,
} from "../create-agent/create.js";
import { RunPlanSchema } from "@otto-code/protocol/orchestration";
import {
  type WorkspaceAccess,
  isOttoToolAllowedForAccess,
  resolveWorkspaceAccess,
} from "../workspace-access.js";
import { summarizeRunOutput } from "../../orchestration/run-engine.js";
import { attachStartRunLifecycle } from "../../orchestration/start-run-lifecycle.js";
import {
  type NodeOutputStore,
  compileOutputToolInputShape,
  validateNodeOutput,
} from "../../orchestration/node-output.js";
import { executeQueryTool, queryToolName } from "../../orchestration/node-query-tools.js";
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
import {
  formatSystemNotificationPrompt,
  sendPromptToAgent,
  setupFinishNotification,
} from "../agent-prompt.js";
import { respondToAgentPermission } from "../permission-response.js";
import {
  archiveAgentCommand,
  cancelAgentRunCommand,
  closeAgentCommand,
  setAgentModeCommand,
  updateAgentCommand,
} from "../lifecycle-command.js";
import type { ForgeService } from "../../../services/github-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type {
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../../workspace-registry.js";
import { WorktreeRequestError } from "../../worktree-errors.js";
import { resolveWorktreeSourceCwd } from "../../workspace-source.js";
import {
  archiveCommand,
  type ArchiveCommandDependencies,
  createOttoWorktreeCommand,
  type CreateOttoWorktreeCommandInput,
  listOttoWorktreesCommand,
} from "../../worktree/commands.js";
import { truncateHeadTail } from "../../../utils/truncate-head-tail.js";
import { registerBrowserTools } from "../../browser-tools/tools.js";
import type { BrowserToolsBroker } from "../../browser-tools/broker.js";
import { registerPreviewTools } from "../../preview/preview-tools.js";
import type { DevServerManager } from "../../preview/dev-server-manager.js";
import type { ArtifactService } from "../../artifact/artifact-service.js";
import type { ActivityIncrementFn } from "../../activity-stats/activity-stats-store.js";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { StoredArtifactSchema } from "@otto-code/protocol/artifacts/types";
import { WIDGET_MAX_LOADING_MESSAGES } from "@otto-code/protocol/widgets/types";
import { sanitizeWidgetFragment } from "../../widget/widget-fragment.js";
import { WIDGET_CONTRACT_MODULES, readWidgetContract } from "../../widget/widget-contract.js";
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
   * Daemon-owned orchestration runtime. Enables the start_orchestration /
   * get_orchestration_status / wait_for_chats tools so an orchestrator chat can declare a multi-chat
   * plan the daemon executes. Absent on hosts that don't wire orchestration.
   */
  runService?: RunService | null;
  providerSnapshotManager: ProviderSnapshotManager;
  daemonConfigStore?: Pick<DaemonConfigStore, "get">;
  /**
   * Reads the live Agent Personalities roster from the daemon config. Enables
   * chat creation by personality in create_chat and the list_personalities tool. Absent
   * on hosts that don't wire personalities.
   */
  readAgentPersonalities?: () => AgentPersonality[];
  /**
   * Reads the live Agent Teams section (teams + active team id) from the
   * daemon config. Lets create_chat stamp the frozen team layer onto member
   * spawns. Absent on hosts that don't wire teams - spawns are then teamless,
   * exactly the no-active-team behavior.
   */
  readAgentTeams?: () => AgentTeamsConfigView | undefined;
  /**
   * Per-personality accrued lessons. Enables remember_lesson / review_lessons /
   * revise_lesson. Absent on hosts that don't wire personality memory, in which
   * case the tools are never registered at all - a tool that can only fail is
   * worse than a missing one.
   */
  personalityMemory?: PersonalityMemoryService | null;
  /** Repository-scoped durable knowledge, injected for every agent in the repo. */
  projectKnowledge?: ProjectKnowledgeService | null;
  github?: ForgeService;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot" | "invalidateAuxiliaryReads"
  >;
  findWorkspaceIdForCwd?: ArchiveDependencies["findWorkspaceIdForCwd"];
  listActiveWorkspaces?: ArchiveDependencies["listActiveWorkspaces"];
  archiveWorkspaceRecord?: ArchiveDependencies["archiveWorkspaceRecord"];
  emitWorkspaceUpdatesForWorkspaceIds?: ArchiveDependencies["emitWorkspaceUpdatesForWorkspaceIds"];
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "upsert" | "list">;
  /**
   * Creates a workspace on an existing directory, for create_workspace's
   * "local" isolation. Supplied by the workspace provisioning service; the
   * worktree half goes through createOttoWorktree instead.
   */
  createDirectoryWorkspace?: (
    cwd: string,
    title?: string | null,
    projectId?: string,
  ) => Promise<PersistedWorkspaceRecord>;
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
  // Schedules an AI-written short chat title for a spawned chat that had no
  // explicit title. Absent when structured generation isn't wired.
  scheduleAutoTitle?: CreateAgentCommandDependencies["scheduleAutoTitle"];
  browserToolsEnabled?: boolean;
  browserToolsBroker?: BrowserToolsBroker | null;
  previewDevServers?: DevServerManager | null;
  /**
   * Daemon-wide Otto tool-group allowlist. undefined = every group enabled
   * (mirrors openai-compat's per-provider `ottoToolGroups` semantics); an empty
   * array = no Otto tools. A tool whose group (ottoToolGroupForName) is absent
   * from this set is never registered - so the MCP catalog and any future
   * consumer inherit per-group gating. The browser AND preview groups remain
   * additionally gated by `browserToolsEnabled` (the authoritative browser
   * master over the whole Preview subsystem); the group filter can only further
   * restrict, never re-enable what the master disabled.
   */
  enabledOttoToolGroups?: OttoToolGroup[];
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
  /** Fun-stats counters - see packages/server/src/server/activity-stats. */
  onActivity?: ActivityIncrementFn;
  /**
   * Where submit_output writes what a graph node's agent submitted. Present
   * when orchestration is wired; the tool only registers for agents that carry
   * declared output fields on their labels, so hosts without graphs never see
   * it. See packages/server/src/server/orchestration/node-output.ts.
   */
  nodeOutputStore?: NodeOutputStore | null;
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

/**
 * What the workspace-level tools report back. `isolation` is the create-time
 * intent (see docs/glossary.md); `kind` is the git-derived property it produced.
 * They are reported separately because a "local" intent lands as `directory` or
 * `local_checkout` depending on whether the cwd is a git repo.
 */
const WorkspaceAutomationSummarySchema = z.object({
  workspaceId: z.string(),
  projectId: z.string(),
  cwd: z.string(),
  isolation: z.enum(["local", "worktree"]),
  kind: z.enum(["directory", "local_checkout", "worktree"]),
  title: z.string().nullable(),
});

function toWorkspaceAutomationSummary(workspace: PersistedWorkspaceRecord) {
  return {
    workspaceId: workspace.workspaceId,
    projectId: workspace.projectId,
    cwd: workspace.cwd,
    isolation: workspace.kind === "worktree" ? ("worktree" as const) : ("local" as const),
    kind: workspace.kind,
    title: workspace.title,
  };
}

function assertWorkspaceOptionsAbsent(
  entries: Array<[name: string, value: unknown]>,
  message: string,
): void {
  if (entries.some(([, value]) => value !== undefined)) {
    throw new Error(message);
  }
}

/**
 * Maps create_workspace's flat worktree options onto the same target shape
 * create_worktree takes, so both tools go through one worktree code path.
 */
function resolveWorkspaceWorktreeTarget(input: {
  mode?: "branch-off" | "checkout-branch" | "checkout-pr";
  worktreeSlug?: string;
  branchName?: string;
  baseBranch?: string;
  branch?: string;
  prNumber?: number;
  forge?: string;
}): McpCreateWorktreeTarget {
  switch (input.mode ?? "branch-off") {
    case "checkout-branch":
      if (!input.branch) {
        throw new Error("branch is required for checkout-branch mode");
      }
      assertWorkspaceOptionsAbsent(
        [
          ["branchName", input.branchName],
          ["baseBranch", input.baseBranch],
          ["prNumber", input.prNumber],
          ["forge", input.forge],
        ],
        "branchName, baseBranch, prNumber, and forge are not valid for checkout-branch mode",
      );
      return {
        kind: "checkout-branch",
        branch: input.branch,
        ...(input.worktreeSlug ? { worktreeSlug: input.worktreeSlug } : {}),
      };
    case "checkout-pr":
      if (input.prNumber === undefined) {
        throw new Error("prNumber is required for checkout-pr mode");
      }
      assertWorkspaceOptionsAbsent(
        [
          ["branchName", input.branchName],
          ["baseBranch", input.baseBranch],
          ["branch", input.branch],
        ],
        "branchName, baseBranch, and branch are not valid for checkout-pr mode",
      );
      return {
        kind: "checkout-pr",
        githubPrNumber: input.prNumber,
        ...(input.forge ? { forge: input.forge } : {}),
      };
    default:
      assertWorkspaceOptionsAbsent(
        [
          ["branch", input.branch],
          ["prNumber", input.prNumber],
          ["forge", input.forge],
        ],
        "branch, prNumber, and forge require a checkout mode",
      );
      return {
        kind: "branch-off",
        ...(input.worktreeSlug ? { worktreeSlug: input.worktreeSlug } : {}),
        ...(input.branchName ? { branchName: input.branchName } : {}),
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
      };
  }
}

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

interface InheritedArtifactIdentity {
  personalityName?: string;
  spinner?: { glowA: string; glowB: string };
}

/**
 * The personality identity an MCP-created artifact inherits from its caller -
 * the caller's personality name and spinner colors - so its card shows who
 * generated it and its spinner renders in the personality's colors. Only
 * inherited when the artifact runs on the caller's own brain: an explicit
 * provider override detaches it, mirroring how the model/effort inherit.
 */
function resolveInheritedArtifactIdentity(params: {
  providerOverridden: boolean;
  snapshot: ResolvedPersonalitySnapshot | undefined;
}): InheritedArtifactIdentity {
  const snapshot = params.providerOverridden ? undefined : params.snapshot;
  if (!snapshot) {
    return {};
  }
  return {
    ...(snapshot.name ? { personalityName: snapshot.name } : {}),
    ...(snapshot.spinner ? { spinner: snapshot.spinner } : {}),
  };
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
  "Effort level (off/minimal/low/medium/high/xhigh/max), clamped to the model's nearest option, or an exact thinkingOptions id from list_models.";

// Lets a caller start an agent with no task in hand - "just open a new chat".
// When create_chat omits initialPrompt, the new chat gets this generic ask so
// it immediately greets the user and asks what to work on, instead of the caller
// having to invent a reason up front (which otherwise stalls the spawn while the
// caller goes back to ask "what should it do?"). A missing title falls back the
// same way, but only when there's no prompt to derive one from.
const DEFAULT_BARE_AGENT_INITIAL_PROMPT =
  "I've just started a new chat with you and haven't given you a task yet. Briefly introduce yourself and ask what I'd like to work on.";
const DEFAULT_BARE_AGENT_TITLE = "New chat";

/**
 * Default window for `get_chat_activity` when the caller omits `limit`. Bounds
 * an otherwise-unbounded child-transcript dump; the arg stays opt-in for more.
 */
const GET_AGENT_ACTIVITY_DEFAULT_LIMIT = 50;

/**
 * Ceiling on the same arg. The default bounded the no-arg call, but `limit`
 * itself was unbounded, so "pass `limit` for more" was an open invitation to
 * ask for the whole child transcript in one result. Paging with repeated calls
 * is the supported way past this.
 */
const GET_AGENT_ACTIVITY_MAX_LIMIT = 500;

/**
 * Per-chat cap on the final message `wait_for_chats` returns. A 32-way gather
 * returned every child's last message verbatim, so one barrier could carry tens
 * of thousands of tokens into the conductor's context.
 */
const WAIT_FOR_AGENTS_MESSAGE_HEAD_CHARS = 3_200;
const WAIT_FOR_AGENTS_MESSAGE_TAIL_CHARS = 800;

/**
 * Default window for `capture_terminal` with `scrollback: true`. That flag used
 * to mean `start: 0` - the entire xterm buffer, up to 1000 lines of wide build
 * output in one result. An explicit `start`/`end` still selects any range,
 * including the whole buffer.
 */
const CAPTURE_TERMINAL_SCROLLBACK_DEFAULT_LINES = 300;

export function capWaitForAgentsMessage(message: string): string {
  return truncateHeadTail({
    text: message,
    headChars: WAIT_FOR_AGENTS_MESSAGE_HEAD_CHARS,
    tailChars: WAIT_FOR_AGENTS_MESSAGE_TAIL_CHARS,
    note: "call get_chat_activity for the rest",
  });
}

// Negative `start` is resolved against the line count by `captureTerminalLines`,
// so the tail window needs no knowledge of how much scrollback exists.
export function resolveCaptureTerminalStart(input: {
  start: number | undefined;
  end: number | undefined;
  scrollback: boolean | undefined;
}): number | undefined {
  if (!input.scrollback) {
    return input.start;
  }
  if (input.start !== undefined) {
    return input.start;
  }
  if (input.end !== undefined) {
    // An explicit end means the caller is selecting a range; anchor at the
    // start of the buffer as `scrollback: true` always did.
    return 0;
  }
  return -CAPTURE_TERMINAL_SCROLLBACK_DEFAULT_LINES;
}

// Fill the generic defaults for a bare "just open a new chat" spawn. A real
// prompt with no title keeps deriving its title from the prompt (undefined here
// → derived downstream); only a title-less AND prompt-less spawn gets the
// placeholder title.
function resolveBareSpawnTitleAndPrompt(input: {
  title: string | undefined;
  initialPrompt: string | undefined;
}): { title: string | undefined; titleIsPlaceholder: boolean; initialPrompt: string } {
  const usesPlaceholderTitle = !input.title && !input.initialPrompt;
  return {
    title: input.title ?? (usesPlaceholderTitle ? DEFAULT_BARE_AGENT_TITLE : undefined),
    // The placeholder is a stand-in, not a name the caller picked, so it must not
    // suppress auto-naming - otherwise the chat reads "New chat" forever and the
    // app renders it as a permanent loading skeleton (resolveWorkspaceAgentTabLabel).
    titleIsPlaceholder: usesPlaceholderTitle,
    initialPrompt: input.initialPrompt ?? DEFAULT_BARE_AGENT_INITIAL_PROMPT,
  };
}

/**
 * Resolve a requested effort - canonical level or exact option id - against a
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
 * create_chat handler stays under the complexity budget.
 */
function buildPersonalityAgentConfig(brain: {
  systemPrompt?: string;
  personalitySnapshot?: ResolvedPersonalitySnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
  featureValues?: Record<string, unknown>;
}):
  | {
      systemPrompt?: string;
      personalitySnapshot?: ResolvedPersonalitySnapshot;
      teamSnapshot?: ResolvedTeamSnapshot;
      featureValues?: Record<string, unknown>;
    }
  | undefined {
  if (
    brain.systemPrompt === undefined &&
    brain.personalitySnapshot === undefined &&
    brain.teamSnapshot === undefined &&
    brain.featureValues === undefined
  ) {
    return undefined;
  }
  const config: {
    systemPrompt?: string;
    personalitySnapshot?: ResolvedPersonalitySnapshot;
    teamSnapshot?: ResolvedTeamSnapshot;
    featureValues?: Record<string, unknown>;
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
  if (brain.featureValues !== undefined) {
    config.featureValues = brain.featureValues;
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
 * stores and what the app's project pickers/filters key on) - NOT the
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

// The caller's workspace-access ceiling (agent/workspace-access.ts), read from
// its stored config the same way the orchestration policy is read from its
// labels. No caller - the daemon/user-level catalog, not an agent session -
// resolves to "write", the pre-feature behaviour.
function resolveCallerWorkspaceAccess(
  agentManager: AgentManager,
  callerAgentId: string | undefined,
): WorkspaceAccess {
  return resolveWorkspaceAccess(
    callerAgentId ? agentManager.getAgent(callerAgentId)?.config.workspaceAccess : undefined,
  );
}

// Read the caller agent's orchestration policy label, if it carries one.
function resolveOrchestrationPolicy(
  agentManager: AgentManager,
  callerAgentId: string | undefined,
): "deterministic" | "autonomous" | null {
  if (!callerAgentId) {
    return null;
  }
  return getOrchestrationPolicyFromLabels(agentManager.getAgent(callerAgentId)?.labels);
}

// The orchestration tool binary (projects/orchestration-graphs). No policy ⇒
// everything allowed. "deterministic" - the daemon does all linking, so the
// node loses every orchestration-shaped tool (the agents + schedules groups)
// plus preview and browser control. "autonomous" - full toolset EXCEPT
// start_orchestration: orchestrations never nest.
function buildOrchestrationPolicyGate(
  policy: "deterministic" | "autonomous" | null,
): (name: string) => boolean {
  return (name: string): boolean => {
    if (!policy) {
      return true;
    }
    if (name === "start_orchestration") {
      return false;
    }
    if (policy === "autonomous") {
      return true;
    }
    const group = ottoToolGroupForName(name);
    return (
      group !== "agents" && group !== "schedules" && group !== "preview" && group !== "browser"
    );
  };
}

/**
 * Two independent narrowings of the tool catalog, combined.
 *
 * `enabledGroups` is the daemon-wide allowlist (undefined = every group).
 * `nodeGroups` is one graph node's own declaration, read from its labels
 * (null = the node didn't declare one). They intersect, never union: a node can
 * hand itself less authority than the daemon allows, never more. An empty node
 * list is meaningful - "no Otto tools at all" - which is why it is an empty
 * array rather than null.
 */
// Validate a tool's input against its declared schema before the handler sees
// it. A tool may declare either a raw Zod shape or a whole ZodType; the shape
// form is wrapped as a passthrough object so unknown keys survive.
async function parseToolInput(tool: OttoToolDefinition, input: unknown): Promise<unknown> {
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
}

function buildToolGroupGate(input: {
  enabledGroups: OttoToolGroup[] | undefined;
  agentManager: AgentManager;
  callerAgentId: string | undefined;
}): (name: string) => boolean {
  const { enabledGroups, agentManager, callerAgentId } = input;
  const nodeGroups = getToolGroupsFromLabels(
    callerAgentId ? agentManager.getAgent(callerAgentId)?.labels : undefined,
  );
  return (name: string): boolean => {
    const group = ottoToolGroupForName(name);
    if (enabledGroups !== undefined && !enabledGroups.includes(group)) {
      return false;
    }
    return nodeGroups === null || nodeGroups.includes(group);
  };
}

// This registration function is intentionally the catalog's single policy gate;
// individual feature blocks do not get to bypass its capability checks.
// eslint-disable-next-line complexity
export function createOttoToolCatalog(options: OttoToolHostDependencies): OttoToolCatalog {
  const {
    agentManager,
    agentStorage,
    terminalManager,
    scheduleService,
    runService,
    providerSnapshotManager,
    daemonConfigStore,
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

  const tools = new Map<string, OttoToolDefinition>();
  // undefined = all groups enabled (mirrors openai-compat per-provider
  // semantics); a defined set gates every tool by its ottoToolGroupForName.
  const enabledGroups = options.enabledOttoToolGroups;
  // A graph node may narrow its own catalog (projects/orchestration-graphs).
  // Intersecting rather than replacing is the whole contract: a node can give
  // itself less than the daemon allows, never more.
  const isToolGroupEnabled = buildToolGroupGate({ enabledGroups, agentManager, callerAgentId });
  // Orchestration tool policy (projects/orchestration-graphs): agents the
  // daemon spawned as graph nodes carry a policy label; the gate below strips
  // the tools that policy forbids. Enforced here at registration so every
  // catalog consumer (MCP and native tool loops alike) inherits the filter.
  const isToolAllowedByOrchestrationPolicy = buildOrchestrationPolicyGate(
    resolveOrchestrationPolicy(agentManager, callerAgentId),
  );
  const callerWorkspaceAccess = resolveCallerWorkspaceAccess(agentManager, callerAgentId);
  const registerTool = (
    name: string,
    config: OttoToolConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
    handler: (input: any, context: OttoToolExecutionContext) => Promise<OttoToolResult>,
  ) => {
    // Per-group gating: a tool whose group is disabled is never registered, so
    // both the MCP path and any future catalog consumer inherit the filter.
    if (!isToolGroupEnabled(name)) {
      return;
    }
    if (!isToolAllowedByOrchestrationPolicy(name)) {
      return;
    }
    // Workspace-access ceiling: enforced here at registration, like the two
    // gates above, so every catalog consumer - the MCP server serving CLI
    // providers and openai-compat's daemon-owned tool loop - withholds the
    // same tools. A tool that was never registered cannot be argued into
    // running (agent/workspace-access.ts).
    if (!isOttoToolAllowedForAccess(name, callerWorkspaceAccess)) {
      return;
    }
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
      // Deliberately not `title`. Everything else here is runtime config worth
      // inheriting; the title is a label, and stamping the caller's chat title
      // onto the schedule made every run of every agent-created schedule show up
      // as "Parent agent" instead of a title derived from the schedule's prompt
      // (resolveScheduleAgentTitle prefers config.title over the prompt).
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

  const getProfileRoster = (): AgentProfile[] => daemonConfigStore?.get().agentProfiles ?? [];

  const findPersonalityByName = (name: string): AgentPersonality | undefined => {
    const trimmed = name.trim();
    const roster = getPersonalityRoster();
    return (
      roster.find((p) => p.name === trimmed) ??
      roster.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    );
  };

  const findProfileByName = (name: string): AgentProfile | undefined => {
    const trimmed = name.trim();
    const roster = getProfileRoster();
    return (
      roster.find((profile) => profile.name === trimmed) ??
      roster.find((profile) => profile.name.toLowerCase() === trimmed.toLowerCase())
    );
  };

  interface ResolvedCreateAgentBrain {
    providerModel: string;
    modeId?: string;
    thinkingOptionId?: string;
    systemPrompt?: string;
    personalitySnapshot?: ResolvedPersonalitySnapshot;
    teamSnapshot?: ResolvedTeamSnapshot;
    featureValues?: Record<string, unknown>;
  }

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

  // Profiles intentionally combine upstream launch settings with Otto identity fields.
  // eslint-disable-next-line complexity
  const resolveConfiguredProfileBrain = async (
    profile: AgentProfile,
    input: {
      providerOverride: string | undefined;
      modeOverride: string | undefined;
      thinkingOverride: string | undefined;
      cwd: string | undefined;
    },
  ): Promise<ResolvedCreateAgentBrain> => {
    const entries = await providerSnapshotManager.listProviders({ cwd: input.cwd, wait: true });
    const providerEntry = entries.find((entry) => entry.provider === profile.provider);
    const resolvedModel =
      profile.model ??
      providerEntry?.models?.find((model) => model.isDefault)?.id ??
      providerEntry?.models?.[0]?.id;
    const profileProviderModel = resolvedModel
      ? `${profile.provider}/${resolvedModel}`
      : profile.provider;
    const providerModel = input.providerOverride?.trim() || profileProviderModel;
    const modeId = input.modeOverride ?? profile.modeId ?? providerEntry?.defaultModeId;
    const profileEffort = typeof profile.effortLevel === "string" ? profile.effortLevel : undefined;
    const thinkingOptionId = input.thinkingOverride
      ? await resolveThinkingAgainstProvider(input.thinkingOverride, providerModel)
      : (profile.thinkingOptionId ??
        (profileEffort
          ? await resolveThinkingAgainstProvider(profileEffort, providerModel)
          : undefined));
    const roles = Array.isArray(profile.roles)
      ? normalizePersonalityRoles(
          profile.roles.filter((role): role is string => typeof role === "string"),
        )
      : [];
    const personalityPrompt =
      typeof profile.personalityPrompt === "string" ? profile.personalityPrompt : undefined;
    const spinnerResult = profileSpinnerSchema.safeParse(profile.spinner);
    const voiceResult = profileVoiceSchema.safeParse(profile.voice);
    const teamSnapshot = resolveTeamSnapshotForPersonality(readAgentTeams?.(), profile.id);
    const composedPrompt = composeTeamAndPersonalityPrompt(teamSnapshot, personalityPrompt, roles);
    const personalitySnapshot: ResolvedPersonalitySnapshot | undefined = resolvedModel
      ? {
          personalityId: profile.id,
          name: profile.name,
          provider: profile.provider,
          model: resolvedModel,
          ...(modeId ? { modeId } : {}),
          ...(thinkingOptionId ? { thinkingOptionId } : {}),
          ...(profileEffort ? { effortLevel: profileEffort } : {}),
          effortDegraded: false,
          respectGlobalAppendPrompt:
            typeof profile.respectGlobalAppendPrompt === "boolean"
              ? profile.respectGlobalAppendPrompt
              : true,
          roles,
          ...(personalityPrompt ? { systemPrompt: personalityPrompt } : {}),
          ...(spinnerResult.success ? { spinner: spinnerResult.data } : {}),
          ...(voiceResult.success ? { voice: voiceResult.data } : {}),
        }
      : undefined;
    return {
      providerModel,
      ...(modeId ? { modeId } : {}),
      ...(thinkingOptionId ? { thinkingOptionId } : {}),
      ...(composedPrompt ? { systemPrompt: composedPrompt } : {}),
      ...(personalitySnapshot ? { personalitySnapshot } : {}),
      ...(teamSnapshot ? { teamSnapshot } : {}),
      ...(profile.featureValues ? { featureValues: profile.featureValues } : {}),
    };
  };

  const resolveLegacyPersonalityBrain = async (
    personality: AgentPersonality,
    input: {
      providerOverride: string | undefined;
      modeOverride: string | undefined;
      thinkingOverride: string | undefined;
      cwd: string | undefined;
    },
  ): Promise<ResolvedCreateAgentBrain> => {
    const entries = await providerSnapshotManager.listProviders({ cwd: input.cwd, wait: true });
    const resolution = resolvePersonality(personality, entries);
    if (resolution.status === "unavailable") {
      throw new Error(
        `Personality "${personality.name}" is unavailable here: ${resolution.reason}`,
      );
    }
    const snapshot = resolution.snapshot;
    const teamSnapshot = resolveTeamSnapshotForPersonality(
      readAgentTeams?.(),
      snapshot.personalityId,
    );
    const composedPrompt = composeTeamAndPersonalityPrompt(
      teamSnapshot,
      snapshot.systemPrompt,
      snapshot.roles,
    );
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
  };

  // Turn the create_chat personality inputs - a personality name and/or explicit
  // provider/settings - into the concrete provider/model/effort/mode/prompt to
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
    if (input.personalityName) {
      const profile = findProfileByName(input.personalityName);
      if (profile) {
        return resolveConfiguredProfileBrain(profile, input);
      }
      const personality = findPersonalityByName(input.personalityName);
      if (!personality) {
        const names = [...getProfileRoster(), ...getPersonalityRoster()]
          .map((candidate) => candidate.name)
          .join(", ");
        throw new Error(
          `Profile "${input.personalityName}" not found.${names ? ` Available: ${names}.` : " No profiles are configured on this host."}`,
        );
      }
      return resolveLegacyPersonalityBrain(personality, input);
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
    // Check the caller first: an agent scheduling work inherits its own
    // provider/model, so demanding an explicit provider before looking would
    // reject the common "schedule this same thing nightly" call.
    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return {
        type: "new-agent" as const,
        config: buildCallerAgentScheduleConfig(callerAgent, params),
      };
    }

    if (!params?.provider?.trim()) {
      throw new Error("provider is required when target is new-agent");
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
      .describe("Branch off a new branch."),
    z
      .object({
        kind: z.literal("checkout-branch"),
        branch: z.string().min(1).describe("Existing branch to check out."),
        worktreeSlug: z
          .string()
          .min(1)
          .optional()
          .describe("Optional worktree slug/path label. Omit to derive one from the branch."),
      })
      .strict()
      .describe("Check out an existing branch."),
    z
      .object({
        kind: z.literal("checkout-pr"),
        githubPrNumber: z.number().int().positive().describe("Change request number."),
        forge: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Git host the change request lives on, for example github or bitbucket. Defaults to the repository's resolved forge.",
          ),
      })
      .strict()
      .describe("Check out a change request (pull request / merge request)."),
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
        "Short descriptive title (<= 60 chars) summarizing the agent's focus. Optional - omit to let Otto derive one from the prompt (or name a bare new chat).",
      ),
    provider: ProviderModelInputSchema.optional().describe(
      "Provider/model pair, for example codex/gpt-5.4. Required unless `personality` names a profile; when both are given, this overrides the profile's provider/model.",
    ),
    personality: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Spawn from a named agent profile on this host. The compatibility field name remains `personality`; explicit provider/settings override profile values per field. See list_profiles before choosing one. Fails loudly if unavailable here.",
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
        "First task to run immediately after creation. Optional - omit to just open a new chat; the agent then greets the user and asks what to work on. Don't refuse to spawn just because there's no task yet.",
      ),
  };
  const agentToAgentInputSchema = {
    ...commonCreateAgentInputSchema,
    // Left as bare .optional() (no schema default) so the handler can tell an
    // explicit choice from an omission and fall back to the daemon
    // agentBehaviors.notifyOnFinishDefault toggle (default true). See WP-E.
    notifyOnFinish: z
      .boolean()
      .optional()
      .describe(
        "Get notified when the created agent finishes, errors, or needs permission. Defaults to the host's notify-on-finish setting; set false only for truly fire-and-forget agents.",
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
    delivery: z
      .enum(["interrupt", "queue"])
      .optional()
      .default("interrupt")
      .describe(
        "How to reach the agent if it is BUSY. 'interrupt' (default) cancels whatever it is doing and runs your prompt now - use it for corrections that must land immediately. 'queue' lets the current turn finish and runs your prompt as the next one - use it for a follow-up that should not throw away work in progress. If the agent is idle both run it immediately.",
      ),
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
    // Left as bare .optional() (no schema default) so the handler can tell an
    // explicit choice from an omission and fall back to the daemon
    // agentBehaviors.notifyOnFinishDefault toggle (default true). See WP-E.
    notifyOnFinish: z
      .boolean()
      .optional()
      .describe(
        "Get notified when the prompted agent finishes, errors, or needs permission. Defaults to the host's notify-on-finish setting; set false only for truly fire-and-forget prompts.",
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

  // Both halves of Preview - browser verification (`browser_*`) and dev-server
  // lifecycle (`preview_*`) - are gated behind the browser-tools master, so the
  // "Browser Tools" host setting is a single functional switch for the whole
  // subsystem: master off = neither half is registered for any provider.
  if (options.browserToolsEnabled && options.browserToolsBroker) {
    registerBrowserTools({
      registerTool,
      broker: options.browserToolsBroker,
      callerAgentId,
      resolveCallerAgent,
      previewServers: options.previewDevServers ?? null,
    });
  }

  if (options.browserToolsEnabled && options.previewDevServers) {
    registerPreviewTools({
      registerTool,
      manager: options.previewDevServers,
      broker: options.browserToolsBroker ?? null,
      resolveCallerAgent,
    });
  }

  registerTool(
    "create_chat",
    {
      title: "Create chat",
      description:
        "Start an Otto chat session immediately. A chat can be independent or a child chat. Requires relationship, workspace, and either provider/model (e.g. codex/gpt-5.4) or a profile name. Title and initialPrompt are optional. Prefer a named profile when available; call list_profiles before choosing one.",
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
      // Omitted → fall back to the daemon notify-on-finish default (agent-scoped
      // only; default true, preserving prior behavior); an explicit arg still
      // overrides. Extracted to keep this handler under the complexity cap.
      notifyOnFinish = resolveCreateAgentNotifyOnFinish(resolvedArgs);
      if (resolvedArgs.kind === "agent-scoped") {
        requestedBackground = true;
        detached = resolvedArgs.relationship.kind === "detached";
      } else {
        requestedBackground = resolvedArgs.parsedArgs.background;
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
          scheduleAutoTitle: options.scheduleAutoTitle,
        },
        {
          kind: "mcp",
          provider: brain.providerModel,
          ...(personalityConfig ? { config: personalityConfig } : {}),
          title: bareSpawn.title,
          titleIsPlaceholder: bareSpawn.titleIsPlaceholder,
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
          "List the personality profiles on this host - named templates binding a provider/model, effort, mode, prompt, and roles. Pass a name to create_chat's `personality` to start it (availability is resolved per workspace; unavailable profiles can't be started there). Any chat may call this to choose a collaborator. Each entry's `guidance`, `tier`, and `canLaunch` fields explain when to choose it.",
        inputSchema: {
          cwd: z
            .string()
            .optional()
            .describe(
              "Workspace directory to resolve availability against. Defaults to your current cwd.",
            ),
          roles: z
            .array(z.string())
            .optional()
            .describe(
              "Only return personalities carrying at least one of these roles (for example writer, coder, judger, advisor).",
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
                .describe("coordinator (delegates/orchestrates) or focused (stays on one task)."),
              canLaunch: z
                .boolean()
                .describe(
                  "Whether this personality is meant to spawn other agents and orchestrate.",
                ),
              guidance: z
                .string()
                .describe("Why you'd choose this personality - its roles' intent."),
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
              "Present when an Agent Team is active - the list above is scoped to its members.",
            ),
        },
      },
      async (args: { cwd?: string; roles?: string[] }) => {
        const roleFilters = (args.roles ?? []).map((role) => role.trim()).filter(Boolean);
        const caller = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
        const cwd = args.cwd?.trim() || caller?.cwd || undefined;
        const entries = await providerSnapshotManager.listProviders({ cwd, wait: true });
        // With a team active, the bench is the team: only members are listed
        // (create_chat by explicit name still resolves the full roster - an
        // off-team specialist can be pulled in deliberately, without the team
        // prompt). No active team = the full roster, exactly as before.
        const activeTeam = getActiveAgentTeam(readAgentTeams?.());
        const personalities = getPersonalityRoster()
          .filter((personality) => !activeTeam || isTeamMember(activeTeam, personality.id))
          .filter(
            (personality) =>
              roleFilters.length === 0 ||
              roleFilters.some(
                (role) => isPersonalityRole(role) && personalityHasRole(personality, role),
              ),
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
                    note: `Team "${activeTeam.name}" is active; this list is its bench. create_chat with an off-team personality name still works but starts without the team prompt.`,
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

  // Resolve the effective notifyOnFinish for a create_chat call. Chat-scoped
  // omissions fall back to the daemon agentBehaviors.notifyOnFinishDefault toggle
  // (default true); top-level omissions stay false (top-level sends can't be
  // notified - there's no caller agent to notify). Explicit args always win.
  function resolveCreateAgentNotifyOnFinish(resolved: ResolvedCreateAgentToolArgs): boolean {
    if (resolved.kind === "agent-scoped") {
      return (
        resolved.parsedArgs.notifyOnFinish ?? agentManager.getAgentBehaviors().notifyOnFinishDefault
      );
    }
    return resolved.parsedArgs.notifyOnFinish ?? false;
  }

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

    const legacyWorktreeTarget = resolveLegacyCreateAgentWorktreeTarget({
      worktreeName,
      branchName,
      baseBranch,
      refName,
      githubPrNumber,
    });

    if (!cwd?.trim()) {
      if (legacyWorktreeTarget) {
        throw new Error("cwd is required for top-level create_chat calls");
      }
      // No placement at all: a top-level caller that just says "make me an
      // agent" gets a fresh local workspace at the daemon's own directory,
      // rather than an error demanding a cwd it has no way to know.
      return canonicalTopLevelCreateAgentArgsSchema.parse({
        ...canonicalCandidate,
        relationship: { kind: "detached" },
        workspace: {
          kind: "create",
          source: { kind: "directory", path: process.cwd() },
        },
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
      });
    }
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
          ...(target.worktreeSlug ? { worktreeName: target.worktreeSlug } : {}),
        };
      case "checkout-pr":
        return {
          action: "checkout",
          checkoutSource: {
            kind: "change_request",
            number: target.githubPrNumber,
            ...(target.forge ? { forge: target.forge } : {}),
          },
        };
      default:
        throw new Error("unreachable");
    }
  }

  registerTool(
    "send_chat_prompt",
    {
      title: "Send chat prompt",
      description:
        "Send a prompt to an active, existing Otto chat by its agentId. Use list_chats first when you need to identify a collaborator. Chat-scoped callers continue in the background by default; top-level callers wait by default. Use delivery queue to preserve a busy chat's current turn, or interrupt only when the new prompt must take precedence.",
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
      notifyOnFinish,
      delivery = "interrupt",
    }: {
      agentId: string;
      prompt: string;
      sessionMode?: string;
      background?: boolean;
      notifyOnFinish?: boolean;
      delivery?: "interrupt" | "queue";
    }) => {
      // Omitted → fall back to the daemon notify-on-finish default (default
      // true, preserving prior behavior); an explicit arg still overrides. The
      // callerAgentId gate below keeps top-level (unwatched) sends silent.
      const resolvedNotifyOnFinish =
        notifyOnFinish ?? agentManager.getAgentBehaviors().notifyOnFinishDefault;
      const shouldNotifyOnFinish = Boolean(callerAgentId && resolvedNotifyOnFinish && background);
      onActivity?.("backgroundTasksInvoked", Number(background));

      const dispatch = await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        sessionMode,
        delivery,
        // Agent-to-agent sends carry their own framing; never merge one into a
        // neighbouring message when the queue drains.
        source: "system",
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

      const queuedGuidance = dispatch.queued
        ? "The chat was busy, so your prompt is queued and will run as its next turn. Nothing was interrupted."
        : null;
      const notifyGuidance = shouldNotifyOnFinish
        ? "You will get notified when the prompted chat finishes, errors, or needs permission. Do not poll for status; continue with other work until the notification arrives."
        : null;
      const guidance = [queuedGuidance, notifyGuidance].filter(Boolean).join(" ");
      const responseData = {
        success: true,
        status: currentSnapshot?.lifecycle ?? "idle",
        lastMessage: null,
        permission: null,
        ...(guidance ? { guidance } : {}),
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
    "get_chat_status",
    {
      title: "Get chat status",
      description:
        "Return the latest snapshot for a chat, including lifecycle state, capabilities, and pending permissions.",
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
    "list_chats",
    {
      title: "List chats",
      description:
        "List recent existing Otto chats as compact metadata. Use this to find a collaborator's agentId before send_chat_prompt; filter to the current workspace by default.",
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
    "cancel_chat",
    {
      title: "Cancel chat",
      description: "Stop the chat's current turn but keep the chat available for future work.",
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
    "show_widget",
    {
      title: "Show a widget",
      description:
        "Render a visual inline in the conversation - an SVG diagram or chart, an HTML " +
        "dashboard, a mockup, a small interactive control. It appears in the transcript at " +
        "this point in your reply, next to the text explaining it.\n\n" +
        "Reach for this whenever a picture carries the answer better than prose: comparing " +
        "options, showing a flow or an architecture, plotting numbers, sketching UI, laying " +
        "out anything with two dimensions. Do not narrate what you are about to draw - draw it.\n\n" +
        "Call widget_contract FIRST, before your first widget, and follow what it says. It " +
        "carries the theme variables, the icon set, the two host globals, and the sandbox " +
        "limits - none of which you can guess. There is NO network: no CDN, no Chart.js, no " +
        "D3, no web fonts. Everything is inline HTML/CSS/SVG/JS.\n\n" +
        "A widget is not an artifact. Use this for something that explains the answer here " +
        "and now; use create_artifact for a document the user will come back to.",
      inputSchema: {
        // Declared before widget_code on purpose. Providers stream tool inputs
        // in declaration order and withhold a string argument until it closes,
        // so the fields listed first arrive while the fragment is still being
        // written - which is what lets Otto show these messages instead of a
        // dead spinner.
        loading_messages: z
          .array(z.string())
          .min(1)
          .max(WIDGET_MAX_LOADING_MESSAGES)
          .describe(
            "1-4 short lines shown while the widget renders, roughly five words each, in the " +
              "user's language. If the subject is serious - illness, grief, conflict, disaster, " +
              'money someone could lose - keep them flat and factual ("Laying out the stages"). ' +
              "Otherwise have fun with them.",
          ),
        title: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Short snake_case identifier, specific enough to tell this widget apart from " +
              "others in the same conversation - q4_revenue_by_region, not chart.",
          ),
        widget_code: z
          .string()
          .min(1)
          .describe(
            "The fragment. Starts with <svg for SVG mode, otherwise HTML. No DOCTYPE, no " +
              "<html>/<head>/<body>. Content-driven height - never position:fixed and never a " +
              "height on html/body.",
          ),
      },
      outputSchema: {
        rendered: z.boolean(),
        mode: z.string(),
      },
    },
    async (input: { widget_code: string; title: string; loading_messages: string[] }) => {
      // The widget renders from the tool CALL, not from this result - the
      // fragment is already on its way to the client by the time this runs (see
      // widget-timeline.ts). The handler exists to validate, so a fragment that
      // cannot render comes back to the model as a fixable error instead of
      // leaving a broken frame in the transcript.
      const fragment = sanitizeWidgetFragment(input.widget_code);
      return {
        content: [],
        structuredContent: ensureValidJson({ rendered: true, mode: fragment.mode }),
      };
    },
  );

  registerTool(
    "widget_contract",
    {
      title: "Read the widget contract",
      description:
        "Return the host contract for show_widget: theme variables, icon names, the " +
        "sendPrompt/openLink globals, sizing rules and sandbox limits. Call this before your " +
        "first widget in a conversation. Pass a module for detail on one kind of widget: " +
        `${WIDGET_CONTRACT_MODULES.join(", ")}.`,
      inputSchema: {
        module: z
          .string()
          .trim()
          .optional()
          .describe(
            `Optional module: ${WIDGET_CONTRACT_MODULES.join(", ")}. Omit for the core contract.`,
          ),
      },
      outputSchema: {
        contract: z.string(),
      },
    },
    async (input: { module?: string }) => {
      return {
        content: [],
        structuredContent: ensureValidJson({ contract: readWidgetContract(input.module) }),
      };
    },
  );

  registerTool(
    "suggest_task",
    {
      title: "Suggest a task",
      description:
        "Create a deferred suggested-task card. Flag an out-of-scope issue as follow-up work the user can start later " +
        "in its own chat. This does not start work.\n\n" +
        "Call this on your own initiative, without being asked, whenever you notice something " +
        "worth doing that would bloat the current change: dead code, stale docs, missing test " +
        "coverage, a confirmed TODO, a refactor, or a bug spotted in passing. Noticing it is the " +
        "trigger - do not wait for permission and do not just mention it in prose.\n\n" +
        'Also call this whenever the user asks for one, in any of their words: "suggest a task", ' +
        '"suggest tasks", "make that a task", "add a task", "queue that up", "spin that off", ' +
        '"flag that for later", "note that for later", "spawn a task". These all mean this tool.\n\n' +
        "Don't flag vague code-smell hunches, trivial fixes you can just do inline, or " +
        "low-confidence guesses.\n\n" +
        "A card appears for the user, who acts on it asynchronously (new worktree, locally, this " +
        "session, or dismiss). Your current turn continues uninterrupted and the task is NOT " +
        "started automatically.",
      inputSchema: {
        title: z
          .string()
          .describe(
            "A short imperative action phrase, under 60 chars, starting with a verb - the card " +
              'label and the future chat\'s title. E.g. "Fix the flaky auth test", "Add ' +
              'parser tests".',
          ),
        prompt: z
          .string()
          .describe(
            "The self-contained initial message for the future chat - NOT shown to the user " +
              "directly. Include file paths and enough context to do the task without this " +
              "conversation.",
          ),
        tldr: z
          .string()
          .describe(
            "A 1-2 sentence plain-English summary of what the task will do and why, shown to the " +
              "user on the card. No file paths or code.",
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Optional absolute path to a different project root. Defaults to the current project.",
          ),
      },
      outputSchema: {
        task_id: z.string(),
      },
    },
    async ({ title, prompt, tldr, cwd }) => {
      if (!callerAgentId) {
        throw new Error("suggest_task must be called from a chat session");
      }
      const resolvedCwd = cwd ? resolveScopedCwd(cwd) : undefined;
      const taskId = agentManager.spawnSuggestedTask({
        parentAgentId: callerAgentId,
        title,
        prompt,
        tldr,
        ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ task_id: taskId }),
      };
    },
  );

  registerTool(
    "dismiss_task",
    {
      title: "Dismiss a suggested task",
      description:
        "Withdraw a suggested-task card you created with suggest_task, when it's now stale, " +
        "superseded, or already handled (to replace one, spawn the new card first, then dismiss the " +
        "old task_id). Only cards the user hasn't acted on can be withdrawn; if it was already " +
        "started or dismissed, the result says so - don't retry.",
      inputSchema: {
        task_id: z.string(),
        reason: z
          .string()
          .optional()
          .describe("Optional short note on why the suggestion is no longer relevant."),
      },
      outputSchema: {
        dismissed: z.boolean(),
        status: z.string(),
      },
    },
    async ({ task_id, reason }) => {
      const result = agentManager.dismissSuggestedTask(task_id, reason);
      let status: string;
      if (!result.found) {
        status = "not_found";
      } else if (result.dismissed) {
        status = "dismissed";
      } else {
        status = `already_${result.state ?? "resolved"}`;
      }
      return {
        content: [],
        structuredContent: ensureValidJson({ dismissed: result.dismissed, status }),
      };
    },
  );

  // -------------------------------------------------------------------------
  // Personality memory. Only registered when the host wires the store, and only
  // three tools: one reflexive write, one deliberate read, one reviewed edit.
  // See docs/agent-personalities.md § Memory (The three tools).
  // -------------------------------------------------------------------------
  if (options.personalityMemory) {
    const personalityMemory = options.personalityMemory;

    /**
     * The personality behind the calling agent. Memory is keyed to the
     * personality, not the agent - the agent is ephemeral, the personality is
     * the continuity - so an agent with no bound personality has nowhere to keep
     * anything and is told so plainly rather than silently succeeding.
     */
    const requireMemoryTarget = (): { personalityId: string; cwd: string | undefined } => {
      if (!callerAgentId) {
        throw new Error("Personality memory tools must be called from an agent session");
      }
      const agent = agentManager.getAgent(callerAgentId);
      const personalityId = agent?.config.personalitySnapshot?.personalityId;
      if (!personalityId) {
        throw new Error(
          "This agent has no bound personality, so there is nowhere to keep lessons. " +
            "Memory belongs to a named personality, not to a single chat.",
        );
      }
      return { personalityId, cwd: agent?.config.cwd };
    };

    registerTool(
      "remember_lesson",
      {
        title: "Remember a lesson",
        description:
          "Record something you learned, so you still know it in your next session. State the " +
          "lesson and nothing else - there is no id to track, no file to choose and no index to " +
          "maintain. Storage, placement and de-duplication are handled for you, and restating " +
          "something you already recorded reinforces it rather than duplicating it.\n\n" +
          "Call this on your own initiative whenever you learn something that will still be true " +
          "next time: a mechanism that behaves unexpectedly, a convention this project enforces, " +
          "a command that must be run a particular way, a tool that fails in a specific " +
          "situation, or an observation about how the work here actually goes.\n\n" +
          "Do NOT record: anything specific to this one task, anything already written down in " +
          "the project's own docs, secrets, or a guess you have not verified. A lesson you are " +
          "not confident in is worse than no lesson, because you will trust it later.\n\n" +
          "Write it as one short standalone paragraph that will still make sense with none of " +
          "this conversation around it.",
        inputSchema: {
          lesson: z
            .string()
            .describe(
              "The lesson, as one short standalone paragraph. Include the specific names, paths " +
                "or commands involved - a lesson too vague to act on is noise.",
            ),
          scope: z
            .enum(["project", "everywhere"])
            .optional()
            .describe(
              'Defaults to "project" (this repository only). Use "everywhere" only for lessons ' +
                "that hold regardless of which project you are working in.",
            ),
        },
        outputSchema: {
          recorded: z.boolean(),
          // "added" vs "reinforced" is worth returning: it tells the agent it had
          // already learned this, which is itself useful information.
          action: z.string(),
          total: z.number(),
        },
      },
      async ({ lesson, scope }) => {
        const target = requireMemoryTarget();
        const trimmed = lesson.trim();
        if (trimmed.length === 0) {
          throw new Error("A lesson needs some text.");
        }
        const result = await personalityMemory.record({
          personalityId: target.personalityId,
          lesson: trimmed,
          scope: scope === "everywhere" ? "global" : "project",
          ...(target.cwd ? { cwd: target.cwd } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            recorded: true,
            action: result.outcome,
            total: result.total,
          }),
        };
      },
    );

    registerTool(
      "review_lessons",
      {
        title: "Review remembered lessons",
        description:
          "Read back everything you have remembered, so it can be improved instead of just " +
          "accumulating. Returns each lesson with a short handle for revise_lesson.\n\n" +
          "Call this when the user asks what you remember or asks you to tidy your memory, and " +
          "on your own initiative when a lesson you were given contradicts what you are seeing.\n\n" +
          "Then work through them looking for lessons that are now WRONG, too VAGUE to act on, " +
          "OVERLAPPING with another, or no longer RELEVANT.\n\n" +
          "For every change you want to make, ASK THE USER FIRST - say which lesson, what you " +
          "think is wrong with it, and what you propose instead, then wait for the answer. Only " +
          "then call revise_lesson. Rewriting a lesson on your own judgement turns your " +
          "assumptions into something you will trust permanently, which is the failure this " +
          "review exists to prevent. Leaving a lesson alone is always an acceptable outcome.",
        inputSchema: {},
        outputSchema: {
          lessons: z.array(
            z.object({
              handle: z.string(),
              lesson: z.string(),
              scope: z.string(),
              learned_times: z.number(),
              recorded_at: z.string(),
            }),
          ),
          injected_now: z.number(),
        },
      },
      async () => {
        const target = requireMemoryTarget();
        const entries = await personalityMemory.list(target.personalityId);
        return {
          content: [],
          structuredContent: ensureValidJson({
            lessons: entries.map((entry) => ({
              handle: entry.id,
              lesson: entry.text,
              scope: entry.scope === "global" ? "everywhere" : "this project",
              learned_times: entry.reinforcedCount ?? 1,
              recorded_at: entry.createdAt,
            })),
            injected_now: entries.length,
          }),
        };
      },
    );

    registerTool(
      "revise_lesson",
      {
        title: "Revise a remembered lesson",
        description:
          "Apply one reviewed change to a lesson: rewrite it, change its scope, or forget it. " +
          "The handle comes from review_lessons - call that first.\n\n" +
          "Only call this after the user has agreed to this specific change. This is the " +
          "deliberate counterpart to remember_lesson: recording is reflexive, revising is not.",
        inputSchema: {
          handle: z.string().describe("The handle review_lessons gave for this lesson."),
          lesson: z
            .string()
            .optional()
            .describe("The rewritten lesson. Omit to keep the current text."),
          scope: z
            .enum(["project", "everywhere"])
            .optional()
            .describe("Move the lesson between this project and everywhere."),
          forget: z
            .boolean()
            .optional()
            .describe("True to delete the lesson outright. Overrides the other fields."),
        },
        outputSchema: {
          applied: z.boolean(),
          status: z.string(),
        },
      },
      async ({ handle, lesson, scope, forget }) => {
        const target = requireMemoryTarget();
        const applied = await personalityMemory.revise({
          personalityId: target.personalityId,
          entryId: handle,
          ...(lesson !== undefined ? { text: lesson } : {}),
          ...(scope ? { scope: scope === "everywhere" ? "global" : "project" } : {}),
          // Needed when the scope moves to "project": without a root the lesson
          // binds to no project and drops out of every brief.
          ...(target.cwd ? { cwd: target.cwd } : {}),
          ...(forget ? { drop: true } : {}),
        });
        let status: string;
        if (!applied) {
          status = "not_found";
        } else {
          status = forget ? "forgotten" : "revised";
        }
        return {
          content: [],
          structuredContent: ensureValidJson({ applied, status }),
        };
      },
    );
  }

  // -------------------------------------------------------------------------
  // Every chat receives a compact active-page catalog. Full rich Markdown
  // pages remain pull-on-demand through these provider-neutral tools.
  // -------------------------------------------------------------------------
  if (options.projectKnowledge) {
    const projectKnowledge = options.projectKnowledge;
    const requireProjectCwd = (): string => {
      if (!callerAgentId)
        throw new Error("Project knowledge tools must be called from an agent session");
      const cwd = agentManager.getAgent(callerAgentId)?.config.cwd;
      if (!cwd)
        throw new Error(
          "This agent has no repository working directory to attach project knowledge to.",
        );
      return cwd;
    };

    const recordOutputSchema = z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      statement: z.string(),
      evidence: z.string().optional(),
      tags: z.array(z.string()),
      status: z.string(),
      delivery_status: z.string().optional(),
      progress: z
        .object({
          completed: z.number(),
          total: z.number(),
          unit: z.string(),
          percentage: z.number(),
        })
        .optional(),
      reference_disposition: z.string().optional(),
      source_url: z.string().optional(),
      updated_at: z.string(),
      path: z.string().optional(),
      timeline: z.array(
        z.object({
          kind: z.string(),
          text: z.string(),
          recorded_at: z.string(),
          source: z.string().optional(),
          affects: z.array(z.string()).optional(),
        }),
      ),
    });
    const toToolRecord = (record: Awaited<ReturnType<typeof projectKnowledge.list>>[number]) => ({
      id: record.id,
      kind: record.kind,
      title: record.title,
      statement: record.statement,
      ...(record.evidence ? { evidence: record.evidence } : {}),
      tags: record.tags,
      status: record.status,
      ...(record.deliveryStatus ? { delivery_status: record.deliveryStatus } : {}),
      ...(record.progress
        ? {
            progress: {
              ...record.progress,
              percentage: Math.round((record.progress.completed / record.progress.total) * 100),
            },
          }
        : {}),
      ...(record.referenceDisposition
        ? { reference_disposition: record.referenceDisposition }
        : {}),
      ...(record.sourceUrl ? { source_url: record.sourceUrl } : {}),
      updated_at: record.updatedAt,
      ...(record.path ? { path: record.path } : {}),
      timeline: (record.provenance ?? []).map((entry) => {
        const output: {
          kind: string;
          text: string;
          recorded_at: string;
          source?: string;
          affects?: string[];
        } = {
          kind: entry.kind,
          text: entry.text,
          recorded_at: entry.recordedAt,
        };
        if (entry.source) output.source = entry.source;
        if (entry.affects?.length) output.affects = entry.affects;
        return output;
      }),
    });

    registerTool(
      "list_project_knowledge",
      {
        title: "List project knowledge",
        description:
          "List the repository's active project-knowledge pages and six root pages. Call this at task start when the injected catalog indicates relevant knowledge. Inactive pages are omitted unless explicitly requested for review.",
        inputSchema: {
          includeInactive: z
            .boolean()
            .optional()
            .describe("Include proposed and superseded pages for an explicit knowledge review."),
        },
        outputSchema: {
          records: z.array(recordOutputSchema),
          roots: z.array(z.object({ slug: z.string(), title: z.string(), path: z.string() })),
        },
      },
      async ({ includeInactive }) => {
        const view = await projectKnowledge.view(requireProjectCwd());
        return {
          content: [],
          structuredContent: ensureValidJson({
            records: view.records
              .filter((record) => includeInactive || record.status === "confirmed")
              .map(toToolRecord),
            roots: view.rootPages.map(({ slug, title, path }) => ({ slug, title, path })),
          }),
        };
      },
    );

    registerTool(
      "read_project_knowledge",
      {
        title: "Read project knowledge",
        description:
          "Read one active rich Markdown knowledge page, including its complete append-only timeline. Draft and superseded pages require includeInactive for explicit review work.",
        inputSchema: { id: z.string(), includeInactive: z.boolean().optional() },
        outputSchema: { record: recordOutputSchema.nullable() },
      },
      async ({ id, includeInactive }) => {
        const record = await projectKnowledge.get(
          requireProjectCwd(),
          id,
          includeInactive ? { includeInactive: true } : {},
        );
        return {
          content: [],
          structuredContent: ensureValidJson({ record: record ? toToolRecord(record) : null }),
        };
      },
    );

    registerTool(
      "read_project_knowledge_root",
      {
        title: "Read project knowledge root",
        description:
          "Read one rich Markdown project-map root: background, architecture, flow, mindmap, stack, or roadmap.",
        inputSchema: {
          slug: z.enum(["background", "architecture", "flow", "mindmap", "stack", "roadmap"]),
        },
        outputSchema: {
          page: z
            .object({ slug: z.string(), title: z.string(), path: z.string(), body: z.string() })
            .nullable(),
        },
      },
      async ({ slug }) => {
        const page = await projectKnowledge.getRoot(requireProjectCwd(), slug);
        return { content: [], structuredContent: ensureValidJson({ page }) };
      },
    );

    registerTool(
      "update_project_knowledge_root",
      {
        title: "Update project knowledge root",
        description:
          "Replace one project-map root with evidence-backed rich Markdown. Preserve useful detail and wiki-link atomic pages; never populate it from guesses.",
        inputSchema: {
          slug: z.enum(["background", "architecture", "flow", "mindmap", "stack", "roadmap"]),
          body: z.string(),
        },
        outputSchema: { applied: z.boolean(), path: z.string().optional() },
      },
      async ({ slug, body }) => {
        const page = await projectKnowledge.updateRoot({ cwd: requireProjectCwd(), slug, body });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: page !== null,
            ...(page ? { path: page.path } : {}),
          }),
        };
      },
    );

    registerTool(
      "lint_project_knowledge_links",
      {
        title: "Lint project knowledge links",
        description:
          "Find unresolved [[wiki links]] in root pages and active compiled truth. Historical timeline text is intentionally not rewritten or linted.",
        inputSchema: {},
        outputSchema: {
          broken: z.array(z.object({ source: z.string(), target: z.string() })),
        },
      },
      async () => ({
        content: [],
        structuredContent: ensureValidJson({
          broken: await projectKnowledge.lintLinks(requireProjectCwd()),
        }),
      }),
    );

    registerTool(
      "query_project_knowledge",
      {
        title: "Query project knowledge",
        description:
          "Search the repository's durable Markdown knowledge. Use this before broad repository searches when the " +
          "task asks why something is done a certain way or what the team already decided. Results include current " +
          "truth and append-only evidence; verify implementation facts against current code when needed.",
        inputSchema: {
          query: z.string().describe("The task or question to match against project knowledge."),
        },
        outputSchema: {
          records: z.array(recordOutputSchema),
        },
      },
      async ({ query }) => {
        const records = await projectKnowledge.query(requireProjectCwd(), query);
        return {
          content: [],
          structuredContent: ensureValidJson({
            records: records.map(toToolRecord),
          }),
        };
      },
    );

    registerTool(
      "record_project_knowledge",
      {
        title: "Record project knowledge",
        description:
          "Record a durable project fact in the repository's shared knowledge store. Default to a proposal. Set " +
          "confirmed only when the user explicitly made or confirmed the record. Findings capture unresolved observations and do not imply a decision or remediation plan. " +
          "Do not record guesses, transient implementation details, secrets, or information that source code states plainly. " +
          "The catalog is injected automatically, while the rich page remains pull-on-demand. Use update_project_knowledge_truth for any later change to current truth, " +
          "because it atomically records the reason in the page timeline.",
        inputSchema: {
          kind: z.enum(["finding", "decision", "constraint", "requirement", "architecture"]),
          id: z
            .string()
            .optional()
            .describe(
              "Optional lowercase kebab-case page id. Otherwise Otto derives it from title.",
            ),
          title: z.string(),
          statement: z.string(),
          evidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affects: z
            .array(z.string())
            .optional()
            .describe("Human page ids materially affected by this decision."),
          status: z
            .enum(["proposed", "confirmed"])
            .optional()
            .describe("Defaults to proposed. Use confirmed only after explicit user confirmation."),
        },
        outputSchema: { id: z.string(), status: z.string() },
      },
      async ({ kind, id, title, statement, evidence, tags, affects, status }) => {
        const record = await projectKnowledge.record({
          cwd: requireProjectCwd(),
          kind,
          ...(id ? { id } : {}),
          title,
          statement,
          ...(evidence ? { evidence } : {}),
          ...(tags ? { tags } : {}),
          ...(affects ? { affects } : {}),
          ...(status ? { status } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({ id: record.id, status: record.status }),
        };
      },
    );

    registerTool(
      "migrate_legacy_project_findings",
      {
        title: "Migrate legacy project findings",
        description:
          "Import every dated report under the repository's legacy findings/ tree as a confirmed first-class Knowledge finding. The import preserves the report body and migration provenance, rewrites relative links for the new location, and never deletes the source tree.",
        inputSchema: {},
        outputSchema: {
          imported: z.number().int().nonnegative(),
          skipped: z.number().int().nonnegative(),
        },
      },
      async () => {
        const result = await projectKnowledge.importLegacyFindings(requireProjectCwd());
        return { content: [], structuredContent: ensureValidJson(result) };
      },
    );

    registerTool(
      "record_project_charter",
      {
        title: "Record project charter",
        description:
          "Create a first-class project charter in repository knowledge. The charter's review status says whether its description is trusted; delivery_status independently tracks execution. Use this for durable initiatives, not transient tasks. Default review status is proposed unless the user explicitly confirms the charter.",
        inputSchema: {
          id: z.string().optional(),
          title: z.string(),
          charter: z
            .string()
            .describe("Rich Markdown scope, outcomes, constraints, and acceptance criteria."),
          deliveryStatus: z
            .enum([
              "charter",
              "in_build",
              "partial",
              "blocked",
              "complete",
              "reference",
              "deferred",
              "cancelled",
            ])
            .optional(),
          progress: z
            .object({
              completed: z.number().int().nonnegative(),
              total: z.number().int().positive(),
              unit: z.string(),
            })
            .optional(),
          evidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affects: z.array(z.string()).optional(),
          status: z.enum(["proposed", "confirmed"]).optional(),
        },
        outputSchema: { id: z.string(), status: z.string(), delivery_status: z.string() },
      },
      async ({ id, title, charter, deliveryStatus, progress, evidence, tags, affects, status }) => {
        const record = await projectKnowledge.record({
          cwd: requireProjectCwd(),
          kind: "project",
          ...(id ? { id } : {}),
          title,
          statement: charter,
          ...(deliveryStatus ? { deliveryStatus } : {}),
          ...(progress ? { progress } : {}),
          ...(evidence ? { evidence } : {}),
          ...(tags ? { tags } : {}),
          ...(affects ? { affects } : {}),
          ...(status ? { status } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            id: record.id,
            status: record.status,
            delivery_status: record.deliveryStatus ?? "charter",
          }),
        };
      },
    );

    registerTool(
      "update_project_delivery",
      {
        title: "Update project delivery",
        description:
          "Update a charter's delivery state or structured progress and append the reason permanently. This never confirms or supersedes the charter itself; use set_project_knowledge_status for review state.",
        inputSchema: {
          id: z.string(),
          deliveryStatus: z
            .enum([
              "charter",
              "in_build",
              "partial",
              "blocked",
              "complete",
              "reference",
              "deferred",
              "cancelled",
            ])
            .optional(),
          progress: z
            .object({
              completed: z.number().int().nonnegative(),
              total: z.number().int().positive(),
              unit: z.string(),
            })
            .nullable()
            .optional()
            .describe("Structured completion. Pass null to remove an obsolete metric."),
          reason: z.string(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, deliveryStatus, progress, reason, expectedUpdatedAt }) => {
        const result = await projectKnowledge.updateProject({
          cwd: requireProjectCwd(),
          id,
          ...(deliveryStatus ? { deliveryStatus } : {}),
          ...(progress !== undefined ? { progress } : {}),
          reason,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "record_project_reference",
      {
        title: "Record project reference",
        description:
          "Create a first-class reference page describing an external source and exactly how it affected the project. Record rejected sources too, with the reason, so future agents do not repeat the research.",
        inputSchema: {
          id: z.string().optional(),
          title: z.string(),
          summary: z.string().describe("Rich Markdown evaluation and project relevance."),
          disposition: z
            .enum(["unevaluated", "read", "adopted", "rejected", "dependency"])
            .optional(),
          sourceUrl: z.string().optional(),
          evidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affects: z.array(z.string()).optional(),
          status: z.enum(["proposed", "confirmed"]).optional(),
        },
        outputSchema: { id: z.string(), status: z.string(), disposition: z.string() },
      },
      async ({ id, title, summary, disposition, sourceUrl, evidence, tags, affects, status }) => {
        const record = await projectKnowledge.record({
          cwd: requireProjectCwd(),
          kind: "reference",
          ...(id ? { id } : {}),
          title,
          statement: summary,
          ...(disposition ? { referenceDisposition: disposition } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(evidence ? { evidence } : {}),
          ...(tags ? { tags } : {}),
          ...(affects ? { affects } : {}),
          ...(status ? { status } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            id: record.id,
            status: record.status,
            disposition: record.referenceDisposition ?? "unevaluated",
          }),
        };
      },
    );

    registerTool(
      "update_project_reference",
      {
        title: "Update project reference",
        description:
          "Update a reference's evaluation or source URL and append the reason permanently. Use update_project_knowledge_truth when its written evaluation also changes.",
        inputSchema: {
          id: z.string(),
          disposition: z
            .enum(["unevaluated", "read", "adopted", "rejected", "dependency"])
            .optional(),
          sourceUrl: z.string().nullable().optional(),
          reason: z.string(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, disposition, sourceUrl, reason, expectedUpdatedAt }) => {
        const result = await projectKnowledge.updateReference({
          cwd: requireProjectCwd(),
          id,
          ...(disposition ? { disposition } : {}),
          ...(sourceUrl !== undefined ? { sourceUrl } : {}),
          reason,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "set_project_knowledge_status",
      {
        title: "Set project knowledge status",
        description:
          "Confirm, supersede, or return a project-knowledge record to proposed. Only confirm or supersede after the user has explicitly agreed. " +
          "A superseded record remains as repository history but is neither injected nor returned by normal search.",
        inputSchema: {
          id: z.string(),
          status: z.enum(["proposed", "confirmed", "superseded"]),
          reason: z.string().optional().describe("Why this review status is appropriate."),
        },
        outputSchema: { applied: z.boolean(), status: z.string() },
      },
      async ({ id, status, reason }) => {
        const record = await projectKnowledge.setStatus(requireProjectCwd(), id, status, reason);
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: record !== null,
            status: record?.status ?? "not_found",
          }),
        };
      },
    );

    registerTool(
      "delete_project_knowledge",
      {
        title: "Delete accidental project knowledge",
        description:
          "Permanently delete an accidental or junk project-knowledge page. Use only after the user explicitly approves deleting that exact page; supersede valid historical knowledge instead.",
        inputSchema: {
          id: z.string(),
          reason: z
            .string()
            .describe("Why permanent deletion is appropriate instead of superseding."),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { deleted: z.boolean(), error: z.string().optional() },
      },
      async ({ id, reason, expectedUpdatedAt }) => {
        const result = await projectKnowledge.delete({
          cwd: requireProjectCwd(),
          id,
          reason,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson(result),
        };
      },
    );

    registerTool(
      "update_project_knowledge_truth",
      {
        title: "Update project knowledge truth",
        description:
          "Rewrite one knowledge page's current truth and atomically append the reason to its permanent timeline. " +
          "Use only after the user explicitly agrees that the established understanding changed.",
        inputSchema: {
          id: z.string(),
          statement: z.string(),
          reason: z.string().describe("Why the current truth changed."),
          source: z.string().optional(),
          affects: z.array(z.string()).optional(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, statement, reason, source, affects, expectedUpdatedAt }) => {
        const result = await projectKnowledge.updateTruth({
          cwd: requireProjectCwd(),
          id,
          statement,
          reason,
          ...(source ? { source } : {}),
          ...(affects ? { affects } : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "append_project_knowledge_evidence",
      {
        title: "Append project knowledge evidence",
        description:
          "Append evidence to a knowledge page's permanent timeline without changing current truth. Use it for " +
          "verified benchmarks, user decisions, or source references that may matter later.",
        inputSchema: {
          id: z.string(),
          text: z.string(),
          source: z.string().optional(),
          affects: z.array(z.string()).optional(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, text, source, affects, expectedUpdatedAt }) => {
        const result = await projectKnowledge.appendEvidence({
          cwd: requireProjectCwd(),
          id,
          text,
          ...(source ? { source } : {}),
          ...(affects ? { affects } : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "bootstrap_project_knowledge",
      {
        title: "Bootstrap project knowledge",
        description:
          "Initialize the repository's Markdown knowledge tree and generated index without requiring `.otto/KNOWLEDGE.md`; preserve optional project guidance when present. " +
          "Then inspect code, official docs, and Git history before creating draft pages. Never invent facts.",
        inputSchema: {},
        outputSchema: { initialized: z.boolean() },
      },
      async () => {
        await projectKnowledge.bootstrap(requireProjectCwd());
        return { content: [], structuredContent: ensureValidJson({ initialized: true }) };
      },
    );
  }

  registerTool(
    "archive_chat",
    {
      title: "Archive chat",
      description:
        "Stop and archive a chat. It is removed from the active list but remains recoverable in the archive.",
      inputSchema: { agentId: z.string() },
      outputSchema: { success: z.boolean() },
    },
    async ({ agentId }) => {
      await archiveAgentCommand({ agentManager, agentStorage, logger: childLogger }, agentId);
      return { content: [], structuredContent: ensureValidJson({ success: true }) };
    },
  );

  registerTool(
    "delete_chat",
    {
      title: "Delete chat",
      description: "Permanently terminate and delete a chat session.",
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
    "update_chat",
    {
      title: "Update chat",
      description: "Update a chat name, labels, and/or runtime settings.",
      inputSchema: {
        agentId: z.string(),
        name: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
        settings: UpdateAgentSettingsInputSchema.optional().describe(
          "Runtime settings to apply to the chat.",
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
        'Create an artifact: a self-contained HTML page (report, dashboard, visualization, mockup) generated by a background agent and shown in the Artifacts screen. Returns immediately as "generating" and flips to "ready"/"error" on its own within minutes - no need to poll. Runs unattended and inherits your provider/model/effort/mode unless overridden. The generator can\'t see this conversation, so put all content, data, and requirements in the description.',
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
            "Generation prompt. Self-contained: include all content, data, and requirements - the generator has no access to this conversation.",
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
            "Permission mode id for the generation agent (unattended/bypass modes only - anything else falls back to the provider's unattended default, so generation never stalls). Defaults to your own mode when generating with your provider.",
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

      // When the artifact inherits the caller's brain (no explicit provider
      // override), it also inherits the caller's personality identity so the
      // card shows who generated it, matching the create sheet.
      const inheritedIdentity = resolveInheritedArtifactIdentity({
        providerOverridden: input.provider !== undefined,
        snapshot: callerAgent?.config.personalitySnapshot,
      });

      const artifact = await artifactService.create({
        name,
        description: input.description,
        projectId,
        provider,
        ...(model ? { model } : {}),
        ...(resolvedThinkingOptionId ? { thinkingOptionId: resolvedThinkingOptionId } : {}),
        ...(modeId ? { modeId } : {}),
        ...inheritedIdentity,
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
      outputSchema: {
        ...StoredArtifactSchema.shape,
        data: z.json().nullable(),
      },
    },
    async ({ artifactId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const record = await artifactService.inspect(artifactId);
      const data = await artifactService.getData(artifactId);
      return {
        content: [],
        structuredContent: ensureValidJson({ ...record, data }),
      };
    },
  );

  registerTool(
    "update_artifact_data",
    {
      title: "Update artifact data",
      description:
        "Replace only an artifact's dedicated JSON data block. Use inspect_artifact first to learn its current data, then send the complete replacement data. This never changes the artifact's HTML, UI, CSS, or JavaScript. Artifacts made before the data contract may need regeneration first.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to update; call inspect_artifact first for its data contract."),
        data: z.json().describe("Complete JSON data replacement for the artifact."),
      },
      outputSchema: ArtifactToolSummarySchema.shape,
    },
    async ({ artifactId, data }: { artifactId: string; data: unknown }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const updated = await artifactService.updateData(artifactId, data);
      options.emitArtifactUpdated?.(updated);
      return {
        content: [],
        structuredContent: ensureValidJson(toArtifactToolSummary(updated)),
      };
    },
  );

  registerTool(
    "update_artifact",
    {
      title: "Update artifact",
      description:
        "Edit an artifact's metadata - name, prompt, project, provider, model, effort - WITHOUT re-running generation. Call generate_artifact afterwards to re-generate with the new settings.",
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
      description:
        "Capture plain-text terminal output lines from a terminal session. " +
        `With scrollback and no start/end, returns the last ${CAPTURE_TERMINAL_SCROLLBACK_DEFAULT_LINES} lines; pass start/end for any other range.`,
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
        start: resolveCaptureTerminalStart({ start, end, scrollback }),
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
    isolation?: "local" | "worktree";
  }) => {
    // Left off the config entirely when omitted: the run resolves `isolation ??
    // "local"`, and materializing the default here would make every stored
    // schedule claim an explicit choice its author never made.
    const isolation = input.isolation ? { isolation: input.isolation } : {};
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
        ...isolation,
      };
    }

    const baseTarget = resolveNewAgentScheduleTarget({ provider: input.provider, cwd: input.cwd });
    const config: typeof baseTarget.config & {
      thinkingOptionId?: string;
      isolation?: "local" | "worktree";
    } = {
      ...baseTarget.config,
      ...isolation,
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
        isolation: z
          .enum(["local", "worktree"])
          .optional()
          .describe(
            "Where each run works. 'local' (default) runs in the schedule's cwd; 'worktree' cuts a fresh Otto-managed worktree per run.",
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
      isolation,
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
        ...(isolation ? { isolation } : {}),
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

  // The counterpart to create_heartbeat, and the reason it exists separately
  // from delete_schedule: create_heartbeat stamps the caller as the target, but
  // delete_schedule takes a bare id and would happily let one agent delete
  // another's heartbeat. This one refuses anything the caller does not own.
  registerTool(
    "delete_heartbeat",
    {
      title: "Delete heartbeat",
      description: "Delete one of your own heartbeats.",
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
      if (!callerAgentId) {
        throw new Error("delete_heartbeat requires an agent-scoped session");
      }

      const schedule = await scheduleService.inspect(id);
      if (schedule.target.type !== "agent" || schedule.target.agentId !== callerAgentId) {
        throw new Error(`Heartbeat ${id} does not belong to caller ${callerAgentId}`);
      }

      await scheduleService.delete(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
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
        // Resolve against the provider/model the schedule ends up with -
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
    "list_profiles",
    {
      title: "List agent profiles",
      description:
        "List the host's named agent profiles. Profiles bind provider/model/mode settings and may also carry Otto roles, prompts, voice, spinner, and memory behavior. Read `notes` and `roles` to choose a collaborator, then pass its name to create_chat or copy its launch settings.",
      inputSchema: {},
      outputSchema: { profiles: z.array(AgentProfileSchema) },
    },
    async () => {
      // v0.4 profiles are the canonical shape. Fold legacy Otto personalities
      // into that roster so role/prompt/voice behavior survives migration
      // without exposing two independent lists to new callers.
      const byId = new Map<string, Record<string, unknown>>();
      for (const personality of readAgentPersonalities?.() ?? []) {
        byId.set(personality.id, {
          id: personality.id,
          name: personality.name,
          provider: personality.provider,
          model: personality.model,
          modeId: personality.modeId,
          effortLevel: personality.effortLevel,
          personalityPrompt: personality.personalityPrompt,
          respectGlobalAppendPrompt: personality.respectGlobalAppendPrompt,
          roles: personality.roles,
          spinner: personality.spinner,
          voice: personality.voice,
          voiceCues: personality.voiceCues,
          memoryEnabled: personality.memoryEnabled,
        });
      }
      for (const profile of daemonConfigStore?.get().agentProfiles ?? []) {
        byId.set(profile.id, { ...byId.get(profile.id), ...profile });
      }
      return {
        content: [],
        structuredContent: ensureValidJson({ profiles: [...byId.values()] }),
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

  // Workspace-level counterparts to the worktree tools below. These speak the
  // noun the UI uses: one create_workspace call covers both an existing
  // checkout and a fresh worktree, selected by `isolation` (docs/glossary.md).
  // The worktree tools stay registered - they are the lower-level operation,
  // and archive_worktree in particular archives every workspace on a worktree,
  // which archive_workspace deliberately does not do.
  registerTool(
    "create_workspace",
    {
      title: "Create workspace",
      description:
        "Create a workspace using an existing local checkout or a new Otto-managed worktree.",
      inputSchema: {
        isolation: z.enum(["local", "worktree"]),
        path: z
          .string()
          .optional()
          .describe("Local directory or source checkout. Defaults to your current workspace."),
        projectId: z.string().optional().describe("Existing project id to own the workspace."),
        title: z.string().trim().min(1).optional(),
        mode: z
          .enum(["branch-off", "checkout-branch", "checkout-pr"])
          .optional()
          .describe("Worktree creation mode. Defaults to branch-off."),
        worktreeSlug: z.string().trim().min(1).optional(),
        branchName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New branch name for branch-off mode."),
        baseBranch: z.string().trim().min(1).optional().describe("Base ref for branch-off mode."),
        branch: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Existing branch for checkout-branch mode."),
        prNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Change request number for checkout-pr mode."),
        forge: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Git host the change request lives on for checkout-pr mode, for example github or bitbucket. Defaults to the workspace's resolved forge.",
          ),
      },
      outputSchema: WorkspaceAutomationSummarySchema.shape,
    },
    async ({
      isolation,
      path,
      projectId,
      title,
      mode,
      worktreeSlug,
      branchName,
      baseBranch,
      branch,
      prNumber,
      forge,
    }) => {
      let workspace: PersistedWorkspaceRecord;
      if (isolation === "local") {
        const cwd = resolveScopedCwd(path, { required: true });
        assertWorkspaceOptionsAbsent(
          [
            ["mode", mode],
            ["worktreeSlug", worktreeSlug],
            ["branchName", branchName],
            ["baseBranch", baseBranch],
            ["branch", branch],
            ["prNumber", prNumber],
            ["forge", forge],
          ],
          "Worktree options require isolation worktree",
        );
        if (!options.createDirectoryWorkspace) {
          throw new Error("Workspace provisioning is not configured");
        }
        workspace = await options.createDirectoryWorkspace(cwd, title ?? null, projectId);
      } else {
        // A projectId alone is enough: the worktree source falls back to the
        // project's root checkout, so an agent can cut a worktree for a project
        // it has never had a cwd in.
        let cwd =
          path !== undefined || !projectId ? resolveScopedCwd(path, { required: true }) : null;
        if (!cwd) {
          if (!options.projectRegistry) {
            throw new Error("Project registry is not configured");
          }
          cwd = await resolveWorktreeSourceCwd({ projectId }, options.projectRegistry);
        }
        const commandResult = await createOttoWorktreeCommand(
          {
            ottoHome: options.ottoHome,
            worktreesRoot: options.worktreesRoot,
            createOttoWorktreeWorkflow: options.createOttoWorktree,
          },
          {
            ...createMcpWorktreeCommandInput(
              cwd,
              resolveWorkspaceWorktreeTarget({
                ...(mode ? { mode } : {}),
                ...(worktreeSlug ? { worktreeSlug } : {}),
                ...(branchName ? { branchName } : {}),
                ...(baseBranch ? { baseBranch } : {}),
                ...(branch ? { branch } : {}),
                ...(prNumber === undefined ? {} : { prNumber }),
                ...(forge ? { forge } : {}),
              }),
            ),
            ...(projectId ? { projectId } : {}),
            ...(title ? { title } : {}),
          },
        );
        if (!commandResult.ok) {
          throw new WorktreeRequestError(commandResult.error);
        }
        workspace = commandResult.createdWorktree.workspace;
      }

      return {
        content: [],
        structuredContent: ensureValidJson(toWorkspaceAutomationSummary(workspace)),
      };
    },
  );

  registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "List active workspaces.",
      inputSchema: {},
      outputSchema: { workspaces: z.array(WorkspaceAutomationSummarySchema) },
    },
    async () => {
      if (!options.workspaceRegistry?.list) {
        throw new Error("Workspace registry is not configured");
      }
      const workspaces = (await options.workspaceRegistry.list())
        .filter((workspace) => !workspace.archivedAt)
        .map(toWorkspaceAutomationSummary);
      return {
        content: [],
        structuredContent: ensureValidJson({ workspaces }),
      };
    },
  );

  registerTool(
    "archive_workspace",
    {
      title: "Archive workspace",
      description: "Archive a workspace and everything it owns.",
      inputSchema: { workspaceId: z.string().min(1) },
      outputSchema: {
        workspaceId: z.string(),
        archivedAgentIds: z.array(z.string()),
        removedDirectory: z.boolean(),
      },
    },
    async ({ workspaceId }) => {
      if (!options.listActiveWorkspaces) {
        throw new Error("Active workspace lister is required to archive workspaces");
      }
      const workspace = await requireActiveWorkspaceForArchive(
        { listActiveWorkspaces: options.listActiveWorkspaces },
        workspaceId,
      );
      // A worktree-backed workspace lives under a parent repo whose worktree
      // list goes stale the moment this one is removed. Hand the repo root to
      // archiveByScope so it force-refreshes that snapshot, exactly as
      // archive_worktree does - otherwise the removed worktree lingers in the UI.
      const repoRoot =
        workspace.kind === "worktree" && options.workspaceGitService
          ? await options.workspaceGitService.resolveRepoRoot(workspace.cwd).catch(() => undefined)
          : undefined;
      const result = await archiveByScope(
        archiveWorktreeDependencies(options, {
          agentManager,
          agentStorage,
          terminalManager: terminalManager ?? null,
          logger: childLogger,
        }),
        {
          requestId: "mcp:archive_workspace",
          scope: { kind: "workspace", workspaceId: workspace.workspaceId },
          ...(repoRoot ? { repoRoot } : {}),
        },
      );
      return {
        content: [],
        structuredContent: ensureValidJson({
          workspaceId,
          archivedAgentIds: result.archivedAgentIds,
          removedDirectory: result.removedDirectory,
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
    "get_chat_activity",
    {
      title: "Get chat activity",
      description: "Return recent chat timeline entries as a curated summary.",
      inputSchema: {
        agentId: z.string(),
        limit: z
          .number()
          .max(GET_AGENT_ACTIVITY_MAX_LIMIT)
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

      // Default to a bounded window: `limit ?? 0` meant the entire child
      // transcript, which for a long-running agent is an unbounded dump that
      // gets replayed on every round. Callers can still opt into more (or all,
      // via a large limit) with the arg.
      const effectiveLimit = limit ?? GET_AGENT_ACTIVITY_DEFAULT_LIMIT;
      const selection = selectItemsByProjectedLimit({
        items: timeline,
        direction: "tail",
        limit: effectiveLimit,
      });
      const curatedContent = curateAgentActivity(selection.items);
      const { totalProjected, shownProjected } = selection;

      const noun = totalProjected === 1 ? "activity" : "activities";
      const countHeader =
        shownProjected < totalProjected
          ? `Showing the ${shownProjected} most recent of ${totalProjected} ${noun}` +
            (limit === undefined
              ? ` (default limit ${effectiveLimit}; pass \`limit\` for more)`
              : ` (limited to ${limit})`)
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
    "set_chat_mode",
    {
      title: "Set chat mode",
      description:
        "Switch the chat's permission/runtime mode (plan, bypassPermissions, read-only, auto, etc.).",
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
        "Return all pending permission requests across Otto chats with normalized payloads.",
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
      description: "Approve or deny a pending permission request for an Otto chat.",
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
  // wait_for_chats: the multi-chat gather barrier the daemon lacked. Useful on
  // its own (a conductor hand-tracking children) and reused by the run runtime.
  registerTool(
    "wait_for_chats",
    {
      title: "Wait for chats",
      description:
        "Wait until every listed chat reaches a terminal state (idle/error) or needs permission, then return each chat's final message. The gather barrier for fan-out work.",
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
              return {
                agentId: id,
                status: result.status,
                lastMessage: lastMessage == null ? null : capWaitForAgentsMessage(lastMessage),
              };
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
    // conductor, in the conductor's workspace. Mirrors the create_chat flow.
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
          scheduleAutoTitle: options.scheduleAutoTitle,
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
      "start_orchestration",
      {
        title: "Start orchestration",
        description:
          "Use when active work needs a declared multi-chat plan with daemon-managed fan-out, gathering, judging, loops, or approval gates. The daemon executes typed phases (research/plan/implement/design/verify/gate/deliver), fans out candidates, judges them, loops until enough pass, and pauses at gates for approval. Each phase dispatches to the active team's personality profile for its role and fails clearly if the team lacks one. Waits until the orchestration completes (returning `result`, the final deliverable, which you should relay to the user) or pauses at a gate (returning a `note` to relay). Do not use for a discrete task that can be completed directly or by one dedicated chat.",
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
        const runWorkerAgentIds = new Set<string>();

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
            runWorkerAgentIds.add(agentId);
            return { agentId, personalityId: member.id };
          },
          awaitAgent: async ({ agentId, signal }) => {
            try {
              // Wait for the whole subtree to settle, not just the worker's first
              // idle - a worker that spawns its own helpers gets re-invoked when
              // they finish and writes its real answer in a later turn.
              const result = await agentManager.waitForAgentFullySettled(agentId, { signal });
              const finalMessage =
                result.lastMessage ?? (await agentManager.getLastAssistantMessage(agentId));
              return { finalMessage: finalMessage ?? null, failed: result.status === "error" };
            } catch {
              return { finalMessage: null, failed: true };
            }
          },
          cancelAgent: async ({ agentId }) => {
            try {
              // The cancel cascade: a canceled run must really stop its
              // children, not abandon them running. Best-effort - an agent that
              // settled first is the expected race.
              await agentManager.cancelAgentRun(agentId);
            } catch (error) {
              childLogger.warn({ err: error, agentId }, "Could not cancel a run child on cancel");
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
        // An orchestration plan gathers its chats inside the daemon, rather than
        // letting every worker notify the conductor. Restore one aggregate
        // hand-back only if the original tool turn has gone away; the normal
        // path receives the result below without an extra turn. This lifecycle
        // applies only to AI-declared plans, not graph orchestration.
        attachStartRunLifecycle({
          runId: run.id,
          settled,
          ...(callerAgentId ? { conductorAgentId: callerAgentId } : {}),
          workerAgentIds: runWorkerAgentIds,
          port: {
            conductorHasInFlightTurn: () =>
              Boolean(callerAgentId && agentManager.hasInFlightRun(callerAgentId)),
            notifyConductor: async (text) => {
              if (!callerAgentId) {
                return;
              }
              await sendPromptToAgent({
                agentManager,
                agentStorage,
                agentId: callerAgentId,
                prompt: formatSystemNotificationPrompt(text),
                unarchive: false,
                delivery: "queue",
                source: "system",
                logger: childLogger,
              });
            },
            archiveWorker: async (agentId) => {
              // A settled child stays live just long enough for the terminal Run
              // to become durable, then leaves the conductor's completed list.
              // It is safe for a user to have archived it first.
              if (agentManager.getAgent(agentId)) {
                await agentManager.archiveAgent(agentId);
              }
            },
            logger: childLogger,
          },
        });
        // Block until the run settles or parks at a gate, so the conductor comes
        // back with the actual deliverable to relay - not just a fire-and-forget id.
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
      "get_orchestration_status",
      {
        title: "Get orchestration status",
        description:
          "Return the current projection of an orchestration - its phases, statuses, and structured judge verdicts.",
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

  registerGraphNodeTools({
    tools,
    agentManager,
    callerAgentId,
    nodeOutputStore: options.nodeOutputStore,
    logger: childLogger,
  });

  return toCatalog();
}

/**
 * Tools that belong to one graph node rather than to Otto: its submit_output
 * channel and its author-defined lookups. Both are read from the agent's own
 * labels, so they exist for exactly one agent and reach every provider the same
 * way (MCP-served seats through the daemon's MCP server, openai-compat seats
 * through the native tool loop).
 */
function registerGraphNodeTools(input: {
  tools: Map<string, OttoToolDefinition>;
  agentManager: AgentManager;
  callerAgentId: string | undefined;
  nodeOutputStore: NodeOutputStore | null | undefined;
  logger: Logger;
}): void {
  registerNodeOutputTool({ ...input, nodeOutputStore: input.nodeOutputStore ?? null });
  registerNodeQueryTools(input);
}

/**
 * Register a graph node's own read-only query tools, from its labels.
 *
 * Like submit_output these sit past the group gates, because they are not Otto
 * capabilities being handed out - they are lookups this node's author defined
 * for this node, and each one is read-only by construction
 * (orchestration/node-query-tools.ts). Names are prefixed so a query tool can
 * never shadow a built-in.
 */
function registerNodeQueryTools(input: {
  tools: Map<string, OttoToolDefinition>;
  agentManager: AgentManager;
  callerAgentId: string | undefined;
  logger: Logger;
}): void {
  const { tools, agentManager, callerAgentId, logger } = input;
  if (!callerAgentId) {
    return;
  }
  const agent = agentManager.getAgent(callerAgentId);
  const declared = getQueryToolsFromLabels(agent?.labels);
  if (!declared) {
    return;
  }
  const cwd = agent?.cwd;
  for (const tool of declared) {
    const name = queryToolName(tool);
    tools.set(name, {
      name,
      title: tool.name,
      description: tool.description,
      inputSchema: compileOutputToolInputShape(tool.parameters ?? []),
      handler: async (rawInput: unknown, context): Promise<OttoToolResult> => {
        if (!cwd) {
          return {
            content: [{ type: "text", text: "This agent has no working directory." }],
            isError: true,
          };
        }
        const result = await executeQueryTool({
          tool,
          args: (rawInput ?? {}) as Record<string, unknown>,
          cwd,
          ...(context.signal ? { signal: context.signal } : {}),
        });
        logger.debug({ agentId: callerAgentId, tool: name }, "Query tool executed");
        return {
          content: [{ type: "text", text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        };
      },
    });
  }
}

/**
 * Register submit_output for an agent the daemon spawned as a graph node with
 * declared output fields (projects/orchestration-graphs). The contract rides on
 * the agent's own labels, so the tool exists for exactly one agent and every
 * provider reaches it the same way - MCP-served seats through the daemon's MCP
 * server, openai-compat seats through the native tool loop.
 *
 * Deliberately registered past the group and orchestration-policy gates. Those
 * gates decide which Otto *capabilities* a node may use; this is not a
 * capability, it is the node's own deliverable channel. A deterministic node -
 * the very kind most likely to declare fields - would otherwise have its submit
 * tool stripped as part of the "agents" group and could never satisfy the
 * contract its graph gave it.
 *
 * Validation failure is returned as a tool error rather than thrown: the model
 * sees the message and corrects within the same session, which costs one turn
 * instead of a re-dispatch.
 */
function registerNodeOutputTool(input: {
  tools: Map<string, OttoToolDefinition>;
  agentManager: AgentManager;
  callerAgentId: string | undefined;
  nodeOutputStore: NodeOutputStore | null;
  logger: Logger;
}): void {
  const { tools, agentManager, callerAgentId, nodeOutputStore, logger } = input;
  if (!callerAgentId || !nodeOutputStore) {
    return;
  }
  const fields = getOutputFieldsFromLabels(agentManager.getAgent(callerAgentId)?.labels);
  if (!fields) {
    return;
  }
  tools.set("submit_output", {
    name: "submit_output",
    title: "Submit output",
    description:
      "Submit this node's declared output fields. Call exactly once when your work is complete - this call is the deliverable, not your chat message.",
    inputSchema: compileOutputToolInputShape(fields),
    handler: async (rawInput: unknown): Promise<OttoToolResult> => {
      const validation = validateNodeOutput(fields, rawInput);
      if (!validation.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Validation error: ${validation.message}. Correct the values and call submit_output again.`,
            },
          ],
          isError: true,
        };
      }
      nodeOutputStore.record(callerAgentId, validation.value);
      logger.debug({ agentId: callerAgentId }, "Node output submitted");
      return {
        content: [{ type: "text", text: "Output submitted." }],
      };
    },
  });
}

type McpCreateWorktreeTarget =
  | { kind: "branch-off"; worktreeSlug?: string; branchName?: string; baseBranch?: string }
  | { kind: "checkout-branch"; branch: string; worktreeSlug?: string }
  | { kind: "checkout-pr"; githubPrNumber: number; forge?: string };

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
      return {
        ...base,
        action: "checkout",
        refName: target.branch,
        ...(target.worktreeSlug ? { worktreeSlug: target.worktreeSlug } : {}),
      };
    case "checkout-pr":
      // Forge-neutral: a change request number means nothing without the forge
      // it belongs to, so it rides in checkoutSource rather than the legacy
      // GitHub-only githubPrNumber field.
      return {
        ...base,
        action: "checkout",
        checkoutSource: {
          kind: "change_request",
          number: target.githubPrNumber,
          ...(target.forge ? { forge: target.forge } : {}),
        },
      };
    default:
      throw new Error("unreachable");
  }
}
