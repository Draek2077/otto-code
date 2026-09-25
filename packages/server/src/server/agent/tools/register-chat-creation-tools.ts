import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { AgentPermissionRequestPayloadSchema } from "../../messages.js";
import type { FirstAgentContext } from "../../messages.js";
import { createAgentCommand, type CreateAgentFromMcpInput } from "../create-agent/create.js";
import { expandUserPath, isSameOrDescendantPath } from "../../path-utils.js";
import {
  AgentProviderEnum,
  AgentStatusEnum,
  ProviderModeSchema,
  resolveRequiredProviderModel,
  sanitizePermissionRequest,
  waitForAgentWithTimeout,
} from "../mcp-shared.js";
import { EFFORT_INPUT_DESCRIPTION, buildPersonalityAgentConfig } from "./otto-tool-shared.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

// Lets a caller start an agent with no task in hand - "just open a new chat".
// When create_chat omits initialPrompt, the new chat gets this generic ask so
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

type Dependencies = Pick<
  OttoToolContext,
  | "options"
  | "agentManager"
  | "agentStorage"
  | "terminalManager"
  | "providerSnapshotManager"
  | "callerAgentId"
  | "onActivity"
  | "childLogger"
  | "callerContext"
  | "resolveCallerAgent"
  | "resolveScopedCwd"
  | "resolveCreateAgentBrain"
  | "AgentCreateWorktreeTargetInputSchema"
> & { registerTool: RegisterOttoTool };

export function registerChatCreationTools({
  options,
  agentManager,
  agentStorage,
  terminalManager,
  providerSnapshotManager,
  callerAgentId,
  onActivity,
  childLogger,
  callerContext,
  resolveCallerAgent,
  resolveScopedCwd,
  resolveCreateAgentBrain,
  AgentCreateWorktreeTargetInputSchema,
  registerTool,
}: Dependencies): void {
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
      "Provider/model pair, for example codex/gpt-5.4. Required unless `agentProfile` is given; when both are given, this overrides the agent profile's provider/model.",
    ),
    agentProfile: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Spawn as an agent profile configured on this host: its provider, model, mode, effort, prompt, and identity in one pick. Pass the name from list_agent_profiles (an agent profile id also works). `provider` and `settings` override it field by field. Fails loudly if that agent profile cannot run here.",
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

  type AgentToAgentCreateAgentArgs = z.infer<typeof agentToAgentCreateAgentArgsSchema>;

  type TopLevelCreateAgentArgs = z.infer<typeof canonicalTopLevelCreateAgentArgsSchema>;

  type TopLevelCreateAgentToolArgs = z.infer<typeof topLevelCreateAgentArgsSchema>;

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
    "create_chat",
    {
      title: "Create chat",
      description:
        "Start an Otto chat session immediately. A chat can be independent or a child chat. Requires relationship, workspace, and either an agent profile or a provider/model pair (e.g. codex/gpt-5.4). Title and initialPrompt are optional. Prefer an agent profile when one fits: call list_agent_profiles first, and fall back to provider/model when none does.",
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
        personalityRef: parsedArgs.agentProfile,
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
}
