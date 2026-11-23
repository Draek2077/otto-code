import { z } from "zod";
import { reasoningFieldsSchema } from "./completions.js";
import { storedContentSchema } from "./prompt-content.js";
import { preferencesSchema } from "./session-config.js";
import { contextStateSchema } from "./context-history.js";

const savedMessage = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(storedContentSchema)]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    ...reasoningFieldsSchema.shape,
    tool_calls: z
      .array(
        z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() }),
        }),
      )
      .optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string(), content: z.string() }),
]);
export const savedSession = z.object({
  format: z.literal("otto-openai-compatible-v1"),
  endpoint: z.string(),
  messages: z.array(savedMessage),
  timeline: z.array(z.json()),
  timelineTimestamps: z.record(z.string(), z.string()).optional(),
  pendingToolImages: z.array(storedContentSchema).optional(),
  preferences: preferencesSchema.optional(),
  cacheKey: z.string().min(1).optional(),
  context: contextStateSchema.optional(),
  // COMPAT(otto09Origin): v0.10.0, review after 2027-04-22 with the old thinking-field adapter.
  legacyOrigin: z.object({ provider: z.string(), sessionId: z.string() }).optional(),
});
