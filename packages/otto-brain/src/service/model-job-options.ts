/** The same bounded admission contract is used by host requests and CLI commands. */
import { z } from "zod/v3";

const modelId = z.string().min(1);
export const SweepBudgetsSchema = z
  .array(z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER))
  .min(1)
  .max(64);
export const ModelJobRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("calibrate"), modelId }).strict(),
  z
    .object({ operation: z.literal("sweep"), modelId, budgets: SweepBudgetsSchema.optional() })
    .strict(),
  z.object({ operation: z.literal("benchmark"), modelId }).strict(),
]);
export type ModelJobRequest = z.infer<typeof ModelJobRequestSchema>;
