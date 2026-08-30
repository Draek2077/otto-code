import type { Logger } from "pino";

import type { AgentProfile } from "@otto-code/protocol/messages";
import { getActiveAgentTeam, type AgentTeamsConfigView } from "@otto-code/protocol/agent-teams";
import {
  ORCHESTRATION_OUTPUT_FIELDS_LABEL,
  ORCHESTRATION_POLICY_LABEL,
  ORCHESTRATION_QUERY_TOOLS_LABEL,
  ORCHESTRATION_RUN_ID_LABEL,
  ORCHESTRATION_TOOL_GROUPS_LABEL,
} from "@otto-code/protocol/agent-labels";
import {
  type OrchestrationGraph,
  type PromptTemplate,
  type WorkflowStartConfirmation,
  type WorkflowScheduleSource,
} from "@otto-code/protocol/workflow";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentProvider, ProviderSnapshotEntry } from "../agent/agent-sdk-types.js";
import { resolveProfile, type ResolvedProfileSnapshot } from "../agent/agent-profiles.js";
import { sendPromptToAgent } from "../agent/agent-prompt.js";
import {
  composeTeamAndPersonalityPrompt,
  resolveTeamSnapshotForPersonality,
  type ResolvedTeamSnapshot,
} from "../agent/agent-teams.js";
import {
  type CreateAgentCommandDependencies,
  createAgentCommand,
  formatProviderModel,
} from "../agent/create-agent/create.js";
import { type GraphEngineSpawnInput, validateGraphForExecution } from "./graph-engine.js";
import type { GraphStore } from "./graph-store.js";
import {
  type WorkspaceAccess,
  capabilitiesEnforceAccess,
  describeUnsupportedAccess,
  resolveWorkspaceAccess,
} from "../agent/workspace-access.js";
import type { NodeOutputStore } from "./node-output.js";
import type { PromptTemplateStore } from "./prompt-template-store.js";
import { renderPromptTemplate, resolveTemplateVariables } from "./prompt-render.js";
import { resolveTeamRoleMember } from "./resolve-team-role.js";
import type { GraphSpawnPort, WorkflowService } from "./workflow-service.js";

// User-initiated orchestrations (projects/orchestration-graphs): the daemon
// wiring behind the New Orchestration dialog's `runs.start` RPC. Two flavors:
//
// - "ai": prompt-and-go - persist the Workflow first, then spawn its bound
//   orchestrator agent. The agent later activates that same record with a
//   declared phase plan via start_workflow.
// - "graph": deterministic - persist the immutable graph snapshot, then spawn
//   the orchestrator (root node, hosts the chat) and hand the graph to
//   WorkflowService.startGraphRun with a spawn port that creates every child
//   agent itself. Participants never wire themselves
//   together: children are stamped with the orchestration policy label the
//   otto-tool catalog enforces (deterministic ⇒ no orchestration/preview/
//   browser tools; autonomous ⇒ everything except start_run).
//
// Orchestrator seat precedence (per the dialog): explicit personality → bare
// provider/model → the active team's Orchestrator-role member. No fallback
// beyond that - a missing seat is a loud error.

export interface UserOrchestrationDependencies {
  runService: WorkflowService;
  graphStore: GraphStore;
  agentManager: AgentManager;
  createAgentDeps: CreateAgentCommandDependencies;
  logger: Logger;
  getPersonalityRoster(): AgentProfile[];
  getAgentTeams(): AgentTeamsConfigView | undefined;
  listProviderEntries(cwd: string): Promise<readonly ProviderSnapshotEntry[]>;
  /**
   * Where node agents' submit_output calls land (shared with the Otto tool
   * catalog). Absent on hosts that never execute graphs - such a node then
   * falls back to recovering its fields from prose.
   */
  nodeOutputStore?: NodeOutputStore;
  /** Host-level prompt templates. Absent ⇒ nodes use their inline prompts. */
  promptTemplateStore?: PromptTemplateStore;
}

export interface StartUserOrchestrationInput {
  flavor: string;
  cwd: string;
  workspaceId?: string;
  title?: string;
  description?: string;
  orchestratorPersonalityId?: string;
  orchestratorProvider?: string;
  orchestratorModel?: string;
  orchestratorThinkingOptionId?: string;
  prompt?: string;
  graphId?: string;
  graphInputs?: Record<string, string>;
  /** Internal session proof that the user accepted this exact Graph review. */
  startConfirmationSatisfied?: boolean;
  draft?: boolean;
  runId?: string;
  scheduleSource?: WorkflowScheduleSource;
}

