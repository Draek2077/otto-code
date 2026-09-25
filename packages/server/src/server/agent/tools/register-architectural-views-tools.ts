import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<OttoToolContext, "options" | "agentManager" | "callerAgentId"> & {
  registerTool: RegisterOttoTool;
};

export function registerArchitecturalViewsTools({
  options,
  agentManager,
  callerAgentId,
  registerTool,
}: Dependencies): void {
  if (options.architecturalViews && callerAgentId) {
    const architecturalViews = options.architecturalViews;
    const authoringCwd = (): string => {
      const cwd = agentManager.getAgent(callerAgentId)?.config.cwd;
      if (!cwd) throw new Error("Interactive View tools require an active authoring chat.");
      return cwd;
    };
    const requireBoundDraft = async (viewId: string, draftId: string) => {
      const content = await architecturalViews.getDraftContent(authoringCwd(), viewId, draftId);
      if (!content) throw new Error("Interactive View not found.");
      if (content.draft.authoringAgentId !== callerAgentId) {
        throw new Error("This chat is not the bound authoring chat for that Interactive View.");
      }
      return content.draft;
    };
    const draftInput = z.object({ viewId: z.string().min(1), draftId: z.string().min(1) });
    const draftOutput = {
      viewId: z.string(),
      draftId: z.string(),
      title: z.string(),
      diagramType: z.enum(["architecture", "workflow", "sequence", "dataflow", "lifecycle"]),
      updatedAt: z.string(),
      knowledgeReferences: z.array(z.object({ kind: z.enum(["record", "root"]), id: z.string() })),
    };

    registerTool(
      "read_architectural_view_draft",
      {
        title: "Read Interactive View",
        description:
          "Read the typed JSON specification and linked Knowledge references for the Interactive View bound to this authoring chat. Use it before editing; the specification is the canonical editable source, and the linked Knowledge is the factual source for a new or refreshed visual.",
        inputSchema: draftInput,
        outputSchema: { ...draftOutput, specification: z.json() },
      },
      async ({ viewId, draftId }) => {
        const boundDraft = await requireBoundDraft(viewId, draftId);
        const result = await architecturalViews.getDraftSpecification({
          cwd: authoringCwd(),
          viewId,
          draftId,
        });
        if (!result) throw new Error("Interactive View not found.");
        return {
          content: [],
          structuredContent: ensureValidJson({
            viewId,
            draftId,
            title: result.draft.title,
            diagramType: result.draft.diagramType,
            updatedAt: result.draft.updatedAt,
            knowledgeReferences: boundDraft.knowledgeReferences,
            specification: result.specification,
          }),
        };
      },
    );
    registerTool(
      "update_architectural_view_draft",
      {
        title: "Update Interactive View",
        description:
          "Replace the bound Interactive View's complete typed JSON specification and refresh its last-known-good preview. The published view is never changed by this tool. If validation fails, the previous preview remains available.",
        inputSchema: draftInput.extend({ specification: z.json() }),
        outputSchema: draftOutput,
      },
      async ({ viewId, draftId, specification }) => {
        await requireBoundDraft(viewId, draftId);
        const draft = await architecturalViews.updateDraftSpecification({
          cwd: authoringCwd(),
          viewId,
          draftId,
          specification,
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            viewId,
            draftId,
            title: draft.title,
            diagramType: draft.diagramType,
            updatedAt: draft.updatedAt,
          }),
        };
      },
    );
  }

  if (options.architecturalViews && callerAgentId && options.openArchitecturalView) {
    const architecturalViews = options.architecturalViews;
    registerTool(
      "show_architectural_view",
      {
        title: "Show Interactive View",
        description:
          "Open one published Interactive View in this chat's workspace. Use this when the user asks to see a diagram; it opens the interactive visual instead of pasting HTML into the conversation.",
        inputSchema: { viewId: z.string().min(1) },
        outputSchema: {
          viewId: z.string(),
          title: z.string(),
          sourceStatus: z.enum(["current", "stale", "unknown"]),
        },
      },
      async ({ viewId }) => {
        const agent = agentManager.getAgent(callerAgentId);
        const cwd = agent?.config.cwd;
        const workspaceId = agent?.workspaceId;
        if (!cwd || !workspaceId) {
          throw new Error("Interactive Views can only open from a workspace-bound chat.");
        }
        const content = await architecturalViews.getContent(cwd, viewId);
        if (!content) throw new Error("Interactive View not found.");
        options.openArchitecturalView?.({ agentId: callerAgentId, workspaceId, viewId });
        return {
          content: [],
          structuredContent: ensureValidJson({
            viewId,
            title: content.view.title,
            sourceStatus: content.view.sourceStatus,
          }),
        };
      },
    );
  }
}
