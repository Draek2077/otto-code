import type { Command } from "commander";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import { isSameOrDescendantPath } from "../../utils/paths.js";

export function addDeleteOptions(cmd: Command): Command {
  return cmd
    .description(
      "Delete an agent (interrupt if running, then hard-delete). Removes Otto's record only - the agent provider's own transcript is left on disk.",
    )
    .argument("[id]", "Agent ID (or prefix) - optional if --all or --cwd specified")
    .option("--all", "Delete all agents")
    .option("--cwd <path>", "Delete all agents in directory")
    .option("--archived", "Only archived agents (use with --all or --cwd)")
    .option("--include-archived", "Include archived agents (use with --all or --cwd)");
}
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

export interface DeleteResult {
  deletedCount: number;
  agentIds: string[];
}

export const deleteSchema: OutputSchema<DeleteResult> = {
  idField: (item) => item.agentIds.join("\n"),
  columns: [{ header: "DELETED", field: "deletedCount" }],
};

export interface AgentDeleteOptions extends CommandOptions {
  all?: boolean;
  cwd?: string;
  archived?: boolean;
  includeArchived?: boolean;
}

export type AgentDeleteResult = SingleResult<DeleteResult>;

/** Which side of the archive line a bulk delete is allowed to touch. */
export type AgentDeleteScope = "active" | "archived" | "both";

/**
 * Bulk delete used to filter `!a.archivedAt` unconditionally, so the one command
 * that could clear the archive deliberately skipped exactly the rows a user most
 * wants gone. The flags open it up without moving anyone's muscle memory: bare
 * `--all` / `--cwd` still mean active-only.
 *
 * Both flags at once is contradictory ("only archived" and "also archived"), so
 * it is refused rather than guessed - this command is irreversible.
 */
export function resolveAgentDeleteScope(options: {
  archived?: boolean;
  includeArchived?: boolean;
}): AgentDeleteScope {
  if (options.archived && options.includeArchived) {
    const error: CommandError = {
      code: "CONFLICTING_OPTIONS",
      message: "--archived and --include-archived cannot be combined",
      details: "--archived deletes only archived agents; --include-archived deletes both",
    };
    throw error;
  }
  if (options.archived) {
    return "archived";
  }
  if (options.includeArchived) {
    return "both";
  }
  return "active";
}

export function matchesAgentDeleteScope(
  agent: { archivedAt?: Date | string | null },
  scope: AgentDeleteScope,
): boolean {
  if (scope === "both") {
    return true;
  }
  const isArchived = agent.archivedAt != null && agent.archivedAt !== "";
  return scope === "archived" ? isArchived : !isArchived;
}

export async function runDeleteCommand(
  id: string | undefined,
  options: AgentDeleteOptions,
  _command: Command,
): Promise<AgentDeleteResult> {
  const host = getDaemonHost({ host: options.host });

  if (!id && !options.all && !options.cwd) {
    const error: CommandError = {
      code: "MISSING_ARGUMENT",
      message: "Agent ID required unless --all or --cwd is specified",
      details: "Usage: otto agent delete <id> | --all | --cwd <path>",
    };
    throw error;
  }

  // Resolved before connecting: a contradictory flag pair should fail fast, not
  // after opening a socket.
  const scope = resolveAgentDeleteScope(options);

  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: otto daemon start",
    };
    throw error;
  }

  try {
    const fetchPayload = await client.fetchAgents({ filter: { includeArchived: true } });
    let agents = fetchPayload.entries.map((entry) => entry.agent);
    const deletedIds: string[] = [];

    if (options.all) {
      agents = agents.filter((a) => matchesAgentDeleteScope(a, scope));
    } else if (options.cwd) {
      agents = agents.filter(
        (a) => matchesAgentDeleteScope(a, scope) && isSameOrDescendantPath(options.cwd!, a.cwd),
      );
    } else if (id) {
      const fetchResult = await client.fetchAgent({ agentId: id });
      if (!fetchResult) {
        const error: CommandError = {
          code: "AGENT_NOT_FOUND",
          message: `No agent found matching: ${id}`,
          details: "Use `otto ls` to list available agents",
        };
        throw error;
      }
      agents = [fetchResult.agent];
    }

    const deleteResults = await Promise.all(
      agents.map(async (agent) => {
        try {
          if (agent.status === "running") {
            await client.cancelAgent(agent.id).catch(() => {});
          }
          await client.deleteAgent(agent.id);
          return { ok: true as const, id: agent.id };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false as const, id: agent.id, message };
        }
      }),
    );
    for (const result of deleteResults) {
      if (result.ok) {
        deletedIds.push(result.id);
      } else {
        console.error(
          `Warning: Failed to delete agent ${result.id.slice(0, 7)}: ${result.message}`,
        );
      }
    }

    await client.close();

    return {
      type: "single",
      data: {
        deletedCount: deletedIds.length,
        agentIds: deletedIds,
      },
      schema: deleteSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DELETE_AGENT_FAILED",
      message: `Failed to delete agent(s): ${message}`,
    };
    throw error;
  }
}
