import type { Logger } from "pino";

import type { AgentPersonality } from "@otto-code/protocol/messages";
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
  validateOrchestrationGraph,
} from "@otto-code/protocol/orchestration";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentProvider, ProviderSnapshotEntry } from "../agent/agent-sdk-types.js";
import {
  resolvePersonality,
  type ResolvedPersonalitySnapshot,
} from "../agent/agent-personalities.js";
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
import type { GraphEngineSpawnInput } from "./graph-engine.js";
import type { GraphStore } from "./graph-store.js";
import {
  type WorkspaceAccess,
  describeUnsupportedAccess,
  resolveWorkspaceAccess,
} from "../agent/workspace-access.js";
import type { NodeOutputStore } from "./node-output.js";
import type { PromptTemplateStore } from "./prompt-template-store.js";
import { renderPromptTemplate, resolveTemplateVariables } from "./prompt-render.js";
import { resolveTeamRoleMember } from "./resolve-team-role.js";
import type { GraphSpawnPort, RunService } from "./run-service.js";

// User-initiated orchestrations (projects/orchestration-graphs): the daemon
// wiring behind the New Orchestration dialog's `runs.start` RPC. Two flavors:
//
// - "ai": prompt-and-go — spawn an orchestrator agent whose first turn is the
//   user's prompt plus a nudge to declare its own plan via start_run. The Run
//   record appears when the agent calls the tool; the dialog just needs the
//   chat to navigate to.
// - "graph": deterministic — spawn the orchestrator (root node, hosts the
//   chat), then hand the graph to RunService.startGraphRun with a spawn port
//   that creates every child agent itself. Participants never wire themselves
//   together: children are stamped with the orchestration policy label the
//   otto-tool catalog enforces (deterministic ⇒ no orchestration/preview/
//   browser tools; autonomous ⇒ everything except start_run).
//
// Orchestrator seat precedence (per the dialog): explicit personality → bare
// provider/model → the active team's Orchestrator-role member. No fallback
// beyond that — a missing seat is a loud error.

