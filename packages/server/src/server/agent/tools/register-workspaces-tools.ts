import { assertWorkspaceAutomationAllowedForWorkspace } from "../../workspace-automation-gate.js";
import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { Logger } from "pino";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import {
  archiveByScope,
  killTerminalsForWorkspace,
  requireActiveWorkspaceForArchive,
} from "../../workspace-archive-service.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import { WorktreeRequestError } from "../../worktree-errors.js";
import { resolveWorktreeSourceCwd } from "../../workspace-source.js";
import {
  archiveCommand,
  type ArchiveCommandDependencies,
  createOttoWorktreeCommand,
  type CreateOttoWorktreeCommandInput,
  listOttoWorktreesCommand,
} from "../../worktree/commands.js";
import { type OttoToolHostDependencies } from "./otto-tool-host-dependencies.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

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
    assertWorkspaceAutomationAllowed: async (workspaceId) => {
      if (!options.workspaceRegistry)
        throw new Error("Workspace registry is required to approve repository automation");
      await assertWorkspaceAutomationAllowedForWorkspace(options.workspaceRegistry, workspaceId);
    },
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

type Dependencies = Pick<
  OttoToolContext,
  | "options"
  | "agentManager"
  | "agentStorage"
  | "terminalManager"
  | "callerAgentId"
  | "childLogger"
  | "resolveScopedCwd"
  | "AgentCreateWorktreeTargetInputSchema"
> & { registerTool: RegisterOttoTool };

export function registerWorkspacesTools({
  options,
  agentManager,
  agentStorage,
  terminalManager,
  callerAgentId,
  childLogger,
  resolveScopedCwd,
  AgentCreateWorktreeTargetInputSchema,
  registerTool,
}: Dependencies): void {
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
    "move_chat_to_workspace",
    {
      title: "Move chat to workspace",
      description:
        "Move an existing chat into another workspace. Use list_chats for the chat id and list_workspaces for the destination id. Omit agentId to move this chat. The chat keeps running in its original working directory; only the workspace that shows it changes. Hidden and archived destinations are unavailable.",
      inputSchema: {
        agentId: z
          .string()
          .min(1)
          .optional()
          .describe("Chat to move. Omit to move the calling chat."),
        workspaceId: z.string().min(1).describe("Destination workspace id."),
      },
      outputSchema: {
        agentId: z.string(),
        workspaceId: z.string(),
        previousWorkspaceId: z.string().nullable(),
        moved: z.boolean(),
      },
    },
    async ({ agentId, workspaceId }: { agentId?: string; workspaceId: string }) => {
      const resolvedAgentId = agentId ?? callerAgentId;
      if (!resolvedAgentId) throw new Error("agentId is required outside a chat session");
      if (!options.moveChatToWorkspace) throw new Error("Chat transfer is not configured");
      const result = await options.moveChatToWorkspace({ agentId: resolvedAgentId, workspaceId });
      if (result.status === "refused") throw new Error(result.error);
      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId: resolvedAgentId,
          workspaceId: result.workspaceId,
          previousWorkspaceId:
            result.status === "transferred" ? result.previousWorkspaceId : workspaceId,
          moved: result.status === "transferred",
        }),
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
}
