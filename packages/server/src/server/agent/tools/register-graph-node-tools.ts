import type { Logger } from "pino";
import type { AgentManager } from "../agent-manager.js";
import {
  getOutputFieldsFromLabels,
  getQueryToolsFromLabels,
} from "@otto-code/protocol/agent-labels";
import {
  type NodeOutputStore,
  compileOutputToolInputShape,
  validateNodeOutput,
} from "../../workflow/node-output.js";
import { executeQueryTool, queryToolName } from "../../workflow/node-query-tools.js";
import type { OttoToolDefinition, OttoToolResult } from "./types.js";

/**
 * Tools that belong to one graph node rather than to Otto: its submit_output
 * channel and its author-defined lookups. Both are read from the agent's own
 * labels, so they exist for exactly one agent and reach every provider the same
 * way (MCP-served seats through the daemon's MCP server, openai-compat seats
 * through the native tool loop).
 */
export function registerGraphNodeTools(input: {
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