export interface UserOrchestrationDependencies {
  runService: RunService;
  graphStore: GraphStore;
  agentManager: AgentManager;
  createAgentDeps: CreateAgentCommandDependencies;
  logger: Logger;
  getPersonalityRoster(): AgentPersonality[];
  getAgentTeams(): AgentTeamsConfigView | undefined;
  listProviderEntries(cwd: string): Promise<readonly ProviderSnapshotEntry[]>;
  /**
   * Where node agents' submit_output calls land (shared with the Otto tool
   * catalog). Absent on hosts that never execute graphs — such a node then
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
  draft?: boolean;
  runId?: string;
}

export interface StartUserOrchestrationResult {
  runId?: string;
  agentId?: string;
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
  const description = input.description?.trim();
  const kickoff =
    `${prompt}\n\n` +
    (description ? `Context (what this orchestration is for): ${description}\n\n` : "") +
    `Orchestrate this: declare a multi-agent plan with the start_run tool and let the ` +
    `daemon execute it, then relay the results. Use Otto tools only — never spawn ` +
    `provider-native subagents or workflows for orchestration.`;
  const agentId = await spawnOrchestrationAgent(deps, {
    seat,
    title: input.title?.trim() || "Orchestration",
    prompt: kickoff,
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    detached: true,
  });
  return { agentId };
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
  const title = input.title?.trim() || graph.name;
  const description = input.description?.trim();
  const descriptionField = description ? { description } : {};
  const team = getActiveAgentTeam(deps.getAgentTeams());
  const teamFields = team ? { teamId: team.id, teamName: team.name } : {};

  if (input.draft) {
    const run = await deps.runService.createDraftGraphRun({
      graph,
      title,
      ...descriptionField,
      ...(input.graphInputs ? { graphInputs: input.graphInputs } : {}),
      cwd: input.cwd,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...teamFields,
      // With a runId this re-saves that draft in place (Edit Orchestration);
      // without one it mints a new draft (the designer flow).
      ...(input.runId ? { runId: input.runId } : {}),
    });
    return { runId: run.id };
  }

  const problems = validateOrchestrationGraph(graph);
  if (problems.length > 0) {
    throw new Error(`Graph is not executable: ${problems.join(" ")}`);
  }

  const graphInputs = input.graphInputs ?? {};
  const seat = await resolveOrchestratorSeat(deps, input);
  const orchestratorAgentId = await spawnOrchestrationAgent(deps, {
    seat,
    title,
    prompt: buildOrchestratorKickoff(graph, graphInputs, title, description),
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    detached: true,
  });

  // Children stamp the run id for first-class attribution; the id isn't known
  // until startGraphRun mints it, so the port reads it through this ref (all
  // spawns happen strictly after startGraphRun returns).
  const runIdRef = { current: "" };
  const spawnPort = buildGraphSpawnPort(deps, {
    cwd: input.cwd,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    orchestratorAgentId,
    runIdRef,
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
    ...(input.runId ? { runId: input.runId } : {}),
  });
  runIdRef.current = run.id;
  return { runId: run.id, agentId: orchestratorAgentId };
}

// ── Orchestrator seat ────────────────────────────────────────────────────────

type OrchestratorSeat =
  | { kind: "personality"; personality: AgentPersonality }
  | { kind: "model"; providerModel: string; thinkingOptionId?: string };

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
      "No active-team member fills the Orchestrator role — pick a personality or model in the dialog.",
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
}

/**
 * Refuse to spawn a restricted node onto a seat that can't restrict it.
 *
 * The alternative — spawn anyway and hope — would make the designer's access
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
  if (capabilities?.supportsWorkspaceAccess) {
    return;
  }
  throw new Error(
    describeUnsupportedAccess({
      nodeTitle: input.nodeTitle,
      access: input.access,
      provider: providerId,
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
  personalitySnapshot: ResolvedPersonalitySnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
}

// Resolve a personality against the cwd's provider snapshot and fold its
// identity into a create config — the same stack the app's spawn paths apply
// (team prompt → personality prompt → role-focus directive). Unavailable is a
// loud error: an orchestration must never silently swap brains.
async function buildPersonalityCreateConfigForCwd(
  deps: UserOrchestrationDependencies,
  personality: AgentPersonality,
  cwd: string,
): Promise<{ snapshot: ResolvedPersonalitySnapshot; config: PersonalityCreateConfig }> {
  const entries = await deps.listProviderEntries(cwd);
  const resolution = resolvePersonality(personality, entries);
  if (resolution.status !== "available") {
    throw new Error(`Personality "${personality.name}" is unavailable: ${resolution.reason}`);
  }
  const snapshot = resolution.snapshot;
  const teamSnapshot = resolveTeamSnapshotForPersonality(deps.getAgentTeams(), personality.id);
  const composedPrompt = composeTeamAndPersonalityPrompt(
    teamSnapshot,
    snapshot.systemPrompt,
    snapshot.roles,
  );
  return {
    snapshot,
    config: {
      personalitySnapshot: snapshot,
      ...(teamSnapshot ? { teamSnapshot } : {}),
      ...(composedPrompt !== undefined ? { systemPrompt: composedPrompt } : {}),
    },
  };
}

// ── The graph spawn port ─────────────────────────────────────────────────────

function buildGraphSpawnPort(
  deps: UserOrchestrationDependencies,
  context: {
    cwd: string;
    workspaceId?: string;
    orchestratorAgentId: string;
    runIdRef: { current: string };
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
    const member = spawnInput.role
      ? resolveTeamRoleMember({
          team: getActiveAgentTeam(deps.getAgentTeams()),
          roster: deps.getPersonalityRoster(),
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
        // Taken (not read) — one submission belongs to one settle, and leaving
        // it behind would let a later iteration inherit an earlier answer.
        const submittedOutput = deps.nodeOutputStore?.take(agentId) ?? null;
        return {
          finalMessage: finalMessage ?? null,
          failed: result.status === "error",
          submittedOutput,
        };
      } catch {
        deps.nodeOutputStore?.forget(agentId);
        return { finalMessage: null, failed: true };
      }
    },
    renderPromptTemplate: async ({ ref, graphInputs, upstreamFields }) => {
      const store = deps.promptTemplateStore;
      if (!store) {
        return null;
      }
      const template = await store.get(ref.templateId);
      if (!template) {
        return null;
      }
      // Snippets are resolved from a snapshot taken once per render, so a
      // template that includes another can't turn into a storm of reads.
      const all = await store.list();
      const byId = new Map(all.map((entry) => [entry.id, entry]));
      return renderPromptTemplate({
        template,
        variables: resolveTemplateVariables({
          bindings: ref.variables,
          graphInputs,
          upstreamFields,
        }),
        resolveSnippet: (id) => byId.get(id) ?? null,
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
    `You are the orchestrator of "${title}" — a deterministic orchestration. The daemon ` +
    `executes a fixed graph of agent nodes and routes each node's result to you as it ` +
    `finishes. You do NOT spawn, steer, or manage these agents yourself — the graph is the ` +
    `plan and the daemon is the executor.${descriptionBlock}\n\n` +
    `Nodes:\n${nodeLines.join("\n")}${inputBlock}\n\n` +
    `Acknowledge results briefly as they arrive (one or two sentences — you are narrating ` +
    `progress for the user watching this chat). When the daemon reports completion, ` +
    `synthesize everything into a final answer.`
  );
}
