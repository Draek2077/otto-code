import type { AgentSession, AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import type { PiRuntime, PiRuntimeSession } from "../../agent/providers/pi/runtime.js";
import type { PiSessionState } from "../../agent/providers/pi/rpc-types.js";

/** No MCP probe or generated extension: the native CLI starts with an empty tool set. */
export async function createReadOnlyPiSession(
  runtime: PiRuntime,
  config: AgentSessionConfig,
  env: Record<string, string> | undefined,
  attach: (session: PiRuntimeSession, state: PiSessionState) => AgentSession,
): Promise<AgentSession> {
  const session = await runtime.startSession({
    cwd: config.cwd,
    model: config.model,
    noSession: true,
    env,
    ottoReadOnlyGeneration: true,
    extraArgs: ["--system-prompt", config.systemPrompt ?? ""],
  });
  try {
    return attach(session, await session.getState());
  } catch (error) {
    await session.close().catch(() => undefined);
    throw error;
  }
}
