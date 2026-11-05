import type { Logger } from "pino";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentRunOptions, AgentTimelineItem } from "../../agent/agent-sdk-types.js";
import type { NodeOutputStore } from "./node-output.js";
import type { RunEngineAwaitResult } from "./workflow-engine.js";

const OUTPUT_CHARS = 64000;
class BoundedWorkflowReply {
  private text = "";
  private contiguous = false;
  private truncated = false;
  accept(item: AgentTimelineItem): void {
    if (item.type !== "assistant_message") {
      this.contiguous = false;
      return;
    }
    const previous = this.contiguous ? this.text : "";
    if (!this.contiguous) this.truncated = false;
    const next = previous + item.text;
    this.truncated ||= next.length > OUTPUT_CHARS;
    this.text = next.slice(-OUTPUT_CHARS);
    this.contiguous = true;
  }
  result(): string | null {
    return this.text
      ? (this.truncated
          ? "[Earlier output truncated; open the worker chat for the full result.]\n"
          : "") + this.text
      : null;
  }
}
/** Consume Paseo's ordinary turn stream without retaining tool output or a duplicate transcript. */
export async function consumeWorkflowTurn(
  agents: Pick<AgentManager, "streamAgent" | "cancelAgentRun">,
  id: string,
  text: string,
  signal: AbortSignal,
  options: AgentRunOptions,
  outputs: NodeOutputStore,
  logger: Pick<Logger, "warn">,
  denyPermission?: (requestId: string) => Promise<void>,
): Promise<RunEngineAwaitResult> {
  signal.throwIfAborted();
  let cancel: Promise<unknown> | null = null;
  const abort = () => {
    cancel ??= agents.cancelAgentRun(id).catch((error) => {
      logger.warn({ error, agentId: id }, "Workflow owned-turn cancellation failed");
      return undefined;
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  const reply = new BoundedWorkflowReply();
  let failed = false;
  let error: string | undefined;
  try {
    // Structured text cannot be interpreted as a user slash command by the provider adapter.
    for await (const event of agents.streamAgent(id, [{ type: "text", text }], options)) {
      if (event.type === "permission_requested" && denyPermission) {
        try {
          await denyPermission(event.request.id);
        } catch (denialError) {
          abort();
          throw new Error("Workflow permission denial failed; the owned turn was canceled.", {
            cause: denialError,
          });
        }
      }
      if (event.type === "timeline") reply.accept(event.item);
      if (event.type === "turn_failed") {
        failed = true;
        error = event.error.slice(0, 2000);
      }
      if (event.type === "turn_canceled") failed = true;
    }
    return {
      finalMessage: reply.result(),
      failed: failed || signal.aborted,
      ...(error ? { error } : {}),
      submittedOutput: outputs.take(id),
    };
  } finally {
    signal.removeEventListener("abort", abort);
    await cancel;
  }
}
