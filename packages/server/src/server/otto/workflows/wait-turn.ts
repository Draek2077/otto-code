import type { AgentManager } from "../../agent/agent-manager.js";

/** Wait for this owned chat only. Never steer/replace a user's conductor turn or poll unrelated sessions. */
export async function waitForWorkflowChatIdle(
  agents: Pick<AgentManager, "getAgent" | "hasInFlightRun" | "subscribe">,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (!agents.hasInFlightRun(id)) return;
  await new Promise<void>((resolve, reject) => {
    let release: (() => void) | null = null;
    let deferred: ReturnType<typeof setImmediate> | null = null;
    let settled = false;
    const cleanup = () => {
      release?.();
      release = null;
      if (deferred) clearImmediate(deferred);
      deferred = null;
      signal.removeEventListener("abort", aborted);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const aborted = () => finish(signal.reason ?? new Error("Workflow canceled."));
    const check = () => {
      const agent = agents.getAgent(id);
      if (!agent || agent.lifecycle === "closed") {
        finish(new Error("Workflow conductor session is closed."));
        return;
      }
      if (!agents.hasInFlightRun(id)) finish();
    };
    release = agents.subscribe(
      (event) => {
        if (event.type !== "agent_state" || event.agent.id !== id) return;
        check();
        if (!settled && event.agent.lifecycle !== "running" && !deferred) {
          // Paseo emits idle before its foreground iterator's finally settles the pending run.
          // One event-triggered next-turn check observes that boundary; there is no repeating timer.
          deferred = setImmediate(() => {
            deferred = null;
            check();
          });
        }
      },
      { agentId: id, replayState: false },
    );
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else check();
  });
}
