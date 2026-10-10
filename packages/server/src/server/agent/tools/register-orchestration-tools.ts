import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import type { AgentProfile } from "@otto-code/protocol/messages";
import {
  getOrchestrationRunIdFromLabels,
  WORKFLOW_WORKER_RUN_ID_LABEL,
} from "@otto-code/protocol/agent-labels";
import { createAgentCommand } from "../create-agent/create.js";
import { isTerminalRunStatus, RunPlanSchema } from "@otto-code/protocol/workflow";
import { summarizeRunOutput } from "../../workflow/workflow-engine.js";
import {
  attachStartRunLifecycle,
  type StartCallState,
} from "../../workflow/workflow-start-lifecycle.js";
import type { RunSpawnPort } from "../../workflow/workflow-service.js";
import { resolveTeamRoleMember } from "../../workflow/resolve-team-role.js";
import { AgentStatusEnum } from "../mcp-shared.js";
import { formatSystemNotificationPrompt, sendPromptToAgent } from "../agent-prompt.js";
import { truncateHeadTail } from "../../../utils/truncate-head-tail.js";
import { buildPersonalityAgentConfig } from "./otto-tool-shared.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

/**
 * Per-chat cap on the final message `wait_for_chats` returns. A 32-way gather
 * returned every child's last message verbatim, so one barrier could carry tens
 * of thousands of tokens into the conductor's context.
 */
const WAIT_FOR_AGENTS_MESSAGE_HEAD_CHARS = 3_200;

const WAIT_FOR_AGENTS_MESSAGE_TAIL_CHARS = 800;

export function capWaitForAgentsMessage(message: string): string {
  return truncateHeadTail({
    text: message,
    headChars: WAIT_FOR_AGENTS_MESSAGE_HEAD_CHARS,
    tailChars: WAIT_FOR_AGENTS_MESSAGE_TAIL_CHARS,
    note: "call get_chat_activity for the rest",
  });
}

type Dependencies = Pick<
  OttoToolContext,
  | "options"
  | "agentManager"
  | "agentStorage"
  | "terminalManager"
  | "runService"
  | "providerSnapshotManager"
  | "readAgentTeams"
  | "callerAgentId"
  | "childLogger"
  | "callerContext"
  | "resolveCallerAgent"
  | "resolveScopedCwd"
  | "getPersonalityRoster"
  | "resolvePersonalityBrain"
> & { registerTool: RegisterOttoTool };

