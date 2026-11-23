import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTimeout } from "../../../utils/promise-timeout.js";
import {
  CONTEXT_GENERATION_SYSTEM_PROMPT,
  NATIVE_CONTEXT_OUTPUT_LIMIT,
} from "./native-generation-policy.js";

export interface CopilotGenerationRpc {
  request(method: string, params: object): Promise<unknown>;
  notifications(listener: (value: unknown) => void): () => void;
  requests(listener: (method: string, params: unknown) => unknown): () => void;
}
export interface CopilotGenerationInput {
  cwd: string;
  model?: string;
  prompt: string;
  signal: AbortSignal;
}
const pingSchema = z.object({ protocolVersion: z.number().int().min(2).max(3) });
const sessionSchema = z.object({ sessionId: z.string().min(1) });
const notificationSchema = z.object({
  sessionId: z.string(),
  event: z.object({ type: z.string(), data: z.record(z.string(), z.unknown()).optional() }),
});
const denied = { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
const unavailable = "Tools are unavailable during Context proposal generation.";

/** Native SDK protocol v2/v3, bounded to a fresh owned session. No ACP plan-mode assumption. */
export async function runCopilotGeneration(
  rpc: CopilotGenerationRpc,
  input: CopilotGenerationInput,
): Promise<string> {
  input.signal.throwIfAborted();
  await rpc.request("ping", {}).then((value) => pingSchema.parse(value));
  const ownedId = randomUUID();
  let sessionId: string | undefined;
  let text = "";
  let bytes = 0;
  let sent = false;
  let resolveIdle!: (value: string) => void;
  let rejectIdle!: (error: Error) => void;
  const idle = new Promise<string>((resolve, reject) => {
    resolveIdle = resolve;
    rejectIdle = reject;
  });
  // Every early transport/validation failure also tears down the notification waiter.
  void idle.catch(() => undefined);
  const abort = () => rejectIdle(new Error("Context generation was canceled or timed out."));
  input.signal.addEventListener("abort", abort, { once: true });
  const releaseRequests = rpc.requests((method, params) => {
    if (method === "permission.request") return { result: denied };
    if (method === "tool.call")
      return {
        result: {
          textResultForLlm: unavailable,
          resultType: "failure",
          error: unavailable,
          toolTelemetry: {},
        },
      };
    if (method === "hooks.invoke") {
      const hook = z.object({ hookType: z.string() }).parse(params);
      return {
        output:
          hook.hookType === "preToolUse"
            ? { permissionDecision: "deny", permissionDecisionReason: unavailable }
            : {},
      };
    }
    throw new Error("Unsupported request in Context generation.");
  });
  const releaseNotifications = rpc.notifications((value) => {
    const parsed = notificationSchema.safeParse(value);
    if (!parsed.success || parsed.data.sessionId !== sessionId || !sent) return;
    const event = parsed.data.event;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") {
      bytes += Buffer.byteLength(event.data.content, "utf8");
      if (bytes > NATIVE_CONTEXT_OUTPUT_LIMIT)
        rejectIdle(new Error("Context generation text exceeded its limit."));
      else text = event.data.content;
    }
    if (event.type === "session.idle") resolveIdle(text);
    if (event.type === "session.error") rejectIdle(new Error("Copilot Context generation failed."));
    if (event.type === "permission.requested" || event.type === "external_tool.requested") {
      const requestId = event.data?.requestId;
      if (typeof requestId !== "string") {
        rejectIdle(new Error("Invalid native permission request."));
        return;
      }
      const response =
        event.type === "permission.requested"
          ? rpc.request("session.permissions.handlePendingPermissionRequest", {
              sessionId,
              requestId,
              result: denied,
            })
          : rpc.request("session.tools.handlePendingToolCall", {
              sessionId,
              requestId,
              error: unavailable,
            });
      void response.catch(() => rejectIdle(new Error("Unable to deny native tool request.")));
    }
  });
  try {
    const created = sessionSchema.parse(
      await rpc.request("session.create", {
        sessionId: ownedId,
        clientName: "Otto",
        model: input.model,
        workingDirectory: input.cwd,
        systemMessage: { mode: "replace", content: CONTEXT_GENERATION_SYSTEM_PROMPT },
        tools: [],
        availableTools: [],
        mcpServers: {},
        customAgents: [],
        skillDirectories: [],
        requestPermission: true,
        requestUserInput: false,
        hooks: true,
        streaming: true,
        infiniteSessions: { enabled: false },
        envValueMode: "direct",
      }),
    );
    // Never destroy a host-returned foreign ID, even when a malformed server response supplies one.
    if (created.sessionId !== ownedId)
      throw new Error("Native generation session identity did not match.");
    sessionId = created.sessionId;
    input.signal.throwIfAborted();
    sent = true;
    await rpc.request("session.send", { sessionId, prompt: input.prompt });
    const result = await idle;
    if (!result.trim()) throw new Error("Copilot returned no Context proposal text.");
    return result;
  } finally {
    input.signal.removeEventListener("abort", abort);
    releaseNotifications();
    releaseRequests();
    // Only the utility session we created. Existing Copilot chats are never enumerated or touched.
    if (sessionId)
      await withTimeout(
        rpc.request("session.delete", { sessionId }),
        3000,
        "Native utility session cleanup timed out.",
      );
  }
}
