import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import { isPaseoToolEnabled } from "../../../server/agent/paseo-tool-policy.js";
import type {
  PaseoToolDefinition,
  PaseoToolRuntimeContext,
} from "../../../server/agent/tools/types.js";

export async function prepareConnectorTools(input: {
  host: { definitions(cwd: string): Promise<PaseoToolDefinition[]> };
  runtime: PaseoToolRuntimeContext;
  cwd?: string;
  enabled: boolean;
}): Promise<PaseoToolDefinition[]> {
  if (
    !input.enabled ||
    !input.runtime.callerAgentId ||
    input.runtime.voiceOnly ||
    input.runtime.callerPurpose === "history" ||
    input.runtime.paseoToolPolicy?.enabled === false ||
    !input.cwd
  )
    return [];
  return input.host.definitions(input.cwd);
}

/** Called only after the normal catalog's voice-only return. External tools
 * respect the upstream master/direct-name policy, without an internal group. */
export function registerConnectorTools(input: {
  tools: Map<string, PaseoToolDefinition>;
  definitions?: readonly PaseoToolDefinition[];
  callerAgentId?: string;
  policy?: ProviderPaseoToolsPolicy;
}): void {
  if (!input.callerAgentId) return;
  for (const tool of input.definitions ?? []) {
    if (isPaseoToolEnabled(input.policy, tool.name)) input.tools.set(tool.name, tool);
  }
}
