import type { WorkspaceScriptPayload } from "@otto-code/protocol/messages";
import type { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type { DiscoveredScriptEntry } from "./script-provider.js";

/**
 * Wire payloads for the Scripts a project declares for itself.
 *
 * Always `type: "script"`, never `"service"`: a service payload carries a
 * proxy route, and a proxy route needs a declared port plus the *intent* that
 * the thing serves HTTP. `package.json` cannot tell us either — `npm run dev`
 * might be a server, a watcher or a one-shot — and a dead proxy URL is worse
 * than none. A user who wants a routed URL declares the Script in otto.json.
 */
export function buildDiscoveredScriptPayloads(input: {
  workspaceId: string;
  discovered: readonly DiscoveredScriptEntry[];
  runtimeStore: WorkspaceScriptRuntimeStore;
}): WorkspaceScriptPayload[] {
  return input.discovered.map((entry) => {
    const runtime = input.runtimeStore.get({
      workspaceId: input.workspaceId,
      scriptName: entry.scriptName,
    });
    return {
      scriptName: entry.scriptName,
      label: entry.name,
      source: { id: entry.sourceId, label: entry.sourceLabel, file: entry.sourceFile },
      command: entry.command,
      type: "script",
      hostname: entry.scriptName,
      port: null,
      proxyUrl: null,
      lifecycle: runtime?.lifecycle ?? "stopped",
      health: null,
      exitCode: runtime?.exitCode ?? null,
      terminalId: runtime?.terminalId ?? null,
    };
  });
}
