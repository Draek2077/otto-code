import type { ProviderSessionConfig } from "../../../server/provider.js";
import type { AgentTool } from "./tools.js";

/** Only narrows this harness. The daemon owns Workflow membership and filters the internal MCP catalog. */
export function workflowNativeTools(
  config: ProviderSessionConfig,
  tools: AgentTool[],
): AgentTool[] {
  const ceiling = config.providerOptions?.ottoWorkflowWorkspaceAccess;
  if (ceiling === "none") return [];
  if (ceiling === "read") return tools.filter((tool) => tool.access === "read");
  return tools;
}

const privateControls = new Set(["submit_output", "get_workflow_status", "delegate_workflow_task"]);
/** Internal run control can create a bounded read/none child, but cannot write the workspace. Never trust external annotations as this authority. */
export function workflowMcpAccess(
  context: { providerOptions?: Readonly<Record<string, unknown>> },
  server: string,
  name: string,
  readHint: boolean,
): AgentTool["access"] {
  const ceiling = context.providerOptions?.ottoWorkflowWorkspaceAccess;
  if (ceiling === "read" || ceiling === "none") {
    if (server !== "paseo") return "unknown";
    if (privateControls.has(name)) return "read";
    if (ceiling === "none") return "unknown";
  }
  return readHint ? "read" : "unknown";
}
