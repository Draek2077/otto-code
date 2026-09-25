import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<OttoToolContext, "agentManager" | "callerAgentId" | "resolveScopedCwd"> & {
  registerTool: RegisterOttoTool;
};

export function registerTasksTools({
  agentManager,
  callerAgentId,
  resolveScopedCwd,
  registerTool,
}: Dependencies): void {
  registerTool(
    "suggest_task",
    {
      title: "Suggest a task",
      description:
        "Create a deferred suggested-task card. Flag an out-of-scope issue as follow-up work the user can start later " +
        "in its own chat. This does not start work.\n\n" +
        "Call this on your own initiative, without being asked, whenever you notice something " +
        "worth doing that would bloat the current change: dead code, stale docs, missing test " +
        "coverage, a confirmed TODO, a refactor, or a bug spotted in passing. Noticing it is the " +
        "trigger - do not wait for permission and do not just mention it in prose.\n\n" +
        'Also call this whenever the user asks for one, in any of their words: "suggest a task", ' +
        '"suggest tasks", "make that a task", "add a task", "queue that up", "spin that off", ' +
        '"flag that for later", "note that for later", "spawn a task". These all mean this tool.\n\n' +
        "Don't flag vague code-smell hunches, trivial fixes you can just do inline, or " +
        "low-confidence guesses.\n\n" +
        "A card appears for the user, who acts on it asynchronously (new worktree, locally, this " +
        "session, or dismiss). Your current turn continues uninterrupted and the task is NOT " +
        "started automatically.",
      inputSchema: {
        title: z
          .string()
          .describe(
            "A short imperative action phrase, under 60 chars, starting with a verb - the card " +
              'label and the future chat\'s title. E.g. "Fix the flaky auth test", "Add ' +
              'parser tests".',
          ),
        prompt: z
          .string()
          .describe(
            "The self-contained initial message for the future chat - NOT shown to the user " +
              "directly. Include file paths and enough context to do the task without this " +
              "conversation.",
          ),
        tldr: z
          .string()
          .describe(
            "A 1-2 sentence plain-English summary of what the task will do and why, shown to the " +
              "user on the card. No file paths or code.",
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Optional absolute path to a different project root. Defaults to the current project.",
          ),
      },
      outputSchema: {
        task_id: z.string(),
      },
    },
    async ({ title, prompt, tldr, cwd }) => {
      if (!callerAgentId) {
        throw new Error("suggest_task must be called from a chat session");
      }
      const resolvedCwd = cwd ? resolveScopedCwd(cwd) : undefined;
      const taskId = agentManager.spawnSuggestedTask({
        parentAgentId: callerAgentId,
        title,
        prompt,
        tldr,
        ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ task_id: taskId }),
      };
    },
  );

  registerTool(
    "dismiss_task",
    {
      title: "Dismiss a suggested task",
      description:
        "Withdraw a suggested-task card you created with suggest_task, when it's now stale, " +
        "superseded, or already handled (to replace one, spawn the new card first, then dismiss the " +
        "old task_id). Only cards the user hasn't acted on can be withdrawn; if it was already " +
        "started or dismissed, the result says so - don't retry.",
      inputSchema: {
        task_id: z.string(),
        reason: z
          .string()
          .optional()
          .describe("Optional short note on why the suggestion is no longer relevant."),
      },
      outputSchema: {
        dismissed: z.boolean(),
        status: z.string(),
      },
    },
    async ({ task_id, reason }) => {
      const result = agentManager.dismissSuggestedTask(task_id, reason);
      let status: string;
      if (!result.found) {
        status = "not_found";
      } else if (result.dismissed) {
        status = "dismissed";
      } else {
        status = `already_${result.state ?? "resolved"}`;
      }
      return {
        content: [],
        structuredContent: ensureValidJson({ dismissed: result.dismissed, status }),
      };
    },
  );
}
