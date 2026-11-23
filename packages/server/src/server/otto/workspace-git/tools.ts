import { z } from "zod";
import type { PaseoToolConfig, PaseoToolResult } from "../../agent/tools/types.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { createOttoWorkspaceLifecycle } from "./lifecycle.js";

const toolName = "move_chat_to_workspace";
type Move = ReturnType<typeof createOttoWorkspaceLifecycle>["move"];
type Register = <Input>(
  name: string,
  config: PaseoToolConfig,
  handler: (input: Input) => Promise<PaseoToolResult>,
) => void;

export function registerWorkspaceMoveTool(input: {
  register: Register;
  move?: Move;
  policy?: RetainedToolPolicy;
  manager: Pick<AgentManager, "getAgent">;
  storage: Pick<AgentStorage, "get">;
  callerId?: string;
}) {
  const { register, move, callerId, manager, storage, policy } = input;
  if (!move || !policy) return;
  register(
    toolName,
    {
      title: "Move chat to workspace",
      description:
        "Move a chat to another workspace on this host. Use a destination ID from list_workspaces and an optional chat ID from list_chats. With no chat ID, move the calling chat. The chat keeps its current working directory and transcript.",
      inputSchema: {
        workspaceId: z.string().min(1).max(256),
        agentId: z.string().min(1).max(256).optional(),
      },
      outputSchema: { workspaceId: z.string() },
    },
    async (payload: { workspaceId: string; agentId?: string }) => {
      const provider = callerId ? manager.getAgent(callerId)?.provider : undefined;
      if (!(await policy(toolName, provider)))
        throw new Error("This host has disabled workspace moves for this tool session.");
      const agentId = payload.agentId ?? callerId;
      if (!agentId) throw new Error("Choose a chat to move.");
      const stored = await storage.get(agentId);
      if (!stored) throw new Error("Chat not found.");
      const current = manager.getAgent(agentId)?.workspaceId ?? stored.workspaceId ?? null;
      return {
        content: [],
        structuredContent: await move({
          agentId,
          fromWorkspaceId: current,
          workspaceId: payload.workspaceId,
        }),
      };
    },
  );
}
