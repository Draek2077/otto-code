import os from "node:os";
import path from "node:path";
import type { ProviderOverrides } from "@getpaseo/protocol/provider-config";
import type { ContextAgent } from "./agents.js";
import { readNativeContext } from "./native-reader.js";

const pathKeys = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
] as const;
export function nativeContextInspector(ports: {
  providers(): ProviderOverrides;
  sessionEnvironment(agentId: string): Record<string, string> | undefined;
}) {
  return async (agent: ContextAgent, location: { root: string; cwd: string }) => {
    const providers = ports.providers();
    const family = providers[agent.provider]?.extends ?? agent.provider;
    if (family !== "claude" && family !== "codex" && family !== "opencode") return null;
    const session = ports.sessionEnvironment(agent.id);
    const environment: Partial<Record<(typeof pathKeys)[number], string>> = {};
    for (const key of pathKeys) {
      const value =
        session?.[key] ??
        providers[agent.provider]?.env?.[key] ??
        providers[family]?.env?.[key] ??
        process.env[key];
      if (value !== undefined) environment[key] = value;
    }
    return readNativeContext({
      ...location,
      provider: family,
      userHome: os.homedir(),
      environment,
      managedDirectory: managedDirectory(family),
    });
  };
}
function managedDirectory(provider: "claude" | "codex" | "opencode"): string | null {
  if (process.platform === "win32") {
    if (provider === "claude")
      return path.join(process.env.ProgramFiles ?? "C:\\Program Files", "ClaudeCode");
    if (provider === "opencode" && process.env.ProgramData)
      return path.join(process.env.ProgramData, "opencode");
    return null;
  }
  if (process.platform === "darwin" && provider !== "codex")
    return path.join(
      "/Library/Application Support",
      provider === "claude" ? "ClaudeCode" : "opencode",
    );
  return provider === "claude" ? "/etc/claude-code" : `/etc/${provider}`;
}
