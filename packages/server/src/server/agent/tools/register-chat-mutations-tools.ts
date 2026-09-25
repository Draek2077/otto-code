import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import {
  archiveAgentCommand,
  closeAgentCommand,
  updateAgentCommand,
} from "../lifecycle-command.js";
import { EFFORT_INPUT_DESCRIPTION, resolveEffortAgainstModels } from "./otto-tool-shared.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<
  OttoToolContext,
  "agentManager" | "agentStorage" | "childLogger" | "listProviderModels"
> & { registerTool: RegisterOttoTool };

export function registerChatMutationsTools({
  agentManager,
  agentStorage,
  childLogger,
  listProviderModels,
  registerTool,
}: Dependencies): void {
  const UpdateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode ID."),
      model: z.string().nullable().optional().describe("Model ID. Pass null to clear."),
      thinkingOptionId: z
        .string()
        .nullable()
        .optional()
        .describe(`${EFFORT_INPUT_DESCRIPTION} Pass null to clear.`),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
    })
    .strict();

  registerTool(
    "archive_chat",
    {
      title: "Archive chat",
      description:
        "Stop and archive a chat. It is removed from the active list but remains recoverable in the archive.",
      inputSchema: { agentId: z.string() },
      outputSchema: { success: z.boolean() },
    },
    async ({ agentId }) => {
      await archiveAgentCommand({ agentManager, agentStorage, logger: childLogger }, agentId);
      return { content: [], structuredContent: ensureValidJson({ success: true }) };
    },
  );

  registerTool(
    "delete_chat",
    {
      title: "Delete chat",
      description: "Permanently terminate and delete a chat session.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await closeAgentCommand({ agentManager }, agentId);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_chat",
    {
      title: "Update chat",
      description: "Update a chat name, labels, and/or runtime settings.",
      inputSchema: {
        agentId: z.string(),
        name: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
        settings: UpdateAgentSettingsInputSchema.optional().describe(
          "Runtime settings to apply to the chat.",
        ),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, name, labels, settings }) => {
      if (settings?.modeId !== undefined) {
        await agentManager.setAgentMode(agentId, settings.modeId);
      }
      if (settings?.model !== undefined) {
        await agentManager.setAgentModel(agentId, settings.model);
      }
      if (settings?.thinkingOptionId !== undefined) {
        let thinkingOptionId = settings.thinkingOptionId;
        const agent = agentManager.getAgent(agentId);
        if (thinkingOptionId !== null && agent) {
          // Resolve against the model this call leaves the agent on.
          const targetModel =
            settings.model !== undefined ? (settings.model ?? undefined) : agent.config.model;
          thinkingOptionId = resolveEffortAgainstModels({
            requested: thinkingOptionId,
            models: await listProviderModels(agent.provider),
            model: targetModel,
          });
        }
        await agentManager.setAgentThinkingOption(agentId, thinkingOptionId);
      }
      if (settings?.features) {
        for (const [featureId, value] of Object.entries(settings.features)) {
          await agentManager.setAgentFeature(agentId, featureId, value);
        }
      }

      await updateAgentCommand({ agentManager }, { agentId, name, labels });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );
}
