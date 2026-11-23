import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const text = z.string().trim().min(1).max(1200);
const scope = z.enum(["project", "global"]);
const base = z.object({ profileId: id, workspaceId: z.string().min(1).optional() });
export const MemoryAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("counts") }),
  base.extend({ kind: z.literal("view") }),
  base.extend({ kind: z.literal("add"), text, scope }),
  base.extend({
    kind: z.literal("edit"),
    entryId: z.string(),
    expectedUpdatedAt: z.string().optional(),
    text,
    scope,
  }),
  base.extend({
    kind: z.literal("forget"),
    entryId: z.string(),
    expectedUpdatedAt: z.string().optional(),
  }),
  base.extend({ kind: z.literal("transfer"), destination: id }),
  base.extend({ kind: z.literal("clear") }),
]);
const entry = z.object({
  id: z.string(),
  text: z.string(),
  scope,
  projectRoot: z.string().optional(),
  source: z.string(),
  updatedAt: z.string(),
  reinforcedCount: z.number().optional(),
  transferredFrom: z.string().optional(),
});
export const MemoryResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("view"),
    enabled: z.boolean(),
    entries: z.array(entry),
    brief: z.object({ text: z.string(), estTokens: z.number() }),
  }),
  z.object({ kind: z.literal("counts"), counts: z.record(z.string(), z.number()) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type MemoryAction = z.infer<typeof MemoryAction>;
export type MemoryView = Extract<z.infer<typeof MemoryResult>, { kind: "view" }>;
export const MemoryRequest = z.object({
  type: z.literal("agent.profile.memory.request"),
  requestId: z.string(),
  input: MemoryAction,
});
export const MemoryResponse = z.object({
  type: z.literal("agent.profile.memory.response"),
  payload: z.object({ requestId: z.string(), result: MemoryResult }),
});