export interface StartUserOrchestrationResult {
  runId?: string;
  agentId?: string;
  confirmation?: WorkflowStartConfirmation;
}

export async function startUserOrchestration(
  deps: UserOrchestrationDependencies,
  input: StartUserOrchestrationInput,
): Promise<StartUserOrchestrationResult> {
  if (input.flavor === "ai") {
    return startAiOrchestration(deps, input);
  }
  if (input.flavor === "graph") {
    return startGraphOrchestration(deps, input);
  }
  throw new Error(`Unknown orchestration flavor "${input.flavor}"`);
}

async function startAiOrchestration(
  deps: UserOrchestrationDependencies,
  input: StartUserOrchestrationInput,
): Promise<StartUserOrchestrationResult> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error("An AI orchestration needs a prompt.");
  }
  const seat = await resolveOrchestratorSeat(deps, input);
  const title = input.title?.trim() || "Orchestration";
  const description = input.description?.trim();
  const team = getActiveAgentTeam(deps.getAgentTeams());
  const run = await deps.runService.createAiRun({
    title,
    ...(description ? { description } : {}),
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(team ? { teamId: team.id, teamName: team.name } : {}),
  });
  const kickoff =
    `${prompt}\n\n` +
    (description ? `Context (what this orchestration is for): ${description}\n\n` : "") +
    `Run this as an AI Workflow: declare a multi-agent plan with the start_workflow tool and let ` +
    `the daemon execute it, then relay the results. Use Otto tools only - never spawn ` +
    `provider-native subagents or workflows for this Workflow.`;
  try {
    const agentId = await spawnOrchestrationAgent(deps, {
      seat,
      title,
      prompt: kickoff,
      cwd: input.cwd,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      labels: { [ORCHESTRATION_RUN_ID_LABEL]: run.id },
      detached: true,
    });
    await deps.runService.bindAiRunConductor({
      runId: run.id,
      conductorAgentId: agentId,
      cancelConductor: async () => {
        await deps.agentManager.cancelAgentRun(agentId);
      },
    });
    // The record stays "planning" for as long as its chat is alive: a model
    // that asks a clarifying question first must still be able to declare its
    // plan on a later turn. The daemon's agent-archived hook (bootstrap.ts)
    // fails the record if the chat is archived or deleted without a plan.
    return { runId: run.id, agentId };
  } catch (error) {
    await deps.runService.failPendingAiRun(
      run.id,
      `Could not start the orchestrator: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

async function startGraphOrchestration(
  deps: UserOrchestrationDependencies,
  input: StartUserOrchestrationInput,
): Promise<StartUserOrchestrationResult> {
  if (!input.graphId) {
    throw new Error("A graph orchestration needs a graphId.");
  }
  const graph = await deps.graphStore.get(input.graphId);
  if (!graph) {
    throw new Error(`Graph ${input.graphId} not found`);
  }
  // The Graph is fully known before its root agent starts. Keep this daemon
  // check next to launch: a client may render the same review, but it cannot
  // lower the threshold or skip the confirmation by altering UI state.
  const title = input.title?.trim() || graph.name;
  const description = input.description?.trim();
  const descriptionField = description ? { description } : {};
  // The cast is FROZEN here, once: every node seat, and the team prompt each
  // child composes, resolves against this view for the whole run - a mid-run
  // team edit must not re-cast later nodes or shear a running orchestration.
  // (The phase-run path gets the same guarantee from its per-run role cache.)
  const agentTeamsView = deps.getAgentTeams();
  const team = getActiveAgentTeam(agentTeamsView);
  const teamFields = team ? { teamId: team.id, teamName: team.name } : {};
  const scheduleSourceField = optionalScheduleSource(input.scheduleSource);

  if (input.draft) {
    const run = await deps.runService.createDraftGraphRun({
      graph,
      title,
      ...descriptionField,
      ...(input.graphInputs ? { graphInputs: input.graphInputs } : {}),
      cwd: input.cwd,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...teamFields,
      ...scheduleSourceField,
      // With a runId this re-saves that draft in place (Edit Orchestration);
      // without one it mints a new draft (the designer flow).
      ...(input.runId ? { runId: input.runId } : {}),
    });
    return { runId: run.id };
  }

  const startReview = reviewGraphStartConfirmation(deps, graph, input);
  if (startReview) {
    return startReview;
  }

  // Validate parser-backed conditions and Checks before resolving a seat or
  // spawning the root chat. An invalid saved draft is recoverable authoring
  // work, never a partially launched Workflow.
  const problems = validateGraphForExecution(graph);
  if (problems.length > 0) {
    throw new Error(`Graph is not executable: ${problems.join(" ")}`);
  }

  const graphInputs = input.graphInputs ?? {};
  const seat = await resolveOrchestratorSeat(deps, input);
  // The root chat is already real work. Make the graph, inputs, workspace and
  // frozen team recoverable before it receives a first turn.
  const prepared = await deps.runService.prepareGraphRun({
    graph,
    graphInputs,
    title,
    ...descriptionField,
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...teamFields,
    ...scheduleSourceField,
    ...(input.runId ? { runId: input.runId } : {}),
  });
  const orchestratorAgentId = await spawnPreparedGraphOrchestrator({
    deps,
    runId: prepared.id,
    seat,
    graph,
    graphInputs,
    title,
    description,
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });

  // Children stamp the run id for first-class attribution; the id isn't known
  // until startGraphRun mints it, so the port reads it through this ref (all
  // spawns happen strictly after startGraphRun returns).
  const runIdRef = { current: "" };
  // Templates are snapshotted with the cast: a node dispatched late renders the
  // template text that was true at start, not a mid-run edit. Together with the
  // frozen team view this is what makes a run reproducible - which the
  // evaluation harness depends on.
  const spawnPort = buildGraphSpawnPort(deps, {
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    orchestratorAgentId,
    runIdRef,
    agentTeamsView,
    roster: deps.getPersonalityRoster(),
    templatesById: await snapshotPromptTemplates(deps.promptTemplateStore),
  });

  const { run } = deps.runService.startGraphRun({
    graph,
    graphInputs,
    title,
    ...descriptionField,
    spawnPort,
    orchestratorAgentId,
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...teamFields,
    ...scheduleSourceField,
    runId: prepared.id,
  });
  runIdRef.current = run.id;
  return { runId: run.id, agentId: orchestratorAgentId };
}

function reviewGraphStartConfirmation(
  deps: UserOrchestrationDependencies,
  graph: OrchestrationGraph,
  input: StartUserOrchestrationInput,
): StartUserOrchestrationResult | null {
  const confirmation = deps.runService.reviewGraphStart(graph);
  return confirmation && !input.startConfirmationSatisfied ? { confirmation } : null;
}

function optionalScheduleSource(
  scheduleSource: StartUserOrchestrationInput["scheduleSource"],
): Pick<StartUserOrchestrationInput, "scheduleSource"> {
  return scheduleSource ? { scheduleSource } : {};
}

// ── Orchestrator seat ────────────────────────────────────────────────────────

type OrchestratorSeat =
  | { kind: "personality"; personality: AgentProfile }
  | { kind: "model"; providerModel: string; thinkingOptionId?: string };

async function spawnPreparedGraphOrchestrator(input: {
  deps: UserOrchestrationDependencies;
  runId: string;
  seat: OrchestratorSeat;
  graph: OrchestrationGraph;
  graphInputs: Record<string, string>;
  title: string;
  description?: string;
  cwd: string;
  workspaceId?: string;
}): Promise<string> {
  try {
    return await spawnOrchestrationAgent(input.deps, {
      seat: input.seat,
      title: input.title,
      prompt: buildOrchestratorKickoff(
        input.graph,
        input.graphInputs,
        input.title,
        input.description,
      ),
      cwd: input.cwd,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      detached: true,
    });
  } catch (error) {
    await input.deps.runService.failPendingGraphRun(
      input.runId,
      `Could not start the Graph orchestrator: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

async function resolveOrchestratorSeat(
  deps: UserOrchestrationDependencies,
  input: StartUserOrchestrationInput,
): Promise<OrchestratorSeat> {
  if (input.orchestratorPersonalityId) {
    const personality = deps
      .getPersonalityRoster()
      .find((entry) => entry.id === input.orchestratorPersonalityId);
    if (!personality) {
      throw new Error(`Personality ${input.orchestratorPersonalityId} not found`);
    }
    return { kind: "personality", personality };
  }
  if (input.orchestratorProvider) {
    return {
      kind: "model",
      providerModel: formatProviderModel(input.orchestratorProvider, input.orchestratorModel),
      ...(input.orchestratorThinkingOptionId
        ? { thinkingOptionId: input.orchestratorThinkingOptionId }
        : {}),
    };
  }
  const member = resolveTeamRoleMember({
    team: getActiveAgentTeam(deps.getAgentTeams()),
    roster: deps.getPersonalityRoster(),
    role: "orchestrator",
  });
  if (!member) {
    throw new Error(
      "No active-team member fills the Orchestrator role - pick a personality or model in the dialog.",
    );
  }
  return { kind: "personality", personality: member };
}

// ── Spawning ─────────────────────────────────────────────────────────────────

interface SpawnOrchestrationAgentInput {
  seat: OrchestratorSeat;
  title: string;
  prompt: string;
  cwd: string;
  workspaceId?: string;
  callerAgentId?: string;
  labels?: Record<string, string>;
  /** true ⇒ a top-level chat (the orchestrator); false ⇒ bound child node. */
  detached: boolean;
  /** Workspace access ceiling, when the node declared one. */
  access?: string;
  /** The node's title, for the refusal message if its seat can't enforce access. */
  nodeTitle?: string;
  /**
   * The team view frozen at run start. Node spawns pass it so the composed
   * team prompt matches the cast the run resolved against; absent (the
   * orchestrator's own start-time spawn) reads the live view, which at that
   * moment is the same thing.
   */
  agentTeamsView?: AgentTeamsConfigView;
}

/**
 * Refuse to spawn a restricted node onto a seat that can't restrict it.
 *
 * The alternative - spawn anyway and hope - would make the designer's access
 * control mean different things on different seats with nothing in the UI to
 * say which. A node that asked for "read" and silently got "write" is the exact
 * failure this feature exists to prevent, so the run stops here and names both
 * the node and the provider.
 */
function assertProviderEnforcesAccess(
  deps: UserOrchestrationDependencies,
  input: { provider: string; access: WorkspaceAccess; nodeTitle: string },
): void {
  // `provider` may be "provider" or "provider/model"; capabilities are per provider.
  const providerId = input.provider.split("/")[0] ?? input.provider;
  const capabilities = deps.agentManager.getProviderCapabilities(providerId as AgentProvider);
  // Per level, not one flag: Codex enforces "read" natively but has nothing
  // below read-only, so a "none" node on a Codex seat is refused here too.
  if (capabilitiesEnforceAccess(capabilities, input.access)) {
    return;
  }
  throw new Error(
    describeUnsupportedAccess({
      nodeTitle: input.nodeTitle,
      access: input.access,
      provider: providerId,
      ...(capabilitiesEnforceAccess(capabilities, "read")
        ? { enforceableFloor: "read" as const }
        : {}),
    }),
  );
}

async function spawnOrchestrationAgent(
  deps: UserOrchestrationDependencies,
  input: SpawnOrchestrationAgentInput,
): Promise<string> {
  let provider: string;
  let config: PersonalityCreateConfig | undefined;
  let thinking: string | undefined;
  let mode: string | undefined;

  if (input.seat.kind === "personality") {
    const resolved = await buildPersonalityCreateConfigForCwd(
      deps,
      input.seat.personality,
      input.cwd,
      input.agentTeamsView,
    );
    provider = formatProviderModel(resolved.snapshot.provider, resolved.snapshot.model);
    config = resolved.config;
    thinking = resolved.snapshot.thinkingOptionId;
    mode = resolved.snapshot.modeId;
  } else {
    provider = input.seat.providerModel;
    thinking = input.seat.thinkingOptionId;
  }

  const access = resolveWorkspaceAccess(input.access);
  if (access !== "write") {
    assertProviderEnforcesAccess(deps, {
      provider,
      access,
      nodeTitle: input.nodeTitle ?? input.title,
    });
  }

  const { snapshot } = await createAgentCommand(deps.createAgentDeps, {
    kind: "mcp",
    provider,
    // The ceiling rides on the session config, so each provider adapter
    // narrows its own tool surface from one declaration.
    config: { ...config, ...(access !== "write" ? { workspaceAccess: access } : {}) },
    title: input.title,
    initialPrompt: input.prompt,
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(thinking ? { thinking } : {}),
    ...(mode ? { mode } : {}),
    ...(input.labels ? { labels: input.labels } : {}),
    background: true,
    notifyOnFinish: false,
    detached: input.detached,
    ...(input.callerAgentId ? { callerAgentId: input.callerAgentId } : {}),
  });
  return snapshot.id;
}

interface PersonalityCreateConfig {
  systemPrompt?: string;
  profileSnapshot: ResolvedProfileSnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
}

// Resolve a personality against the cwd's provider snapshot and fold its
// identity into a create config - the same stack the app's spawn paths apply
// (team prompt → personality prompt → role-focus directive). Unavailable is a
// loud error: an orchestration must never silently swap brains.
async function buildPersonalityCreateConfigForCwd(
  deps: UserOrchestrationDependencies,
  personality: AgentProfile,
  cwd: string,
  agentTeamsView?: AgentTeamsConfigView,
): Promise<{ snapshot: ResolvedProfileSnapshot; config: PersonalityCreateConfig }> {
  const entries = await deps.listProviderEntries(cwd);
  const resolution = resolveProfile(personality, entries);
  if (resolution.status !== "available") {
    throw new Error(`Personality "${personality.name}" is unavailable: ${resolution.reason}`);
  }
  const snapshot = resolution.snapshot;
  const teamSnapshot = resolveTeamSnapshotForPersonality(
    agentTeamsView ?? deps.getAgentTeams(),
    personality.id,
  );
  const composedPrompt = composeTeamAndPersonalityPrompt(
    teamSnapshot,
    snapshot.systemPrompt,
    snapshot.roles,
  );
  return {
    snapshot,
    config: {
      profileSnapshot: snapshot,
      ...(teamSnapshot ? { teamSnapshot } : {}),
      ...(composedPrompt !== undefined ? { systemPrompt: composedPrompt } : {}),
    },
  };
}

/**
 * The prompt-template snapshot taken at run start (null when the host has no
 * store). One read serves the whole run - see the reproducibility comment at
 * the call site.
 */
async function snapshotPromptTemplates(
  store: PromptTemplateStore | undefined,
): Promise<Map<string, PromptTemplate> | null> {
  if (!store) {
    return null;
  }
  const all = await store.list();
  return new Map(all.map((entry) => [entry.id, entry]));
}

// ── The graph spawn port ─────────────────────────────────────────────────────

function buildGraphSpawnPort(
  deps: UserOrchestrationDependencies,
  context: {
    cwd: string;
    workspaceId?: string;
    orchestratorAgentId: string;
    runIdRef: { current: string };
    /** The team view frozen at run start - the whole cast resolves against it. */
    agentTeamsView: AgentTeamsConfigView | undefined;
    /** The personality roster frozen at run start. */
    roster: AgentProfile[];
    /** Prompt templates frozen at run start; null when the host has no store. */
    templatesById: Map<string, PromptTemplate> | null;
  },
): GraphSpawnPort {
  const spawn = async (spawnInput: GraphEngineSpawnInput) => {
    const labels: Record<string, string> = {
      [ORCHESTRATION_POLICY_LABEL]: spawnInput.policy,
      ...(context.runIdRef.current
        ? { [ORCHESTRATION_RUN_ID_LABEL]: context.runIdRef.current }
        : {}),
      // The node's contract travels with the agent, so its tool catalog can
      // mint submit_output for it and no provider needs special handling.
      ...(spawnInput.outputFields
        ? { [ORCHESTRATION_OUTPUT_FIELDS_LABEL]: JSON.stringify(spawnInput.outputFields) }
        : {}),
      ...(spawnInput.toolGroups
        ? { [ORCHESTRATION_TOOL_GROUPS_LABEL]: JSON.stringify(spawnInput.toolGroups) }
        : {}),
      ...(spawnInput.queryTools
        ? { [ORCHESTRATION_QUERY_TOOLS_LABEL]: JSON.stringify(spawnInput.queryTools) }
        : {}),
    };
    // Resolved against the run-start snapshot, never the live host config -
    // a node dispatched an hour in gets the cast the run started with.
    const member = spawnInput.role
      ? resolveTeamRoleMember({
          team: getActiveAgentTeam(context.agentTeamsView),
          roster: context.roster,
          role: spawnInput.role,
        })
      : null;
    const base = {
      title: spawnInput.title,
      prompt: spawnInput.task,
      cwd: context.cwd,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      callerAgentId: context.orchestratorAgentId,
      labels,
      detached: false,
      ...(spawnInput.access ? { access: spawnInput.access } : {}),
      nodeTitle: spawnInput.title,
      ...(context.agentTeamsView ? { agentTeamsView: context.agentTeamsView } : {}),
    } satisfies Omit<SpawnOrchestrationAgentInput, "seat">;
    if (member) {
      const agentId = await spawnOrchestrationAgent(deps, {
        ...base,
        seat: { kind: "personality", personality: member },
      });
      return { agentId, personalityId: member.id };
    }
    if (spawnInput.model) {
      const agentId = await spawnOrchestrationAgent(deps, {
        ...base,
        seat: { kind: "model", providerModel: spawnInput.model },
      });
      return { agentId };
    }
    throw new Error(
      spawnInput.role
        ? `No active-team member fills role "${spawnInput.role}" and the node has no model override.`
        : "The node has neither a role nor a model.",
    );
  };

  return {
    spawn,
    awaitAgent: async ({ agentId, signal }) => {
      try {
        // Whole-subtree settle: an autonomous node that spawns helpers gets
        // re-invoked when they finish and writes its real answer later.
        const result = await deps.agentManager.waitForAgentFullySettled(agentId, { signal });
        const finalMessage =
          result.lastMessage ?? (await deps.agentManager.getLastAssistantMessage(agentId));
        // Taken (not read) - one submission belongs to one settle, and leaving
        // it behind would let a later iteration inherit an earlier answer.
        const submittedOutput = deps.nodeOutputStore?.take(agentId) ?? null;
        const failure =
          result.status === "error" ? deps.agentManager.getAgent(agentId)?.lastError : undefined;
        return {
          finalMessage: finalMessage ?? null,
          failed: result.status === "error",
          ...(failure ? { error: failure } : {}),
          submittedOutput,
        };
      } catch {
        deps.nodeOutputStore?.forget(agentId);
        return { finalMessage: null, failed: true };
      }
    },
    renderPromptTemplate: async ({ ref, graphInputs, upstreamFields }) => {
      // Resolved against the run-start snapshot, never the live store: a node
      // dispatched late renders the same text an early node did, and a mid-run
      // template edit cannot reword a running orchestration.
      const templates = context.templatesById;
      if (!templates) {
        return null;
      }
      const template = templates.get(ref.templateId);
      if (!template) {
        return null;
      }
      return renderPromptTemplate({
        template,
        variables: resolveTemplateVariables({
          bindings: ref.variables,
          graphInputs,
          upstreamFields,
        }),
        resolveSnippet: (id) => templates.get(id) ?? null,
      });
    },
    cancelAgent: async ({ agentId }) => {
      try {
        await deps.agentManager.cancelAgentRun(agentId);
      } catch (error) {
        // Best-effort: an agent that settled between the timer firing and this
        // call is the expected race, not a problem worth failing the run over.
        deps.logger.warn({ err: error, agentId }, "Could not cancel a timed-out node agent");
      }
    },
    notifyOrchestrator: async ({ text }) => {
      await sendPromptToAgent({
        agentManager: deps.agentManager,
        agentStorage: deps.createAgentDeps.agentStorage,
        agentId: context.orchestratorAgentId,
        prompt: text,
        logger: deps.logger,
      });
    },
  };
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function buildOrchestratorKickoff(
  graph: OrchestrationGraph,
  inputs: Record<string, string>,
  title: string,
  description: string | undefined,
): string {
  const nodeLines = graph.nodes
    .filter((node) => node.kind !== "orchestrator")
    .map((node) => `- ${node.title}${node.role ? ` (${node.role})` : ""}`);
  const inputEntries = Object.entries(inputs);
  const inputBlock =
    inputEntries.length > 0
      ? `\n\nInputs supplied by the user:\n${inputEntries.map(([key, value]) => `- ${key}: ${value}`).join("\n")}`
      : "";
  const descriptionBlock = description ? `\n\nPurpose: ${description}` : "";
  return (
    `You are the orchestrator of "${title}" - a deterministic orchestration. The daemon ` +
    `executes a fixed graph of agent nodes and routes each node's result to you as it ` +
    `finishes. You do NOT spawn, steer, or manage these agents yourself - the graph is the ` +
    `plan and the daemon is the executor.${descriptionBlock}\n\n` +
    `Nodes:\n${nodeLines.join("\n")}${inputBlock}\n\n` +
    `Acknowledge results briefly as they arrive (one or two sentences - you are narrating ` +
    `progress for the user watching this chat). When the daemon reports completion, ` +
    `synthesize everything into a final answer.`
  );
}
