import { z } from "zod";
import type { AgentManager } from "../../agent/agent-manager.js";

const Target = z
  .object({
    parentId: z.string().min(1).max(512),
    subagentId: z.string().min(1).max(512),
    workspaceId: z.string().min(1).max(512),
  })
  .strict();

export async function stopObservedSubagent(manager: AgentManager, method: string, input: unknown) {
  if (method !== "subagent.stop") return undefined;
  const target = Target.parse(input);
  await manager.stopObservedSubagent(target.parentId, target.subagentId, target.workspaceId);
  return { stopped: true };
}
