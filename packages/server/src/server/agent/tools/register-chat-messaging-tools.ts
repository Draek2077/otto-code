import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { AgentPermissionRequestPayloadSchema } from "../../messages.js";
import {
  AgentStatusEnum,
  sanitizePermissionRequest,
  waitForAgentWithTimeout,
} from "../mcp-shared.js";
import { sendPromptToAgent, setupFinishNotification } from "../agent-prompt.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<
  OttoToolContext,
  "agentManager" | "agentStorage" | "callerAgentId" | "onActivity" | "childLogger"
> & { registerTool: RegisterOttoTool };

export function registerChatMessagingTools({
  agentManager,
  agentStorage,
  callerAgentId,
  onActivity,
  childLogger,
  registerTool,
}: Dependencies): void {
  const commonSendAgentPromptInputSchema = {
    agentId: z.string(),
    prompt: z.string(),
    sessionMode: z.string().optional().describe("Optional mode to set before running the prompt."),
    delivery: z
      .enum(["interrupt", "steer", "queue"])
      .optional()
      .describe(
        "How to reach a BUSY chat. Omit to use the host's Default send setting. 'steer' adds this prompt to the active turn (or interrupts if the provider cannot steer); 'interrupt' cancels the active turn and runs now; 'queue' runs after the active turn completes. An idle chat runs the prompt immediately with any choice.",
      ),
  };

  const agentToAgentSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    background: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Run agent in background. Agent-scoped default is true so you can continue until the finish notification arrives. Set false only when you need a blocking response.",
      ),
    // Left as bare .optional() (no schema default) so the handler can tell an
    // explicit choice from an omission and fall back to the daemon
    // agentBehaviors.notifyOnFinishDefault toggle (default true). See WP-E.
    notifyOnFinish: z
      .boolean()
      .optional()
      .describe(
        "Get notified when the prompted agent finishes, errors, or needs permission. Defaults to the host's notify-on-finish setting; set false only for truly fire-and-forget prompts.",
      ),
  };

  const topLevelSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run agent in background. If false (default), waits for completion or permission request. If true, returns immediately.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the prompted agent finishes, errors, or needs permission.",
      ),
  };

  const sendAgentPromptInputSchema = callerAgentId
    ? agentToAgentSendAgentPromptInputSchema
    : topLevelSendAgentPromptInputSchema;

  registerTool(
    "send_chat_prompt",
    {
      title: "Send chat prompt",
      description:
        "Send a prompt to an active, existing Otto chat by its agentId. Use list_chats first when you need to identify a collaborator. Chat-scoped callers continue in the background by default; top-level callers wait by default. Omit delivery to follow the host's Default send setting; set it explicitly only when this prompt needs different timing.",
      inputSchema: sendAgentPromptInputSchema,
      outputSchema: {
        success: z.boolean(),
        status: AgentStatusEnum,
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
        guidance: z.string().optional(),
      },
    },
    async ({
      agentId,
      prompt,
      sessionMode,
      background = Boolean(callerAgentId),
      notifyOnFinish,
      delivery,
    }: {
      agentId: string;
      prompt: string;
      sessionMode?: string;
      background?: boolean;
      notifyOnFinish?: boolean;
      delivery?: "interrupt" | "steer" | "queue";
    }) => {
      // Omitted → fall back to the daemon notify-on-finish default (default
      // true, preserving prior behavior); an explicit arg still overrides. The
      // callerAgentId gate below keeps top-level (unwatched) sends silent.
      const resolvedNotifyOnFinish =
        notifyOnFinish ?? agentManager.getAgentBehaviors().notifyOnFinishDefault;
      const shouldNotifyOnFinish = Boolean(callerAgentId && resolvedNotifyOnFinish && background);
      const effectiveDelivery = delivery ?? agentManager.getAgentBehaviors().defaultSendBehavior;
      onActivity?.("backgroundTasksInvoked", Number(background));

      // The shared prompt path has two wire deliveries. Steer is its separate
      // active-turn behavior, so it uses immediate delivery without queueing.
      const dispatch = await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        sessionMode,
        delivery: effectiveDelivery === "queue" ? "queue" : "interrupt",
        ...(effectiveDelivery === "steer" ? { activeTurnBehavior: "steer" as const } : {}),
        // Agent-to-agent sends carry their own framing; never merge one into a
        // neighbouring message when the queue drains.
        source: "system",
        logger: childLogger,
      });

      if (shouldNotifyOnFinish && callerAgentId) {
        setupFinishNotification({
          agentManager,
          agentStorage,
          childAgentId: agentId,
          callerAgentId,
          logger: childLogger,
        });
      }

      // If not running in background, wait for completion
      if (!background) {
        const result = await waitForAgentWithTimeout(agentManager, agentId, {
          waitForActive: true,
        });

        const responseData = {
          success: true,
          status: result.status,
          lastMessage: result.lastMessage,
          permission: sanitizePermissionRequest(result.permission),
        };
        const validJson = ensureValidJson(responseData);

        const response = {
          content: [],
          structuredContent: validJson,
        };
        return response;
      }

      // Return immediately if background=true
      // Re-fetch snapshot since the state may have changed
      const currentSnapshot = agentManager.getAgent(agentId);

      const queuedGuidance =
        dispatch.disposition === "queued"
          ? "The chat was busy, so your prompt is queued and will run as its next turn. Nothing was interrupted."
          : null;
      const notifyGuidance = shouldNotifyOnFinish
        ? "You will get notified when the prompted chat finishes, errors, or needs permission. Do not poll for status; continue with other work until the notification arrives."
        : null;
      const guidance = [queuedGuidance, notifyGuidance].filter(Boolean).join(" ");
      const responseData = {
        success: true,
        status: currentSnapshot?.lifecycle ?? "idle",
        lastMessage: null,
        permission: null,
        ...(guidance ? { guidance } : {}),
      };
      const validJson = ensureValidJson(responseData);

      const response = {
        content: [],
        structuredContent: validJson,
      };
      return response;
    },
  );
}
