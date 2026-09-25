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
      .enum(["interrupt", "queue"])
      .optional()
      .default("interrupt")
      .describe(
        "How to reach the agent if it is BUSY. 'interrupt' (default) cancels whatever it is doing and runs your prompt now - use it for corrections that must land immediately. 'queue' lets the current turn finish and runs your prompt as the next one - use it for a follow-up that should not throw away work in progress. If the agent is idle both run it immediately.",
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
        "Send a prompt to an active, existing Otto chat by its agentId. Use list_chats first when you need to identify a collaborator. Chat-scoped callers continue in the background by default; top-level callers wait by default. Use delivery queue to preserve a busy chat's current turn, or interrupt only when the new prompt must take precedence.",
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
      delivery = "interrupt",
    }: {
      agentId: string;
      prompt: string;
      sessionMode?: string;
      background?: boolean;
      notifyOnFinish?: boolean;
      delivery?: "interrupt" | "queue";
    }) => {
      // Omitted → fall back to the daemon notify-on-finish default (default
      // true, preserving prior behavior); an explicit arg still overrides. The
      // callerAgentId gate below keeps top-level (unwatched) sends silent.
      const resolvedNotifyOnFinish =
        notifyOnFinish ?? agentManager.getAgentBehaviors().notifyOnFinishDefault;
      const shouldNotifyOnFinish = Boolean(callerAgentId && resolvedNotifyOnFinish && background);
      onActivity?.("backgroundTasksInvoked", Number(background));

      const dispatch = await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        sessionMode,
        delivery,
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
