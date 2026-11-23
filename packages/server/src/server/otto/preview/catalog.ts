import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import { isPaseoToolEnabled } from "../../agent/paseo-tool-policy.js";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { PreviewHost } from "./host.js";
import { createPreviewTools, type PreviewToolCaller } from "./tools.js";
/** Registration is inert; retained policy is checked again at each execution. */
export function registerPreviewTools(ports: {
  tools: Map<string, PaseoToolDefinition>;
  enabled?: boolean;
  host?: PreviewHost;
  policy?: RetainedToolPolicy;
  paseoPolicy?: ProviderPaseoToolsPolicy;
  caller(): PreviewToolCaller;
}) {
  if (!ports.enabled || !ports.host || !ports.policy) return;
  for (const tool of createPreviewTools({
    host: ports.host,
    policy: ports.policy,
    caller: ports.caller,
  })) {
    if (isPaseoToolEnabled(ports.paseoPolicy, tool.name)) ports.tools.set(tool.name, tool);
  }
}
