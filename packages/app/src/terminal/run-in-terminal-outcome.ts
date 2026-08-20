import { buildHostWorkspaceOpenRoute } from "@/utils/host-routes";

/**
 * What to do once a "run in terminal" action has handed its command to the
 * daemon. Shared by every surface that offers one (Kanban credential fixes,
 * the LSP install block), so they all end the same way.
 *
 * Isolated from React for the same reason as kanban-screen-state.ts: the
 * decision is worth pinning, and it does not need a component tree to test.
 *
 * Spawning is only half the job. These commands are interactive - a device
 * flow prints a one-time code and waits for Enter, a two-step install leaves
 * the second line to type - so a terminal the user cannot see is no better
 * than no terminal at all. When the daemon bound the terminal to a workspace
 * there is a route that puts them at the prompt; when it did not, saying where
 * it went is all that is left.
 */

/** The router takes a typed href, so the route keeps the builder's literal type. */
type WorkspaceOpenRoute = ReturnType<typeof buildHostWorkspaceOpenRoute>;

export type RunInTerminalOutcome =
  | { kind: "navigate"; route: WorkspaceOpenRoute }
  | { kind: "started" }
  | { kind: "error"; message: string | null };

export function resolveRunInTerminalOutcome(input: {
  serverId: string;
  terminal: { id: string; workspaceId?: string } | null;
  error: string | null;
}): RunInTerminalOutcome {
  if (!input.terminal) {
    return { kind: "error", message: input.error };
  }
  if (!input.terminal.workspaceId) {
    return { kind: "started" };
  }
  return {
    kind: "navigate",
    route: buildHostWorkspaceOpenRoute(
      input.serverId,
      input.terminal.workspaceId,
      `terminal:${input.terminal.id}`,
    ),
  };
}
