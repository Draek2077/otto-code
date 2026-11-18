import { z } from "zod";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import type { ProfileMemoryService } from "./profile-memory-service.js";

export function memoryTools(
  memory: ProfileMemoryService,
  caller: () => { id: string; cwd: string } | null,
): PaseoToolDefinition[] {
  function target() {
    const agent = caller();
    if (!agent) throw new Error("This chat needs a named Profile to remember lessons.");
    return { personalityId: agent.id, cwd: agent.cwd };
  }
  const scopeSchema = z.enum(["project", "everywhere"]);
  const remember = z.object({
    lesson: z.string().trim().min(1).max(1200),
    scope: scopeSchema.optional(),
  });
  const revise = z.object({
    handle: z.string(),
    lesson: z.string().trim().min(1).max(1200).optional(),
    scope: scopeSchema.optional(),
    forget: z.boolean().optional(),
  });
  const result = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  return [
    {
      name: "remember_lesson",
      title: "Remember a lesson",
      description:
        "Remember a verified reusable lesson for your Profile. Project scope is the default. Exclude secrets and temporary task details.",
      inputSchema: remember,
      handler: async (input) => {
        const { lesson, scope } = remember.parse(input);
        return result(
          await memory.record({
            ...target(),
            lesson,
            scope: scope === "everywhere" ? "global" : "project",
          }),
        );
      },
    },
    {
      name: "review_lessons",
      title: "Review lessons",
      description:
        "Read this Profile’s global lessons and lessons for the current project. Ask before revising or forgetting any.",
      inputSchema: z.object({}),
      handler: async () => result(await memory.forCaller(target())),
    },
    {
      name: "revise_lesson",
      title: "Revise a lesson",
      description:
        "After the user agrees to the specific edit, revise, rescope or forget a lesson returned by review_lessons.",
      inputSchema: revise,
      handler: async (input) => {
        const { handle, lesson, scope, forget } = revise.parse(input);
        const owner = target();
        if (!(await memory.forCaller(owner)).some((row) => row.handle === handle))
          throw new Error("Lesson unavailable in this project.");
        return result({
          applied: await memory.revise({
            ...owner,
            entryId: handle,
            text: lesson,
            scope: scope && (scope === "everywhere" ? "global" : "project"),
            drop: forget,
          }),
        });
      },
    },
  ];
}

export function registerProfileMemory(
  manager: import("../../agent/agent-manager.js").AgentManager,
  callerId: string | undefined,
  register: (
    name: string,
    config: PaseoToolDefinition,
    handler: PaseoToolDefinition["handler"],
  ) => void,
) {
  if (!manager.profileMemory) return;
  const definitions = memoryTools(manager.profileMemory, () => {
    const agent = callerId ? manager.getAgent(callerId) : undefined;
    return agent?.config.ottoProfile ? { id: agent.config.ottoProfile.id, cwd: agent.cwd } : null;
  });
  for (const tool of definitions) register(tool.name, tool, tool.handler);
}
