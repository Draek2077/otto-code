import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import {
  AgentPermissionRequestPayloadSchema,
  AgentPermissionResponseSchema,
} from "../../messages.js";
import { toAgentPayload } from "../agent-projections.js";
import { AgentStatusEnum, sanitizePermissionRequest } from "../mcp-shared.js";
import { respondToAgentPermission } from "../permission-response.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<OttoToolContext, "agentManager" | "childLogger"> & {
  registerTool: RegisterOttoTool;
};

export function registerPermissionsTools({
  agentManager,
  childLogger,
  registerTool,
}: Dependencies): void {
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
}