export function registerOrchestrationTools({
  options,
  agentManager,
  agentStorage,
  terminalManager,
  runService,
  providerSnapshotManager,
  readAgentTeams,
  callerAgentId,
  childLogger,
  callerContext,
  resolveCallerAgent,
  resolveScopedCwd,
  getPersonalityRoster,
  resolvePersonalityBrain,
  registerTool,
}: Dependencies): void {
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
    const roleMemberCache = new Map<string, AgentProfile | null>();
    const resolveRoleMember = (role: string): AgentProfile | null => {
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

    // Spawn one candidate child agent from a Personality, parented to the
    // conductor, in the conductor's workspace. Mirrors the create_chat flow.
    //
    // Takes the resolved roster entry, not its name: the role resolution above
    // already holds the entry, and names carry no uniqueness constraint, so
    // re-finding it by name could bind a different Personality than the one
    // recorded as this node's personalityId.
    const spawnRunChild = async (input: {
      personality: AgentProfile;
      task: string;
      title: string;
      cwd: string;
      workspaceId?: string;
      /** The run this chat works for, so clients present it read-only. */
      runId: string;
    }): Promise<string> => {
      const brain = await resolvePersonalityBrain(input.personality, {
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
          labels: { [WORKFLOW_WORKER_RUN_ID_LABEL]: input.runId },
          thinking: brain.thinkingOptionId,
          mode: brain.modeId,
          // A Workflow child has no one to answer its prompts: the engine awaits
          // it, not a user, and a gate is the run's only human checkpoint. The
          // unattended signal coerces an attended profile mode (Claude
          // "default", Codex "auto") to the provider's safe unattended mode and
          // lets the daemon deny-responder answer escalations, instead of the
          // child stalling at its first Write until the run archives it. See
          // docs/safe-unattended.md.
          unattended: true,
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
      "start_workflow",
      {
        title: "Start Workflow",
        description:
          "Use when active work needs a declared multi-chat Workflow with daemon-managed fan-out, gathering, judging, loops, or approval gates. The daemon executes typed phases (research/plan/implement/design/verify/gate/deliver), fans out candidates, judges them, loops until enough pass, and pauses at gates for approval. Size each phase to what one session can finish; for open-ended work (inventory a platform, plan a whole project) declare `mode: iterative` with a `judge` so a failed candidate's chat is continued with the judge's unmet criteria instead of being replaced by a fresh agent. Each phase dispatches to the active team's agent profile for its role and fails clearly if the team lacks one. Waits until the Workflow completes (returning `result`, the final deliverable, which you should relay to the user) or pauses at a gate (returning a `note` to relay). Do not use for a discrete task that can be completed directly or by one dedicated chat.",
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
        const pendingAiRunId = getOrchestrationRunIdFromLabels(conductor?.labels);
        const cwd = resolveScopedCwd(undefined);
        const workspaceId = conductor?.workspaceId;
        const runWorkerAgentIds = new Set<string>();
        // Assigned once the run exists. Nothing spawns before then: every child
        // starts after the start confirmation, well after startWorkflow returns.
        const runIdRef = { current: "" };

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
              personality: member,
              task: spawnInput.task,
              title: `${spawnInput.role ?? spawnInput.phaseType}: ${spawnInput.phaseId}`,
              cwd,
              ...(workspaceId ? { workspaceId } : {}),
              runId: runIdRef.current,
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
              // A child parked on a permission prompt has not finished; reading
              // its last message as the result would judge a half-turn ("I'll
              // write the file directly.") and move on while the prompt hangs.
              // Children are spawned unattended so this should not occur; when
              // it does, name it rather than report "no output".
              if (result.permission) {
                return {
                  finalMessage: null,
                  failed: true,
                  error: `The assigned agent stopped at a permission prompt for '${result.permission.name}' that a Workflow cannot answer. Give its profile an unattended mode.`,
                };
              }
              const finalMessage =
                result.lastMessage ?? (await agentManager.getLastAssistantMessage(agentId));
              const failure =
                result.status === "error" ? agentManager.getAgent(agentId)?.lastError : undefined;
              return {
                finalMessage: finalMessage ?? null,
                failed: result.status === "error",
                ...(failure ? { error: failure } : {}),
              };
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
          continueAgent: async ({ agentId, task }) => {
            // The iterative loop: the child's own chat gets the judge's verdict
            // as its next turn, keeping everything it already built. The engine
            // awaits it again through awaitAgent once the turn has started.
            await sendPromptToAgent({
              agentManager,
              agentStorage,
              agentId,
              prompt: task,
              unarchive: true,
              logger: childLogger,
            });
          },
        };

        // Record the active team on the run so the Runs display can filter by it.
        const activeTeam = getActiveAgentTeam(readAgentTeams?.());
        const { run, settled } = activeRunService.startWorkflow({
          plan: parsedPlan,
          spawnPort,
          ...(pendingAiRunId ? { runId: pendingAiRunId } : {}),
          ...(callerAgentId ? { conductorAgentId: callerAgentId } : {}),
          cwd,
          ...(workspaceId ? { workspaceId } : {}),
          ...(activeTeam ? { teamId: activeTeam.id, teamName: activeTeam.name } : {}),
          // The plan is model-initiated. The daemon preserves it, exposes its
          // real fan-out shape, and waits for the owner before spawning any
          // child. This is separate from declared attended gates.
          requireStartConfirmation: true,
        });
        runIdRef.current = run.id;
        // An orchestration plan gathers its chats inside the daemon, rather than
        // letting every worker notify the conductor. Restore one aggregate
        // hand-back only if the original tool turn has gone away; the normal
        // path receives the result below without an extra turn. This lifecycle
        // applies only to AI-declared plans, not graph orchestration.
        const startCall: { state: StartCallState } = { state: "awaiting" };
        attachStartRunLifecycle({
          runId: run.id,
          settled,
          ...(callerAgentId ? { conductorAgentId: callerAgentId } : {}),
          workerAgentIds: runWorkerAgentIds,
          port: {
            startCallState: () => startCall.state,
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
        let outcome: Awaited<ReturnType<typeof activeRunService.settleOrPause>>;
        try {
          outcome = await activeRunService.settleOrPause({ runId: run.id, settled });
        } catch (error) {
          startCall.state = "returned-early";
          throw error;
        }
        // Only a terminal run carries its result back in this tool result; a
        // pause or the wait limit leaves the result to the queued hand-back.
        startCall.state = isTerminalRunStatus(outcome.status) ? "delivered" : "returned-early";
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
                  note: outcome.startConfirmation
                    ? "The declared plan is awaiting start confirmation. Approve or reject it in the Workflows screen before any child agents start."
                    : "A gate is awaiting approval. Approve or reject it in the Workflows screen, then the run continues.",
                }
              : {}),
            ...(outcome.error ? { error: outcome.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "get_workflow_status",
      {
        title: "Get Workflow status",
        description:
          "Return the current projection of a Workflow - its phases, statuses, and structured judge verdicts. " +
          "A running phase is live: its `round`, and each candidate's `stage` (working, judging, settled), " +
          "`attempts`, `judgeAgentIds`, `verdict` and `verdictAt` update as they happen, and the run's " +
          "`updatedAt` moves with them. Read these before pulling a worker's chat activity.",
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
}
