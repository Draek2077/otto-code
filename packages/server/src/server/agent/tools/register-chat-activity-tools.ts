import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { curateAgentActivity } from "../activity-curator.js";
import { selectItemsByProjectedLimit } from "../timeline-projection.js";
import { ensureAgentLoaded } from "../agent-loading.js";
import { setAgentModeCommand } from "../lifecycle-command.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

/**
 * Default window for `get_chat_activity` when the caller omits `limit`. Bounds
 * an otherwise-unbounded child-transcript dump; the arg stays opt-in for more.
 */
const GET_AGENT_ACTIVITY_DEFAULT_LIMIT = 50;

/**
 * Ceiling on the same arg. The default bounded the no-arg call, but `limit`
 * itself was unbounded, so "pass `limit` for more" was an open invitation to
 * ask for the whole child transcript in one result. Paging with repeated calls
 * is the supported way past this.
 */
const GET_AGENT_ACTIVITY_MAX_LIMIT = 500;

type Dependencies = Pick<OttoToolContext, "agentManager" | "agentStorage" | "childLogger"> & {
  registerTool: RegisterOttoTool;
};

export function registerChatActivityTools({
  agentManager,
  agentStorage,
  childLogger,
  registerTool,
}: Dependencies): void {
  registerTool(
    "get_chat_activity",
    {
      title: "Get chat activity",
      description: "Return recent chat timeline entries as a curated summary.",
      inputSchema: {
        agentId: z.string(),
        limit: z
          .number()
          .max(GET_AGENT_ACTIVITY_MAX_LIMIT)
          .optional()
          .describe("Optional limit for number of activities to include (most recent first)."),
      },
      outputSchema: {
        agentId: z.string(),
        updateCount: z.number(),
        currentModeId: z.string().nullable(),
        content: z.string(),
      },
    },
    async ({ agentId, limit }) => {
      await ensureAgentLoaded(agentId, {
        agentManager,
        agentStorage,
        logger: childLogger,
      });
      const timeline = agentManager.getTimeline(agentId);
      const snapshot = agentManager.getAgent(agentId);

      // Default to a bounded window: `limit ?? 0` meant the entire child
      // transcript, which for a long-running agent is an unbounded dump that
      // gets replayed on every round. Callers can still opt into more (or all,
      // via a large limit) with the arg.
      const effectiveLimit = limit ?? GET_AGENT_ACTIVITY_DEFAULT_LIMIT;
      const selection = selectItemsByProjectedLimit({
        items: timeline,
        direction: "tail",
        limit: effectiveLimit,
      });
      const curatedContent = curateAgentActivity(selection.items);
      const { totalProjected, shownProjected } = selection;

      const noun = totalProjected === 1 ? "activity" : "activities";
      const countHeader =
        shownProjected < totalProjected
          ? `Showing the ${shownProjected} most recent of ${totalProjected} ${noun}` +
            (limit === undefined
              ? ` (default limit ${effectiveLimit}; pass \`limit\` for more)`
              : ` (limited to ${limit})`)
          : `Showing all ${totalProjected} ${noun}`;

      const contentWithCount = `${countHeader}\n\n${curatedContent}`;

      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId,
          updateCount: timeline.length,
          currentModeId: snapshot?.currentModeId ?? null,
          content: contentWithCount,
        }),
      };
    },
  );

  registerTool(
    "set_chat_mode",
    {
      title: "Set chat mode",
      description:
        "Switch the chat's permission/runtime mode (plan, bypassPermissions, read-only, auto, etc.).",
      inputSchema: {
        agentId: z.string(),
        modeId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
        newMode: z.string(),
      },
    },
    async ({ agentId, modeId }) => {
      const result = await setAgentModeCommand({ agentManager }, { agentId, modeId });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true, newMode: result.modeId }),
      };
    },
  );
}
