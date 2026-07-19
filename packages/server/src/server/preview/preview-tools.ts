import { z } from "zod";

import type {
  OttoToolConfig,
  OttoToolExecutionContext,
  OttoToolResult,
} from "../agent/tools/types.js";
import type { BrowserToolsBroker } from "../browser-tools/broker.js";
import type { DevServerManager, PreviewServerSummary } from "./dev-server-manager.js";

/**
 * Agent-facing preview_* tools (dev-server half of the preview bridge).
 * Registered into the Otto tool catalog next to the browser_* tools; the
 * agent starts a server here, then verifies it through the browser tools.
 *
 * The verification surface is the Otto browser pane — the same tab the user
 * watches — never a headless or system browser. Each server gets exactly one
 * designated tab ("it"): preview_start opens or re-finds that tab and returns
 * its browserId for the browser_* tools. Tool descriptions deliberately steer
 * agent behavior — see docs/preview.md ("Design principles").
 */

interface CallerAgentContext {
  id: string;
  cwd: string;
  workspaceId?: string;
}

/** Narrow surface of DevServerManager the tools need — keeps tests honest. */
export type PreviewDevServerHost = Pick<
  DevServerManager,
  "start" | "stop" | "list" | "logs" | "bindTab" | "boundTab" | "getServer"
>;

export interface RegisterPreviewToolsOptions {
  registerTool: (
    name: string,
    config: OttoToolConfig,
    handler: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by the catalog before execution.
      input: any,
      context: OttoToolExecutionContext,
    ) => Promise<OttoToolResult>,
  ) => void;
  manager: PreviewDevServerHost;
  broker?: Pick<BrowserToolsBroker, "execute"> | null;
  resolveCallerAgent: () => CallerAgentContext | null;
}

const PreviewToolOutputSchema = {
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
};

const LAUNCH_JSON_FORMAT = `{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "<unique-name>",
      "runtimeExecutable": "<command>",
      "runtimeArgs": ["<args>"],
      "port": <port>
    }
  ]
}`;

const CWD_REQUIRED_MESSAGE =
  "Preview tools need a workspace directory. Start the agent inside a workspace before using preview_start.";

function success(result: unknown): OttoToolResult {
  // Compact (not 2-space) JSON: preview results are small structured objects the
  // model reads fine without indentation, which was pure token inflation.
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: { ok: true, result },
  };
}

function failure(message: string): OttoToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false, error: message },
    isError: true,
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PreviewTabState {
  browserId: string | null;
  tabUrl?: string;
  note?: string;
}

