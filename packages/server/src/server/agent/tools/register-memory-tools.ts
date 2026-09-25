import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<OttoToolContext, "options" | "agentManager" | "callerAgentId"> & {
  registerTool: RegisterOttoTool;
};

export function registerMemoryTools({
  options,
  agentManager,
  callerAgentId,
  registerTool,
}: Dependencies): void {
  // -------------------------------------------------------------------------
  // Personality memory. Only registered when the host wires the store, and only
  // three tools: one reflexive write, one deliberate read, one reviewed edit.
  // See docs/agent-profiles.md § Memory (The three tools).
  // -------------------------------------------------------------------------
  if (options.personalityMemory) {
    const personalityMemory = options.personalityMemory;

    /**
     * The personality behind the calling agent. Memory is keyed to the
     * personality, not the agent - the agent is ephemeral, the personality is
     * the continuity - so an agent with no bound personality has nowhere to keep
     * anything and is told so plainly rather than silently succeeding.
     */
    const requireMemoryTarget = (): { personalityId: string; cwd: string | undefined } => {
      if (!callerAgentId) {
        throw new Error("Personality memory tools must be called from an agent session");
      }
      const agent = agentManager.getAgent(callerAgentId);
      const personalityId = agent?.config.profileSnapshot?.profileId;
      if (!personalityId) {
        throw new Error(
          "This agent has no bound personality, so there is nowhere to keep lessons. " +
            "Memory belongs to a named personality, not to a single chat.",
        );
      }
      return { personalityId, cwd: agent?.config.cwd };
    };

    registerTool(
      "remember_lesson",
      {
        title: "Remember a lesson",
        description:
          "Record something you learned, so you still know it in your next session. State the " +
          "lesson and nothing else - there is no id to track, no file to choose and no index to " +
          "maintain. Storage, placement and de-duplication are handled for you, and restating " +
          "something you already recorded reinforces it rather than duplicating it.\n\n" +
          "Call this on your own initiative whenever you learn something that will still be true " +
          "next time: a mechanism that behaves unexpectedly, a convention this project enforces, " +
          "a command that must be run a particular way, a tool that fails in a specific " +
          "situation, or an observation about how the work here actually goes.\n\n" +
          "Do NOT record: anything specific to this one task, anything already written down in " +
          "the project's own docs, secrets, or a guess you have not verified. A lesson you are " +
          "not confident in is worse than no lesson, because you will trust it later.\n\n" +
          "Write it as one short standalone paragraph that will still make sense with none of " +
          "this conversation around it.",
        inputSchema: {
          lesson: z
            .string()
            .describe(
              "The lesson, as one short standalone paragraph. Include the specific names, paths " +
                "or commands involved - a lesson too vague to act on is noise.",
            ),
          scope: z
            .enum(["project", "everywhere"])
            .optional()
            .describe(
              'Defaults to "project" (this repository only). Use "everywhere" only for lessons ' +
                "that hold regardless of which project you are working in.",
            ),
        },
        outputSchema: {
          recorded: z.boolean(),
          // "added" vs "reinforced" is worth returning: it tells the agent it had
          // already learned this, which is itself useful information.
          action: z.string(),
          total: z.number(),
        },
      },
      async ({ lesson, scope }) => {
        const target = requireMemoryTarget();
        const trimmed = lesson.trim();
        if (trimmed.length === 0) {
          throw new Error("A lesson needs some text.");
        }
        const result = await personalityMemory.record({
          personalityId: target.personalityId,
          lesson: trimmed,
          scope: scope === "everywhere" ? "global" : "project",
          ...(target.cwd ? { cwd: target.cwd } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            recorded: true,
            action: result.outcome,
            total: result.total,
          }),
        };
      },
    );

    registerTool(
      "review_lessons",
      {
        title: "Review remembered lessons",
        description:
          "Read back everything you have remembered, so it can be improved instead of just " +
          "accumulating. Returns each lesson with a short handle for revise_lesson.\n\n" +
          "Call this when the user asks what you remember or asks you to tidy your memory, and " +
          "on your own initiative when a lesson you were given contradicts what you are seeing.\n\n" +
          "Then work through them looking for lessons that are now WRONG, too VAGUE to act on, " +
          "OVERLAPPING with another, or no longer RELEVANT.\n\n" +
          "For every change you want to make, ASK THE USER FIRST - say which lesson, what you " +
          "think is wrong with it, and what you propose instead, then wait for the answer. Only " +
          "then call revise_lesson. Rewriting a lesson on your own judgement turns your " +
          "assumptions into something you will trust permanently, which is the failure this " +
          "review exists to prevent. Leaving a lesson alone is always an acceptable outcome.",
        inputSchema: {},
        outputSchema: {
          lessons: z.array(
            z.object({
              handle: z.string(),
              lesson: z.string(),
              scope: z.string(),
              learned_times: z.number(),
              recorded_at: z.string(),
            }),
          ),
          injected_now: z.number(),
        },
      },
      async () => {
        const target = requireMemoryTarget();
        const entries = await personalityMemory.list(target.personalityId);
        return {
          content: [],
          structuredContent: ensureValidJson({
            lessons: entries.map((entry) => ({
              handle: entry.id,
              lesson: entry.text,
              scope: entry.scope === "global" ? "everywhere" : "this project",
              learned_times: entry.reinforcedCount ?? 1,
              recorded_at: entry.createdAt,
            })),
            injected_now: entries.length,
          }),
        };
      },
    );

    registerTool(
      "revise_lesson",
      {
        title: "Revise a remembered lesson",
        description:
          "Apply one reviewed change to a lesson: rewrite it, change its scope, or forget it. " +
          "The handle comes from review_lessons - call that first.\n\n" +
          "Only call this after the user has agreed to this specific change. This is the " +
          "deliberate counterpart to remember_lesson: recording is reflexive, revising is not.",
        inputSchema: {
          handle: z.string().describe("The handle review_lessons gave for this lesson."),
          lesson: z
            .string()
            .optional()
            .describe("The rewritten lesson. Omit to keep the current text."),
          scope: z
            .enum(["project", "everywhere"])
            .optional()
            .describe("Move the lesson between this project and everywhere."),
          forget: z
            .boolean()
            .optional()
            .describe("True to delete the lesson outright. Overrides the other fields."),
        },
        outputSchema: {
          applied: z.boolean(),
          status: z.string(),
        },
      },
      async ({ handle, lesson, scope, forget }) => {
        const target = requireMemoryTarget();
        const applied = await personalityMemory.revise({
          personalityId: target.personalityId,
          entryId: handle,
          ...(lesson !== undefined ? { text: lesson } : {}),
          ...(scope ? { scope: scope === "everywhere" ? "global" : "project" } : {}),
          // Needed when the scope moves to "project": without a root the lesson
          // binds to no project and drops out of every brief.
          ...(target.cwd ? { cwd: target.cwd } : {}),
          ...(forget ? { drop: true } : {}),
        });
        let status: string;
        if (!applied) {
          status = "not_found";
        } else {
          status = forget ? "forgotten" : "revised";
        }
        return {
          content: [],
          structuredContent: ensureValidJson({ applied, status }),
        };
      },
    );
  }
}