interface PreviewBrokerContext {
  agentId?: string;
  cwd?: string;
  workspaceId?: string;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function findBoundTab(
  broker: Pick<BrowserToolsBroker, "execute">,
  context: PreviewBrokerContext,
  browserId: string,
): Promise<{ url: string } | null> {
  try {
    const payload = await broker.execute({
      ...context,
      command: { command: "list_tabs", args: {} },
    });
    if (payload.ok && payload.result.command === "list_tabs") {
      const tab = payload.result.tabs.find((entry) => entry.browserId === browserId);
      return tab ? { url: tab.url ?? "" } : null;
    }
  } catch {
    // Treat lookup failures as "tab not found" — the open path reports errors.
  }
  return null;
}

/**
 * Ensure the server's designated Otto browser tab exists, opening it in the
 * user's browser pane when needed. Never fails the server start: browser
 * problems come back as a note so the agent (and user) know the state.
 */
async function ensurePreviewTab(params: {
  broker: Pick<BrowserToolsBroker, "execute"> | null;
  manager: PreviewDevServerHost;
  server: PreviewServerSummary;
  context: PreviewBrokerContext;
}): Promise<PreviewTabState> {
  const { broker, manager, server, context } = params;
  if (!broker) {
    return {
      browserId: null,
      note: "Browser tools are disabled on this daemon — server started without a preview tab.",
    };
  }
  if (!context.workspaceId) {
    return {
      browserId: null,
      note: "No workspace context — server started without opening a preview tab.",
    };
  }

  const bound = manager.boundTab(server.serverId);
  if (bound) {
    const existing = await findBoundTab(broker, context, bound);
    if (existing) {
      if (sameOrigin(existing.url, server.url)) {
        return { browserId: bound, tabUrl: existing.url };
      }
      return {
        browserId: bound,
        tabUrl: existing.url,
        note:
          `The preview tab is currently at ${existing.url}, not the dev server — it may have been navigated away. ` +
          `Use browser_navigate with this browserId to return to ${server.url}.`,
      };
    }
  }

  try {
    const payload = await broker.execute({
      ...context,
      command: {
        command: "new_tab",
        args: {
          url: server.url,
          layout: "split-right",
          preview: { serverId: server.serverId, serverName: server.name, cwd: server.cwd },
        },
      },
    });
    if (payload.ok && payload.result.command === "new_tab") {
      manager.bindTab(server.serverId, payload.result.browserId);
      return {
        browserId: payload.result.browserId,
        tabUrl: payload.result.url,
        ...(bound ? { note: "The previous preview tab was closed — opened a new one." } : {}),
      };
    }
    const message = payload.ok
      ? "unexpected browser host response"
      : `${payload.error.message} (${payload.error.code})`;
    return {
      browserId: null,
      note: `Server started, but no preview tab could be opened: ${message}`,
    };
  } catch (error) {
    return {
      browserId: null,
      note: `Server started, but no preview tab could be opened: ${toMessage(error)}`,
    };
  }
}

export function registerPreviewTools(options: RegisterPreviewToolsOptions): void {
  const resolveCwd = (): string | null => options.resolveCallerAgent()?.cwd ?? null;

  options.registerTool(
    "preview_start",
    {
      title: "Start preview dev server",
      description:
        "Start a dev server by name from .claude/launch.json, and open (or re-find) its designated preview tab in the Otto browser — the same tab the user sees. " +
        "Reuses the server if already running. ALWAYS use this instead of shell commands to run dev servers. " +
        "The result's browser.browserId is the tab to verify against: pass it to browser_snapshot, browser_click, browser_screenshot, etc. Don't open extra tabs for verification. " +
        "If .claude/launch.json doesn't exist, create it first with this format:\n" +
        LAUNCH_JSON_FORMAT +
        '\nSet "runtimeExecutable" to the command (e.g. "npm"), "runtimeArgs" to the arguments (e.g. ["run", "dev"]), and "port" to the server port. ' +
        "Only include servers you actually need to preview.",
      inputSchema: {
        name: z.string().min(1).describe("Server name from .claude/launch.json"),
      },
      outputSchema: PreviewToolOutputSchema,
    },
    async (input: { name: string }) => {
      const caller = options.resolveCallerAgent();
      if (!caller?.cwd) {
        return failure(CWD_REQUIRED_MESSAGE);
      }
      try {
        const started = await options.manager.start({ cwd: caller.cwd, name: input.name });
        const browser = await ensurePreviewTab({
          broker: options.broker ?? null,
          manager: options.manager,
          server: started.server,
          context: {
            agentId: caller.id,
            cwd: caller.cwd,
            ...(caller.workspaceId ? { workspaceId: caller.workspaceId } : {}),
          },
        });
        return success({
          serverId: started.server.serverId,
          name: started.server.name,
          url: started.server.url,
          port: started.server.port,
          status: started.server.status,
          reused: started.reused,
          browser,
          logTail: started.logTail,
        });
      } catch (error) {
        return failure(toMessage(error));
      }
    },
  );

  options.registerTool(
    "preview_stop",
    {
      title: "Stop preview dev server",
      description: "Stop a dev server started with preview_start, killing its whole process tree.",
      inputSchema: {
        serverId: z.string().min(1).describe("Server ID to stop"),
      },
      outputSchema: PreviewToolOutputSchema,
    },
    async (input: { serverId: string }) => {
      const caller = options.resolveCallerAgent();
      if (!caller?.cwd) {
        return failure(CWD_REQUIRED_MESSAGE);
      }
      try {
        // Scoped to the caller's workspace — an agent can only stop servers
        // belonging to the workspace it runs in.
        const stopped = await options.manager.stop(input.serverId, { requireCwd: caller.cwd });
        return success(stopped);
      } catch (error) {
        return failure(toMessage(error));
      }
    },
  );

  options.registerTool(
    "preview_list",
    {
      title: "List preview dev servers",
      description:
        "List dev servers started with preview_start. Returns serverIds for use with the other preview_* tools.",
      inputSchema: {},
      outputSchema: PreviewToolOutputSchema,
    },
    async () => {
      const cwd = resolveCwd();
      return success({ servers: options.manager.list(cwd ?? undefined) });
    },
  );

  options.registerTool(
    "preview_logs",
    {
      title: "Read preview dev server logs",
      description:
        "Get server stdout/stderr output. Use to check for build errors, verify server behavior, or read debug output. " +
        "Use 'level': 'error' to show only lines containing error/exception/failed/fatal, or 'search' to filter for specific text. " +
        "Use after preview_start.",
      inputSchema: {
        serverId: z.string().min(1).describe("Server ID"),
        lines: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Max lines to return (default: 50)"),
        level: z
          .enum(["all", "error"])
          .optional()
          .describe("Filter: 'all' (default) or 'error' (only error-looking lines)"),
        search: z.string().optional().describe("Filter to lines containing this text"),
      },
      outputSchema: PreviewToolOutputSchema,
    },
    async (input: {
      serverId: string;
      lines?: number;
      level?: "all" | "error";
      search?: string;
    }) => {
      const caller = options.resolveCallerAgent();
      if (!caller?.cwd) {
        return failure(CWD_REQUIRED_MESSAGE);
      }
      const server = options.manager.getServer(input.serverId);
      if (server && server.cwd !== caller.cwd) {
        return failure(`Server "${input.serverId}" belongs to a different workspace.`);
      }
      try {
        const lines = options.manager.logs(input.serverId, {
          ...(input.lines !== undefined ? { lines: input.lines } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.search !== undefined ? { search: input.search } : {}),
        });
        return success({ lines });
      } catch (error) {
        return failure(toMessage(error));
      }
    },
  );
}
